// Turns the floor team's plain-text survey file into a FLOOR_MAP object.
// Format (one statement per line; blank lines and # comments are ignored):
//
//   survey: <checked_at> | <checked_by> | <reference>
//   start: <id|LETTER> [facing <label> | heading <north|east|south|west>]
//   anchor <id|LETTER>: <landmark> [| aliases: a, b, c]
//   leg <from> [facing <label> | heading <dir>] -> <to> : <action>
//       [| exit facing <label> | exit heading <dir>]
//
// Ids: a bare letter (A, B, C…) is a waypoint sign and maps to `sign_<letter>`;
// anything else is used as-is and must be a lowercase anchor id (a destination
// id from COURSE_DESTINATIONS or a waypoint id).
// Actions: straight → walk_straight, left → left_then_straight,
//          right → right_then_straight, around → around_then_straight,
//          approach → approach_visible.
// See qa/SURVEY FORMAT.md for a fully worked example.
import { validId } from './route-planner.mjs';

const ACTIONS = new Map([
  ['straight', 'walk_straight'],
  ['left', 'left_then_straight'],
  ['right', 'right_then_straight'],
  ['around', 'around_then_straight'],
  ['approach', 'approach_visible'],
]);
const HEADINGS = new Set(['north', 'east', 'south', 'west']);
const ID_TOKEN = '[A-Za-z][A-Za-z0-9_]*';
const LINES = {
  survey: new RegExp(`^survey\\s*:\\s*([^|]+)\\|\\s*([^|]+)\\|\\s*([^|]+)$`, 'u'),
  start: new RegExp(`^start\\s*:\\s*(${ID_TOKEN})(?:\\s+(facing|heading)\\s+(.+))?$`, 'u'),
  anchor: new RegExp(`^anchor\\s+(${ID_TOKEN})\\s*:\\s*(.+?)(?:\\s*\\|\\s*aliases\\s*:\\s*(.+))?$`, 'u'),
  leg: new RegExp(`^leg\\s+(${ID_TOKEN})(?:\\s+(facing|heading)\\s+(.+?))?\\s*->\\s*` +
    `(${ID_TOKEN})\\s*:\\s*(\\w+)\\s*(?:\\|\\s*exit\\s+(facing|heading)\\s+(.+?))?$`, 'u'),
};

function anchorId(token) {
  return /^[A-Za-z]$/u.test(token) ? `sign_${token.toLowerCase()}` : token;
}

function parsePose(kind, value, line, errors) {
  const label = value.trim();
  if (kind === 'heading') {
    if (!HEADINGS.has(label)) {
      errors.push({ line, message: `unknown heading '${label}' (north|east|south|west)` });
      return undefined;
    }
    return { heading: label };
  }
  return { facing: label };
}

// Returns { map, errors: [{ line, message }] }. Map keys appear only when
// present in the survey; errors collect every bad line (line numbers 1-based).
export function parseSurveyText(text) {
  const map = { anchors: [], edges: [] };
  const ids = new Set();
  const errors = [];
  const pendingLegs = [];

  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = index + 1;
    const source = raw.trim();
    if (!source || source.startsWith('#')) continue;
    const fail = message => errors.push({ line, message });

    let match = LINES.survey.exec(source);
    if (match) {
      const [, checked_at, checked_by, reference] = match.map((v, i) => i ? v?.trim() : v);
      if (map.survey) fail('duplicate survey line');
      else if (!checked_at || !checked_by || !reference) fail('survey needs <at> | <by> | <reference>');
      else map.survey = { checked_at, checked_by, reference };
      continue;
    }
    match = LINES.start.exec(source);
    if (match) {
      const [, token, poseKind, poseValue] = match;
      if (map.start) { fail('duplicate start line'); continue; }
      const anchor = anchorId(token);
      if (!validId(anchor)) { fail(`bad start anchor id '${token}'`); continue; }
      map.start = { anchor };
      if (poseKind) {
        const pose = parsePose(poseKind, poseValue, line, errors);
        if (pose) Object.assign(map.start, pose);
      }
      continue;
    }
    match = LINES.anchor.exec(source);
    if (match) {
      const [, token, landmark, aliasList] = match;
      const id = anchorId(token);
      if (!validId(id)) { fail(`bad anchor id '${token}'`); continue; }
      if (ids.has(id)) { fail(`duplicate anchor id '${id}'`); continue; }
      if (!landmark) { fail(`anchor '${token}' has no landmark`); continue; }
      ids.add(id);
      const anchor = { id, landmark };
      if (aliasList) {
        const aliases = aliasList.split(',').map(a => a.trim()).filter(Boolean);
        if (aliases.length) anchor.aliases = aliases;
      }
      map.anchors.push(anchor);
      continue;
    }
    match = LINES.leg.exec(source);
    if (match) {
      const failed = errors.length;
      const [, from, entryKind, entryValue, to, action, exitKind, exitValue] = match;
      const entry = entryKind ? parsePose(entryKind, entryValue, line, errors) : null;
      const exit = exitKind ? parsePose(exitKind, exitValue, line, errors) : null;
      if (errors.length > failed) continue;
      if (!ACTIONS.has(action)) { fail(`unknown action '${action}'`); continue; }
      pendingLegs.push({ line, edge: {
        from: anchorId(from), to: anchorId(to), action: ACTIONS.get(action),
        entry_pose: entry, exit_pose: exit,
      } });
      continue;
    }
    fail(`unrecognized line '${source.slice(0, 60)}'`);
  }

  for (const { line, edge } of pendingLegs) {
    const failed = errors.length;
    for (const end of ['from', 'to']) {
      if (!validId(edge[end])) errors.push({ line, message: `bad ${end} id '${edge[end]}'` });
      else if (!ids.has(edge[end])) {
        errors.push({ line, message: `leg ${end} '${edge[end]}' is not a declared anchor` });
      }
    }
    if (edge.from === edge.to) {
      errors.push({ line, message: 'leg starts and ends at the same anchor' });
    }
    if (errors.length === failed) map.edges.push(edge);
  }
  if (map.start && !ids.has(map.start.anchor)) {
    errors.push({ line: 0, message: `start anchor '${map.start.anchor}' is not a declared anchor` });
  }
  return { map, errors };
}

