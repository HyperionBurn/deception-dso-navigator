# Team Deception | Jury cues

**Clock:** 3:00 pitch · 3:00 robot video · 2:00 questions. Fill every `[ ]` from QA and the final video before the jury. Never claim a result the footage doesn't show.

## 100-word submission (draft)
Robot A's operator doesn't know where visitors want to go or speak their language. Our ElevenLabs agent does. A visitor asks in Arabic, English or Hindi/Urdu; the agent clarifies vague requests ("a quiet place to call?" → call booth), translates the intent, and talks the MangoBot operator there in short English commands, one surveyed leg at a time. It tracks position from the operator's reports and our own floor signs, stops instantly when a second person changes the destination, replans from where the robot stands, and only announces arrival, in the visitor's language, after the operator confirms the endpoint. [ ] routes filmed.

## 0:00–3:00 | Pitch (three slides)

| Clock | Slide | Say |
|---|---|---|
| 0:00–0:40 | **The gap** | "The robot can walk, but its operator doesn't know where you want to go, and may not speak your language. Our agent is the only one who knows the way." |
| 0:40–2:10 | **How it works** | "One multilingual agent listens and speaks Arabic, English and Hindi/Urdu. Visitor lines stay in their language; every operator line starts with 'Operator' and is in English. Routes come from a tool over a map we surveyed ourselves: our own letter signs at decision points, every leg walked in each direction. The agent gives one command, waits for 'done', counts where the robot is, and says stop. If anything is unclear, it holds and asks. A confident wrong turn is worse than a pause." |
| 2:10–3:00 | **Built for the room** | "Background music and crowds: Scribe realtime ASR and short turns. Network drops: the robot bridge and the website reconnect and hand the agent its memory. The robot shows it's listening with its LEDs and face [ ] if shown. Results: [ ] of 3 routes reached the right endpoint; [ ] holds instead of guesses." |

## 3:00–6:00 | Robot video
1. **Easy** [ ]: request → clarification → English steps with "done" → stop → arrival in the visitor's language.
2. **Music** [ ]: organizer's track under the request; the agent still gets the destination.
3. **Change** [ ]: second person, organizer's destination → "Operator, stop" → both people told what's happening → new route from the current sign → arrival.

Playback gate: one take per route, ≥2 languages each, visitor, robot and operator in frame, total ≤3:00, cuts only between routes.

## 6:00–8:00 | Questions

| If asked | Answer |
|---|---|
| How does it know where the robot is? | "It starts from a known sign, counts every confirmed step, and re-checks with the operator, who reads our signs, whenever anything changes. LiDAR/camera localization is the next step [ ] or what we tried." |
| What if it mishears? | "It asks again rather than guess; a destination or a turn is never taken from unclear speech." |
| What if the operator ends up somewhere unexpected? | "The operator's report wins. The agent re-anchors to the sign they read and replans, or holds if that spot isn't mapped." |
| Does your code move the robot? | "No. MangoBot controls all motion; our bridge only touches the robot's audio, lights and screen." |
| Why not let the operator pick the way? | "The brief says they follow the agent exactly. So we only speak legs we walked ourselves." |
