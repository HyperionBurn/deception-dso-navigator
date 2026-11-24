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
// Surveyed 2026-11-24 18:47 by video only, not yet walked (IMG_3440.MOV); ingested by scripts/ingest-survey.mjs.
// Surveyed 2026-11-24 18:47 by video only, not yet walked (IMG_3440.MOV); ingested by scripts/ingest-survey.mjs.
// Surveyed 2026-11-24 18:47 by video only, not yet walked (IMG_3440.MOV); ingested by scripts/ingest-survey.mjs.
export const FLOOR_MAP = Object.freeze({
  survey: Object.freeze({ checked_at: "2026-11-24 18:47", checked_by: "video only, not yet walked", reference: "IMG_3440.MOV" }),
  start: Object.freeze({ anchor: "sign_a", facing: "reception" }),
  anchors: Object.freeze([
    Object.freeze({ id: "sign_a", landmark: "the pitch room door", aliases: Object.freeze(["pitch room","pitch room door","black wall","the start","steel bin","باب قاعة العروض","قاعة العروض"]) }),
    Object.freeze({ id: "team_tables", landmark: "the purple pillar", aliases: Object.freeze(["the purple pillar with the green speech bubble","purple pillar","magenta pillar","speech bubble","green speech bubble","team tables","the desks","طاولات الفرق","العمود البنفسجي"]) }),
    Object.freeze({ id: "sign_b", landmark: "the peach pillar", aliases: Object.freeze(["peach pillar","pink pillar","orange pillar","العمود الوردي","العمود البرتقالي"]) }),
    Object.freeze({ id: "kitchen", landmark: "the cafeteria menu boards", aliases: Object.freeze(["cafeteria","menu boards","the menu","kitchen","pizza counter","الكافتيريا","المطبخ","قائمة الطعام"]) }),
  ]),
  edges: Object.freeze([
    Object.freeze({ from: "sign_a", to: "team_tables", action: "walk_straight", entry_pose: {"facing":"reception"}, exit_pose: {"facing":"reception"} }),
    Object.freeze({ from: "team_tables", to: "sign_b", action: "walk_straight", entry_pose: {"facing":"reception"}, exit_pose: {"facing":"reception"} }),
    Object.freeze({ from: "sign_b", to: "kitchen", action: "left_then_straight", entry_pose: {"facing":"reception"}, exit_pose: {"facing":"menu boards"} }),
    Object.freeze({ from: "kitchen", to: "sign_b", action: "around_then_straight", entry_pose: {"facing":"menu boards"}, exit_pose: {"facing":"team tables"} }),
    Object.freeze({ from: "sign_b", to: "team_tables", action: "right_then_straight", entry_pose: {"facing":"team tables"}, exit_pose: {"facing":"pitch room"} }),
    Object.freeze({ from: "team_tables", to: "sign_a", action: "walk_straight", entry_pose: {"facing":"pitch room"}, exit_pose: {"facing":"pitch room"} }),
    Object.freeze({ from: "sign_a", to: "team_tables", action: "around_then_straight", entry_pose: {"facing":"pitch room"}, exit_pose: {"facing":"reception"} }),
    Object.freeze({ from: "team_tables", to: "sign_a", action: "around_then_straight", entry_pose: {"facing":"reception"}, exit_pose: {"facing":"pitch room"} }),
    Object.freeze({ from: "team_tables", to: "sign_b", action: "around_then_straight", entry_pose: {"facing":"pitch room"}, exit_pose: {"facing":"reception"} }),
    Object.freeze({ from: "sign_b", to: "team_tables", action: "around_then_straight", entry_pose: {"facing":"reception"}, exit_pose: {"facing":"pitch room"} }),
    Object.freeze({ from: "sign_b", to: "kitchen", action: "around_then_straight", entry_pose: {"facing":"team tables"}, exit_pose: {"facing":"menu boards"} }),
  ]),
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
