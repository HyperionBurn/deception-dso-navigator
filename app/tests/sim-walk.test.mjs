import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import route from '../api/route.mjs';
import { COURSE_DESTINATIONS, FLOOR_MAP } from '../lib/floor-map.mjs';

// Walk simulation for the route tool, on the real production map.
//
// A simulated agent follows agent/system-prompt.txt: ask for a destination, say each step, wait for the
// operator, report back, repeat. A simulated operator really stands somewhere on the map graph (a place
// and a facing) and answers in different ways. Every question goes through the real HTTP handler.
//
// The checks do not copy the planner. They read the places and legs straight from FLOOR_MAP and use their
// own small shortest-route search, so a wrong step shows up as a failure here.
//
// Everything is fixed: seeds are constants, nothing uses the network or the clock.

const ROUTE_KEY = 'sim-walk-made-up-key'; // made up, only used inside this test
const ROUTE_URL = 'https://example.invalid/api/route';

// ---------- what the map says (read from FLOOR_MAP only) ----------
const ANCHORS = new Map(FLOOR_MAP.anchors.map(anchor => [anchor.id, anchor]));
const EDGES = FLOOR_MAP.edges;
const PLACES = [...ANCHORS.keys()];
const poseName = pose => pose?.facing ?? pose?.heading ?? null;
const poseFields = pose => (pose?.facing ? { facing: pose.facing } : pose?.heading ? { heading: pose.heading } : {});
const FACINGS = [...new Set(EDGES.flatMap(edge => [edge.entry_pose, edge.exit_pose]).map(poseName).filter(Boolean))];
const STEP_CAP = PLACES.length + 3;
const MAX_ASKS = 4; // after this many questions in a row the agent holds and asks a person
const isMapped = id => COURSE_DESTINATIONS.includes(id) && ANCHORS.has(id);
const MAPPED = COURSE_DESTINATIONS.filter(isMapped);
const START = FLOOR_MAP.start;
const signLetter = anchor => anchor.aliases.map(alias => /^sign ([A-F])$/u.exec(alias)?.[1]).find(Boolean);
const SIGN_PLACES = PLACES.filter(id => signLetter(ANCHORS.get(id)));
// What the robot camera calls a place (see marker_name in robot/bridge/navigator_bridge.py).
const cameraName = id => (signLetter(ANCHORS.get(id)) ? `sign ${signLetter(ANCHORS.get(id))}` :
  `the ${id === 'team_tables' ? 'team tables' : id.replace(/_/gu, ' ')} marker`);
const entryOk = (edge, pose) => edge.entry_pose === null || poseName(edge.entry_pose) === pose;
const usableFacings = node => [...new Set(EDGES.filter(edge => edge.from === node).map(edge => poseName(edge.entry_pose)))];
// A facing label that is also a place name cannot be told apart by the tool, so saying it earns a
// safe hold, not a step. Derived from the map: the facing's words equal a landmark's words.
const LANDMARK_WORDS = new Set(PLACES.map(id => ANCHORS.get(id).landmark.toLowerCase().replace(/^the\s+/u, '')));
const UNSPEAKABLE = new Set(FACINGS.filter(facing => LANDMARK_WORDS.has(facing.toLowerCase())));
const SPEAKABLE_FACINGS = FACINGS.filter(facing => !UNSPEAKABLE.has(facing));
const speakableFacings = node => usableFacings(node).filter(facing => !UNSPEAKABLE.has(facing));

// Number of legs on the shortest checked route, or null when there is none.
function legsToGo(node, pose, destination) {
  if (node === destination) return 0;
  const seen = new Set([`${node}|${pose}`]);
  let layer = [{ node, pose }];
  for (let depth = 1; layer.length; depth++) {
    const next = [];
    for (const state of layer) {
      for (const edge of EDGES) {
        if (edge.from !== state.node || !entryOk(edge, state.pose)) continue;
        if (edge.to === destination) return depth;
        const after = { node: edge.to, pose: poseName(edge.exit_pose) };
        const key = `${after.node}|${after.pose}`;
        if (!seen.has(key)) {
          seen.add(key);
          next.push(after);
        }
      }
    }
    layer = next;
  }
  return null;
}

// ---------- small helpers ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const upper = text => text.toUpperCase();
const isArabic = text => /\p{Script=Arabic}/u.test(text);
const arabicName = id => ANCHORS.get(id).aliases.find(isArabic);
const heardWords = text => text.split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;

