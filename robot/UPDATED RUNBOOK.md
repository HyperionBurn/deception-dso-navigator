# Robot A | Updated slot runbook

**Operative brief:** Team Guide Update, 24 November 2026, pp. 1–3 and 6. The old PDF is retained for history. Its stationary demo, one-take package and schedule are superseded. **NOT READY:** No floor or hardware evidence has been recorded here.

## Before the slot

1. Confirm the final team, robot slot, submission deadline and pitch order with Adam, Seruga or registration. Old Deception references only (Dubai time): Nov 24, 18:00 test; Nov 25, 07:30 film, 08:30 submission, 09:34 pitch. Do not rely on them.
2. Assign a route lead, visitor(s), camera lead and observer/timekeeper. Confirm the MangoBot operator. Tell the operator to follow the agent's words and report observed cue and facing after each command. The operator does not select any path. Fix framing and consent before recording.
3. Complete the [survey](../qa/physical-walk.md) and [blind walk](../qa/cases.md). Check initial and switch states, distinct endpoint cues and assessed coverage for reachable destinations. Freeze the candidate and course revisions after rehearsal. If actual start or facing differs, use an independently checked start or hold. Do not film a guessed route.
4. Before filming, find an organizer to supply and play the music and disclose the replacement destination during its take. Agree on how the second person enters, without staging the replacement destination in advance.

## In the slot | MangoBot leads hardware

- MangoBot controls all movement and may stop for safety. Use the approved audio path only. Do not send motion commands from code. Stay on this floor. Confirm the assigned PC2 container and approved team folder under `/home/agi`, outside `aimdk*`, with MangoBot. Use only approved credentials and existing components. No PC1, motion topics, OS, driver, DDS, algorithm, firmware, power or hardware changes, or factory resets. Keep a laptop backup. Start at most two ROS nodes per second.
- Before walking, ask MangoBot to confirm the active mic, wake word if applicable, speaker focus and the approved bridge. Confirm both audio directions use `pcm_16000` if using the organizer bridge. Hear two intelligible exchanges covering the visitor language and English operator directions. Check clean reset, no echo or stale audio, and the ability to hear a change while a route is in progress. If MangoBot chooses half duplex, wait until playback finishes to speak and test the planned change at a listening window. Do not claim barge-in unless tested.
- Stop the take on unexpected motion, disconnect, stale playback or lost position. Let MangoBot handle hardware and session recovery. Resume only after a clean reset, credible audio and a fresh confirmed pose. Restart the full take after any interruption that would require an internal cut. Keep credentials and raw transcripts out of shared artifacts.

## Record and verify

| Take | Cue for the crew | Required finish |
|---|---|---|
| 1 · Easy | Use a short surveyed route. Start on the visitor request. Show a clarification if needed. | English one-command steps with acknowledgments, stop, stationary confirmation, exact endpoint proof and arrival in the visitor's language. |
| 2 · Background music | Organizer supplies and plays the track during the visitor request. Keep the music as supplied. | The request is understood in noise and the robot reaches the correct endpoint with verified stop and arrival. |
| 3 · Destination change | A second person requests the organizer's new destination halfway through. Keep the whole exchange in the take. | Stop, confirm stationary and current cue/facing, cancel the old route, explain the change to both people, reroute from the observed pose, verify final stop and announce arrival. |

Start a fresh session per take. Use at least two languages per route, ideally Arabic and English, with the agent translating between the visitor and operator. Keep the visitor, robot and operator in the shot, including the second visitor during the change. Capture commands and responses clearly. Use one continuous take per route. Keep the three takes and any joins together at or under 3:00. Target about 45 seconds easy, 50 seconds music and 75 seconds change, leaving 10 seconds of margin. These are editing budgets, not measured route times. Choose or shorten only through surveyed paths. Never rush steps, acknowledgments or safety to make time.

Play back each take with sound before leaving the slot if possible. Check the assembled file again. Cut only between the routes. Log take IDs, durations, actual endpoints and any failure in [QA](../qa/README.md). If a required take or survey evidence is missing, mark **NOT READY** and notify the organizer. A laptop rehearsal does not qualify as the robot video. Jury: 3 minutes pitch, 3 minutes robot video, 2 minutes questions.
