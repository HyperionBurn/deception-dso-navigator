# Report for Wasif (night of 24-25 Nov, Devin)

**Missing secrets.** This session had no `ELEVENLABS_API_KEY`, `ROUTE_TOOL_KEY` or `VERCEL_TOKEN`. Not run: `tests/floor-drive.mjs`, `tests/live-voice-smoke.mjs`, the prompt push, the production route tool, the Vercel deploy. So the live agent and production are unchanged, and the live prompt was not touched (no backup needed). No merge tool and no `gh` here, and nobody pushes to `main`, so all five PRs wait for a human merge.

## What changed, with proof
| Item | PR | Proof |
|---|---|---|
| Planner T4 (facing hides the `likely_start` guess), T5 (facing-only request gets `needs_anchor`, not HTTP 400), Arabic T1/T3, Arabic "in front of my face ... far" stays a sighting (review fix) | [#19](https://github.com/HyperionBurn/deception-dso-navigator/pull/19) | `npm test` 111/111. T1-T3 English were merged by Hussain in #18 |
| Bridge: ROS service calls called `future.result(timeout=...)`, which rclpy does not have, so focus, volume, barge-in stop, LEDs and emoji all failed silently. Now the organisers' call pattern. Late reply from an earlier try no longer wakes the next try (review fix). Mic (raw + VAD) and playback paths tested end to end with fakes. Line-by-line diff: `robot/bridge/ORGANISER_BRIDGE_DIFF.md` | [#20](https://github.com/HyperionBurn/deception-dso-navigator/pull/20) | bridge tests 87 pass, 2 skipped; 6 new tests fail on the old code |
| One question, one photo and fill-in survey lines for meeting room, conference room, call booths 1-4 and the robot start: `qa/MISSING PLACES.md`. Map unchanged: `evidence/floor/` shows none of these places | [#21](https://github.com/HyperionBurn/deception-dso-navigator/pull/21) | `npm test` 105/105, `map:check` 0 rejected |
| `research_fact` answers 12 event questions (times, jury, prizes, robot, WiFi, who to ask, HADI) from the organiser guides, page cited, before the hosted researcher | [#22](https://github.com/HyperionBurn/deception-dso-navigator/pull/22) | `npm test` 109/109; tests prove no bundled voice-kit fact is taken over; 3 review findings fixed |
| Take scripts (easy, music, change), three slides, 100 words (exactly 100), jury cues with false claims removed (printed signs, "every leg walked", LEDs) | [#23](https://github.com/HyperionBurn/deception-dso-navigator/pull/23) | docs only; `npm test` 105/105 |

| Judge screen: `--judge-screen PORT` (off by default) serves a read-only page on 127.0.0.1 with the current operator step, the transcript and latency | [#25](https://github.com/HyperionBurn/deception-dso-navigator/pull/25) | bridge tests 75 pass, 2 skipped (3 new); not viewed against a live session |

Camera-confirmed arrival: not built. Latency numbers already exist: the bridge writes `latency-*.csv` and logs `LATENCY:` median/worst at the end of a take (untested on the robot).
Old branches `feat/agent-nav`, `feat/bridge-core`, `feat/bridge-raw-mic`, `feat/browser-session-id`, `feat/nav-core`, `feat/second-screen` belong to PRs #2-#7, which Hussain closed; their work was redone on `main`. Safe to delete; I did not.

## Still unproven
- Nothing ran on the robot, real ROS 2 or `aimdk_msgs`.
- Live drill and voice smoke after #19 and #22 (need the ElevenLabs key; the last live result is `evidence/live-runs/drill7.txt` 28/28, before tonight).
- #19 and #22 change the route tool and research API: after merging, redeploy (`npx vercel --prod --yes`) so production matches `main`, then run both live tests.
- Every leg in `qa/survey.txt` comes from video and has not been walked.

## Robot slot checklist
1. `git pull` on `main` after #20 is merged; copy `robot/bridge/` to `/home/agi` in the MangoBot container (never inside `aimdk*`).
2. Run the bridge exactly as `CONNECT_TO_ROBOT.md` says; one long-lived process.
3. Log shows `FOCUS: request -> focus_gain=True`. If `False` or unavailable, playback may be muted: tell MangoBot.
4. Say "hello" 1 m from the head; check the agent hears you (transcript line in the log) and the robot speaks.
5. Talk over the agent; check it stops speaking (barge-in).
6. Play music near the robot; check one request still gets the right destination.
7. Walk Take 1 with the operator; note any leg that does not match the floor and stop filming if one fails.
8. Copy the `latency-*.csv` and the log off the robot for the slides.

## Questions only a person on the floor can answer
1. Where does the robot start, and which way does it face? (photo from behind the robot)
2. Which room is the meeting room? Point at its door from the purple pillar. (photo)
3. Which room is the conference room? Is it the pitch room? (photo)
4. Where are call booths 1-4, and which number is which? (one photo showing all four)
5. Walk every leg in `qa/survey.txt` forward and back; does each one end at the named landmark?
6. Which destination will the organisers pick for the change take?

Exact survey lines to fill: `qa/MISSING PLACES.md` (after #21 is merged).

---

# Handoff for the next AI agent

Written 24 Nov 2026, about 23:00 Dubai time, by the agent that worked with Wasif all evening.
Everything below was checked in this repo or on the live services unless it says "not tested".

## 1. Read these first (10 minutes)

1. `CLAUDE.md` - the team's rules. They win over this file.
2. This file.
3. `qa/sim/SIM_REPORT.md` - Hussain's review of the agent prompt, with exact wording fixes that are **not applied yet** (section 7, P1).
4. `CONNECT_TO_ROBOT.md` - how a teammate at the venue runs our bridge on the robot.
5. `qa/FLOOR FROM VIDEO.md` and `qa/survey.txt` - what we know about the floor and where it comes from.
6. `docs/WIN_PLAN.md` - the approved plan ("Bottom line" and section 4.11).

## 2. The job in one paragraph

Hackathon "Voice of the Oasis", Dtec, Dubai Silicon Oasis, 24-25 Nov 2026. A MangoBot engineer (the operator) walks Robot A. He does not know where the visitor wants to go. Our ElevenLabs voice agent rides on the robot, talks to the visitor in their language (Arabic, English, Hindi/Urdu) and tells the operator in English, one step at a time, how to walk to a place on this floor. It confirms the arrival. Judged on a filmed demo of three routes (easy, loud music, destination change), a 3-minute pitch and questions.

## 3. Rules you must not break

- **No code that moves the robot.** The bridge carries audio only and refuses motion-related ROS names (`guard_ros_name`).
- **Never guess a route or a place.** Nothing about the floor is true until someone measured it. Mark anything else as provisional.
- English and Arabic in every route.
- **No secrets in the repo:** no API key, no access code, no robot address, no robot password. They live in Vercel env, `app/.env.local` and `app/.private/` (git-ignored). Never print them.
- **Changes reach `main` through a pull request.** Tonight several commits went straight to `main` on Wasif's instruction; that broke the rule. Default now: branch, PR, merge the PR. `gh` is logged in on Wasif's laptop.
- **Only one person pushes the release agent.** Hussain and Wasif's agent both edited `agent/system-prompt.txt` tonight. Ask Wasif who pushes before you run `push-agent.mjs`.
- Hussain merges PRs to `main` every few minutes. Always `git fetch` and merge before you commit or deploy.
- Write to Wasif in short, plain sentences. Lead with the result. Say what you did not test.

## 4. Where things stand

| Piece | State | How it was checked |
|---|---|---|
| Live agent (prompt, tools, voice) | Works. Short replies, yes/no start question, Arabic/English/Hindi. | `tests/floor-drive.mjs` 28/28 and `tests/live-voice-smoke.mjs` PASS, both against production, about 22:35 |
| Agent daily limit | Was 75 conversations a day and was hit at about 22:15 (every call was refused). Raised to 1000, concurrency 4, on both agents. | Greeting received again after the change |
| Website and route tool | Live. Deployed from the merge of 22:25. | Production API calls return the yellow pillar route |
| Website and route tool vs `main` | Production was redeployed from `main` at about 23:40, after PR #15. It includes the planner change from PR #12. | A production route call with "looking toward reception" returns a step |
| Unit tests | `npm test` in `app/`: 94 pass. `python -m pytest -q robot/bridge/test_bridge.py`: 74 pass. | Run at about 22:50 |
| Floor map | 4 stops, 11 legs, 2 of 8 destinations (team tables, kitchen). Video only, nobody walked it. | `npm run map:check` |
| Robot | A teammate ran our bridge on the robot tonight. Wasif: "it worked functionally" but the voice cut in and out. | Wasif's report; we have no log from that session |
| Robot voice fix | Found and fixed after that session: the bridge sent speaker audio at half speed. Also aligned microphone QoS and speaker message size with the organisers' bridge. **Not run on the robot yet.** | Timing probe on a laptop: 4.0 s of audio published in 3.7 s (was 8.6 s); unit tests |
| Camera | `--camera-markers` reads printed ArUco signs and sends "Camera: the robot is now at X" notes; the prompt has a "Camera notes" section. **The team has no printed signs, so it is unused.** | Unit tests with generated images only |

Six destinations are **not mapped**: the meeting room, the conference room and call booths 1 to 4. The agent says "not mapped yet" and offers the two mapped places.

## 4b. If you run in the cloud

You have the repo but not Wasif's laptop. Without secrets you can still run `npm test`, `npm run map:check`, the bridge tests, and read all the evidence. For anything live you need these, given to you as secrets (never commit them, never print them):

| Secret | Needed for |
|---|---|
| `ELEVENLABS_API_KEY` | `push-agent.mjs`, `tests/floor-drive.mjs`, `tests/live-voice-smoke.mjs`, changing agent or tool settings |
| The team access code, saved as `app/.private/team-access-code.txt` | `tests/live-voice-smoke.mjs`, the bridge in laptop mode |
| The route tool key, saved as `app/.private/route-tool-key.txt` | Calling the production route tool directly |
| Vercel login for Wasif's project (token, org id, project id) | `npx vercel --prod --yes` |
| The rehearsal agent id | Trying a prompt on the rehearsal agent before production |

Put `ELEVENLABS_API_KEY=...` in `app/.env.local` (git-ignored) and run the scripts with `node --env-file=.env.local`. The production agent id is the default in `app/scripts/push-agent.mjs`. If a secret is missing, do the work that needs none, and list exactly what you could not run.

## 5. Map of the repo

| Path | What it is |
|---|---|
| `agent/system-prompt.txt` | The live agent's prompt. `agent/destination-facts.txt` is background text. |
| `app/api/route.mjs` | The route tool the agent calls (`next_route_step`). `app/api/session.mjs` gives the browser and the bridge a signed session for the access code. `app/api/research.mjs` answers facts (`research_fact`). |
| `app/lib/route-planner.mjs` | The planner. Pure code, no guessing. `app/lib/route-contract.md` explains every request field and result. |
| `app/lib/floor-map.mjs` | The production map. **Generated** from `qa/survey.txt`; do not edit by hand. `rehearsal-map.mjs` is a made-up map for practice only. |
| `app/scripts/` | `ingest-survey.mjs` (survey to map), `check-map.mjs` (audit), `push-agent.mjs` (prompt to the live agent). |
| `app/tests/*.test.mjs` | Unit tests, run by `npm test`. |
| `app/tests/floor-drive.mjs` | Text drill against the **live** agent: six short conversations with PASS/FAIL per turn. |
| `app/tests/live-voice-smoke.mjs` | Voice test against the live agent: real speech in, real speech out. |
| `robot/bridge/navigator_bridge.py` | The robot audio bridge (also runs on a laptop with `--io laptop`). `test_bridge.py` holds its tests. |
| `CONNECT_TO_ROBOT.md` | Venue runbook for the bridge. `ROBOT_TEST_HANDOFF_FOR_AI_AGENT.md` is the longer, older version. |
| `qa/` | Survey, floor evidence, test cases, Hussain's simulation report (`qa/sim/`). |
| `submission/` | Jury cues and the judge packet draft, with blanks to fill after filming. |
| `evidence/` | Copied from Wasif's laptop: video frames of the floor (`evidence/floor/hires_dtec/` is 1920 px, two per second, frame N is at N/2 seconds), transcripts, OCR results, and the last live test outputs. Start with `evidence/README.md`. |
| `docs/organisers/`, `robot/reference/` | The organisers' documents, their robot bridge, and the text of the AgiBot X2 developer pages. |

## 6. How to do the common jobs (run from `app/` unless it says otherwise)

**Change the floor map**
1. Edit `qa/survey.txt` (format: `qa/SURVEY FORMAT.md`). Each direction of travel is its own `leg` line.
2. `npm run map:ingest ../qa/survey.txt` writes `lib/floor-map.mjs` and prints every route as English commands.
3. `npm run map:check` (exit 0; warnings for unmapped destinations are expected) and `npm test`.
4. Deploy (below). The route tool reads the map on the server, so a map change needs a deploy.

**Change the agent's prompt**
1. Edit `agent/system-prompt.txt`. Keep it short; the live model is small (deepseek flash) and copies examples literally.
2. `node --env-file=.env.local scripts/push-agent.mjs --dry-run`, then without `--dry-run`. It pushes the prompt and the greeting to the production agent.
3. The rehearsal agent: same command with `ELEVENLABS_AGENT_ID` set to `rehearsal_agent_id` from `.private/rehearsal-ids.json`.
4. Run the text drill and the voice test (below). Read the transcript, not only PASS/FAIL.

The route tool's description lives only on ElevenLabs. To change it: GET `/v1/convai/tools/{id}`, change only `tool_config.description`, PATCH, GET again and compare. Backups of earlier versions are in `.private/route-tool-before-*.json`.

**Deploy the website and route tool**
`npx vercel --prod --yes`. It normally takes under a minute. If it sits in "Building" for more than three minutes, stop it and run it again. Then call the production route tool once to check (the key is in `.private/route-tool-key.txt`; never print it).

**Checks**
- `npm test` - about 15 seconds.
- `python -m pytest -q robot/bridge/test_bridge.py` (from the repo root) - 2 seconds.
- `node --env-file=.env.local tests/floor-drive.mjs` - about 9 minutes, six live conversations. Always give it a hard time limit and save the output to a file.
- `node --env-file=.env.local tests/live-voice-smoke.mjs` - about 2 minutes.
- Every live conversation counts toward the agent's daily limit.

**Hear the bridge without the robot**
In `robot/bridge`: `python navigator_bridge.py --io laptop --code <access code>`. It uses the laptop's microphone and speaker and the same playback code as the robot. Ask Wasif for the code.

## 7. What we know about the floor

All of it comes from one phone video with narration (`IMG_3440.MOV`, 18:47 on 24 Nov). Nobody has walked it with the agent.

- A striped walkway runs from the **pitch room door** (black wall, steel bin) to the reception hall.
- Facing reception from that door: the **team tables** are on the right, at **the purple pillar** (dark purple, lime-green speech bubble, a whiteboard). Further on, also on the right, is **the yellow pillar** (bright yellow, glass board).
- The **cafeteria** (the organisers' "kitchen with tables and food") opens on the left, opposite the yellow pillar. Its **menu boards** are the arrival landmark.
- Route in the map: pitch room door, straight to the purple pillar, straight to the yellow pillar, turn left, cafeteria menu boards. The return legs come from the view filmed inside the cafeteria at 1:02-1:06.
- **A mistake already found:** an earlier pass called the yellow pillar "peach". Full-size frames (0:37-0:38, 1:02-1:06) show yellow. An orange pillar stands further on behind a blue one and is not the junction. Expect more such errors until someone walks it.
- Other places the agent may describe but never walks to: toilets, printer and lockers, reception, stairs, pitch room (see the prompt's "Other places").

**Not known:** where the meeting room, the conference room and the four call booths are; where the robot starts and which way it faces (the map assumes the pitch room door, facing reception).

What was searched for the missing places:
- The narrator never says meeting, conference, booth, call or phone.
- OCR of every frame of all three videos (two frames per second) found no sign with those words. The organisers' PDFs contain no floor plan. It did read "PRINTER SCANNER LOCKERS", "Write Something", "TOILET" and two tenant plaques.
- Guesses that are **not** in the map: the pitch room (rows of chairs, screens) could be the "conference room"; the glass room with sofas at its far end could be the "meeting room"; the organisers' example "past the kitchen and stop at the second booth" suggests the booths are further along the walkway than the cafeteria. None of this is evidence.

## 8. Open work, most important first

**P1. Apply the prompt fixes in `qa/sim/SIM_REPORT.md`** (problems 1 to 8, each with CURRENT and NEW wording). The worst ones: "stopped" is read as "arrived"; two noise rules contradict each other; the destination-change rules fight; the agent may put a whole sentence into `current_landmark`; a tool error is told to the visitor as "not mapped"; only the first two landmarks are offered. After editing: push the prompt (see section 3 on who pushes), run the text drill and the voice test, read the transcripts.

**P2. Map the six missing places.** Only from evidence: a teammate's description, a photo, a new video, or the organisers. For each place you need the stop's landmark, what it faces, and the legs to and from a stop already in the map. If Wasif asks you to "map from what you know", say plainly that there is no evidence for the booths, and offer the guesses in section 7 as provisional entries that must be confirmed on the floor before filming. A confident wrong route loses more than "not mapped yet".

**P3. Keep production equal to `main`.** Any merged change to `app/` needs a deploy from Wasif's Vercel project; check the route tool afterwards.

**P4. Robot slot (Wednesday 25 Nov).** Team Guide v2 gives our round 2 as 07:30, code freeze and submission at 08:30, and our pitch at 09:41; the Update says slots were reshuffled, so Wasif must confirm the times. In this order: copy the new `navigator_bridge.py` to the robot (the copy there has the half-speed voice bug); check the voice is smooth; walk both mapped routes there and back and note every wrong turn or landmark; rehearse the three film takes; restore the robot and copy the logs (`CONNECT_TO_ROBOT.md` step 9). Ask for the newest file in `~/deception/logs/` if anything sounds wrong.

**P5. Planner problems T1 to T5 in the same report.** T1 (a whole sentence resolves to the wrong place) and T3 ("the cafeteria is on my left" counts as being there) are the risky ones. Any planner change needs a test and a deploy.

**P6. Film and submit.** Three continuous takes, at most 3:00 in total, an organiser present. Then fill `submission/JURY CUES.md` and the judge packet (100 words, up to three slides, project link). Confirm the deadline and pitch time with the organisers.

## 9. Decisions waiting for Wasif (and Hussain)

1. Pull requests or direct pushes to `main`?
2. Who pushes the live agent?
3. Camera without printed signs: recognising the pillars and menu boards needs a cloud vision model. The Vercel AI Gateway answers from this project (`google/gemini-2.5-flash` returned 200 with the project's OIDC token), and the agent already understands "Camera:" notes. Against it: `docs/WIN_PLAN.md` lists cloud vision under "do not build", it sends pictures of bystanders to a third party, and it cannot be tested before the robot slot. Not built.

## 10. Traps I hit, so you do not

- **Agent daily limit.** If every conversation closes at once with code 4300, the agent's `platform_settings.call_limits.daily_limit` is used up.
- **Live tests can hang.** Always set a time limit. One hung test cost 45 minutes tonight.
- **This shell (Git Bash on Windows):** a heredoc longer than about 9,000 characters gets cut off; write long files in pieces. A double backslash inside a heredoc arrives as a single one. `rg` is not installed. Use `py -3.11` for packages that fail on the default Python (pycolmap, rapidocr).
- **Subagents cannot see images.** Look at frames yourself, or run OCR (`evidence/floor/ocr/ocr_run.py`).
- **Low-resolution frames lie about colour.** The peach/yellow mistake came from 960 px frames. Use `evidence/floor/hires_dtec/`.
- **The bridge had three faults nobody saw until the robot:** half-speed playback, and two microphone QoS settings that differed from the organisers' bridge (`robot/reference/organisers_elevenlabs_robot_bridge.py` is a copy of theirs). Compare against their file line by line before trusting ours.
- **Do not claim "matches" or "works" without running it.** Say "not tested on the robot" when that is the truth.
