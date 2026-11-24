# Evidence copied from Wasif's laptop (24 Nov 2026)

Everything here is raw material. None of it is a verified fact about the floor until someone walks it.

## `floor/` - the teammate's walk-through videos

Three phone videos with spoken narration, recorded 18:47-18:54 on 24 Nov:
- `3440` (3:56) - the Dtec event floor from 0:00 to 2:13, then the food court and outside.
- `3441` (0:22) - the building lobby. `3442` (1:20) - the block A corridor. Both are outside the event floor.

| Path | What it is |
|---|---|
| `hires_dtec/3440_hNNNN.jpg` | The event-floor part of 3440 at full size (1920x1080), two frames per second. **Frame N is at N/2 seconds.** Use these for colours and small text. |
| `frames_960/` | All three videos, one frame every 2 seconds, 960 px wide. The file name carries the clip and the time in seconds. |
| `sheets/` | Contact sheets of the same frames (12 per sheet) for a quick overview. |
| `picks/` | Four sheets made while checking the junction pillar: `vision_pick3.jpg` (0:36-0:39) and `vision_pick4.jpg` (1:00-1:06) show that it is yellow. |
| `transcript_3440.txt`, `_3441`, `_3442` | The narration with time stamps. |
| `ocr/ocr_*.tsv` | Text read from every full-size frame of all three videos (frame, seconds, confidence, box, text). `ocr_run.py` is the script (RapidOCR). No frame contains the words meeting, conference, booth, call or phone. |
| `turns_*.txt`, `yaw_*.png`, `path_*.png`, `colmap_summary.txt` | Camera-motion estimates. COLMAP could not rebuild one floor plan (the main video broke into nine pieces). Trust them only for the left turn into the cafeteria at 0:38-0:41. |

The videos themselves and the rest of the full-size frames are too big for git. If they were uploaded, they are attached to the GitHub release `floor-evidence-2026-11-24`.

## `live-runs/`

The last text drill (`drill7.txt`, 28 of 28) and voice test (`smoke5.txt`, pass) against the live agent, with identifiers removed. They show how the agent actually talks.

## Elsewhere in the repo

- `docs/organisers/` - the organisers' Team Guide Update, slides and kickoff deck (PDF), and the text of the Update and of Team Guide v2 (robot addresses removed). None of them contains a floor plan.
- `robot/reference/organisers_elevenlabs_robot_bridge.py` - the organisers' own robot bridge, the one other teams run. Our bridge must behave like it.
- `robot/reference/agibot-*.txt` - text of the AgiBot X2 developer pages (Python examples, sensors, vision, SLAM, navigation, sensor field of view), addresses removed.
