import { COURSE_DESTINATIONS } from './floor-map.mjs';

export const validId = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(value);
export const validHeading = value => ['north', 'east', 'south', 'west'].includes(value);
const plainText = (value, max) => typeof value === 'string' && value.length > 0 &&
  value.length <= max && value.trim() === value && !/[\p{C}\p{Zl}\p{Zp}]/u.test(value);
export const validFacing = value => plainText(value, 120);
export const validObservedLandmark = value => typeof value === 'string' && value.length <= 240 &&
  value.trim().length > 0 && !/[\p{C}\p{Zl}\p{Zp}]/u.test(value);

const poseKey = pose => pose?.heading ? `heading:${pose.heading}` :
  pose?.facing ? `facing:${pose.facing}` : '';
const renderPose = key => key.startsWith('heading:') ? key.slice(8) : key.slice(7);
const validPose = pose => pose === null || (pose && typeof pose === 'object' &&
  Object.keys(pose).length === 1 &&
  ((Object.hasOwn(pose, 'heading') && validHeading(pose.heading)) ||
    (Object.hasOwn(pose, 'facing') && validFacing(pose.facing))));
const checked = evidence => plainText(evidence?.checked_at, 80) &&
  plainText(evidence.checked_by, 120) && plainText(evidence.reference, 240);
// A map-level survey supplies evidence only for records that carry none.
const evidenceOf = (record, survey) => record?.evidence ?? survey;

const commands = new Map([
  ['approach_visible', cue => `Face ${cue}. Walk to it and stop there.`],
  ['walk_straight', cue => `Walk straight and stop at ${cue}.`],
  ['left_then_straight', cue => `Turn left. Walk straight and stop at ${cue}.`],
  ['right_then_straight', cue => `Turn right. Walk straight and stop at ${cue}.`],
  ['around_then_straight', cue => `Turn around. Walk straight and stop at ${cue}.`],
]);

// Spoken-observation matching. Arabic words are listed in normalized form.
const NUMBER_WORDS = new Map([
  ['one', '1'], ['first', '1'], ['1st', '1'],
  ['two', '2'], ['second', '2'], ['2nd', '2'],
  ['three', '3'], ['third', '3'], ['3rd', '3'],
  ['four', '4'], ['fourth', '4'], ['4th', '4'],
  ['واحد', '1'], ['واحده', '1'], ['الاول', '1'], ['اول', '1'], ['اولي', '1'],
  ['اثنين', '2'], ['اثنان', '2'], ['الثاني', '2'], ['ثاني', '2'], ['ثانيه', '2'],
  ['ثلاثه', '3'], ['الثالث', '3'], ['ثالث', '3'], ['ثالثه', '3'],
  ['اربعه', '4'], ['الرابع', '4'], ['رابع', '4'], ['رابعه', '4'],
]);
const STOPWORDS = new Set([
  'the', 'a', 'an', 'at', 'by', 'near', 'next', 'to', 'of', 'i', 'im', 'am',
  'we', 'are', 'is', 'standing', 'stopped', 'stop', 'facing', 'in', 'front',
  'toward', 'towards', 'looking', 'look',
  'عند', 'جنب', 'قدام', 'انا', 'في', 'امام',
]);

// Words that say the place is somewhere else (far, ahead, behind), not "I am at it". English and Gulf Arabic.
// A plain "I see the X" is NOT blocked: the agent asks "Can you see the X, the Y or the Z?" to find the position.
const SIGHTING = new RegExp(
  '\\b(?:far|ahead|behind|over there|from here|in the distance)\\b' +
  '|(?<![\\p{L}])(?:بعيد|بعيده|بعيدة|خلفي|ورا|وراي)(?![\\p{L}])', 'iu');

export const tokenize = value => {
  const text = value.normalize('NFC')
    .replace(/(^|[^\p{L}\p{N}])[Ss][Ii][Gg][Nn]\s+([A-F])(?![\p{L}\p{N}])/gu, '$1sign$2')
    .toLowerCase()
    .replace(/[ً-ٰٟ]/gu, '')
    .replace(/ـ/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ة/gu, 'ه')
    .replace(/ى/gu, 'ي')
    .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/\p{P}/gu, ' ');
  const tokens = new Set();
  for (const raw of text.split(/\s+/u)) {
    let token = raw;
    if (token.length > 3 && token.startsWith('ال')) token = token.slice(2);
    token = NUMBER_WORDS.get(token) ?? token;
    if (token && !STOPWORDS.has(token)) tokens.add(token);
  }
  return tokens;
};

const anchorPhrases = anchor =>
  [anchor.landmark, ...(Array.isArray(anchor.aliases) ? anchor.aliases : [])]
    .filter(phrase => plainText(phrase, 120))
    .map(tokenize)
    .filter(tokens => tokens.size > 0);