// ---------- how the operator talks ----------
const FILLERS = {
  en: [t => `um, I think I am at ${t}`, t => `uh we are stopped near ${t}`,
    t => `okay, I'm standing at ${t} now`, t => `so the robot is at ${t}, sorry`],
  ar: [t => `يعني انا عند ${t}`, t => `اوه نحن عند ${t} الحين`],
};
const PUNCTUATION = [t => `${t}!!!`, t => `...${t}?`, t => `"${t}",`,
  t => t.replace(/ /gu, ' , '), t => t.replace(/ /gu, '-'), t => `  ${t.replace(/ /gu, '   ')}  `];

// Every way the operator may name one place, grouped by style.
function namesFor(anchor) {
  const texts = [anchor.landmark, ...anchor.aliases];
  return {
    exact: [anchor.landmark],
    alias: anchor.aliases,
    upper: texts.map(upper),
    punctuation: texts.flatMap(text => PUNCTUATION.map(wrap => wrap(text))),
    filler: texts.flatMap(text => FILLERS[isArabic(text) ? 'ar' : 'en'].map(wrap => wrap(text))),
  };
}
const NAMES = new Map(PLACES.map(id => [id, namesFor(ANCHORS.get(id))]));

// Ways to say which way the robot faces. "exact" is the label the tool lists in known_facings.
const FACING_WORDS = {
  exact: label => label,
  the: label => `the ${label}`,
  upper: label => `THE ${upper(label)}`,
  facing: label => `facing the ${label}.`,
  toward: label => `toward the ${label}`,
  towards: label => `towards ${label}`,
  looking: label => `looking at the ${label}`,
};

function makeSpeech(sim) {
  let first = sim.firstPlace ?? null;
  return {
    place(node) {
      if (first) {
        const text = first;
        first = null;
        return text;
      }
      return pick(sim.rng, NAMES.get(node)[sim.placeStyle ?? 'exact']);
    },
    facing: label => {
      // facingOverride is the first facing the operator says (the next stop's name); after that
      // the robot has moved and the real pose facing is spoken again.
      if (sim.facingOverride) {
        const text = sim.facingOverride;
        sim.facingOverride = null;
        return text;
      }
      return FACING_WORDS[sim.facingStyle ?? 'exact'](label);
    },
  };
}

// ---------- talking to the tool ----------
async function callTool(body) {
  const response = await route.fetch(new Request(ROUTE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-navigator-route-key': ROUTE_KEY },
    body: JSON.stringify(body),
  }));
  return { http: response.status, result: await response.json() };
}

// What the agent says aloud after "Operator," (command and arrival question), by the prompt's wording.
const operatorLines = result => (result.status === 'step' ? [result.command] :
  result.status === 'at_destination' ? [`stop here. Can you confirm we're at ${result.expected_landmark}?`] : []);
const otherSpokenText = result => [result.expected_landmark, result.destination_landmark,
  ...(result.known_landmarks ?? []), ...(result.candidates ?? []), ...(result.known_facings ?? [])]
  .filter(text => typeof text === 'string');

// Rules that hold for every reply, whatever the operator did.
function checkReply({ result, destination, asksForPlace }) {
  const out = [];
  if (!['step', 'needs_anchor', 'unverified', 'at_destination'].includes(result.status)) {
    return [`unknown status "${result.status}"`];
  }
  if (!isMapped(destination) && result.status !== 'unverified') {
    out.push(`"${result.status}" for a destination that is not mapped (${destination})`);
  }
  if (asksForPlace && isMapped(destination) && result.status !== 'needs_anchor') {
    out.push(`"${result.status}" when the tool was given no position`);
  }
  if (result.status === 'unverified' && (result.mapped_destinations ?? []).includes(destination)) {
    out.push('offers the asked-for place as a different place');
  }
  for (const line of operatorLines(result)) {
    if (!line.trim()) out.push('empty command');
    if (heardWords(line) > 12) out.push(`more than 12 words: "${line}"`);
  }
  for (const text of [...operatorLines(result), ...otherSpokenText(result)]) {
    if (/\b(north|south|east|west)\b/iu.test(text)) out.push(`compass word in "${text}"`);
    if (/\w_\w/u.test(text)) out.push(`id in spoken text: "${text}"`);
  }
  if (result.status === 'at_destination') {
    if (result.destination_id !== destination || result.expected_landmark !== ANCHORS.get(destination)?.landmark ||
      result.requires_physical_confirmation !== true) out.push('at_destination has the wrong fields');
  }
  if (result.status === 'needs_anchor') {
    const reasons = ['current_anchor_required', 'ambiguous_landmark', 'current_orientation_required'];
    if (!reasons.includes(result.reason)) out.push(`unknown needs_anchor reason "${result.reason}"`);
    if (result.reason === 'current_orientation_required' && !(result.known_facings?.length > 0)) {
      out.push('orientation question without known_facings');
    }
    if (result.reason === 'ambiguous_landmark' && !(result.candidates?.length > 1)) out.push('ambiguity without candidates');
  }
  return out;
}

