// Draws the demo or real floor on the second screen. Compass directions only decide where things sit on the
// picture ("N" is up). The operator never hears them.

const VECTOR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const round = value => Math.round(value * 100) / 100;

export function layoutMap(map) {
  const ids = Object.keys(map.nodes);
  const nodes = {};
  if (ids.length) nodes[map.meta.start?.node ?? ids[0]] = { x: 0, y: 0 };
  for (let grew = true; grew;) {
    grew = false;
    for (const edge of map.edges) {
      const [dx, dy] = VECTOR[edge.h];
      if (nodes[edge.a] && !nodes[edge.b]) {
        nodes[edge.b] = { x: nodes[edge.a].x + dx * edge.steps, y: nodes[edge.a].y + dy * edge.steps };
        grew = true;
      } else if (nodes[edge.b] && !nodes[edge.a]) {
        nodes[edge.a] = { x: nodes[edge.b].x - dx * edge.steps, y: nodes[edge.b].y - dy * edge.steps };
        grew = true;
      }
    }
  }
  const xs = Object.values(nodes).map(p => p.x);
  const ys = Object.values(nodes).map(p => p.y);
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  return {
    nodes,
    edges: map.edges.map(edge => ({ id: edge.id, a: edge.a, b: edge.b })),
    bounds: { minX, minY, w: Math.max(...xs, 0) - minX || 1, h: Math.max(...ys, 0) - minY || 1 },
  };
}

// Where the robot is on the picture: on a node, or part way along a corridor.
export function pointAt(map, layout, pos) {
  if (!pos) return null;
  if (pos.node) return layout.nodes[pos.node] ? { ...layout.nodes[pos.node], kind: 'node' } : null;
  const edge = map.edges.find(e => e.id === pos.edge);
  const a = layout.nodes[edge?.a];
  const b = layout.nodes[edge?.b];
  if (!a || !b) return null;
  const t = pos.dir === 1 ? pos.done / edge.steps : (edge.steps - pos.done) / edge.steps;
  return { x: round(a.x + (b.x - a.x) * t), y: round(a.y + (b.y - a.y) * t), kind: 'edge' };
}
