// Compass headings are only an internal frame ("N" is any fixed direction we choose).
// The operator never hears compass words, only left, right, around and landmarks.
export const HEADINGS = Object.freeze(['N', 'E', 'S', 'W']);
const DEGREES = { N: 0, E: 90, S: 180, W: 270 };
const TURN_NAMES = { 0: 'straight', 90: 'right', 180: 'around', 270: 'left' };

export const isHeading = value => HEADINGS.includes(value);
export const opposite = heading => HEADINGS[(HEADINGS.indexOf(heading) + 2) % 4];

export function relTurn(current, next) {
  return TURN_NAMES[(DEGREES[next] - DEGREES[current] + 360) % 360];
}