// Is this step something the robot can really do from where it truly stands? Returns { edge } or { problem }.
function checkStep(truth, destination, step) {
  const best = legsToGo(truth.node, truth.pose, destination);
  if (best === null) return { problem: `a step was given but no checked route exists from ${truth.node} facing ${truth.pose}` };
  const action = /^turn left\b/iu.test(step.command) ? 'left_then_straight' :
    /^turn right\b/iu.test(step.command) ? 'right_then_straight' :
      /^turn around\b/iu.test(step.command) ? 'around_then_straight' :
        /^face\b/iu.test(step.command) ? 'approach_visible' : 'walk_straight';
  const edge = EDGES.find(e => e.from === truth.node && e.to === step.next_id && e.action === action && entryOk(e, truth.pose));
  if (!edge) {
    return { problem: `"${step.command}" (to ${step.next_id}) cannot be walked from ${truth.node} facing ${truth.pose}` };
  }
  const target = ANCHORS.get(edge.to);
  const wrong = [];
  if (!step.command.includes(target.landmark)) wrong.push('command does not name the next stop');
  if (step.expected_landmark !== target.landmark) wrong.push('expected_landmark is not the next stop');
  if (step.destination_landmark !== ANCHORS.get(destination).landmark) wrong.push('destination_landmark is wrong');
  if (JSON.stringify(step.exit_pose) !== JSON.stringify(edge.exit_pose ?? null)) wrong.push('exit_pose is not the leg\'s exit pose');
  if (step.remaining_steps !== best) wrong.push(`remaining_steps is ${step.remaining_steps}, the shortest route is ${best}`);
  const rest = legsToGo(edge.to, poseName(edge.exit_pose), destination);
  if (rest === null || 1 + rest !== best) wrong.push('this is not the first leg of a shortest route');
  return wrong.length ? { problem: `${wrong.join('; ')} ("${step.command}")` } : { edge };
}

