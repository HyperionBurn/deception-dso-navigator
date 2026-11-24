// Voice of the Oasis Team Guide Update, 24 Nov 2026, p. 2.
// These are logical destinations, not field observations or sign labels.
export const COURSE_DESTINATIONS = Object.freeze([
  'meeting_room',
  'conference_room',
  'call_booth_1',
  'call_booth_2',
  'call_booth_3',
  'call_booth_4',
  'team_tables',
  'kitchen',
]);

// The guide supplies no checked anchor, starting point, pose or direction.
// See route-contract.md for the evidence required to add a record.
export const FLOOR_MAP = Object.freeze({
  anchors: Object.freeze([]),
  edges: Object.freeze([]),
});

// EXAMPLE ONLY — fictional records showing the authoring shape. Never walk the
// real floor from this block; replace it with checked evidence before use.
//
// export const FLOOR_MAP = {
//   // Optional. Applied to every record that carries no evidence of its own.
//   survey: {
//     checked_at: '2026-11-24 14:00',
//     checked_by: 'floor walk team',
//     reference: 'walk sheet 1',
//   },
//   // Optional. Only orders known_landmarks and seeds the audit route table.
//   // The planner never assumes the robot starts here.
//   start: { anchor: 'entrance', heading: 'north' },
//   anchors: [
//     {
//       id: 'entrance',
//       landmark: 'the oasis gate',
//       aliases: ['main door', 'المدخل الرئيسي'],
//     },
//     { id: 'call_booth_1', landmark: 'call booth one', aliases: ['booth 1', 'كابينة ١'] },
//     { id: 'meeting_room', landmark: 'the meeting room sign' },
//   ],
//   edges: [
//     // Each direction is a separate checked edge.
//     {
//       from: 'entrance', to: 'call_booth_1', action: 'walk_straight',
//       entry_pose: { heading: 'north' }, exit_pose: { facing: 'call booth one' },
//     },
//     {
//       from: 'call_booth_1', to: 'entrance', action: 'around_then_straight',
//       entry_pose: { facing: 'call booth one' }, exit_pose: null,
//     },
//   ],
// };
