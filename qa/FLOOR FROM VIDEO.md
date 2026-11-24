# Floor from video

What three narrated phone videos of Dtec (24 Nov 2026, 18:47-18:54) show,
what they do not show, and what still has to be walked. **Nothing here is in
the production map.** The video is evidence for a draft, not a checked route.

Sources: `IMG_3440.MOV` (3:56), `IMG_3441.MOV` (0:22), `IMG_3442.MOV` (1:20).
Working files are in `.cache/floor/` (not in git): 169 frames at one per
2 s, 679 frames at 2 per second, contact sheets, narration transcripts with
timestamps, and a turn timeline per clip from frame-to-frame motion.

## Result in one paragraph

The videos are a narrated **tour** of the whole ground floor, not a route
survey. They give a reliable picture of the Dtec space: one striped walkway
with the pitch room at one end, the reception hall at the other, the team
tables on one side and the cafeteria on the other. They do **not** show any
call booth, and the narrator never names a "meeting room" or a "conference
room". No signs were taped, no start spot was set, and no turn was said out
loud. About 60% of the footage is outside the Dtec space, which the brief
puts out of scope.

## What is where (Dtec space, IMG_3440 0:00-2:13)

Directions below are for someone standing at the pitch room door, on the
striped walkway, looking down it toward the reception hall.

| Place | What it looks like | Evidence (3440) | Likely challenge name |
|---|---|---|---|
| Pitch room | Wooden floor, rows of black and white chairs, a wall of TV screens, long white counter with a coloured edge strip, red wire chairs, black sofas along a glass wall at the far end. A small white robot stands under the screens. | 0:00-0:14; narration 0:51 "We were in the pitch room for the orientation" | Conference room? **Unconfirmed** |
| Room behind the glass wall | Dim room behind the glass, next to the black sofas. Not entered. | 0:00-0:03 | Meeting room? **Unknown** |
| Pitch room door | Black wall with a steel bin; blue pillar just beyond; the striped walkway starts here. | 0:14-0:17 | Proposed start, sign A |
| Striped walkway | White floor with dark stripes, runs straight to the reception hall. | 0:16-0:19, 0:28, 0:38, 2:04 | Spine of every route |
| Team tables | Right of the walkway. Grey carpet with coloured squares, white desks, purple pillar with a green speech bubble at the near corner, yellow pillar further on. A black "X2" robot case stands by the pitch room's glass wall. | 0:20-0:27, 0:33-0:37, 1:02-1:06 | Team tables |
| Black lattice screen | Left of the walkway, after the blue pillar. A counter with "PIZZA" letters is behind it. | 0:28-0:32 | Passed on the way |
| Yellow pillar | Right of the walkway, bright yellow with a glass board. The cafeteria opens on the left directly opposite. (An earlier pass at low resolution called it peach; the full-size frames at 0:37-0:38 and 1:02-1:06 show it is yellow. An orange pillar stands further on, behind a blue one, and is not the junction.) | 0:37-0:38, 1:02-1:06 | Junction, sign B |
| Cafeteria | Left of the walkway, after the lattice screen, behind dark blue planter boxes. Round white tables, wooden chairs, tall striped bar tables, menu boards, a red-framed TV over a pink cabinet, a glass display case, a green plant wall in the far corner. | 0:38-1:10; narration 0:39 "Now we're entering the cafeteria" | Kitchen with tables and food |
| Printer nook | Behind the green plant wall: corridor with coloured carpet squares, grey lockers, chalk sign "PRINTER SCANNER LOCKERS", green-walled nook with a printer that opens back onto the walkway and team tables. | 1:10-1:20; narration 1:14 | Not a destination |
| Private offices | Frosted glass doors with purple Dtec plaques (one reads "Mappers Technical Services - FZCO"). | 1:22-1:37; narration 1:25 "small private rooms" | Tenant offices, **not call booths** |
| Main staircase | Spiral stairs wrapped in plant columns, Palm mosaic on the wall. Goes to the first floor. | 1:38-1:45; narration 1:40 | Out of scope (leaves the floor) |
| Toilets | Dark-tiled side corridor beside the "Dtec Write Something..." whiteboard wall. Male and female signs. | 1:46-1:59; narration 1:53 | Not a destination |
| Reception hall | Reception desk with red, blue, white and green stripes, plant columns, stanchions, turnstiles to the building. The striped walkway meets the hall beside a wooden double door on a purple wall. | 2:01-2:13; narration 2:07, 2:13 "Now leaving the Dtec space" | Edge of the course |

## Outside the Dtec space (not for the robot)

- 3440 2:13-3:54: lunch area with food outlets, a second entrance, a side
  corridor, and the outdoor courtyard.
- 3441: garden exit, the way to block A, the main entrance with revolving
  doors, reception and security.
- 3442: block A hallway: lifts, staircase, offices, lockers, toilets, a
  green vending machine, blue lounge seats.

The Team Guide Update keeps the robot on "this floor of Dtec" among the
listed places. None of them is in this footage after 2:13, so these areas
stay out of the map.

## Draft legs the video supports

Written in `qa/survey.video-draft.txt`. It parses (`map:ingest --dry-run`)
and prints these routes from the proposed start:

1. Team tables: walk straight, stop at the purple pillar with the green
   speech bubble.
2. Kitchen: on to the yellow pillar, turn left, stop at the cafeteria menu
   boards.

Confidence: the side each place is on (team tables right, cafeteria left) is
clear in several frames. Stop points and the return legs are guesses until
walked.

## Camera path (COLMAP)

Structure-from-motion on the 2-per-second frames (pycolmap 4.2.1, SIFT,
sequential matching) did **not** produce one floor path. IMG_3440 came out
as nine separate fragments covering 282 of 473 frames, each in its own
coordinate frame and scale, so they cannot be laid over each other as a
plan. The stretch from the pitch room door along the walkway (0:10-0:28)
has no pose at all. The other two clips split into three and four fragments.
Fast pans, glass and plain white walls are the cause.

What it does settle: the turn into the cafeteria at 0:38-0:41 is a left turn
of about 90 degrees. Two fragments measure it independently (88 and 113
degrees), and the frame-motion timeline agrees on the direction. That is the
only turn the draft legs rely on.

Plots and tables: `.cache/floor/path_<clip>.png`, `colmap_summary.txt`.

## What is missing

| Missing | Why it matters | How to close it |
|---|---|---|
| Four call booths | Four of the eight destinations. Not in any frame. | Ask Adam or Seruga where they are, then film or photograph each one with its door. |
| Meeting room and conference room | The narrator says "pitch room" only. We do not know which rooms the organisers mean. | Ask the organisers to point at both. |
| Start spot and facing | Every route starts there. The robot and its case are at the pitch room end, so the draft assumes the pitch room door. | Confirm with MangoBot where the robot starts for filming. |
| Signs | The operator needs something exact to read back. A pillar colour works, a taped letter is safer. | Tape `robot/markers/markers.pdf` at the start, the yellow pillar, and each destination. |
| Turns and return legs | The narration names places, never "left" or "right", and no route was walked back. | One walk per leg in each direction, saying the turn out loud. |

## Verification walk (about 15 minutes)

1. Stand at the pitch room door facing down the striped walkway. Tape sign A.
2. Read each draft route aloud while a teammate follows it word for word.
   Mark each instruction right or wrong.
3. Walk each leg back and note the turn.
4. Find the call booths, the meeting room and the conference room. For each:
   which sign you pass last, which way you turn, what you see at the door.
5. Send the notes. They go into `qa/survey.txt`, then `npm run map:ingest`
   and a deploy.
