import { opposite } from './headings.mjs';
import { runTool } from './tools.mjs';

// Sweep test: put the robot at every spot inside every corridor, facing either way, and ask for every place.
// The tools must find a route that really ends at the place. Run it on the real map before filming, so a
// surprise destination cannot find a hole. Returns { total, failures }.
export function sweepMap(map) {
  const places = Object.entries(map.nodes).filter(([, node]) => node.type === 'place').map(([id]) => id);
  const failures = [];
  let total = 0;
  for (const edge of map.edges) {
    for (const dir of [1, -1]) {
      for (let done = 1; done < edge.steps; done++) {
        for (const dest of places) {
          total++;
          const label = `${edge.id} dir ${dir} done ${done} -> ${dest}`;
          let state = null;
          const call = (tool, args) => {
            const out = runTool({ map, state, session_id: 'sweep-session-1', tool, args, now: 0 });
            state = out.state;
            return out.result;
          };
          call('set_position', { edge: edge.id, dir, done, heading: dir === 1 ? edge.h : opposite(edge.h) });
          let step = call('plan_route', { destination_id: dest, lang: 'en' });
          for (let guard = 0; guard < 40 && !step.arrived && step.status !== 'handover'; guard++) {
            if (!['instruction', 'arrival_check'].includes(step.status)) break;
            step = call('confirm_step', { step_id: step.step_id, result: step.status === 'arrival_check' ? 'yes' : 'done' });
          }
          if (!step.arrived || state.pos?.node !== dest) failures.push(label);
        }
      }
    }
  }
  return { total, failures };
}