const isSubset = (phrase, observed) =>
  phrase.size <= observed.size && [...phrase].every(token => observed.has(token));

// Each candidate is { key, phrases: [tokenSet] }. A candidate matches when any of
// its phrases is a non-empty subset of the observed tokens; its score is the
// size of the largest matching phrase. Unique top score wins; otherwise the
// tied candidates are returned (or an empty list when nothing matched).
function matchPhrases(candidates, observed) {
  let best = 0;
  let winners = [];
  for (const candidate of candidates) {
    let score = 0;
    for (const phrase of candidate.phrases) {
      if (isSubset(phrase, observed)) score = Math.max(score, phrase.size);
    }
    if (score > best) {
      best = score;
      winners = [candidate];
    } else if (score === best && score > 0) {
      winners.push(candidate);
    }
  }
  return winners.length === 1 ? { winner: winners[0] } : { tied: winners };
}

// Canonical facing labels are the facing labels used in edge poses, plus every
// anchor landmark (an alias resolves to its anchor's landmark).
function canonicalFacing(map, anchors, observed) {
  const candidates = new Map();
  const add = (label, tokens) => {
    if (!tokens.size) return;
    const phrases = candidates.get(label) ?? [];
    phrases.push(tokens);
    candidates.set(label, phrases);
  };
  for (const edge of map.edges ?? []) {
    for (const pose of [edge?.entry_pose, edge?.exit_pose]) {
      if (pose?.facing != null && validFacing(pose.facing)) add(pose.facing, tokenize(pose.facing));
    }
  }
  for (const anchor of anchors.values()) {
    for (const phrase of anchorPhrases(anchor)) add(anchor.landmark, phrase);
  }
  const match = matchPhrases(
    [...candidates].map(([key, phrases]) => ({ key, phrases })), observed);
  if (match.winner) return match.winner.key;
  // A label spoken verbatim beats a landmark that only contains its words.
  const exact = (match.tied ?? []).filter(candidate => {
    const keyTokens = tokenize(candidate.key);
    return keyTokens.size === observed.size && isSubset(keyTokens, observed);
  });
  return exact.length === 1 ? exact[0].key : null;
}

function checkedAnchors(records, survey) {
  const anchors = new Map();
  const seen = new Set();
  for (const anchor of records ?? []) {
    if (!validId(anchor?.id)) continue;
    if (seen.has(anchor.id)) {
      anchors.delete(anchor.id);
      continue;
    }
    seen.add(anchor.id);
    if (plainText(anchor.landmark, 120) && checked(anchor.evidence ?? survey)) {
      anchors.set(anchor.id, anchor);
    }
  }
  return anchors;
}

function checkedEdges(records, anchors, survey) {
  const outgoing = new Map();
  for (const edge of records ?? []) {
    if (!edge || edge.from === edge.to || !anchors.has(edge.from) || !anchors.has(edge.to) ||
      !commands.has(edge.action) || !validPose(edge.entry_pose) || !validPose(edge.exit_pose) ||
      (edge.entry_pose === null && edge.action !== 'approach_visible') ||
      !checked(edge.evidence ?? survey)) continue;

    const options = outgoing.get(edge.from) ?? [];
    options.push(edge);
    outgoing.set(edge.from, options);
  }
  return outgoing;
}

// Search node + pose states. Equal-length routes follow the authored edge order.
function shortestRoute(outgoing, currentId, startPose, destinationId) {
  const queue = [{ id: currentId, pose: startPose, path: [] }];
  const seen = new Set([JSON.stringify([currentId, startPose])]);
  for (let index = 0; index < queue.length; index++) {
    const { id, pose, path } = queue[index];
    for (const edge of outgoing.get(id) ?? []) {
      if (edge.entry_pose !== null && poseKey(edge.entry_pose) !== pose) continue;
      const route = [...path, edge];
      if (edge.to === destinationId) return route;
      const nextPose = poseKey(edge.exit_pose);
      const state = JSON.stringify([edge.to, nextPose]);
      if (seen.has(state)) continue;
      seen.add(state);
      queue.push({ id: edge.to, pose: nextPose, path: route });
    }
  }
  return null;
}

function knownLandmarks(map, anchors) {
  const ordered = [];
  const startId = map?.start?.anchor;
  if (anchors.has(startId)) ordered.push(anchors.get(startId).landmark);
  for (const anchor of anchors.values()) {
    if (anchor.id !== startId) ordered.push(anchor.landmark);
  }
  return ordered.slice(0, 8);
}

