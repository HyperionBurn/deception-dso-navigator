// The REAL map of the Dtec event floor. It is empty on purpose: nothing goes in here until someone has
// walked the floor and measured it. Every node, edge and landmark needs checked_by and checked_at
// (the validator enforces this because demo is false). See demo-map.mjs for the shape.
// Until this has places and a start point, the navigation tools answer "no map" and give no directions.

export const DTEC_MAP = Object.freeze({
  meta: {
    floor: 'Dtec event floor, measured by the team',
    demo: false,
    unit: 'steps',
    north_means: '',
    start: null,
    verify_arrival: true,
  },
  nodes: {},
  edges: [],
  landmarks: {},
});
