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
