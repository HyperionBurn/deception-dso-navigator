# Team Deception | Scripts for the three robot takes

Each take is one continuous shot with the visitor, the robot and the operator in frame. At least two languages per take. Cuts only between takes. Total for all three: 3:00 or less.
Only these destinations have a route today: **the cafeteria ("kitchen")** and **the team tables**, from the pitch room door facing reception (from video, not walked yet; walk them first, see `qa/FLOOR FROM VIDEO.md`). Any other place gets "not mapped yet" and a handover. That is the honest answer, not a failure.
Agent lines below are what the live text drill produced (`evidence/live-runs/drill7.txt`); the real wording will vary.

## Before every take
1. Robot at the pitch room door, facing down the striped walkway toward reception. Operator knows the four landmarks: pitch room door, purple pillar, yellow pillar, cafeteria menu boards.
2. Bridge running per `CONNECT_TO_ROBOT.md`, Enter pressed for a fresh take, log shows `FOCUS: request -> focus_gain=True`.
3. Visitor stands within 1 m of the robot's head mic. Operator answers only with "Done", "Confirmed", or where the robot is.

## Take 1: easy (Arabic visitor, cafeteria) about 0:50
| Who | Says |
|---|---|
| Agent | أهلًا، أنا دليل آلي بالذكاء الاصطناعي. Hi, I'm an AI robot guide. Where would you like to go? |
| Visitor | السلام عليكم، أنا جوعان، وين أقدر آكل؟ |
| Agent | وعليكم السلام. تبي المطبخ؟ |
| Visitor | إيه، المطبخ. |
| Agent | تمام. Operator, we're going to the kitchen. Are we at the pitch room door, facing reception? |
| Operator | Yes. |
| Agent | Operator, walk straight and stop at the purple pillar. |
| Operator | (walks) Done. |
| Agent | Operator, walk straight and stop at the yellow pillar. |
| Operator | (walks) Done. |
| Agent | Operator, turn left. Walk straight and stop at the cafeteria menu boards. |
| Operator | (walks) Done. |
| Agent | Operator, stop here. Can you confirm we're at the cafeteria menu boards? |
| Operator | Confirmed. |
| Agent | وصلنا، هذا المطبخ. بالعافية! |

Result to fill: reached the right spot? [ ] Steps given [ ] Holds [ ] Time [ ]

## Take 2: organisers' music (English visitor who switches to Arabic, team tables) about 0:50
The organisers play their track; we cannot choose it. Visitor speaks a little louder, close to the robot.
| Who | Says |
|---|---|
| Visitor | Hi, where do the teams sit? |
| Agent | (asks to confirm the team tables) |
| Visitor | نعم، طاولات الفرق. |
| Agent | (in Arabic, then) Operator, we're going to the team tables. Are we at the pitch room door, facing reception? |
| Operator | Yes. |
| Agent | Operator, walk straight and stop at the purple pillar. |
| Operator | (walks) Done. |
| Agent | Operator, stop here. Can you confirm we're at the purple pillar? |
| Operator | Confirmed. |
| Agent | (in Arabic) We have arrived at the team tables. |

If the agent says "Sorry, I didn't catch that", the visitor repeats once. That is the noise rule working; keep rolling.
Result to fill: understood through the music? [ ] Repeats needed [ ] Reached the right spot? [ ]

## Take 3: change of destination (organisers choose the new place) about 1:10
Start toward the cafeteria (as Take 1). After "Done" at the purple pillar, an organiser's second person asks for a new place.
| Who | Says |
|---|---|
| Visitor 1 | (Arabic) asks for the kitchen, as in Take 1 |
| Agent | Operator, walk straight and stop at the purple pillar. |
| Operator | (walks) Done. |
| Visitor 2 | Excuse me, can it take me to the `[organisers' destination]` instead? |
| Agent | Operator, please stop. (tells both people the destination changed) |

Then one of two endings, depending on what the organisers pick:
- **Team tables or cafeteria (mapped):** the agent asks where the robot is, the operator says "At the purple pillar, facing reception", and the agent gives the new steps and confirms arrival in Visitor 2's language.
- **Meeting room, conference room or a call booth (not mapped today):** the agent says it does not have a checked route there yet and asks them to check with the organisers at registration. The operator stays put. Do not ad-lib directions.

Result to fill: stopped at once? [ ] Asked position before replanning? [ ] New route correct or clean handover? [ ]

## Do not film
- Any route to a place not listed above.
- `--camera-markers`, the judge screen or any other switch that is off by default, unless it was tested on the robot first.