// ---------- one simulated walk ----------
// sim fields: label, rng, destination, truth { node, pose }, mode ('done' | 'name' | 'mixed'),
// facingFirst, placeStyle, facingStyle, firstPlace, drift (chance per step), noise (list of strings sent
// before every spoken position), noiseWithFacing, change { afterSteps, to, finished, pickOffered },
// holdIsFine (a safe hold is allowed even when a route exists).
async function walk(sim) {
  const say = makeSpeech(sim);
  const trace = [];
  const problems = [];
  const bad = text => problems.push(text);
  let destination = sim.destination;
  let truth = { ...sim.truth };
  const startDistance = legsToGo(truth.node, truth.pose, destination);
  let budget = STEP_CAP;
  let steps = 0;
  let calls = 0;
  let asks = 0;
  let changed = false;
  let known = {}; // where the agent last told the tool the robot is, without the destination
  let request = { destination_id: destination };
  let outcome = '';

  // The operator speaks the place they stand at (and, normally, the facing). Noise may come first.
  async function reportPlace({ withFacing = true, exact = false } = {}) {
    for (const text of sim.noise ?? []) {
      const noisy = { destination_id: destination, current_landmark: text,
        ...(sim.noiseWithFacing ? { facing: say.facing(truth.pose) } : {}) };
      trace.push(`noise ${JSON.stringify(text)}`);
      const { http, result } = await callTool(noisy);
      calls += 1;
      if (!text.trim()) {
        if (http !== 400) bad(`blank position ${JSON.stringify(text)} gave HTTP ${http}, not 400`);
      } else if (http !== 200 || result.status !== 'needs_anchor') {
        bad(`${JSON.stringify(text)} was not refused as a position (${http} ${result.status})`);
      }
    }
    const place = exact ? ANCHORS.get(truth.node).landmark : say.place(truth.node);
    known = { current_landmark: place };
    return { destination_id: destination, current_landmark: place,
      ...(withFacing ? { facing: say.facing(truth.pose) } : {}) };
  }

  while (!outcome) {
    if (++calls > 120) {
      outcome = 'loop';
      break;
    }
    trace.push(`ask ${JSON.stringify(request)}`);
    const { http, result } = await callTool(request);
    trace.push(`got ${http} ${result.status ?? result.error}${result.reason ? `/${result.reason}` : ''}`);
    if (http !== 200) {
      bad(`HTTP ${http} for a request the agent should be able to make`);
      outcome = 'bad';
      break;
    }
    const asksForPlace = request.current_id == null && request.current_landmark == null;
    for (const problem of checkReply({ result, destination, asksForPlace })) bad(problem);

    if (result.status === 'unverified') {
      const offered = result.mapped_destinations ?? [];
      const reasons = ['destination_not_checked', 'unknown_destination'];
      if (sim.change?.pickOffered && changed && !sim.picked && offered.length && reasons.includes(result.reason)) {
        // The visitor picks a place the agent offered. Plan again from where the robot is.
        sim.picked = true;
        destination = pick(sim.rng, offered);
        budget = steps + STEP_CAP;
        request = { destination_id: destination, ...known };
      } else {
        outcome = 'hold';
      }
    } else if (result.status === 'at_destination') {
      if (truth.node !== destination) bad(`at_destination but the robot is at ${truth.node}, not ${destination}`);
      outcome = 'arrived';
    } else if (result.status === 'needs_anchor') {
      asks += 1;
      if (asks > MAX_ASKS) {
        outcome = 'hold';
        continue;
      }
      if (sim.change?.afterSteps === 0 && !changed) {
        changed = true; // the visitor changes their mind while the agent asks where the robot is
        destination = sim.change.to;
      }
      if (result.reason === 'current_orientation_required') {
        const { heading: _, ...place } = known;
        request = { destination_id: destination, ...place, facing: say.facing(truth.pose) };
        known = { ...place, facing: request.facing };
      } else {
        // "ambiguous_landmark": the operator then names their place exactly.
        request = await reportPlace({ withFacing: sim.facingFirst !== false, exact: result.reason === 'ambiguous_landmark' });
      }
    } else if (result.status === 'step') {
      asks = 0;
      steps += 1;
      if (steps > budget) {
        outcome = 'cap';
        break;
      }
      const executed = checkStep(truth, destination, result);
      if (executed.problem) {
        bad(executed.problem);
        outcome = 'bad';
        break;
      }
      const edge = executed.edge;
      const done = { current_id: result.next_id, ...poseFields(result.exit_pose) };
      const reached = { node: edge.to, pose: poseName(edge.exit_pose) };
      const change = sim.change && !changed && steps === sim.change.afterSteps ? sim.change : null;
      if (change) {
        // The visitor wants another place. The agent says stop, then plans from the last confirmed place,
        // or asks what the operator sees when the step was not finished.
        changed = true;
        destination = change.to;
        budget = steps + STEP_CAP;
        if (change.finished) {
          truth = reached;
          request = { destination_id: destination, ...done };
          known = done;
        } else {
          request = await reportPlace();
        }
      } else if (sim.drift && sim.rng() < sim.drift) {
        // The operator ends up at another place than planned, and says where.
        budget += STEP_CAP;
        truth = { node: pick(sim.rng, PLACES.filter(id => id !== edge.to)), pose: pick(sim.rng, SPEAKABLE_FACINGS) };
        request = await reportPlace();
      } else {
        truth = reached;
        if (sim.mode === 'done' || (sim.mode === 'mixed' && sim.rng() < 0.5)) {
          request = { destination_id: destination, ...done };
          known = done;
        } else {
          request = await reportPlace();
        }
      }
    }
  }

  const routeExists = isMapped(destination) && legsToGo(truth.node, truth.pose, destination) !== null;
  // A facing that names a place too cannot be said back, so when the robot truly faces one the safe
  // hold is the right outcome even though a route exists.
  const facingUnsayable = UNSPEAKABLE.has(truth.pose);
  if (outcome === 'hold' && routeExists && !sim.holdIsFine && !facingUnsayable) {
    bad('held although a route exists from where the robot really is');
  }
  if (['cap', 'loop'].includes(outcome)) bad(`did not finish (${outcome})`);
  if (outcome === 'arrived' && !sim.drift && !sim.change && steps !== startDistance) {
    bad(`took ${steps} steps, the shortest route is ${startDistance}`);
  }
  if (!isMapped(destination) && steps > 0 && !sim.change) bad('gave steps towards an unmapped place');
  return { outcome, steps, calls, problems, trace };
}

