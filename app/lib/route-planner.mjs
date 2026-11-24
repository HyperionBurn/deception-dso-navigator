import { COURSE_DESTINATIONS } from './floor-map.mjs';

export const validId = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(value);
export const validHeading = value => ['north', 'east', 'south', 'west'].includes(value);
const plainText = (value, max) => typeof value === 'string' && value.length > 0 &&
  value.length <= max && value.trim() === value && !/[\p{C}\p{Zl}\p{Zp}]/u.test(value);
export const validFacing = value => plainText(value, 120);
export const validObservedLandmark = value => typeof value === 'string' && value.length <= 240 &&
  value.trim().length > 0 && !/[\p{C}\p{Zl}\p{Zp}]/u.test(value);
const normalizeLandmark = value => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
const poseKey = pose => pose?.heading ? `heading:${pose.heading}` :
  pose?.facing ? `facing:${pose.facing}` : '';
const validPose = pose => pose === null || (pose && typeof pose === 'object' &&
  Object.keys(pose).length === 1 &&
  ((Object.hasOwn(pose, 'heading') && validHeading(pose.heading)) ||
    (Object.hasOwn(pose, 'facing') && validFacing(pose.facing))));
const checked = evidence => plainText(evidence?.checked_at, 80) &&
  plainText(evidence.checked_by, 120) && plainText(evidence.reference, 240);

const commands = new Map([
  ['approach_visible', cue => `Face ${cue}. Walk to it and stop there.`],
  ['walk_straight', cue => `Walk straight and stop at ${cue}.`],
  ['left_then_straight', cue => `Turn left. Walk straight and stop at ${cue}.`],
  ['right_then_straight', cue => `Turn right. Walk straight and stop at ${cue}.`],
  ['around_then_straight', cue => `Turn around. Walk straight and stop at ${cue}.`],
]);

function checkedAnchors(records) {
  const anchors = new Map();
  const seen = new Set();
  for (const anchor of records) {
    if (!validId(anchor?.id)) continue;
    if (seen.has(anchor.id)) {
      anchors.delete(anchor.id);
      continue;
    }
    seen.add(anchor.id);
    if (plainText(anchor.landmark, 120) && checked(anchor.evidence)) anchors.set(anchor.id, anchor);
  }
  return anchors;
}

function checkedEdges(records, anchors) {
  const outgoing = new Map();
  for (const edge of records) {
    if (!edge || edge.from === edge.to || !anchors.has(edge.from) || !anchors.has(edge.to) ||
      !commands.has(edge.action) || !validPose(edge.entry_pose) || !validPose(edge.exit_pose) ||
      (edge.entry_pose === null && edge.action !== 'approach_visible') || !checked(edge.evidence)) continue;

    const options = outgoing.get(edge.from) ?? [];
    options.push(edge);
    outgoing.set(edge.from, options);
  }
  return outgoing;
}

// Search node + pose states. Equal-length routes follow the authored edge order.
function firstEdge(outgoing, currentId, startPose, destinationId) {
  const queue = [{ id: currentId, pose: startPose, first: null }];
  const seen = new Set([JSON.stringify([currentId, startPose])]);
  for (let index = 0; index < queue.length; index++) {
    const { id, pose, first } = queue[index];
    for (const edge of outgoing.get(id) ?? []) {
      if (edge.entry_pose !== null && poseKey(edge.entry_pose) !== pose) continue;
      const routeStart = first ?? edge;
      if (edge.to === destinationId) return routeStart;
      const nextPose = poseKey(edge.exit_pose);
      const state = JSON.stringify([edge.to, nextPose]);
      if (seen.has(state)) continue;
      seen.add(state);
      queue.push({ id: edge.to, pose: nextPose, first: routeStart });
    }
  }
  return null;
}

export function planRoute(map, { destination_id, current_id, current_landmark, heading, facing }) {
  if (!COURSE_DESTINATIONS.includes(destination_id)) {
    return { status: 'unverified', reason: 'unknown_destination' };
  }
  const anchors = checkedAnchors(map.anchors);
  let currentId = current_id;
  if (current_landmark != null) {
    if (currentId != null || !validObservedLandmark(current_landmark)) {
      return { status: 'needs_anchor', reason: 'current_anchor_required' };
    }
    const label = normalizeLandmark(current_landmark);
    const matches = [...anchors.values()].filter(anchor => normalizeLandmark(anchor.landmark) === label);
    if (matches.length === 1) currentId = matches[0].id;
  }
  if (!anchors.has(currentId)) return { status: 'needs_anchor', reason: 'current_anchor_required' };
  if (!anchors.has(destination_id)) return { status: 'unverified', reason: 'destination_not_checked' };
  if (currentId === destination_id) {
    return {
      status: 'at_destination',
      destination_id,
      expected_landmark: anchors.get(destination_id).landmark,
      requires_physical_confirmation: true,
    };
  }

  const outgoing = checkedEdges(map.edges, anchors);
  const observedPose = heading != null ? { heading } : facing != null ? { facing } : null;
  const pose = validPose(observedPose) && !(heading != null && facing != null) ? poseKey(observedPose) : '';
  const edge = firstEdge(outgoing, currentId, pose, destination_id);
  if (!edge) {
    const candidatePoses = new Set((outgoing.get(currentId) ?? []).map(e => poseKey(e.entry_pose)));
    for (const candidate of candidatePoses) {
      if (candidate && candidate !== pose && firstEdge(outgoing, currentId, candidate, destination_id)) {
        return { status: 'needs_anchor', reason: 'current_orientation_required' };
      }
    }
    return { status: 'unverified', reason: 'no_checked_route' };
  }

  const landmark = anchors.get(edge.to).landmark;
  return {
    status: 'step',
    command: commands.get(edge.action)(landmark),
    next_id: edge.to,
    expected_landmark: landmark,
  };
}
