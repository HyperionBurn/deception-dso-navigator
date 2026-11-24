import { HEADINGS, isHeading, opposite } from './headings.mjs';

// A map is plain JSON: nodes (points, junctions, places), edges (corridors with a
// compass heading and a step count) and landmarks (things seen along an edge).
// Until someone measures the floor, the only map we have is demo data (meta.demo = true).

export const MAX_CUE_WORDS = 9; // "walk straight until" + cue must stay within 12 words
export const MAX_SEE_WORDS = 6; // "stay stopped. Do you see" + see must stay within 12 words
export const MAX_SAY_WORDS = 12; // everything after "Operator,"
const ID = /^[a-z][a-z0-9_]{0,31}$/u;
const COMPASS = /\b(north|south|east|west|northern|southern|eastern|western)\b/iu;

export const wordCount = text => String(text).split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;

function cuesOf(node) {
  if (typeof node.cue === 'string') return [['cue', node.cue]];
  if (node.cue && typeof node.cue === 'object') return Object.entries(node.cue).map(([key, text]) => [`cue.${key}`, text]);
  return [];
}

export function validateMap(map) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!map || typeof map !== 'object') return { ok: false, errors: ['map is missing'] };
  const { meta, nodes, edges, landmarks } = map;
  if (!meta || typeof meta.floor !== 'string' || typeof meta.demo !== 'boolean') fail('meta needs floor and demo (true or false)');
  if (!nodes || typeof nodes !== 'object') fail('nodes are missing');
  if (!Array.isArray(edges)) fail('edges are missing');
  if (errors.length) return { ok: false, errors };

  const needsEvidence = meta.demo === false;
  const checked = (what, record) => {
    if (needsEvidence && !(typeof record.checked_by === 'string' && record.checked_by.trim() &&
      typeof record.checked_at === 'string' && record.checked_at.trim())) {
      fail(`${what} needs checked_by and checked_at (real maps only hold measured entries)`);
    }
  };

  for (const [id, node] of Object.entries(nodes)) {
    if (!ID.test(id)) fail(`node id "${id}" is not valid`);
    if (!node || typeof node.name !== 'string' || !['point', 'junction', 'place'].includes(node.type)) {
      fail(`node ${id} needs a name and a type (point, junction or place)`);
      continue;
    }
    const cues = cuesOf(node);
    if (!cues.length) fail(`node ${id} needs a cue`);
    for (const [key, text] of cues) {
      if (typeof text !== 'string' || !text.trim()) fail(`node ${id} ${key} is empty`);
      else if (COMPASS.test(text)) fail(`node ${id} ${key} has a compass word; the operator never hears compass words`);
      else if (wordCount(text) > MAX_CUE_WORDS) fail(`node ${id} ${key} is too long (max ${MAX_CUE_WORDS} words)`);
    }
    if (typeof node.cue === 'object' && node.cue) {
      for (const key of Object.keys(node.cue)) if (key !== 'any' && !isHeading(key)) fail(`node ${id} cue key "${key}" is not a heading`);
    }
    if (node.type === 'place' && !(typeof node.see === 'string' && node.see.trim())) {
      fail(`place ${id} needs "see" (a short phrase for the arrival check, like "the door of booth one")`);
    } else if (node.type === 'place') {
      // Heard as "Operator, stay stopped. Do you see <see>?" so it must stay inside 12 words after "Operator,".
      if (wordCount(node.see) > MAX_SEE_WORDS) fail(`place ${id} "see" is too long (max ${MAX_SEE_WORDS} words)`);
      if (COMPASS.test(node.see)) fail(`place ${id} "see" has a compass word; the operator never hears compass words`);
    }
    // Used when a corridor ends here and the node has no cue for the walking direction.
    if (wordCount(`you reach ${node.name}`) > MAX_CUE_WORDS) fail(`node ${id} name is too long to be spoken as a cue`);
    if (node.aliases != null && !(Array.isArray(node.aliases) && node.aliases.every(a => typeof a === 'string'))) {
      fail(`node ${id} aliases must be a list of strings`);
    }
    checked(`node ${id}`, node);
  }

  const edgeIds = new Set();
  for (const edge of edges) {
    if (!edge || !ID.test(edge.id ?? '') || edgeIds.has(edge.id)) { fail(`edge id "${edge?.id}" is missing or repeated`); continue; }
    edgeIds.add(edge.id);
    for (const end of ['a', 'b']) if (!nodes[edge[end]]) fail(`edge ${edge.id} uses unknown node ${edge[end]}`);
    if (edge.a === edge.b) fail(`edge ${edge.id} joins a node to itself`);
    if (!isHeading(edge.h)) fail(`edge ${edge.id} needs heading N, E, S or W`);
    if (!Number.isInteger(edge.steps) || edge.steps < 1 || edge.steps > 200) fail(`edge ${edge.id} needs steps from 1 to 200`);
    checked(`edge ${edge.id}`, edge);
  }

  for (const [id, mark] of Object.entries(landmarks ?? {})) {
    const edge = edges.find(e => e.id === mark?.edge);
    if (!ID.test(id) || !edge) { fail(`landmark ${id} needs a real edge`); continue; }
    if (!Number.isInteger(mark.at) || mark.at < 1 || mark.at >= edge.steps) fail(`landmark ${id} "at" must be inside edge ${edge.id}`);
    if (!['left', 'right'].includes(mark.side)) fail(`landmark ${id} side must be left or right`);
    if (typeof mark.say !== 'string' || !mark.say.trim()) fail(`landmark ${id} needs "say"`);
    checked(`landmark ${id}`, mark);
  }

  if (meta.start) {
    if (!nodes[meta.start.node] || !isHeading(meta.start.heading) || typeof meta.start.say !== 'string') {
      fail('meta.start needs node, heading and say');
    } else {
      const say = meta.start.say;
      if (!/^Operator, /u.test(say)) fail('meta.start.say must begin with "Operator, "');
      if (COMPASS.test(say)) fail('meta.start.say has a compass word; the operator never hears compass words');
      if (wordCount(say.replace(/^Operator,\s*/u, '')) > MAX_SAY_WORDS) fail(`meta.start.say is too long (max ${MAX_SAY_WORDS} words after "Operator,")`);
    }
  }

  // Every node must be reachable from every other node, otherwise a surprise destination could find a hole.
  const ids = Object.keys(nodes);
  if (ids.length) {
    const seen = new Set([ids[0]]);
    for (let grew = true; grew;) {
      grew = false;
      for (const edge of edges) {
        const a = seen.has(edge.a); const b = seen.has(edge.b);
        if (a !== b) { seen.add(edge.a); seen.add(edge.b); grew = true; }
      }
    }
    for (const id of ids) if (!seen.has(id)) fail(`node ${id} is not connected to the rest of the map`);
  }
  return { ok: errors.length === 0, errors };
}

export function cueFor(map, nodeId, heading) {
  const node = map.nodes[nodeId];
  if (typeof node.cue === 'string') return node.cue;
  return node.cue?.[heading] ?? node.cue?.any ?? `you reach ${node.name}`;
}

// Both walking directions of every edge, with the heading you walk it in.
export function buildGraph(map) {
  const graph = new Map(Object.keys(map.nodes).map(id => [id, []]));
  for (const edge of map.edges) {
    graph.get(edge.a).push({ to: edge.b, h: edge.h, steps: edge.steps, edge: edge.id });
    graph.get(edge.b).push({ to: edge.a, h: opposite(edge.h), steps: edge.steps, edge: edge.id });
  }
  return graph;
}

export { HEADINGS };