// ---------- running many walks ----------
const totals = { runs: 0, failed: 0, calls: 0, steps: 0, arrived: 0, held: 0 };
let seedCounter = 1000;
const sim = (label, fields) => ({ label, rng: mulberry32(seedCounter++), mode: 'done', ...fields });

async function runAll(t, name, sims) {
  const failures = [];
  const outcomes = { arrived: 0, hold: 0 };
  for (const one of sims) {
    const run = await walk(one);
    totals.runs += 1;
    totals.calls += run.calls;
    totals.steps += run.steps;
    if (run.outcome === 'arrived') totals.arrived += 1;
    if (run.outcome === 'hold') totals.held += 1;
    outcomes[run.outcome] = (outcomes[run.outcome] ?? 0) + 1;
    if (run.problems.length) {
      failures.push(`${one.label}\n    ${run.problems.join('\n    ')}\n    last calls: ${run.trace.slice(-8).join(' | ')}`);
    }
  }
  totals.failed += failures.length;
  t.diagnostic(`${name}: ${sims.length} runs, ${failures.length} failures (arrived ${outcomes.arrived}, held ${outcomes.hold})`);
  assert.equal(failures.length, 0, `${failures.length} of ${sims.length} runs failed. First ones:\n${failures.slice(0, 4).join('\n')}`);
}

