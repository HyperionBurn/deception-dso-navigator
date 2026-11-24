import { layoutMap, pointAt } from './layout.mjs';

// What the second screen shows for one session: built only from the saved state, so it costs no model call.
export function screenData(map, state) {
  const layout = layoutMap(map);
  const stepping = state.awaiting?.kind === 'step';
  const steps = state.route.map((instr, index) => ({
    say: instr.say,
    status: index < state.i || state.arrived ? 'done' : (index === state.i && stepping ? 'current' : 'next'),
  }));
  let position = null;
  if (state.pos?.node) position = map.nodes[state.pos.node].name;
  else if (state.pos?.edge) {
    const edge = map.edges.find(e => e.id === state.pos.edge);
    const [from, to] = state.pos.dir === 1 ? [edge.a, edge.b] : [edge.b, edge.a];
    position = `between ${map.nodes[from].name} and ${map.nodes[to].name}`;
  }
  return {
    demo: map.meta.demo,
    session_id: state.session_id,
    updated: state.updated,
    layout,
    labels: Object.fromEntries(Object.entries(map.nodes).map(([id, node]) => [id, { name: node.name, short: node.short ?? null, type: node.type }])),
    robot: pointAt(map, layout, state.pos),
    position,
    confidence: state.conf,
    destination: state.dest ? map.nodes[state.dest].name : null,
    say_operator: state.last_say,
    awaiting: state.awaiting?.kind ?? null,
    steps,
    arrived: state.arrived,
    handover: state.handover ? { reason: state.handover.reason, at: state.handover.at } : null,
    log: state.log.slice(-12),
  };
}
