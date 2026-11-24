import { isHeading, opposite } from './headings.mjs';
import { TURN_PENALTY, legsCost, legsToInstructions, planLegs } from './planner.mjs';

// The tools the voice agent calls. Everything here is plain code: the language model only reads the
// strings returned (say_operator word for word, tell_visitor_en translated) and passes on what people said.
// runTool({ map, state, session_id, tool, args, now }) -> { state, result }. No I/O, so it is easy to test.

const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/u;
export const HOLD_SAY = 'Operator, stop. Stay where you are.';
const SEE_SAY = 'Operator, what do you see?';
export const HANDOVER_SAY = 'Operator, stay where you are. I am calling a person.';
export const REPLIES = Object.freeze(['ok', 'ready', 'done', 'stopped', 'yes', 'no', 'free', 'busy', 'repeat', 'lost', 'blocked', 'wait', 'see', 'at']);
const REPLY_SYNONYMS = { okay: 'ok', yeah: 'yes', yep: 'yes', nope: 'no', stop: 'wait', finished: 'done', complete: 'done' };
const LOG_LIMIT = 40;
const MAX_MISSES = 2;

const capital = text => text.charAt(0).toUpperCase() + text.slice(1);

// Lower case, no accents or Arabic marks, one kind of alef, digits as digits.
export function normalizeText(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase()
    .replace(/[ً-ٰٟـ]/gu, '')
    .replace(/[أإآ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ة/gu, 'ه')
    .replace(/[٠-٩]/gu, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
}
const STOP_WORDS = new Set(['the', 'a', 'an', 'to', 'for', 'please', 'i', 'want', 'need', 'go', 'take', 'me', 'us', 'at']);
const tokens = text => normalizeText(text).split(' ').filter(word => word && !STOP_WORDS.has(word));

export function newState(sessionId, now) {
  return {
    v: 1, session_id: sessionId, created: now, updated: now, step_seq: 0,
    pos: null, heading: null, conf: 'unknown',
    dest: null, pending_dest: null, requester: null, requester2: null,
    route: [], i: 0, awaiting: null, arrived: false, handover: null,
    misses: 0, pending_landmark: null, busy: {}, last_say: null, log: [],
  };
}

function note(state, now, ev, extra = {}) {
  state.log.push({ t: now, ev, ...extra });
  if (state.log.length > LOG_LIMIT) state.log.shift();
}

function issue(state, now, kind, say, expected = 6) {
  state.step_seq += 1;
  state.awaiting = { kind, step_id: state.step_seq, since: now, expected_s: expected, say };
  state.last_say = say;
  return state.awaiting.step_id;
}

const expectedSeconds = instr => (instr.kind === 'walk' ? 5 + 0.8 * instr.steps : 5);

function base(map, status, extra = {}) {
  return { ok: true, status, demo: map.meta.demo, ...extra };
}

function describePosition(map, state) {
  if (!state.pos) return null;
  if (state.pos.node) return { node: state.pos.node, name: map.nodes[state.pos.node].name };
  return { edge: state.pos.edge, dir: state.pos.dir, done: state.pos.done };
}

function summary(map, state) {
  return {
    position: describePosition(map, state), heading: state.heading, confidence: state.conf,
    destination: state.dest, awaiting: state.awaiting?.kind ?? null, arrived: state.arrived,
  };
}

const ask = (map, state, now, say = SEE_SAY, kind = 'landmark') => base(map, 'ask_operator', {
  say_operator: say, step_id: issue(state, now, kind, say, 6), ...summary(map, state),
});

function handover(map, state, now, reason) {
  state.handover = { reason, at: now, last_say: state.last_say, last: state.log.slice(-3) };
  const step = issue(state, now, 'handover', HANDOVER_SAY, 600);
  note(state, now, 'handover', { reason });
  return base(map, 'handover', {
    say_operator: HANDOVER_SAY, step_id: step,
    tell_visitor_en: 'I am not sure where we are. Please wait. I am calling a person to help.', reason,
    ...summary(map, state),
  });
}

function instructionResult(map, state) {
  const instr = state.route[state.i];
  return base(map, 'instruction', {
    say_operator: instr.say, hint: instr.hint ?? null, step_id: state.awaiting.step_id,
    progress: `${state.i + 1}/${state.route.length}`, ...summary(map, state),
  });
}

function issueCurrent(map, state, now) {
  const instr = state.route[state.i];
  issue(state, now, 'step', instr.say, expectedSeconds(instr));
  return instructionResult(map, state);
}

function arrivalResult(map, state, now) {
  state.arrived = true;
  state.awaiting = null;
  state.pos = { node: state.dest };
  state.conf = 'exact';
  state.last_say = 'Operator, stay stopped. Thank you.';
  note(state, now, 'arrived', { place: state.dest });
  return base(map, 'arrived', {
    arrived: true, say_operator: state.last_say,
    tell_visitor_en: `We have arrived at ${map.nodes[state.dest].name}.`, ...summary(map, state),
  });
}

function atEnd(map, state, now) {
  const place = map.nodes[state.dest];
  if (map.meta.verify_arrival === false) return arrivalResult(map, state, now);
  const say = `Operator, stay stopped. Do you see ${place.see}?`;
  return base(map, 'arrival_check', {
    arrived: false, say_operator: say, step_id: issue(state, now, 'arrival', say, 6), ...summary(map, state),
  });
}

// Cheapest way to the destination from where the robot stands now (at a node, or between two nodes).
function bestRoute(map, state, dest) {
  const { pos, heading } = state;
  if (!pos || !isHeading(heading) || !map.nodes[dest]) return null;
  if (pos.node) {
    const legs = pos.node === dest ? [] : planLegs(map, pos.node, heading, dest);
    return legs ? { legs, cost: legsCost(legs, heading), option: 'from node' } : null;
  }
  const edge = map.edges.find(e => e.id === pos.edge);
  const forward = pos.dir === 1;
  const ahead = forward ? edge.b : edge.a;
  const behind = forward ? edge.a : edge.b;
  const backHeading = opposite(heading);
  const options = [];
  const pf = ahead === dest ? [] : planLegs(map, ahead, heading, dest);
  if (pf) options.push({ option: 'keep going', legs: [{ to: ahead, h: heading, steps: edge.steps - pos.done, edge: edge.id }, ...pf] });
  const pb = behind === dest ? [] : planLegs(map, behind, backHeading, dest);
  if (pb) options.push({ option: 'turn around', legs: [{ to: behind, h: backHeading, steps: pos.done, edge: edge.id }, ...pb] });
  for (const o of options) o.cost = legsCost(o.legs, heading);
  options.sort((x, y) => x.cost - y.cost);
  return options[0] ?? null;
}

function beginRoute(map, state, dest, now) {
  if (!map.nodes[dest] || map.nodes[dest].type !== 'place') return base(map, 'unknown_place', { say_operator: null });
  const best = bestRoute(map, state, dest);
  if (!best) return handover(map, state, now, 'no checked route from here');
  state.dest = dest;
  state.pending_dest = null;
  state.arrived = false;
  state.route = legsToInstructions(map, state.heading, best.legs);
  state.i = 0;
  note(state, now, 'route', { dest, option: best.option, steps: state.route.length });
  return state.route.length ? issueCurrent(map, state, now) : atEnd(map, state, now);
}

function startHold(map, state, now, pendingDest) {
  const instr = state.awaiting?.kind === 'step' ? state.route[state.i] : null;
  state.pending_dest = pendingDest ?? state.dest;
  state.hold_unsure = Boolean(instr) || state.conf === 'guess' || !state.pos?.node;
  if (instr) state.conf = 'guess';
  note(state, now, 'hold', { unsure: state.hold_unsure });
  return base(map, 'hold', {
    say_operator: HOLD_SAY, step_id: issue(state, now, 'hold', HOLD_SAY, 6), ...summary(map, state),
  });
}

function placeNames(map) {
  return Object.entries(map.nodes).filter(([, n]) => n.type === 'place');
}

function nameList(names) {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0];
}

function placeKeys(id, node) {
  const idWords = id.replace(/_/gu, ' ');
  return [idWords, node.name, ...(node.aliases ?? [])].map(normalizeText).filter(Boolean);
}

function findPlace(map, { query }) {
  const wanted = normalizeText(query);
  const wantedTokens = tokens(query);
  const places = placeNames(map);
  if (!wanted || !wantedTokens.length) return base(map, 'unknown_place', { candidates: [] });
  const exact = places.filter(([id, n]) => placeKeys(id, n).some(k => k === wanted || tokens(k).join(' ') === wantedTokens.join(' ')));
  let found = exact;
  if (!found.length) {
    found = places.filter(([id, n]) => {
      const bag = new Set(placeKeys(id, n).flatMap(k => k.split(' ')));
      return wantedTokens.every(word => bag.has(word));
    });
  }
  if (found.length === 1) {
    const [id, node] = found[0];
    return base(map, 'found', { place_id: id, name: node.name, candidates: [{ place_id: id, name: node.name }] });
  }
  if (found.length > 1) {
    const candidates = found.map(([id, n]) => ({ place_id: id, name: n.name }));
    return base(map, 'ambiguous', {
      candidates, question_visitor_en: `Which one do you want: ${nameList(candidates.map(c => c.name))}?`,
    });
  }
  const all = places.map(([, n]) => n.name);
  return base(map, 'unknown_place', {
    candidates: [], tell_visitor_en: `That is not on this floor, or I do not know it. I can take you to ${nameList(all)}.`,
  });
}

function findLandmark(map, thing) {
  const wanted = tokens(thing).join(' ');
  if (!wanted) return null;
  for (const [id, mark] of Object.entries(map.landmarks ?? {})) {
    const names = [id.replace(/_/gu, ' '), mark.say, ...(mark.aliases ?? [])].map(t => tokens(t).join(' '));
    if (names.includes(wanted)) return id;
  }
  return null;
}

function findNode(map, thing) {
  const wanted = tokens(thing).join(' ');
  if (!wanted) return null;
  for (const [id, node] of Object.entries(map.nodes)) {
    const names = [id.replace(/_/gu, ' '), node.name, ...(node.aliases ?? [])].map(t => tokens(t).join(' '));
    if (names.includes(wanted)) return id;
  }
  return null;
}

function afterFix(map, state, now) {
  state.handover = null;
  state.misses = 0;
  state.pending_landmark = null;
  state.hold_unsure = false;
  const dest = state.pending_dest ?? (state.arrived ? null : state.dest);
  if (!dest) return base(map, 'position_set', { say_operator: null, ...summary(map, state) });
  return beginRoute(map, state, dest, now);
}

// `standingAt` is true only when the operator said "at" a place. Seeing a place from far away is not being there.
function reportLandmark(map, state, now, { thing, side }, standingAt = false) {
  let id = findLandmark(map, thing) ?? (thing ? null : state.pending_landmark);
  if (!id && !thing) id = state.pending_landmark;
  if (!id) {
    const node = standingAt ? findNode(map, thing) : null;
    if (node && state.pos) {
      state.pos = { node };
      state.conf = 'reported';
      state.heading ??= map.meta.start?.heading ?? null;
      note(state, now, 'at', { node });
      return afterFix(map, state, now);
    }
    state.misses += 1;
    note(state, now, 'unknown_landmark', { thing: String(thing).slice(0, 40) });
    return state.misses >= MAX_MISSES ? handover(map, state, now, 'landmark not on the map')
      : ask(map, state, now, 'Operator, what else do you see?');
  }
  if (side === 'ahead') {
    state.misses += 1;
    note(state, now, 'landmark_ahead', { id });
    return state.misses >= MAX_MISSES ? handover(map, state, now, 'landmark has no side')
      : ask(map, state, now, 'Operator, what else do you see?');
  }
  if (side !== 'left' && side !== 'right') {
    state.pending_landmark = id;
    return ask(map, state, now, 'Operator, is it on your left or right?');
  }
  const mark = map.landmarks[id];
  const edge = map.edges.find(e => e.id === mark.edge);
  const dir = side === mark.side ? 1 : -1;
  state.pos = { edge: edge.id, dir, done: dir === 1 ? mark.at : edge.steps - mark.at };
  state.heading = dir === 1 ? edge.h : opposite(edge.h);
  state.conf = 'reported';
  note(state, now, 'landmark', { id, side });
  return afterFix(map, state, now);
}

function setPosition(map, state, now, args) {
  const invalid = () => base(map, 'invalid', { say_operator: null, message: 'position not on the map' });
  if (args.node != null) {
    if (!Object.hasOwn(map.nodes, args.node) || !isHeading(args.heading)) return invalid();
    state.pos = { node: args.node };
    state.heading = args.heading;
  } else {
    const edge = map.edges.find(e => e.id === args.edge);
    if (!edge || ![1, -1].includes(args.dir) || !Number.isInteger(args.done) || args.done < 1 || args.done >= edge.steps) return invalid();
    state.pos = { edge: edge.id, dir: args.dir, done: args.done };
    state.heading = args.dir === 1 ? edge.h : opposite(edge.h);
  }
  state.conf = 'reported';
  note(state, now, 'set_position', { pos: state.pos });
  return afterFix(map, state, now);
}

function planRouteTool(map, state, now, { destination_id, lang }) {
  if (!map.nodes[destination_id] || map.nodes[destination_id].type !== 'place') {
    return base(map, 'unknown_place', { say_operator: null, tell_visitor_en: 'I do not know that place on this floor.' });
  }
  state.requester = { lang: typeof lang === 'string' ? lang : null };
  state.arrived = false;
  // After a handover, a guess or an unsure hold the saved position cannot be trusted: ask first.
  const unsure = Boolean(state.handover) || state.conf === 'guess' || Boolean(state.hold_unsure);
  if (state.pos && !unsure) return beginRoute(map, state, destination_id, now);
  state.pending_dest = destination_id;
  if (state.pos) return ask(map, state, now);
  if (map.meta.start) {
    const say = map.meta.start.say;
    return base(map, 'need_start', { say_operator: say, step_id: issue(state, now, 'start', say, 6), ...summary(map, state) });
  }
  return ask(map, state, now);
}

function changeDestination(map, state, now, { destination_id, lang }) {
  if (!map.nodes[destination_id] || map.nodes[destination_id].type !== 'place') {
    return base(map, 'unknown_place', { say_operator: null, tell_visitor_en: 'I do not know that place on this floor.' });
  }
  const name = map.nodes[destination_id].name;
  const active = state.dest && !state.arrived && state.awaiting && state.awaiting.kind !== 'handover';
  if (!active) return planRouteTool(map, state, now, { destination_id, lang });
  state.requester2 = { lang: typeof lang === 'string' ? lang : null };
  const result = startHold(map, state, now, destination_id);
  result.tell = [
    { to: 'first_visitor', lang: state.requester?.lang ?? null, en: `Another guest asked for ${name}. We are changing our destination to ${name}.` },
    { to: 'new_visitor', lang: state.requester2.lang, en: `I am taking you to ${name} now.` },
  ];
  return result;
}

function placeBusy(map, state, now, placeId) {
  const node = map.nodes[placeId];
  if (!node || node.type !== 'place') return base(map, 'unknown_place', { say_operator: null });
  state.busy[placeId] = true;
  const options = placeNames(map)
    .filter(([id, n]) => id !== placeId && n.kind === node.kind && !state.busy[id])
    .map(([id]) => ({ id, best: bestRoute(map, state, id) }))
    .filter(o => o.best)
    .sort((x, y) => x.best.cost - y.best.cost);
  if (!options.length) return handover(map, state, now, `${node.name} is busy and no other free place`);
  const alt = options[0].id;
  state.arrived = false;
  const result = beginRoute(map, state, alt, now);
  result.tell_visitor_en = `${capital(node.name)} is busy. ${capital(map.nodes[alt].name)} is next to it.`;
  return result;
}

function nudgeFor(state, now) {
  const aw = state.awaiting;
  if (!aw || aw.kind === 'handover') return null;
  const late = (now - aw.since) / 1000 - aw.expected_s;
  const walking = aw.kind === 'step' && state.route[state.i]?.kind === 'walk';
  const moving = aw.kind === 'step';
  if (late > (moving ? 23 : 15)) return { stage: 'handover' };
  if (moving && late > 13) return { stage: 'hold' };
  if (late > 5) {
    // At the start and arrival questions a plain "yes, I am here" would be taken as the answer, so ask the real question again.
    const again = !moving && aw.kind !== 'landmark';
    const say = walking ? 'Operator, have you stopped? Say yes or no.'
      : moving ? 'Operator, did you turn? Say yes or no.' : again ? aw.say : 'Operator, are you there? Please answer.';
    return { stage: 'ask', say_operator: say };
  }
  return null;
}

function getState(map, state, now) {
  const stage = nudgeFor(state, now);
  const out = base(map, 'info', { ...summary(map, state), last_say: state.last_say, step_id: state.awaiting?.step_id ?? null, nudge: null });
  if (!stage) return out;
  if (stage.stage === 'ask') return { ...out, nudge: { stage: 'ask', say_operator: stage.say_operator } };
  if (stage.stage === 'hold') {
    const hold = startHold(map, state, now, state.dest);
    return { ...out, ...summary(map, state), step_id: hold.step_id, nudge: { stage: 'hold', say_operator: HOLD_SAY, step_id: hold.step_id } };
  }
  const gone = handover(map, state, now, 'operator not answering');
  return { ...out, ...summary(map, state), step_id: gone.step_id, nudge: { stage: 'handover', say_operator: HANDOVER_SAY, step_id: gone.step_id } };
}

function advance(map, state, now) {
  const instr = state.route[state.i];
  if (instr.kind === 'turn') state.heading = instr.to_heading;
  else { state.pos = { node: instr.to_node }; state.heading = instr.to_heading; }
  state.conf = 'counted';
  state.i += 1;
  note(state, now, 'done', { i: state.i });
  return state.i < state.route.length ? issueCurrent(map, state, now) : atEnd(map, state, now);
}

function confirmStep(map, state, now, args) {
  let reply = normalizeText(args.result).split(' ')[0];
  reply = REPLY_SYNONYMS[reply] ?? reply;
  const aw = state.awaiting;
  if (!REPLIES.includes(reply)) {
    return base(map, 'invalid_reply', {
      say_operator: 'Operator, please say one of: done, stopped, yes, no, repeat, lost, wait.', step_id: aw?.step_id ?? null,
    });
  }
  if (reply === 'repeat') {
    return base(map, 'repeat', { say_operator: state.last_say, step_id: aw?.step_id ?? null, ...summary(map, state) });
  }
  if (reply === 'lost' || reply === 'blocked') {
    if (aw?.kind === 'landmark' || aw?.kind === 'hold' || state.pending_dest) {
      return handover(map, state, now, `operator said ${reply} again`);
    }
    note(state, now, reply);
    return startHold(map, state, now, state.dest);
  }
  if (reply === 'see') return reportLandmark(map, state, now, { thing: args.thing, side: args.side });
  if (reply === 'at') return reportLandmark(map, state, now, { thing: args.thing }, true);
  // A step id from the future means the saved state was lost or rolled back: do not leave the operator walking.
  if (Number.isInteger(args.step_id) && args.step_id > state.step_seq) return handover(map, state, now, 'saved state lost');
  if (!aw) return base(map, 'nothing_pending', { say_operator: null, ...summary(map, state) });
  if (args.step_id !== aw.step_id) {
    // The operator already heard the current instruction, so say nothing a second time.
    return base(map, 'stale', { say_operator: null, step_id: aw.step_id, ...summary(map, state) });
  }
  if (reply === 'wait') {
    aw.since = now;
    aw.expected_s = 30;
    return base(map, 'waiting', { say_operator: null, step_id: aw.step_id, ...summary(map, state) });
  }
  if (reply === 'ok' || reply === 'ready') {
    aw.since = now;
    return base(map, 'ack', { say_operator: null, step_id: aw.step_id, ...summary(map, state) });
  }

  switch (aw.kind) {
    case 'start':
      if (reply === 'yes') {
        state.pos = { node: map.meta.start.node };
        state.heading = map.meta.start.heading;
        state.conf = 'reported';
        return beginRoute(map, state, state.pending_dest, now);
      }
      if (reply === 'no') return ask(map, state, now);
      break;
    case 'step':
      if (reply === 'done' || reply === 'stopped' || reply === 'yes') return advance(map, state, now);
      if (reply === 'no') {
        aw.since = now;
        aw.expected_s = 10;
        return base(map, 'ack', { say_operator: null, step_id: aw.step_id, ...summary(map, state) });
      }
      break;
    case 'hold':
      if (reply === 'stopped' || reply === 'done' || reply === 'yes') {
        if (state.hold_unsure) return ask(map, state, now);
        state.hold_unsure = false;
        return beginRoute(map, state, state.pending_dest ?? state.dest, now);
      }
      break;
    case 'arrival':
      if (reply === 'yes' || reply === 'free') return arrivalResult(map, state, now);
      if (reply === 'busy') return placeBusy(map, state, now, state.dest);
      if (reply === 'no') { state.conf = 'guess'; return ask(map, state, now, 'Operator, stay where you are. What do you see?'); }
      break;
    default:
      break;
  }
  return base(map, 'invalid_reply', { say_operator: aw.say, step_id: aw.step_id, ...summary(map, state) });
}

const TOOLS = {
  get_state: (map, state, now) => getState(map, state, now),
  find_place: (map, state, now, args) => findPlace(map, args),
  plan_route: planRouteTool,
  confirm_step: confirmStep,
  report_landmark: (map, state, now, args) => reportLandmark(map, state, now, args),
  report_lost: (map, state, now) => {
    if (state.awaiting?.kind === 'landmark' || state.awaiting?.kind === 'hold') return handover(map, state, now, 'operator lost');
    note(state, now, 'lost');
    return startHold(map, state, now, state.dest);
  },
  set_position: setPosition,
  change_destination: changeDestination,
  place_busy: (map, state, now, args) => placeBusy(map, state, now, args.place_id),
  mark_arrived: (map, state, now) => (state.arrived
    ? base(map, 'arrived', { arrived: true, say_operator: state.last_say, tell_visitor_en: `We have arrived at ${map.nodes[state.dest].name}.`, ...summary(map, state) })
    : base(map, 'not_arrived', { arrived: false, say_operator: state.last_say, step_id: state.awaiting?.step_id ?? null, ...summary(map, state) })),
  handover: (map, state, now, args) => handover(map, state, now, String(args.reason ?? 'asked for a person').slice(0, 120)),
};
export const TOOL_NAMES = Object.freeze(Object.keys(TOOLS));

export function runTool({ map, state, session_id: sessionId, tool, args = {}, now = Date.now() }) {
  if (!SESSION_ID.test(sessionId ?? '')) throw new TypeError('invalid session_id');
  if (!Object.hasOwn(TOOLS, tool)) return { state, result: { ok: false, status: 'unknown_tool', say_operator: null } };
  const next = structuredClone(state ?? newState(sessionId, now));
  next.updated = now;
  const result = TOOLS[tool](map, next, now, args ?? {});
  return { state: next, result };
}

// Read-only calls must not write the session back: a slow read could put an old step back over a newer one.
export function writesState(tool, result) {
  if (tool === 'find_place') return false;
  if (tool === 'get_state') return result?.nudge?.stage === 'hold' || result?.nudge?.stage === 'handover';
  return true;
}

export { TURN_PENALTY };