describe('route walk simulation (production map)', () => {
  const saved = {};
  before(() => {
    for (const key of ['NAVIGATOR_ROUTE_TOOL_KEY', 'NAVIGATOR_MAP_VARIANT']) saved[key] = process.env[key];
    process.env.NAVIGATOR_ROUTE_TOOL_KEY = ROUTE_KEY;
    delete process.env.NAVIGATOR_MAP_VARIANT;
  });
  after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    console.log(`sim-walk summary: ${totals.runs} runs, ${totals.failed} failures, ${totals.calls} tool calls, ` +
      `${totals.steps} steps, ${totals.arrived} arrived, ${totals.held} held`);
  });

  test('the simulation reads the production map it expects', () => {
    // Not exact numbers: the team may map more places later and this test must keep working.
    assert.ok(PLACES.length >= 2, 'the map needs at least two places to walk between');
    assert.ok(FACINGS.length >= 2);
    assert.ok(MAPPED.length >= 1, 'at least one course destination must be routable');
  });

  test('a. perfect operator: every start place, facing and destination', async t => {
    const sims = [];
    const destinations = [...COURSE_DESTINATIONS, 'sign_a', 'sign_b', 'rooftop'];
    for (const facingFirst of [true, false]) {
      for (const node of PLACES) {
        for (const pose of FACINGS) {
          for (const destination of destinations) {
            sims.push(sim(`perfect ${node}/${pose} -> ${destination}${facingFirst ? '' : ' (facing asked later)'}`,
              { destination, truth: { node, pose }, facingFirst, mode: 'done' }));
          }
        }
      }
    }
    await runAll(t, 'perfect operator', sims);
  });

  test('b. every way of naming a place resolves to that place or holds safely', async t => {
    const sims = [];
    for (const node of PLACES) {
      for (const [style, texts] of Object.entries(NAMES.get(node))) {
        for (const text of texts) {
          const pose = pick(mulberry32(seedCounter), speakableFacings(node));
          sims.push(sim(`name ${node} as ${JSON.stringify(text)}`, {
            destination: pick(mulberry32(seedCounter), MAPPED), truth: { node, pose },
            placeStyle: style, firstPlace: text, mode: 'name',
          }));
        }
      }
    }
    await runAll(t, 'naming places', sims);
  });

  test('b. every way of saying the facing is understood or holds safely', async t => {
    const sims = [];
    for (const node of PLACES) {
      for (const pose of usableFacings(node)) {
        for (const facingStyle of Object.keys(FACING_WORDS)) {
          const destination = MAPPED.find(id => id !== node);
          sims.push(sim(`facing ${node} ${pose} said as ${facingStyle}`,
            { destination, truth: { node, pose }, facingStyle, mode: 'name' }));
        }
      }
    }
    await runAll(t, 'saying the facing', sims);
  });

  test('b. naming the next stop as what is straight ahead gives the facing', async t => {
    const sims = [];
    for (const edge of EDGES.filter(e => e.action === 'walk_straight')) {
      const ahead = ANCHORS.get(edge.to);
      for (const text of [ahead.landmark, ...ahead.aliases]) {
        const destination = MAPPED.find(id => id !== edge.from);
        sims.push(sim(`${edge.from} facing ${poseName(edge.entry_pose)}, says "${text}" is ahead`, {
          destination, truth: { node: edge.from, pose: poseName(edge.entry_pose) }, mode: 'name',
          // Only the exact landmark is promised. Aliases may hold safely, but must never give a wrong step.
          // A landmark that is also a facing label ("the team tables") cannot be told apart and holds too.
          holdIsFine: text !== ahead.landmark ||
            UNSPEAKABLE.has(ahead.landmark.toLowerCase().replace(/^the\s+/u, '')),
          facingOverride: text,
        }));
      }
    }
    await runAll(t, 'straight-ahead facing', sims);
  });

  test('c. operator ends up at another place than planned: replan, never loop', async t => {
    const sims = [];
    for (let i = 0; i < 120; i++) {
      const rng = mulberry32(5000 + i);
      const node = pick(rng, PLACES);
      sims.push(sim(`drift run ${i}`, {
        destination: pick(rng, MAPPED), truth: { node, pose: pick(rng, speakableFacings(node)) },
        mode: 'mixed', drift: 0.5, placeStyle: pick(rng, ['exact', 'alias', 'upper']),
      }));
    }
    await runAll(t, 'different place', sims);
  });

  test('d. unknown, empty or filler-only reports are never a position', async t => {
    const noise = ['a red chair', '', '   ', '...', 'um', 'uh... hmm', 'I do not know', 'the', 'at the',
      'a blue pillar', 'pillar', 'peach', 'the pitch', 'room', 'tables', 'boards', 'by the window',
      'the elevator', 'كرسي احمر', 'ما اعرف', '؟؟؟', '!!!'];
    const sims = [];
    for (const text of noise) {
      for (const withFacing of [false, true]) {
        for (const node of ['sign_a', 'team_tables', 'sign_b']) {
          sims.push(sim(`noise ${JSON.stringify(text)} at ${node}`, {
            destination: node === 'sign_b' ? 'team_tables' : 'kitchen',
            truth: { node, pose: usableFacings(node)[0] }, mode: 'name', noise: [text], noiseWithFacing: withFacing,
          }));
        }
      }
    }
    await runAll(t, 'unknown reports', sims);
  });

  test('e. a place seen far away, ahead or behind is never a position', async t => {
    const english = [x => `I can see ${x} far away`, x => `I see ${x} ahead`, x => `I see ${x} from here`,
      x => `${x} is over there`, x => `${x} is behind me`, x => `${x} in the distance`, x => upper(`I can see ${x} far away`)];
    const arabic = [x => `اشوف ${x} بعيد`, x => `${x} بعيدة`, x => `${x} بعيد عني`, x => `${x} ورا`, x => `من بعيد ${x}`];
    const sims = [];
    for (const seen of PLACES) {
      const texts = [
        ...english.flatMap(say => [say(ANCHORS.get(seen).landmark), say(pick(mulberry32(seedCounter), ANCHORS.get(seen).aliases.filter(a => !isArabic(a))))]),
        ...arabic.map(say => say(arabicName(seen))),
      ];
      for (const text of texts) {
        for (const destination of MAPPED) {
          const node = PLACES.find(id => id !== seen && id !== destination);
          sims.push(sim(`${JSON.stringify(text)} while going to ${destination}`, {
            destination, truth: { node, pose: usableFacings(node)[0] }, mode: 'name', noise: [text],
            noiseWithFacing: text.length % 2 === 0,
          }));
        }
      }
    }
    await runAll(t, 'far sightings', sims);
  });

  test('f. destination changes in the middle of a route', async t => {
    const sims = [];
    for (let i = 0; i < 90; i++) {
      const rng = mulberry32(9000 + i);
      const node = pick(rng, PLACES);
      const pose = pick(rng, speakableFacings(node));
      const destination = pick(rng, MAPPED);
      const longest = legsToGo(node, pose, destination) ?? 1;
      const to = pick(rng, [...COURSE_DESTINATIONS, 'sign_a', destination]);
      sims.push(sim(`change run ${i}: ${node}/${pose} -> ${destination}, then ${to}`, {
        destination, truth: { node, pose }, mode: pick(rng, ['done', 'mixed']),
        change: { afterSteps: Math.floor(rng() * Math.max(longest, 1)), to, finished: rng() < 0.5, pickOffered: true },
        holdIsFine: !isMapped(to),
      }));
    }
    await runAll(t, 'destination change', sims);
  });
});
