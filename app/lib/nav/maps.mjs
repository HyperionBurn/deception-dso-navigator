import { DEMO_MAP } from './demo-map.mjs';
import { DTEC_MAP } from './dtec-map.mjs';
import { validateMap } from './map.mjs';

// The demo map is only used when someone switches it on (NAVIGATOR_USE_DEMO_MAP=1), so a made-up floor
// can never be used by accident at the event.
export function loadMap(env = process.env) {
  return env.NAVIGATOR_USE_DEMO_MAP === '1' ? DEMO_MAP : DTEC_MAP;
}

export function mapReady(map) {
  const hasPlace = Object.values(map.nodes).some(node => node.type === 'place');
  return hasPlace && Boolean(map.meta.start) && validateMap(map).ok;
}