// Shared plan for both exports: resolves the request to a checked current
// anchor and pose, then returns the full shortest checked route.
function fullPlan(map, { destination_id, current_id, current_landmark, heading, facing }) {
  const anchors = checkedAnchors(map.anchors, map.survey);
  const mapped = COURSE_DESTINATIONS.filter(
    id => id !== destination_id && anchors.has(id));
  const unverified = reason => mapped.length
    ? { status: 'unverified', reason, mapped_destinations: mapped }
    : { status: 'unverified', reason };
  if (!COURSE_DESTINATIONS.includes(destination_id)) {
    return unverified('unknown_destination');
  }
  if (!anchors.has(destination_id)) return unverified('destination_not_checked');
  const anchorRequired = () => {
    const known = knownLandmarks(map, anchors);
    const result = known.length
      ? { status: 'needs_anchor', reason: 'current_anchor_required', known_landmarks: known }
      : { status: 'needs_anchor', reason: 'current_anchor_required' };
    const start = map?.start;
    if (current_id == null && current_landmark == null && start && anchors.has(start.anchor)) {
      const pose = validPose({ facing: start.facing }) ? { facing: start.facing }
        : validPose({ heading: start.heading }) ? { heading: start.heading } : {};
      result.likely_start = { landmark: anchors.get(start.anchor).landmark, ...pose };
    }
    return result;
  };

  let currentId = current_id;
  if (current_landmark != null) {
    if (currentId != null || !validObservedLandmark(current_landmark)) return anchorRequired();
    // A place described as far, ahead or behind is not where the operator stands. Ask where they stand.
    if (SIGHTING.test(current_landmark)) return anchorRequired();
    const match = matchPhrases(
      [...anchors.values()].map(anchor => ({
        key: anchor.id, anchor, phrases: anchorPhrases(anchor),
      })),
      tokenize(current_landmark),
    );
    if (match.winner) currentId = match.winner.key;
    else if (match.tied.length > 1) {
      return {
        status: 'needs_anchor',
        reason: 'ambiguous_landmark',
        candidates: match.tied.map(candidate => candidate.anchor.landmark),
      };
    }
  }
  if (!anchors.has(currentId)) return anchorRequired();
  if (currentId === destination_id) {
    return {
      status: 'at_destination',
      destination_id,
      expected_landmark: anchors.get(destination_id).landmark,
      requires_physical_confirmation: true,
    };
  }

  const outgoing = checkedEdges(map.edges, anchors, map.survey);
  let pose = '';
  if (!(heading != null && facing != null)) {
    if (heading != null && validPose({ heading })) {
      pose = poseKey({ heading });
    } else if (facing != null && validPose({ facing })) {
      const canonical = canonicalFacing(map, anchors, tokenize(facing));
      if (canonical != null) {
        const direct = `facing:${canonical}`;
        const here = outgoing.get(currentId) ?? [];
        const implied = new Set(here
          .filter(edge => edge.action === 'walk_straight' && edge.entry_pose &&
            anchors.get(edge.to).landmark === canonical)
          .map(edge => poseKey(edge.entry_pose)));
        pose = here.some(edge => poseKey(edge.entry_pose) === direct) || implied.size !== 1
          ? direct : [...implied][0];
      }
    }
  }

  const toLegs = path => path.map(edge => ({
    from: edge.from,
    to: edge.to,
    command: commands.get(edge.action)(anchors.get(edge.to).landmark),
    exit_pose: edge.exit_pose ?? null,
    landmark: anchors.get(edge.to).landmark,
  }));

  const path = shortestRoute(outgoing, currentId, pose, destination_id);
  if (!path) {
    const usable = new Set();
    for (const edge of outgoing.get(currentId) ?? []) {
      const candidate = poseKey(edge.entry_pose);
      if (candidate && candidate !== pose && !usable.has(candidate) &&
        shortestRoute(outgoing, currentId, candidate, destination_id)) {
        usable.add(candidate);
      }
    }
    if (usable.size) {
      return {
        status: 'needs_anchor',
        reason: 'current_orientation_required',
        known_facings: [...usable].map(renderPose),
      };
    }
    return unverified('no_checked_route');
  }
  return {
    status: 'route',
    legs: toLegs(path),
    destination_landmark: anchors.get(destination_id).landmark,
  };
}

export function planFullRoute(map, request) {
  const result = fullPlan(map, request);
  if (result.status !== 'route') return result;
  return { status: 'route', legs: result.legs.map(({ landmark: _, ...leg }) => leg) };
}

export function planRoute(map, request) {
  const result = fullPlan(map, request);
  if (result.status !== 'route') return result;
  const [first] = result.legs;
  return {
    status: 'step',
    command: first.command,
    next_id: first.to,
    expected_landmark: first.landmark,
    exit_pose: first.exit_pose,
    remaining_steps: result.legs.length,
    destination_landmark: result.destination_landmark,
  };
}

