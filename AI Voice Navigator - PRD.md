# AI Voice Navigator | Updated PRD

**Voice of the Oasis · Dtec, Dubai Silicon Oasis · 24 November 2026**
**Status: NOT READY.** No physical start, heading, landmark, directed step, endpoint or route has been verified. Prior kiosk tests do not qualify this challenge. The final team list, robot slots, submission deadline and pitch order are pending.

The Team Guide Update (24 November, pp. 1–3 and 6) replaces the original AI Voice Navigator brief and demo timing. The original general agent and robot rules, judging criteria and prizes still apply.

## Product

A visitor asks for a place on the event floor in their language. The agent clarifies vague requests, translates the confirmed intent and guides the MangoBot operator in English. The operator does not know the visitor's intent or choose the route. MangoBot controls all motion. The agent calls the stop and tells the visitor in their language once the stop and endpoint are confirmed.

The course covers a meeting room, conference room, four call booths, team tables and a kitchen with tables and food. These are guide categories, with no verified positions, labels or access. Aim to cover every reachable destination, distinguish the four booths, and record any exclusion with a reason. Stay on this floor. No organizer markers are provided.

## Direction and position contract

- Open with a brief AI disclosure. Clarify one ambiguity at a time. Use the visitor's language for intent, changes and arrival. Use English for operator directions and acknowledgments. Use at least two languages per film route, preferably Arabic and English. A third language is optional.
- Before movement, confirm the exact starting cue and facing direction. Select a path only through surveyed directed steps. A position includes both location and orientation. Distinguish approaching the same cue from different directions. Never derive a reverse step by flipping left and right.
- Say one short English command per turn. For a turn, name the facing reference. For a walk, name the checked limit. Wait for the operator to confirm the observed cue and facing before advancing. Issue an explicit stop at arrival, on a destination change or when position is uncertain. Wait for confirmation that the robot is stationary and verify the endpoint cue before announcing arrival.
- When a second person changes the destination, invalidate the old instructions. Ask the operator or a nearby observer what they see and which way the robot faces. Resolve the location from those observations, then select checked directed steps to the new destination. Tell both people what changed in their respective languages. If the robot is between known states, proceed only after a surveyed recovery is available; otherwise hold. The organizer supplies the actual replacement destination during recording.
- If a cue, heading, path or access is unknown, say “Stop” if moving, or “Hold position” if stationary. Ask for one useful observation. Do not guess or ask the operator to select a direction. Use a fresh session for each take. Camera and LiDAR confirmation, automatic localization and a visitor changing language are stretch work.

## Evidence gates

| Gate | Required evidence |
|---|---|
| Course survey | On-site walk with distinctive observed cues, position and facing states, directed steps, access observations and exact endpoint proof. Survey likely switch points and paths from them to reachable destinations. Use the [capture sheet](qa/physical-walk.md). |
| Blind rehearsal | A teammate walks from the checked start and follows the agent word for word without choosing the way. An observer logs each command, acknowledgment, observed state, stop and arrival. Cover easy, music practice and a change chosen during the run. The latter must start its new path from the observed position. |
| Robot filming | MangoBot walks Robot A. Film three routes: team choice, organizer music and organizer-selected change. Use one continuous take per route. Keep the visitor, robot and operator in shot. Join only between routes. Total video ≤3:00. |
| Jury and submission | 3 minutes pitch, 3 minutes robot video, 2 minutes questions. Submit project link, 100 words, video and up to three slides by the confirmed deadline. Late submissions are not judged. |

Use synthetic cases for logic only. A passing voice check does not prove a route. No on-site navigation readiness claim until the survey and blind walks pass for the candidate that will film. A route revision, changed course or unknown start requires a recheck. No filmed or submission readiness claim before checking all three takes and the final video. If evidence is missing late in the event, report **NOT READY** and specify what is missing.

## Work order and schedule

Survey now. Turn checked observations into route data for the agent lane, then walk the scripts. Hand the approved revision and known limits to the robot and film leads. Follow the [updated runbook](robot/UPDATED%20RUNBOOK.md) and [judge packet](submission/Deception%20-%20Judge%20Packet%20Draft.md).

Old Deception times are provisional references only (Dubai, UTC+4): November 24 at 18:00 test; November 25 at 07:30 film, 08:30 submission, and 09:34 pitch. Confirm team assignment, slot, deadline and pitch order with the organizers' next update before relying on any time.
