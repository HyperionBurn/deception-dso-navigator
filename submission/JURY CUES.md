# Team Deception | Jury cues

**Clock:** 3:00 pitch · 3:00 robot video · 2:00 questions. Fill every `[ ]` from QA and the final video before the jury. Never claim a result the footage doesn't show.

## 100-word submission (draft)
Robot A's operator doesn't know where visitors want to go or speak their language. Our ElevenLabs agent does. A visitor asks in Arabic, English or Hindi/Urdu; the agent clarifies vague requests, then talks the MangoBot operator there in short English steps, waiting for "done" after each one. Routes come only from places we checked on video and walked; anything else gets "not mapped yet" and a handover to a person. When a second person changes the destination, the agent stops, asks where the robot stands and replans. It announces arrival in the visitor's language. [ ] of 3 routes filmed.

## 0:00–3:00 | Pitch (three slides)

| Clock | Slide | Say |
|---|---|---|
| 0:00–0:40 | **The gap** | "The robot can walk, but its operator doesn't know where you want to go, and may not speak your language. Our agent is the only one who knows the way." |
| 0:40–2:10 | **How it works** | "One multilingual agent listens and speaks Arabic, English and Hindi/Urdu. Visitor lines stay in their language; every operator line starts with 'Operator' and is in English. Routes come from a tool over a map built only from evidence: four landmarks from our floor video, each leg walked before filming [ ]. Places we have not checked get 'not mapped yet'. The agent gives one command, waits for 'done', counts where the robot is, and says stop. If anything is unclear, it holds and asks. A confident wrong turn is worse than a pause." |
| 2:10–3:00 | **Built for the room** | "Background music and crowds: Scribe realtime ASR and short turns. Network drops: the robot bridge and the website reconnect and hand the agent its memory. Results: [ ] of 3 routes reached the right endpoint; [ ] holds instead of guesses." |

## 3:00–6:00 | Robot video
1. **Easy** [ ]: request → clarification → English steps with "done" → stop → arrival in the visitor's language.
2. **Music** [ ]: organizer's track under the request; the agent still gets the destination.
3. **Change** [ ]: second person, organizer's destination → "Operator, stop" → both people told what's happening → asks where the robot is, then a new route or a clean handover if the new place is not mapped → arrival.

Playback gate: one take per route, ≥2 languages each, visitor, robot and operator in frame, total ≤3:00, cuts only between routes.

## 6:00–8:00 | Questions

| If asked | Answer |
|---|---|
| How does it know where the robot is? | "It starts from a known spot, counts every confirmed step, and re-checks with the operator, who names the landmark he sees, whenever anything changes. LiDAR/camera localization is the next step [ ] or what we tried." |
| What if it mishears? | "It asks again rather than guess; a destination or a turn is never taken from unclear speech." |
| What if the operator ends up somewhere unexpected? | "The operator's report wins. The agent re-anchors to the landmark they name and replans, or holds if that spot isn't mapped." |
| Does your code move the robot? | "No. MangoBot controls all motion; our bridge only carries the robot's audio." |
| Why not let the operator pick the way? | "The brief says they follow the agent exactly. So we only speak legs we checked; anything else is 'not mapped yet'." |