// A .json survey file carries the FLOOR_MAP shape directly.
export function parseSurveyJson(text) {
  const errors = [];
  let map;
  try {
    map = JSON.parse(text);
  } catch {
    return { map: null, errors: [{ line: 0, message: 'invalid JSON' }] };
  }
  if (!map || typeof map !== 'object' || Array.isArray(map) ||
      !Array.isArray(map.anchors) || !Array.isArray(map.edges)) {
    return { map: null, errors: [{ line: 0, message: 'JSON must be a {anchors:[], edges:[]} map object' }] };
  }
  return { map, errors };
}

const literal = value => JSON.stringify(value);

export function serializeFloorMap(map) {
  const out = ['export const FLOOR_MAP = Object.freeze({'];
  if (map.survey) {
    out.push(`  survey: Object.freeze({ checked_at: ${literal(map.survey.checked_at)}, ` +
      `checked_by: ${literal(map.survey.checked_by)}, reference: ${literal(map.survey.reference)} }),`);
  }
  if (map.start) {
    const pose = map.start.heading ? `heading: ${literal(map.start.heading)}`
      : map.start.facing ? `facing: ${literal(map.start.facing)}` : '';
    out.push(`  start: Object.freeze({ anchor: ${literal(map.start.anchor)}${pose ? `, ${pose}` : ''} }),`);
  }
  out.push('  anchors: Object.freeze([');
  for (const anchor of map.anchors) {
    const aliases = anchor.aliases?.length ? `, aliases: Object.freeze(${literal(anchor.aliases)})` : '';
    const evidence = anchor.evidence ? `, evidence: Object.freeze(${literal(anchor.evidence)})` : '';
    out.push(`    Object.freeze({ id: ${literal(anchor.id)}, landmark: ${literal(anchor.landmark)}${aliases}${evidence} }),`);
  }
  out.push('  ]),');
  out.push('  edges: Object.freeze([');
  for (const edge of map.edges) {
    const entry = literal(edge.entry_pose ?? null);
    const exit = literal(edge.exit_pose ?? null);
    const evidence = edge.evidence ? `, evidence: Object.freeze(${literal(edge.evidence)})` : '';
    out.push(`    Object.freeze({ from: ${literal(edge.from)}, to: ${literal(edge.to)}, ` +
      `action: ${literal(edge.action)}, entry_pose: ${entry}, exit_pose: ${exit}${evidence} }),`);
  }
  out.push('  ]),');
  out.push('});');
  return out.join('\n');
}

const MAP_START = 'export const FLOOR_MAP';
const EXAMPLE_START = '// EXAMPLE ONLY';

// Replaces only the FLOOR_MAP export in floor-map.mjs source, preserving the
// COURSE_DESTINATIONS block above it and the EXAMPLE comment block below it.
export function writeFloorMapSource(source, map, note) {
  const start = source.indexOf(MAP_START);
  const example = source.indexOf(EXAMPLE_START);
  if (start < 0 || example < 0 || example < start) {
    throw new Error('floor-map.mjs markers not found; refusing to rewrite');
  }
  const header = note ? `// ${note}\n` : '';
  return `${source.slice(0, start)}${header}${serializeFloorMap(map)}\n\n${source.slice(example)}`;
}
