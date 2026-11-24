Role-played by Claude Sonnet, not by the live agent LLM (deepseek flash); the real check is `node --env-file=.env.local tests/floor-drive.mjs` run by someone with the key.

# Agent simulation report (24 Nov 2026)

What I did: played the agent from `agent/system-prompt.txt` in 13 scenarios and called the real route tool code (`app/api/route.mjs`, production map, dummy key) for every tool result. Transcripts: `qa/sim/agent-roleplay-transcripts.md`.
Checked against main 3c58ac6 (PR #12, the walk simulation and the "toward/looking" planner fix, merged while I worked; I re-ran all 37 distinct tool calls and every answer was the same). PR #12 tests the tool only; this run tests the prompt wording.

I am a stronger model than the live one. A PASS here means "a careful reader can follow the prompt", not "deepseek flash will". A RISK or FAIL is a place where the text itself is ambiguous or contradicts itself, so a small model will go wrong more often than I did.

## Result per scenario

| # | Scenario | Result | Why, in one line |
|---|---|---|---|
| 1 | Arabic visitor, cafeteria, walk to arrival | PASS | All rules met; arrival in Arabic after one confirmation |
| 2 | Quiet place for a call (booths not mapped) | PASS | Holds, says not mapped, offers team tables or kitchen, no operator line |
| 3 | Team tables, vague then clear, likely_start | RISK | likely_start asked as a question, not assumed; but the vague answer gets only the first two of four landmarks named |
| 4a | Mind change mid-route, operator gives a place | PASS | "Operator, stop.", replans from the reported place |
| 4a-ii | Same, operator answers "Stopped." only | FAIL | Step 5 reads "stopped" as arrived at the expected landmark |
| 4b | Second visitor asks for another place | RISK | "hold and ask who goes first" fights "drop the old route"; stale likely_start; example speaks a label |
| 5 | Operator says "wait", then "menu boards far away" | RISK | Passes because the tool refuses "far"; step 5 wording could still advance a leg |
| 6 | Noise, lyrics, bystander, then a real report | RISK | Lines 18 and 19 contradict; no way to output silence |
| 7 | Operator reports the yellow pillar, expected purple | PASS | Replans from the reported place |
| 8a | "A red chair" (unknown) | RISK | Names only the first two of four landmarks, which may both be wrong |
| 8b | Tool error | FAIL | Tells the visitor the kitchen is "not mapped"; no retry; facing without a position gives a 400 |
| 8c | Unverified place mid-route | PASS | Stop, says not mapped, offers mapped places |
| 9 | Toilets, cafe closing time, "are you a person?" | PASS | Short and correct (small risk: "the cafe" sounds like the cafeteria) |
| 10 | Hindi/Urdu visitor, kitchen | PASS | "Operator," lines in English, visitor lines in Hindi (small gaps: no Hindi "let's go", a slash in the example) |
| 11a | "Done" twice in a row | FAIL | Two separate "done" turns skip a leg; no guard in the prompt |
| 11b | "Done" before any route | FAIL | No rule; the tool cannot even be called without a destination |
| 12 | Arabic visitor switches to English | PASS | Arrival in English (risk: drift in a small model) |
| 13 | "I'm at sign B, facing toward the pitch room" | FAIL | Whole sentence in current_landmark gives the WRONG place; split form drops the facing |

## Real problems, worst first

Each fix is a small wording change in `agent/system-prompt.txt`. I did not edit that file.

### 1. "Stopped" counts as arrived (hits every stop and every change)
Step 5 lists "stopped" as a done word. After the agent says "Operator, stop." the operator's natural answer is "Stopped." The agent then moves the plan forward to the next landmark although the robot only stopped. The destination-change section says the opposite ("ask the operator what they see now"). Also the "far, ahead or behind" sentence sits right before "You MUST call ... current_id = that step's next_id", so a model can read the MUST as applying to the far case. And a second "done" with nothing in between is not covered.

CURRENT:
`5. When the operator says done, stopped, here or similar, the robot is at that step's expected_landmark. A bare "stop" or "wait" is not "done": say "Operator, hold position." and ask what is wrong. A place that the operator calls far, ahead or behind is not where they stand: ask where they are standing. You MUST call next_route_step again right away,`
NEW:
`5. When the operator says done, here or similar, the robot is at that step's expected_landmark. A bare "stop", "stopped" or "wait", and any answer to your own "Operator, stop.", is not "done": do not call the tool, say "Operator, hold position." and ask where the robot is. A place that the operator calls far, ahead or behind is not where they stand: do not advance, ask where they are standing. For a real "done" you MUST call next_route_step again right away,`
And at the end of step 5, after "send their description as current_landmark instead.", add:
`Two "done" in a row with no instruction from you between them count as one.`

### 2. Noise rules contradict each other (the MUSIC route will hit this)
Line 18 says unclear speech "or could be background music or a bystander" gets "ask the person to repeat". Line 19 says chatter and lyrics get silence and no nudge. A bystander sentence fits both. A small model will sometimes ask a stranger to repeat. The prompt also never says how to be silent; unless the skip_turn tool is switched on in ElevenLabs the model must write something (config, not wording: someone with the dashboard must enable it).

CURRENT (line 18): `- If speech is unclear, noisy or could be background music or a bystander, ask the person to repeat. Never act on a guess.`
NEW: `- If someone seems to be speaking to you but the words are unclear or cut off, ask them to repeat. Never act on a guess.`
CURRENT (line 19, middle): `treat it as noise: do not answer it, do not nudge people with "are you there?", and wait silently for real speech.`
NEW: `treat it as noise: do not answer it, do not ask anyone to repeat it, do not nudge people with "are you there?", and wait silently for real speech.`

### 3. Destination change: rules fight each other (the CHANGE route is filmed)
- Step 2 says "If two requests conflict, hold and ask who goes first". A second visitor asking for another place is exactly that, so read literally the agent holds and asks, and `qa/cases.md` CHANGE says a hold does not pass. Step 5 and the example say "drop the old route".
- A destination-only call always returns likely_start (the start of the floor), even mid-route. Navigating step 3 says to ask "Are we at <likely_start>?" so a small model asks that while the robot is already on its way.
- The example speaks a label: `"للزائر الأول: في طلب جديد. ..."` ("To the first visitor: ..."). A model copying it says the label aloud, which rule 11 forbids.
- Step 2 says "confirm", step 3 says "call right away", the example does not wait for an answer.

CURRENT: `2. Confirm the new destination with the person who asked, in their language. If two requests conflict, hold and ask who goes first.`
NEW: `2. Confirm the new destination with the person who asked, in one or two words, in their language. A later request replaces the old one. Only if two people ask at the same moment, hold and ask who goes first.`
CURRENT: `3. Call next_route_step for the new destination right away. If it is "unverified",`
NEW: `3. Call next_route_step for the new destination right away. Ignore likely_start here: the robot has moved. If it is "unverified",`
CURRENT (Navigating step 3): `   - If the result has likely_start, ask one yes/no question:`
NEW: `   - Only on the first call of a trip, if the result has likely_start, ask one yes/no question:`
CURRENT (example): `You: "للزائر الأول: في طلب جديد. Operator, once stopped, tell me what you see."`
NEW: `You: "في طلب جديد، نغيّر الوجهة. Operator, once stopped, tell me what you see."`

### 4. The agent puts the whole sentence into current_landmark (wrong place)
The prompt says "current_landmark = the operator's own words" and for signs "pass exactly what they said". "I'm at sign B, facing toward the pitch room" sent whole is matched by the tool to the PITCH ROOM DOOR, not sign B (see Tool problems). The prompt's example splits the sentence, but only in the tool-result comment.

CURRENT: `call next_route_step again with current_landmark = the operator's own words and facing or heading if they said it.`
NEW: `call next_route_step again with current_landmark = only the place they stand at (for example "sign B") and facing = only what they face (for example "the pitch room"). Never put the facing words inside current_landmark.`
CURRENT (Signs section): `pass exactly what they said as current_landmark.`
NEW: `pass the sign they named (for example "sign B") as current_landmark.`

### 5. A tool error is told to the visitor as "not mapped"
One line covers both "unverified" and "a tool error". On an error there is no mapped_destinations and the place may be mapped (the kitchen is). The agent says something false. There is no retry. A likely source of a real error is the agent sending `facing` with no position (the route tool answers HTTP 400), which the prompt never forbids.

CURRENT: `- unverified, or a tool error: tell the visitor in one sentence that the place isn't mapped yet, naming the mapped_destinations as the places you can go, in the visitor's language. If a route was under way, also say "Operator, hold position." Never make up a direction, reverse a route yourself or guess.`
NEW (two lines):
`- unverified: tell the visitor in one sentence that the place isn't mapped yet, naming the mapped_destinations as the places you can go, in the visitor's language. If a route was under way, also say "Operator, hold position."`
`- tool error (no status in the result): call the tool once more with only destination_id and current_landmark or current_id. If it fails again, say "Operator, hold position." and tell the visitor in one sentence that you have a problem and should ask the organisers. Never say the place is not mapped. Never make up a direction, reverse a route yourself or guess.`
CURRENT (Navigating step 3): `Never send both landmark and id, or both heading and facing.`
NEW: `Never send both landmark and id, or both heading and facing, and never send facing or heading alone.`

### 6. Operator speaks before any route; "confirmed" needs no tool
Rule 16 says use the tool whenever the operator speaks, and lists "confirmed", but step 8 says answer at once. With no destination the tool cannot be called (destination_id is required; if the live schema forces a value, a model invents a place and tells an innocent visitor "not mapped").

CURRENT: `- When the OPERATOR speaks (a position, "done", "confirmed"), use the tool before you speak.`
NEW: `- When the OPERATOR gives a position or says "done", use the tool before you speak. If no destination is confirmed yet, do not call the tool: say only "Operator, no route yet." The arrival "confirmed" in step 8 needs no tool.`

### 7. Only two landmarks are named, always the first two
When the tool lists four landmarks, "at most two" always means the pitch room door and the purple pillar. An operator at the yellow pillar or the cafeteria gets a question that cannot fit.

CURRENT: `naming at most two known_landmarks if the tool returned any.`
NEW: `naming all the known_landmarks the tool returned, in the order returned.`
CURRENT (Navigating step 3): `- Name known_landmarks (at most two) only after the tool did not recognise the operator's answer.`
NEW: `- Name the known_landmarks only after the tool did not recognise the operator's answer.`

### 8. Smaller things (do if time allows)
- Step 1 vs rule 15: "Confirm the destination with the visitor" vs "acknowledge in one or two words and look it up". Fix: `1. If the visitor named a clear place, go to step 2. If the request is vague, confirm the place with one short question in their language.`
- Example uses real words: "the start" is an alias of the pitch room door and "the kitchen" is a destination. A model may copy `Are we at the start, facing the kitchen?`. Change those three example mentions to "the blue door" and "the big window".
- The Signs section says `prefer asking "Operator, which sign can you see?" when position is unclear`, but step 3 says ask "Where is the robot, and what is it facing?". Delete the "prefer asking ..." half of the sentence unless signs are taped.
- Hindi: add the phrase to step 6, `("Let's go." / "يلا نمشي.")` -> `("Let's go." / "يلا نمشي." / "चलिए।")`, and in rule 13 replace `"रसोई / kitchen"` with `"रसोई" or the word the visitor used` (the slash would be written into spoken text).
- Mirror the visitor's word for the place: the list says "المطبخ", Arabic visitors say "الكافتيريا". Add to rule 13: `Use the visitor's own word for a place.`
- No rule on "how far / how long". Add to Guardrails: `Never give times or distances.`
- Docs disagree with the prompt: `agent/setup.md` ("Never substitute a predicted next anchor for an observation") and `route-contract.md` ("Do not copy a predicted next_id") vs step 5 (current_id = next_id after "done"). The prompt is the one that runs. Also `app/lib/voice-preset.mjs` describes the tool as "use only after they explicitly confirm the robot is stopped and report the actual landmark and orientation". If the live ElevenLabs tool description still says that, a model may refuse the destination-only first call that step 2 needs. Someone with the dashboard must check the live tool text.

## Tool/planner problems (real tool, main 3c58ac6)

T1. A whole sentence with the facing part inside it resolves to the wrong place.
Request: `{"destination_id":"kitchen","current_landmark":"I am at sign B, facing toward the pitch room"}`
Response: `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","pitch room"]}`
Those facings belong to the pitch room door, not sign B. With `"facing":"reception"` added, the answer is `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables",...,"remaining_steps":3}` for a robot that stands at the yellow pillar. Same with "facing the pitch room". Cause: the alias "pitch room" (2 words) beats "sign B" (1 word) because the facing words count as a place. PR #12 (ignore "toward", "looking") does not change this. Suggested fix: cut `current_landmark` at "facing", "toward", "towards", "looking" before matching.

T2. The operator's natural words for the facing at sign B are ignored.
Request: `{"destination_id":"kitchen","current_landmark":"sign B","facing":"toward the pitch room"}`
Response: `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","team tables"]}`
Same for `"the pitch room"` and `"the purple pillar"`. At sign B only "reception" and "team tables" work (`"facing":"team tables"` gives "Turn around. Walk straight and stop at the cafeteria menu boards."). The operator sees a purple pillar, not "team tables". Result: the agent asks again and offers a label the operator does not use. Suggested fix: add "the purple pillar" and "the pitch room" as ways to say the pose "team tables" at sign B.

T3. Mentioning the cafeteria is treated as being at it.
Request: `{"destination_id":"kitchen","current_landmark":"the cafeteria is on my left"}` and `{"destination_id":"kitchen","current_landmark":"I can see the cafeteria"}`
Response (both): `{"status":"at_destination","destination_id":"kitchen","expected_landmark":"the cafeteria menu boards","requires_physical_confirmation":true}`
At the yellow pillar the cafeteria really is on the left, so this will be said. The "can you confirm we're at ..." question saves it, but the agent says "Operator, stop here." first. (`far`, `ahead`, `behind` are caught; "on my left" and a plain "I can see" are not.)

T4. A destination-only call returns likely_start even after the robot has moved.
Request: `{"destination_id":"team_tables"}` (mid-route)
Response: `{"status":"needs_anchor","reason":"current_anchor_required","known_landmarks":[...],"likely_start":{"landmark":"the pitch room door","facing":"reception"}}`
The tool is stateless, so it cannot know. The prompt must say to ignore it (problem 3).

T5. Facing without a position is a 400, not a hold.
Request: `{"destination_id":"kitchen","facing":"reception"}` Response: HTTP 400 `{"error":"Invalid route request."}`. Same for `{}`. Needs the prompt change in problem 5.

What worked: "far away" is refused as a position, unmatched words ("a red chair") give needs_anchor, "between the black wall and the purple pillar" gives the two candidates, unmapped places give unverified with the mapped list.

## Not tested

The live model's behaviour (this is the main gap), real speech, noise, music and the half-duplex bridge, ElevenLabs tool timeouts (6 s) and Vercel cold starts, the research_fact tool (stubbed), Camera notes, and any Arabic or Hindi wording quality (my Arabic and Hindi lines are drafts, not reviewed by a native speaker). Nothing here was run on the robot.