// Reports every record the planner silently drops, a route table from every
// usable anchor and pose to every course destination, and authoring warnings.
export function auditMap(map) {
  const rejected = [];
  const warnings = [];
  const survey = map?.survey;

  const idCounts = new Map();
  for (const anchor of map?.anchors ?? []) {
    if (validId(anchor?.id)) idCounts.set(anchor.id, (idCounts.get(anchor.id) ?? 0) + 1);
  }
  const anchors = new Map();
  (map?.anchors ?? []).forEach((anchor, index) => {
    const reject = reason => rejected.push({
      kind: 'anchor', id_or_index: validId(anchor?.id) ? anchor.id : index, reason,
    });
    if (!validId(anchor?.id)) return reject('bad id');
    if (idCounts.get(anchor.id) > 1) return reject('duplicate id');
    if (!plainText(anchor.landmark, 120)) return reject('bad landmark');
    if (!checked(anchor.evidence ?? survey)) return reject('missing evidence');
    for (const alias of Array.isArray(anchor.aliases) ? anchor.aliases : []) {
      if (!plainText(alias, 120)) warnings.push(`anchor ${anchor.id}: invalid alias dropped`);
    }
    anchors.set(anchor.id, anchor);
  });

  const edges = [];
  (map?.edges ?? []).forEach((edge, index) => {
    const reject = reason => rejected.push({ kind: 'edge', id_or_index: index, reason });
    if (!edge || typeof edge !== 'object') return reject('bad edge');
    if (edge.from === edge.to) return reject('from equals to');
    if (!anchors.has(edge.from) || !anchors.has(edge.to)) return reject('unknown anchor');
    if (!commands.has(edge.action)) return reject('bad action');
    if (!validPose(edge.entry_pose) || !validPose(edge.exit_pose)) return reject('invalid pose');
    if (edge.entry_pose === null && edge.action !== 'approach_visible') {
      return reject('null entry_pose on non-approach action');
    }
    if (!checked(edge.evidence ?? survey)) return reject('missing evidence');
    edges.push(edge);
  });

  const outgoing = new Map();
  for (const edge of edges) {
    const options = outgoing.get(edge.from) ?? [];
    options.push(edge);
    outgoing.set(edge.from, options);
  }
  const toLegs = path => path.map(edge => ({
    from: edge.from,
    to: edge.to,
    command: commands.get(edge.action)(anchors.get(edge.to).landmark),
    exit_pose: edge.exit_pose ?? null,
  }));

  const origins = [];
  const start = map?.start;
  const startId = validId(start?.anchor) && anchors.has(start.anchor) ? start.anchor : null;
  if (start && !startId) warnings.push('start references an unknown or unchecked anchor');
  if (startId) {
    const pose = validHeading(start.heading) ? poseKey({ heading: start.heading }) :
      validFacing(start.facing) ? poseKey({ facing: start.facing }) : '';
    origins.push({ from: startId, pose });
  }
  for (const anchor of anchors.values()) {
    if (anchor.id === startId) continue;
    const poses = [...new Set((outgoing.get(anchor.id) ?? []).map(edge => poseKey(edge.entry_pose)))];
    for (const pose of poses.length ? poses : ['']) origins.push({ from: anchor.id, pose });
  }

  const routes = [];
  for (const { from, pose } of origins) {
    for (const destination of COURSE_DESTINATIONS) {
      const row = { from, pose: pose ? renderPose(pose) : null, destination };
      if (!anchors.has(destination)) row.status = 'destination_not_checked';
      else if (from === destination) row.status = 'at_destination';
      else {
        const path = shortestRoute(outgoing, from, pose, destination);
        if (path) row.legs = toLegs(path);
        else row.status = 'no_checked_route';
      }
      routes.push(row);
    }
  }

  for (const destination of COURSE_DESTINATIONS) {
    if (!anchors.has(destination)) warnings.push(`destination ${destination} has no checked anchor`);
  }
  for (const edge of edges) {
    if (!edges.some(other => other.from === edge.to && other.to === edge.from)) {
      warnings.push(`edge ${edge.from} -> ${edge.to} has no reverse edge`);
    }
  }
  const signatures = new Map();
  for (const anchor of anchors.values()) {
    for (const phrase of anchorPhrases(anchor)) {
      const signature = [...phrase].sort().join(' ');
      const owners = signatures.get(signature) ?? new Map();
      const texts = owners.get(anchor.id) ?? [];
      texts.push(phrase);
      owners.set(anchor.id, texts);
      signatures.set(signature, owners);
    }
  }
  for (const [signature, owners] of signatures) {
    if (owners.size > 1) {
      warnings.push(`phrase "${signature}" collides across anchors: ${[...owners.keys()].join(', ')}`);
    }
  }

  return { rejected, routes, warnings };
}
