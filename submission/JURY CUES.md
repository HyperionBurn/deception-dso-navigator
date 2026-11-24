# Team Deception | Jury cues

**Clock:** 3:00 pitch · 3:00 demo · 2:00 questions. **Current evidence:** Offline practice and local route logic only. The checked-in floor map is empty. QA records no floor survey, blind walk, Robot A audio check, takes, or final playback. Live voice is unverified.

## 0:00–3:00 | Pitch (up to three slides)

| Clock | Say and show |
|---|---|
| 0:00–0:45 | **Problem.** “At Dtec, a visitor may know where they want to go but may not be able to tell the operator in English. Our AI Voice Navigator lets the visitor ask in Arabic or English.” |
| 0:45–2:00 | **How it works.** “The agent clarifies the destination and asks where the robot is and which way it faces. The route tool can return one checked step at a time. The MangoBot operator controls all motion and reports what they see after each step. The agent announces arrival in the visitor’s language only after the operator confirms the stop and the endpoint.” Show: request → checked step → acknowledgment → stop → arrival. |
| 2:00–3:00 | **What we can show.** “The offline practice shows the interaction. We have no verified floor route or Robot A run to report yet.” If evidence becomes available, state the observed result and its scope instead. “In a supervised trial, we’d record correct arrivals, holds on uncertain cues, and requests that needed clarification.” Hand off to playback. |

## 3:00–6:00 | Demo

**If the film passes review:** Play the assembled Robot A video. Let the audience hear the visitor, agent, and operator. Read these cues to yourself during playback:

1. **Easy:** Hear the visitor’s request and the agent’s English step. Look for an acknowledgment after each step, then the stop, endpoint confirmation, and arrival in the visitor’s language.
2. **Music:** The organizer supplies and plays the track. Listen for how the agent handles the request over the music. Look for the confirmed stop and endpoint.
3. **Change:** A second person gives the organizer-selected destination halfway through. Listen for the stop, fresh cue and facing, cancellation of old instructions, explanation to both people, and new route from the observed position. Look for the final stop and endpoint confirmation.

**Playback gate:** Watch the final export with sound. Check that each route is one continuous take with at least two languages. Check that the visitor, robot, and operator stay in frame, including the second visitor during the change. Check that cuts occur only between routes and the total runtime is ≤3:00. Check the three outcomes against the footage and QA before calling the video ready.

**If the film is missing or unchecked:** Tell the organizer. If permitted, say “We don’t have a verified Robot A video. This is offline practice.” Show the simulated destination change. Point out the stop and the request for a fictional marker. Do not count this as the required robot demo.

## 6:00–8:00 | Questions

| If asked | Answer |
|---|---|
| What did you verify? | “Local checks cover route logic. We have no recorded floor survey, blind walk, Robot A audio check, or reviewed film.” If the QA record changes, cite the specific test or take. |
| What if the position or route is unknown? | “Ask the operator to stop if moving or hold if stationary. Ask for one observable cue. Give a direction only when the checked map supports it.” |
| How do you avoid following the old route after a change? | “Stop and wait for the operator to confirm the robot is stationary. Drop pending steps. Confirm the current cue and facing, then ask for a checked step to the new destination. Hold if none is available.” |
| Does it drive or locate the robot by itself? | “MangoBot controls motion. The navigator uses the operator’s observations for position and facing.” |

Basis: [24 November guide requirements in the PRD](../AI%20Voice%20Navigator%20-%20PRD.md) · [Robot A runbook](../robot/UPDATED%20RUNBOOK.md) · [QA evidence](../qa/browser-scorecard.json).
