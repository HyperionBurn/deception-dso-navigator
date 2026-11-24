import { opposite, relTurn } from './headings.mjs';
import { buildGraph, cueFor } from './map.mjs';

// Route planning is plain code. The language model never counts steps or rotates headings.
export const TURN_PENALTY = 6; // steps; makes the planner prefer routes with fewer turns

const graphs = new WeakMap();
const graphOf = map => {
  if (!graphs.has(map)) graphs.set(map, buildGraph(map));
  return graphs.get(map);
};

// Cheapest path over (node, heading). Each leg: { to, h, steps, edge }.
export function planLegs(map, node, heading, dest) {
  if (!map.nodes[node] || !map.nodes[dest]) return null;
  const graph = graphOf(map);
  const queue = [{ cost: 0, node, heading, legs: [] }];
  const seen = new Set();
  while (queue.length) {
    queue.sort((x, y) => x.cost - y.cost);
    const { cost, node: here, heading: facing, legs } = queue.shift();
    if (here === dest) return legs;
    const key = `${here}/${facing}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const leg of graph.get(here)) {
      const turn = leg.h === facing ? 0 : TURN_PENALTY;
      queue.push({ cost: cost + leg.steps + turn, node: leg.to, heading: leg.h, legs: [...legs, leg] });
    }
  }
  return null;
}

export function legsCost(legs, heading) {
  let facing = heading;
  let cost = 0;
  for (const leg of legs) {
    cost += leg.steps + (leg.h === facing ? 0 : TURN_PENALTY);
    facing = leg.h;
  }
  return cost;
}

// One action per instruction. Straight legs are merged; a walk stops only where a turn or the end comes.
export function legsToInstructions(map, heading, legs) {
  const out = [];
  let facing = heading;
  for (let i = 0; i < legs.length;) {
    const leg = legs[i];
    if (leg.h !== facing) {
      const dir = relTurn(facing, leg.h);
      out.push({ kind: 'turn', dir, to_heading: leg.h, say: `Operator, turn ${dir}.` });
      facing = leg.h;
    }
    let j = i;
    let steps = leg.steps;
    while (j + 1 < legs.length && legs[j + 1].h === leg.h) { j++; steps += legs[j].steps; }
    const end = legs[j].to;
    out.push({
      kind: 'walk', to_node: end, to_heading: leg.h, steps,
      say: `Operator, walk straight until ${cueFor(map, end, leg.h)}.`,
      hint: `about ${steps} steps`,
    });
    i = j + 1;
  }
  return out;
}

export { opposite };
