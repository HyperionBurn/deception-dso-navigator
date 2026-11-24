// DEMO DATA. This is NOT the Dtec floor. Every name, cue, distance and step count below is made up
// so the planner and the agent can be tested before anyone has measured the real floor.
// The real map goes in dtec-map.mjs, and only measured entries (with checked_by and checked_at) belong there.
// Place ids match the course list in lib/floor-map.mjs.

const door = (n, word) => ({
  E: `the door of booth ${word} is on your left`,
  W: `the door of booth ${word} is on your right`,
  any: `you reach booth ${word}`,
});

export const DEMO_MAP = Object.freeze({
  meta: {
    floor: 'DEMO DATA, not the real Dtec floor',
    demo: true,
    unit: 'steps',
    north_means: 'facing the glass wall',
    start: { node: 'start', heading: 'N', say: 'Operator, are you at the start point, facing the glass wall?' },
    verify_arrival: true,
  },
  nodes: {
    start: { name: 'the start point', type: 'point', cue: 'you are at the start point' },
    team_corner: {
      name: 'the team corner', type: 'junction',
      cue: { N: 'the team tables open on your left', S: 'the team tables open on your right', any: 'you reach the team corner' },
    },
    booth_corner: {
      name: 'the booth corner', type: 'junction',
      cue: { N: 'the booth corridor opens on your right', S: 'the booth corridor opens on your left', any: 'you reach the booth corner' },
    },
    north_end: { name: 'the end of the corridor', type: 'junction', cue: 'you reach the end of the corridor' },
    team_tables: {
      name: 'the team tables', type: 'place', kind: 'tables', see: 'the team tables',
      cue: 'the team tables are in front of you', aliases: ['team table', 'tables', 'team area', 'طاولات الفرق'],
    },
    call_booth_1: {
      name: 'booth one', type: 'place', kind: 'booth', see: 'the door of booth one', cue: door(1, 'one'),
      aliases: ['booth 1', 'call booth 1', 'call booth one', 'first booth', 'كبينة 1', 'كبينة المكالمات 1'],
    },
    call_booth_2: {
      name: 'booth two', type: 'place', kind: 'booth', see: 'the door of booth two', cue: door(2, 'two'),
      aliases: ['booth 2', 'call booth 2', 'call booth two', 'second booth', 'كبينة 2', 'كبينة المكالمات 2'],
    },
    call_booth_3: {
      name: 'booth three', type: 'place', kind: 'booth', see: 'the door of booth three', cue: door(3, 'three'),
      aliases: ['booth 3', 'call booth 3', 'call booth three', 'third booth', 'كبينة 3', 'كبينة المكالمات 3'],
    },
    call_booth_4: {
      name: 'booth four', type: 'place', kind: 'booth', see: 'the door of booth four', cue: door(4, 'four'),
      aliases: ['booth 4', 'call booth 4', 'call booth four', 'fourth booth', 'كبينة 4', 'كبينة المكالمات 4'],
    },
    kitchen: {
      name: 'the kitchen', type: 'place', kind: 'kitchen', see: 'the kitchen counter',
      cue: 'the kitchen counter is in front of you', aliases: ['kitchenette', 'pantry', 'food', 'المطبخ'],
    },
    meeting_room: {
      name: 'the meeting room', type: 'place', kind: 'room', see: 'the meeting room door',
      cue: 'the meeting room door is in front of you', aliases: ['meeting', 'غرفة الاجتماعات'],
    },
    conference_room: {
      name: 'the conference room', type: 'place', kind: 'room', see: 'the conference room door',
      cue: 'the conference room door is in front of you', aliases: ['conference', 'قاعة المؤتمرات'],
    },
  },
  edges: [
    { id: 'e1', a: 'start', b: 'team_corner', h: 'N', steps: 12 },
    { id: 'e2', a: 'team_corner', b: 'booth_corner', h: 'N', steps: 10 },
    { id: 'e3', a: 'booth_corner', b: 'north_end', h: 'N', steps: 8 },
    { id: 'e4', a: 'team_corner', b: 'team_tables', h: 'W', steps: 8 },
    { id: 'e5', a: 'booth_corner', b: 'call_booth_1', h: 'E', steps: 6 },
    { id: 'e6', a: 'call_booth_1', b: 'call_booth_2', h: 'E', steps: 4 },
    { id: 'e7', a: 'call_booth_2', b: 'call_booth_3', h: 'E', steps: 4 },
    { id: 'e8', a: 'call_booth_3', b: 'call_booth_4', h: 'E', steps: 4 },
    { id: 'e9', a: 'north_end', b: 'kitchen', h: 'N', steps: 6 },
    { id: 'e10', a: 'north_end', b: 'meeting_room', h: 'W', steps: 10 },
    { id: 'e11', a: 'north_end', b: 'conference_room', h: 'E', steps: 12 },
  ],
  // `side` is where the thing is when you walk edge a -> b.
  landmarks: {
    reception: { edge: 'e1', at: 6, side: 'right', say: 'the reception desk', aliases: ['front desk', 'reception'] },
    printer: { edge: 'e2', at: 5, side: 'left', say: 'the printer', aliases: ['copier', 'copy machine'] },
    fridge: { edge: 'e9', at: 3, side: 'right', say: 'the fridge', aliases: ['refrigerator'] },
  },
});
