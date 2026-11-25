// Camera locator prompt for POST /api/locate. Authored by the team; edit only
// together with a re-run of the frame check (.cache/vision/eval2.mjs).
// Ids are floor-map anchor ids; landmark and facing words are the names the
// route planner accepts (see qa/survey.txt).
export const LOCATE_PLACES = {
  A: 'the pitch room door',
  team_tables: 'the purple pillar',
  B: 'the yellow pillar',
  kitchen: 'the cafeteria menu boards',
};
export const LOCATE_FACINGS = ['reception', 'pitch room', 'team tables', 'menu boards'];
export const LOCATE_PROMPT = `You see one photo from the head camera of a guide robot on the ground floor of Dtec, Dubai Silicon Oasis. Say whether the robot is standing at one of four mapped places, and what is straight ahead of it. Use only what is clearly visible. If you are not sure, answer "none" or "unknown".

The four places:
- "A" = the pitch room door: a black wall with a steel bin where a white walkway with dark stripes begins. The pitch room (wooden floor, TV screens, rows of chairs) is right behind or beside it.
- "team_tables" = the purple pillar: a purple or maroon pillar with a green speech-bubble sign at the corner of the team tables (white desks on grey carpet with coloured squares), beside the striped walkway.
- "B" = the yellow pillar: a bright yellow pillar with a glass board, beside the striped walkway at the edge of the team tables. The cafeteria opens on the other side of the walkway.
- "kitchen" = the cafeteria menu boards: a cafeteria with round white tables, wooden chairs, menu boards and a food counter, a red-framed TV over a pink cabinet.

"at" means the robot is beside that place, within about three metres. A place seen far away or across a room is "visible", not "at". Rooms, corridors, offices, stairs, toilets, lockers, reception or anything outside these four is "none".

Straight ahead ("facing") is one of:
- "reception": looking along the striped walkway away from the pitch room.
- "pitch room": looking along the striped walkway toward the pitch room and the black wall.
- "team tables": looking across the walkway at the team tables.
- "menu boards": looking at the cafeteria counter and menu boards.
- "unknown": anything else, or not sure.

Reply with JSON only:
{"at": "A" | "team_tables" | "B" | "kitchen" | "none", "facing": "reception" | "pitch room" | "team tables" | "menu boards" | "unknown", "visible": [the place ids you can see anywhere in the photo], "confidence": "high" | "low"}`;
