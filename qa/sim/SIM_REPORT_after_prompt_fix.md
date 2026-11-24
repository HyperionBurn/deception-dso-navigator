Role-played by Claude Sonnet against the NEW prompt, not by the live agent LLM (deepseek flash); the real check is `node --env-file=.env.local tests/floor-drive.mjs` run by someone with the key.

# Re-run of the agent role-play against the edited prompt (24 Nov 2026)

What I did: played the agent exactly as written in the edited `agent/system-prompt.txt` (in the `prompt` worktree) and called the real route tool code (`app/api/route.mjs`, production map, made-up key) for every tool result: 62 calls, nothing invented. Compared with the old prompt (`origin/main`) and with `qa/sim/SIM_REPORT.md`.

Sync check (round 1): local `origin/main` and the remote main were both 7671419 (I only read the remote head, I did not fetch). Round 2 note: the remote main has since moved to 37020de, which only adds a handoff doc, so `app/` and `agent/` are unchanged. The only file that differs from main in `app/` and `agent/` is `agent/system-prompt.txt`, so the tool and planner are the same as in the first run and the tool problems T1 to T5 still stand.

I am a stronger model than the live one. A PASS means "a careful reader can follow the prompt", not "deepseek flash will". A RISK or FAIL is a place where the text itself is unclear or fights itself.

Round 1 numbers: the edited prompt was 2698 words, the old one 2408 (about 12 percent longer). Step 5 grew from 141 to 180 words and was one block. (The prompt has changed again since; see "Update 2" at the end for the current text and numbers. Everything between here and "Update 2" is about the round 1 prompt.)

## Result table

| # | Scenario | Before | After | One-line why |
|---|---|---|---|---|
| 3 | Team tables, vague then clear, likely_start | RISK | PASS | likely_start still only a question; "somewhere in the hall" now gets all four places, so an operator at the yellow pillar can answer |
| 4a | Mind change, operator answers "Stopped. I'm between ..." in one go | PASS | RISK (new) | step 5 says "any answer to your own Operator, stop. is not done: do not call the tool", which fights rule 16 when the answer already names a place |
| 4a-ii | Same, operator says only "Stopped." | FAIL | PASS | no tool call, "Operator, hold position." and asks where; small cost: it asks the same question twice |
| 4b | Second visitor asks for another place mid-route | RISK | PASS | "a later request replaces the old one", likely_start ignored, no spoken label; same risk as 4a for a combined answer |
| 5 | Operator says "wait", then "menu boards far away" | RISK | PASS | "wait" gets a hold and a question; "far" gets no tool call and a question; stripping "far away" would still be wrong (see below) |
| 6 | Noise, lyrics, bystander, then a real report | RISK | PASS | lines 18 and 19 now agree; the agent still needs a skip-turn setting to be truly silent (config, not wording) |
| 8a | "A red chair" (unknown place) | RISK | PASS | all four places are named, so any real position can be chosen |
| 8b | Facing without a position / tool error | FAIL | PASS (with 3 new problems) | the agent no longer sends facing alone and no longer says "not mapped" on an error; but the retry drops the exit pose, the Camera line still allows facing alone, and "will ask the organisers" is a promise it cannot keep |
| 11a | "Done" twice in a row | FAIL | FAIL (case 2 unchanged) | the new sentence only fires when the agent said nothing between the two "done"; in the real case it did |
| 11b | "Done" before any route | FAIL | PASS | "Operator, no route yet." and no tool call |
| 13 | "I'm at sign B, facing toward the pitch room" | FAIL | PARTIAL | the sentence is now split, so no wrong place; but the tool still ignores "the pitch room" at sign B, so the agent asks again |
| N1 | Three unrecognised position answers | new | PASS | asks three times, holds after the third answer, not before; wording problems below |
| N2 | Normal kitchen route, Arabic visitor | new | PASS | happy path unchanged; arrival in Arabic with the visitor's own word |
| N3 | Operator says just "yes" or "left" mid-route | new | RISK | no longer noise, but nothing says what to do with it; "yes" can still be read as "done" and skip a leg |
| N4 | "Stopped." then the place | new | PASS | replans from the reported place |

New check on your example wording: `"current_landmark":"sign B"` with `"facing":"reception"` works with the tool ("Turn left. Walk straight and stop at the cafeteria menu boards."). `"the pitch room"`, `"toward the pitch room"`, `"pitch room"` and `"the purple pillar"` as the facing at sign B do not (see 13).

## How to read the transcripts

Key: `V` visitor, `O` operator, `T>` the exact request sent to the tool, `T<` the exact answer, `A` what the agent says aloud, `[..]` note (never spoken). `A: (nothing)` means silent.
Short forms (used only to save space): `KL` = `"known_landmarks":["the pitch room door","the purple pillar","the yellow pillar","the cafeteria menu boards"]` and `LS` = `"likely_start":{"landmark":"the pitch room door","facing":"reception"}`.
First message from the agent in every run: "أهلًا، أنا دليل آلي بالذكاء الاصطناعي. Hi, I'm an AI robot guide. Where would you like to go?"
research_fact was not needed in any run.

---

## N2. Normal route to the kitchen, Arabic visitor, start at the pitch room door facing reception

V: "السلام عليكم، أبغى أروح الكافتيريا."
T> `{"destination_id":"kitchen"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
A: "تمام. Operator, we're going to the kitchen. Are we at the pitch room door, facing reception?"
O: "Yes."
T> `{"destination_id":"kitchen","current_landmark":"the pitch room door","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"reception"},"remaining_steps":3,"destination_landmark":"the cafeteria menu boards"}`
A: "يلا نمشي. Operator, walk straight and stop at the purple pillar."
O: "Done."
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."
O: "Done."
T> `{"destination_id":"kitchen","current_id":"sign_b","facing":"reception"}`
T< `{"status":"step","command":"Turn left. Walk straight and stop at the cafeteria menu boards.","next_id":"kitchen","expected_landmark":"the cafeteria menu boards","exit_pose":{"facing":"menu boards"},"remaining_steps":1,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, turn left. Walk straight and stop at the cafeteria menu boards."
O: "Done."
T> `{"destination_id":"kitchen","current_id":"kitchen","facing":"menu boards"}`
T< `{"status":"at_destination","destination_id":"kitchen","expected_landmark":"the cafeteria menu boards","requires_physical_confirmation":true}`
A: "Operator, stop here. Can you confirm we're at the cafeteria menu boards?"
O: "Confirmed."
[no tool: rule 16 now says the arrival "confirmed" needs none]
A: "وصلنا، هذي الكافتيريا."

Judge: PASS. Same tool answers as the first run. Operator lines in English with "Operator,", one instruction each, tool before speaking, one confirmation, arrival in Arabic using the visitor's own word (rule 13 now says so). The edits did not break the happy path.
Small point: rule 13 still gives "المطبخ" as the example and then says "use the word the visitor used". The second part wins, but a small model may pick the example.

---

## 3. English visitor, team tables; operator vague, then clear; likely_start

V: "Can you take me to the team tables?"
T> `{"destination_id":"team_tables"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
A: "Got it. Operator, we're going to the team tables. Are we at the pitch room door, facing reception?"
[first call of the trip, so likely_start is asked as a question, not assumed]
O: "We're near the black wall."
[not a yes; own words, place only]
T> `{"destination_id":"team_tables","current_landmark":"the black wall"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","pitch room"]}`
A: "Operator, which way is the robot facing: reception or the pitch room?"
O: "At the pitch room door, facing reception."
T> `{"destination_id":"team_tables","current_landmark":"the pitch room door","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"reception"},"remaining_steps":1,"destination_landmark":"the purple pillar"}`
A: "Let's go. Operator, walk straight and stop at the purple pillar."
O: "Done."
T> `{"destination_id":"team_tables","current_id":"team_tables","facing":"reception"}`
T< `{"status":"at_destination","destination_id":"team_tables","expected_landmark":"the purple pillar","requires_physical_confirmation":true}`
A: "Operator, stop here. Can you confirm we're at the purple pillar?"
O: "Yes, confirmed."
A: "We've arrived at the team tables."

### 3b. The operator is vaguer: "somewhere in the hall"

(after the same likely_start question)
O: "I'm somewhere in the hall."
T> `{"destination_id":"team_tables","current_landmark":"somewhere in the hall"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, are you at the pitch room door, the purple pillar, the yellow pillar or the cafeteria menu boards?"
[all four, in the returned order (the new line 58 wording). Before, only the first two were named.]
O: "At the yellow pillar."
T> `{"destination_id":"team_tables","current_landmark":"the yellow pillar"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","team tables"]}`
A: "Operator, which way is the robot facing: reception or team tables?"
O: "Reception."
T> `{"destination_id":"team_tables","current_landmark":"the yellow pillar","facing":"reception"}`
T< `{"status":"step","command":"Turn around. Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"pitch room"},"remaining_steps":1,"destination_landmark":"the purple pillar"}`
A: "Let's go. Operator, turn around. Walk straight and stop at the purple pillar."

Judge: PASS. Risk left: the four-place question is long to say aloud, but it is correct.

---

## 4a. Arabic visitor changes her mind mid-route (kitchen to team tables), operator answers with a place at once

(Setup: kitchen route, first instruction "walk straight and stop at the purple pillar" given, operator walking.)
V: "لا لحظة، أبغى أروح طاولات الفرق بدال."
A: "Operator, stop. تمام، طاولات الفرق."
T> `{"destination_id":"team_tables"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
[step 3 of "Destination change" says ignore likely_start: the agent does]
A: "نغيّر الوجهة. Operator, once stopped, tell me what you see."
O: "Stopped. I'm between the black wall and the purple pillar."

Reading A (the sensible one: a place was given, so rule 16 and the last sentence of step 5 win):
T> `{"destination_id":"team_tables","current_landmark":"between the black wall and the purple pillar"}`
T< `{"status":"needs_anchor","reason":"ambiguous_landmark","candidates":["the purple pillar","the pitch room door"]}`
A: "Operator, which is nearer: the purple pillar or the pitch room door?"
O: "The pitch room door. Facing reception."
T> `{"destination_id":"team_tables","current_landmark":"the pitch room door","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"reception"},"remaining_steps":1,"destination_landmark":"the purple pillar"}`
A: "Operator, walk straight and stop at the purple pillar."

Reading B (the literal one): step 5 now says "A bare stop, stopped or wait, and any answer to your own 'Operator, stop.', is not done: do not call the tool, say 'Operator, hold position.' and ask where the robot is." This answer IS an answer to "Operator, stop.", so:
A: "Operator, hold position. Where is the robot, and what is it facing?"
[no tool call; the operator has just said where. A wasted turn, no wrong move. The operator has now been asked the same thing three times: "tell me what you see", then this.]

Judge: RISK (new). It passed in the first run. The new sentence "any answer to your own Operator, stop." covers answers that name a place, and rule 16 says a position needs the tool. A small model can go either way. See "Still wrong or risky" 3.

## 4a-ii and N4. Same, but the operator says only "Stopped.", then names the place

(Same setup and same first three agent lines as 4a, up to "once stopped, tell me what you see.")
O: "Stopped."
[step 5: a bare "stopped" and an answer to my own "Operator, stop." is not done. No tool call.]
A: "Operator, hold position. Where is the robot, and what is it facing?"
O: "At the yellow pillar, facing reception."
T> `{"destination_id":"team_tables","current_landmark":"the yellow pillar","facing":"reception"}`
T< `{"status":"step","command":"Turn around. Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"pitch room"},"remaining_steps":1,"destination_landmark":"the purple pillar"}`
[replanned from the reported place, not from the old plan's next_id]
A: "Operator, turn around. Walk straight and stop at the purple pillar."
O: "Done."
T> `{"destination_id":"team_tables","current_id":"team_tables","facing":"pitch room"}`
T< `{"status":"at_destination","destination_id":"team_tables","expected_landmark":"the purple pillar","requires_physical_confirmation":true}`
A: "Operator, stop here. Can you confirm we're at the purple pillar?"
O: "Yes."
A: "تمام، وصلنا طاولات الفرق."

Judge: 4a-ii PASS, N4 PASS. The old failure (reading "stopped" as arrived at the expected landmark) is gone. Small costs: "hold position" is said to an operator who has already stopped, the where-question repeats the one just asked, and the bare "Stopped." uses up one of the three tries of the new count rule (see N1).

---

## 4b. A second visitor (English) asks for the team tables while visitor 1 (Arabic) is on the way to the cafeteria

(Setup: kitchen route, first instruction given, operator walking.)
V2: "Excuse me, can it take me to the team tables?"
A: "Operator, stop. Okay, team tables."
[step 2: confirm in one or two words; "A later request replaces the old one"; the "who goes first" hold is only for two people asking at the same moment, so not used]
T> `{"destination_id":"team_tables"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
[stale likely_start (the robot has moved): step 3 says ignore it, the agent does]
A: "في طلب جديد، نغيّر الوجهة. Operator, once stopped, tell me what you see."
[no label such as "to the first visitor" any more (the example was fixed)]
O: "Stopped at the purple pillar, facing reception."
T> `{"destination_id":"team_tables","current_landmark":"the purple pillar","facing":"reception"}`
T< `{"status":"at_destination","destination_id":"team_tables","expected_landmark":"the purple pillar","requires_physical_confirmation":true}`
A: "Operator, stop here. Can you confirm we're at the purple pillar?"
O: "Yes."
A: "We've arrived at the team tables."
[English, because the visitor who spoke last (visitor 2) used English]

Judge: PASS. All three first-run problems are fixed (hold fights replace, stale likely_start, spoken label).
Risks left: (a) the same combined-answer conflict as 4a ("Stopped at the purple pillar"); (b) rules 13 and 17 say "the language the visitor last spoke", step 4 says "each in their own language": with two visitors a small model may use one language for both; (c) visitor 1 is never told their cafeteria request was dropped, only "new request, changing destination".

---

## 5. Operator says only "wait", then "I can see the cafeteria menu boards far away"

(Setup: kitchen route, first instruction "walk straight and stop at the purple pillar" given.)
O: "Wait."
[no tool: a bare wait is not done]
A: "Operator, hold position. Where is the robot, and what is it facing?"
O: "I can see the cafeteria menu boards far away."
[step 5: a place called far is not where they stand: do not advance, ask where they are standing. I make no tool call.]
A: "Operator, where are you standing?"
O: "At the purple pillar, facing reception."
T> `{"destination_id":"kitchen","current_landmark":"the purple pillar","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."

If a small model calls the tool anyway (I ran all three forms):
T> `{"destination_id":"kitchen","current_landmark":"I can see the cafeteria menu boards far away"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`  (safe: the tool refuses "far")
T> `{"destination_id":"kitchen","current_landmark":"the cafeteria menu boards far away"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`  (safe)
T> `{"destination_id":"kitchen","current_landmark":"the cafeteria menu boards"}`
T< `{"status":"at_destination","destination_id":"kitchen","expected_landmark":"the cafeteria menu boards","requires_physical_confirmation":true}`  (WRONG: this is what you get if the model cuts "far away" off, which the new "only the place they stand at" wording could invite. The arrival question "Can you confirm we're at ...?" would then catch it.)

Judge: PASS. The MUST sentence now starts with "For a real done", so it no longer reads as covering the "far" case. Risk: the stripped form above.

---

## 6. Noise: "...", song-like words, a bystander sentence, then a real report

(Setup: kitchen route, first instruction given, operator walking.)
Heard: "..."  A: (nothing)
Heard: "la la la, baby baby, oh oh oh yeah"  A: (nothing)
Heard: "Did you see the match last night? I'll call you back after lunch."  A: (nothing)
[line 18 now only covers someone "who seems to be speaking to you" with unclear words. This sentence is clear and not for me, so it is background chatter under line 19: no answer, no "please repeat". The first-run clash is gone.]
(20 seconds of silence)  A: (nothing)  [no "are you there?"]
O: "Done."
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."

Judge: PASS on wording. Still open and not fixable in the prompt: "wait silently" has no way to produce silence unless the skip-turn setting is switched on in the voice platform.

---

## 8a. "Done. I'm next to a red chair." (a place the map does not know)

(Setup: kitchen route, first instruction given.)
O: "Done. I'm next to a red chair."
[a different place is described, so send only that place; the "done" is not used]
T> `{"destination_id":"kitchen","current_landmark":"a red chair"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, I don't know that one. Are you at the pitch room door, the purple pillar, the yellow pillar or the cafeteria menu boards?"
O: "The yellow pillar."
T> `{"destination_id":"kitchen","current_landmark":"the yellow pillar"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","team tables"]}`
A: "Operator, which way are you facing: reception or team tables?"

Judge: PASS. All four places are named now, so a yellow-pillar operator can answer.

---

## 8b-1. The operator gives a facing before any position

(Setup: destination kitchen confirmed, agent has asked "Are we at the pitch room door, facing reception?")
O: "We're facing reception."
[new rule: never send facing alone. No tool call.]
A: "Operator, where is the robot?"
O: "At the pitch room door."
T> `{"destination_id":"kitchen","current_landmark":"the pitch room door","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"reception"},"remaining_steps":3,"destination_landmark":"the cafeteria menu boards"}`
A: "Let's go. Operator, walk straight and stop at the purple pillar."
[I carried the earlier facing along because that is the sensible thing. The prompt does not say to. A literal model sends the place only, gets `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","pitch room"]}` and asks again which way the robot faces: a wasted turn, not a wrong move.]
For the record, the old failure is still a 400 if a model ignores the new rule:
T> `{"destination_id":"kitchen","facing":"reception"}`
T< HTTP 400 `{"error":"Invalid route request."}`

## 8b-2. A real tool error mid-route

I cannot make the real tool fail by itself, so I used a real error the handler gives: a request with a wrong route key (a mixed-up setting in production would look the same). The answer has no "status".
(Setup: kitchen route, first instruction given.)
O: "Done."
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< HTTP 401 `{"error":"Invalid route key."}`
[new line 62: call the tool once more with only destination_id and current_landmark or current_id. So I drop the exit pose.]
T> `{"destination_id":"kitchen","current_id":"team_tables"}`
T< HTTP 401 `{"error":"Invalid route key."}`
A: "Sorry, I have a problem, I'll ask the organisers. Operator, hold position."
[no "not mapped" any more. The old run said "the kitchen isn't mapped yet", which was false.]

Judge: PASS against the old failure. Three new problems:
(1) The retry throws away the exit pose. If the first error was a one-off, this is what the retry gets from the same tool with a good key:
T> `{"destination_id":"kitchen","current_id":"team_tables"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","pitch room"]}`
The agent would then ask the operator "which way are you facing: reception or the pitch room?" in the middle of a walk, and the operator could answer "the pitch room" (wrong), which gives a wrong command.
(2) "will ask the organisers": the agent cannot ask anyone.
(3) The camera line still allows facing alone ("You may send X as facing"). Real answer: `{"destination_id":"kitchen","facing":"the purple pillar"}` gives HTTP 400 `{"error":"Invalid route request."}`.

## 8b-3. The first call of a trip fails

V: "Take me to the kitchen."
T> `{"destination_id":"kitchen"}`
T< HTTP 401 `{"error":"Invalid route key."}`
T> `{"destination_id":"kitchen"}` (one retry)
T< HTTP 401 `{"error":"Invalid route key."}`
A: "Sorry, I have a problem, I'll ask the organisers. Operator, hold position."
[the operator was never told about any trip, so "hold position" is confusing here. The unverified line says "If a route was under way"; the error line does not.]

---

## 11a. "Done" twice

Case 1, one utterance "Done. Done.": one tool call, one step. PASS (as before).
Case 2, two turns, the second said at once, before any walking:
O: "Done."
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."
O: "Done."  (a repeat)
[the new sentence: "Two done in a row with no instruction from you between them count as one." There WAS an instruction between them (the yellow pillar one), so the rule does not apply. A careful reader must call the tool.]
T> `{"destination_id":"kitchen","current_id":"sign_b","facing":"reception"}`
T< `{"status":"step","command":"Turn left. Walk straight and stop at the cafeteria menu boards.","next_id":"kitchen","expected_landmark":"the cafeteria menu boards","exit_pose":{"facing":"menu boards"},"remaining_steps":1,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, turn left. Walk straight and stop at the cafeteria menu boards."
Judge: FAIL for case 2, unchanged. The robot is still at the purple pillar and is told to turn left. The new sentence only fires when two "done" arrive before the agent has said anything (for example the speech-to-text splits one "done" in two while the tool call runs).

## 11b. "Done" before any route

O: "Done."  (no destination confirmed)
[rule 16: no destination yet, do not call the tool]
A: "Operator, no route yet."
Judge: PASS. One gap, checked with the real tool: after an arrival, a "done" still has a "confirmed destination", so the agent would call the tool again:
O: "Done."  (after the visitor was told they arrived)
T> `{"destination_id":"kitchen","current_id":"kitchen","facing":"menu boards"}`
T< `{"status":"at_destination","destination_id":"kitchen","expected_landmark":"the cafeteria menu boards","requires_physical_confirmation":true}`
A: "Operator, stop here. Can you confirm we're at the cafeteria menu boards?"  (the arrival question asked a second time; harmless but odd)

---

## 13. "I'm at sign B, facing toward the pitch room."

(Setup: destination kitchen; the agent asked where the robot is.)
O: "I'm at sign B, facing toward the pitch room."
[new rules: current_landmark = only the place, facing = only what they face, never the facing words inside current_landmark]
T> `{"destination_id":"kitchen","current_landmark":"sign B","facing":"the pitch room"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","team tables"]}`
A: "Operator, which way is the robot facing: reception or team tables?"
O: "Team tables."
T> `{"destination_id":"kitchen","current_landmark":"sign B","facing":"team tables"}`
T< `{"status":"step","command":"Turn around. Walk straight and stop at the cafeteria menu boards.","next_id":"kitchen","expected_landmark":"the cafeteria menu boards","exit_pose":{"facing":"menu boards"},"remaining_steps":1,"destination_landmark":"the cafeteria menu boards"}`
A: "Let's go. Operator, turn around. Walk straight and stop at the cafeteria menu boards."

Other facings I tried at sign B (all give the same orientation question, so the operator's own words are still thrown away): "toward the pitch room", "pitch room", "the purple pillar", "purple pillar", and no facing at all.
Your example pair works: `"sign B"` + `"reception"` gives `{"status":"step","command":"Turn left. Walk straight and stop at the cafeteria menu boards.",...,"remaining_steps":1,...}`.
If a model still sends the whole sentence (old failure):
T> `{"destination_id":"kitchen","current_landmark":"I am at sign B, facing toward the pitch room"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","pitch room"]}`  (still the WRONG place, the pitch room door; this is the tool, T1)

Judge: PARTIAL. The wrong-place failure is fixed in the prompt. The operator's answer is still not used, because the tool does not know "the pitch room" or "the purple pillar" as ways to say the pose at sign B (tool problem T2). Together with the new count rule this can loop (see risk 7).

---

## N1. Three position answers in a row that the tool does not recognise (English visitor)

V: "Take me to the kitchen please."
T> `{"destination_id":"kitchen"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
A: "Got it. Operator, we're going to the kitchen. Are we at the pitch room door, facing reception?"
O: "No, we're next to a red chair."  [answer 1]
T> `{"destination_id":"kitchen","current_landmark":"a red chair"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, I don't know that one. Are you at the pitch room door, the purple pillar, the yellow pillar or the cafeteria menu boards?"  [one failed answer: ask again]
O: "Next to the water cooler."  [answer 2]
T> `{"destination_id":"kitchen","current_landmark":"the water cooler"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, which place is the robot at: the pitch room door, the purple pillar, the yellow pillar or the cafeteria menu boards?"  [two failed answers: ask again, it is not yet the third]
O: "By the glass door."  [answer 3]
T> `{"destination_id":"kitchen","current_landmark":"the glass door"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Sorry, I'll ask the organisers for help. Operator, hold position. I can't match that place."
[visitor first, then the operator line]

Judge: PASS. It does not hand over before the third failed answer and does not guess a landmark.
Things the rule does not say: whether the first yes/no question counts (I counted its answer, because it contained a place); whether a plain "No." counts; whether "needs a facing" or "which of two places" counts as a failure (I did not count them); what resets the count; and what happens after the hand over if the operator then gives a good place (rule 16 would use the tool, which is right). "Stopped." in a destination change also uses up one try (see 4a-ii).

---

## N3. The operator says just "Left." or "Yes." while a route is under way

(Setup: English visitor, kitchen route, first instruction "walk straight and stop at the purple pillar" given. No question of mine is open.)
O: "Left."
[line 19: "left" is never noise. It is not "done", not a place, not an answer to anything. No rule says what to do. A careful reader can only use line 18 (unclear: ask to repeat).]
A: "Operator, I didn't catch that. Could you say it again?"
O: "Yes."
[same: not noise, not done, nothing was asked]
A: "Operator, I didn't catch that. Could you say it again?"

What a small model could do instead:
- Stay silent (the old noise habit). The allow-list was meant to stop that, but no rule gives it anything else to do.
- Read "yes" as "done" (step 5 says "done, here or similar"). Real answer to the call it would then make:
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
  The robot has not reached the purple pillar and is told to go on. This is the dangerous one.
- Send "left" as the place:
T> `{"destination_id":"kitchen","current_landmark":"left"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
  Harmless, but it makes the agent ask a four-place question and it counts as a failed answer for the three-strikes rule.
- Send "left" as facing alone (against the new rule): `{"destination_id":"kitchen","facing":"left"}` gives HTTP 400.

Judge: RISK. "Not noise" is not the same as "knows what to do". In the case that matters (a "yes" or "left" that answers a question of mine, for example "which way are you facing?" or "can you confirm we're at ...?") the list helps. When nothing was asked, the list leaves a hole.

---

# Still wrong or risky (worst first)

Each fix is a small wording change in `agent/system-prompt.txt`. I did not edit that file.

### 1. "Done" repeated after an instruction still skips a leg (11a case 2)
The new sentence only covers two "done" with nothing said between them, which is not the real case. No wording can tell a repeat from a real "done" without time, and a confirm question on every leg would slow everything. Keep it simple: make the sentence say what it really covers, and tell the operator in the briefing to say "done" once, only when stopped.
CURRENT: `Two "done" in a row with no instruction from you between them count as one.`
NEW: `If you hear "done" twice before you have spoken, count it as one.`
(The last leg is still protected by the arrival question. The earlier legs are not.)

### 2. A "yes", "no", "left" or "right" that answers nothing (N3)
CURRENT (line 19, end): `Short operator words are never noise: "done", "yes", "no", "stop", "wait", "left", "right", "نعم".`
NEW: `Short operator words are never noise: "done", "yes", "no", "stop", "wait", "left", "right". If one of them answers no question of yours, do not call the tool and do not treat it as "done": ask once "Operator, are you at <expected_landmark>?" and act only on a yes.`
(The "نعم" is also odd in an operator list: the operator speaks only English.)

### 3. "Any answer to Operator, stop." fights "a position needs the tool" (4a, 4b)
CURRENT (step 5): `A bare "stop", "stopped" or "wait", and any answer to your own "Operator, stop.", is not "done": do not call the tool, say "Operator, hold position." and ask where the robot is.`
NEW: `A bare "stop", "stopped" or "wait", or an answer to your own "Operator, stop." that names no place, is not "done": do not call the tool, say "Operator, hold position." and ask where the robot is. If the answer names a place, treat it as a position.`

### 4. The one retry drops the exit pose (8b-2)
CURRENT (line 62): `call the tool once more with only destination_id and current_landmark or current_id.`
NEW: `call the tool once more with exactly the same fields.`
(The "only" was meant to avoid facing alone, but that is now covered by "never send facing or heading alone" in Navigating step 3.)

### 5. The Camera line still allows facing alone (8b)
CURRENT: `- "Camera: X is visible ahead" only tells you what the robot faces. You may send X as facing.`
NEW: `- "Camera: X is visible ahead" only tells you what the robot faces. Send X as facing only together with a position (current_landmark or current_id). On its own it is not a position: do not call the tool.`

### 6. "will ask the organisers" is a promise the agent cannot keep (lines 62 and 64), and "hold position" is said with no route
CURRENT (line 62): `If it fails again, say "Operator, hold position." and tell the visitor in one sentence that you have a problem and will ask the organisers.`
NEW: `If it fails again, tell the visitor in one sentence that you have a problem and they should ask the organisers at registration. If a route was under way, also say "Operator, hold position."`
CURRENT (line 64, end): `then tell the visitor in one sentence that you will ask the organisers for help.`
NEW: `then tell the visitor in one sentence to ask the organisers at registration for help.`

### 7. The three-strikes rule does not say what counts or what resets it (N1, 13)
Facing answers that the tool cannot match (tool problem T2) can loop or hit the hand over for a good operator.
CURRENT: `If the operator's answers have failed to give you a position three times in a row, stop asking:`
NEW: `If three answers in a row (a place or a facing) are not accepted by the tool or give no place, stop asking. Any step or at_destination result starts the count again:`
The real fix for 13 is in the tool: accept "the pitch room" and "the purple pillar" as the pose "team tables" at sign B (T2).

### 8. "Done" after the arrival (11b)
CURRENT (line 16): `If no destination is confirmed yet, do not call the tool: say only "Operator, no route yet."`
NEW: `If no destination is confirmed yet, or you have already told the visitor they arrived, do not call the tool: say only "Operator, no route yet."`

### 9. Step 5 is now one block of 180 words
A small model is more likely to miss a sentence in the middle. Same words, split into lines:
```
5. When the operator says done, here or similar, the robot is at that step's expected_landmark. For a real "done" you MUST call next_route_step again right away ... [rest unchanged]
   - Not done: a bare "stop", "stopped" or "wait" (or an answer to your "Operator, stop." that names no place): do not call the tool, say "Operator, hold position." and ask where the robot is.
   - A place called far, ahead or behind is not where they stand: do not advance, ask where they are standing.
   - A different place named: send only that place as current_landmark (facing separately).
```
The 11a sentence can go (see 1) to win back some length.

### 10. Smaller things
- Cutting "far away" from "the cafeteria menu boards far away" gives at_destination (scenario 5). One more sentence in step 5 would close it: `Never cut "far", "ahead" or "behind" off to get a place.`
- After a destination change, step 6 ("on the first step, tell the visitor you are setting off") does not say whether the new route's first step gets "Let's go.".
- With two visitors, rule 13 ("the language the visitor last spoke") and step 4 ("each in their own language") pull in different directions.
- The first example (a call booth), the Hindi example and the second-visitor example (conference room) show routes that the production map answers with "unverified" (only the team tables and the kitchen are mapped). The prompt handles "unverified", but a model that copies the example flow may expect booths to work.
- Rule 13 gives "المطبخ" as an example and then says to use the visitor's word. Put the second part first: `Use the word the visitor used for a place (for example "الكافتيريا"); if they did not name it, use "المطبخ".`
- Silence (scenario 6) needs the skip-turn setting in the voice platform; no wording fixes it.
- The Navigating step 3 wording "only the place they stand at" is good for "sign B" but gives no guidance for "between the black wall and the purple pillar". The tool handles the whole phrase well (two candidates), so the model should keep it whole. Add: `If they say they are between two places, send the whole phrase.`

## Tool problems still true (unchanged, not in the prompt)

T2: at sign B only "reception" and "team tables" are accepted as facing; the operator's "the pitch room" and "the purple pillar" are ignored (checked again: 5 forms).
T1: a whole sentence with the facing inside it still gives the wrong place (pitch room door instead of sign B).
T3 and T4: not re-run in full; the 5 "far" calls above confirm "far away" is still refused as a position, and a destination-only call still returns likely_start even mid-route (the prompt now says to ignore it).
T5: facing without a position is still HTTP 400 (the prompt now forbids sending it, except the Camera line, see 5).

## Not tested

The live model's behaviour is the main gap: this report is a careful reader, not deepseek flash. Not run: real speech and noise, the half-duplex audio bridge, tool timeouts and cold starts on the voice platform, the research_fact tool, Camera notes (only read, the facing-alone case was run on the tool), the Hindi/Urdu flow (only the new "चलिए।" and "रसोई" wording was read), and any Arabic or Hindi wording quality (my Arabic lines are drafts, not reviewed by a native speaker). The tool-error branch used a wrong-key 401 as a stand-in for a real error, because the tool cannot be made to fail in any other way from outside. Nothing here was run on the robot, and I did not fetch the remote, I only read its head commit.

---

## Update 2 (after the second round of prompt edits)

Same method: I re-read `agent/system-prompt.txt` (now 2783 words; step 5 is six lines, 226 words, with bullets for done, not done, a named place, and a bare yes/no/left/right) and replayed only the scenarios asked for, with the real route tool (made-up key, 34 calls). The remote main is 37020de (docs only), so the tool answers are the same as in round 1. Same limits as above: Claude Sonnet reading the prompt, not the live model. Short forms `KL` and `LS` mean the same as above.

### Result table

| Scenario | After round 1 | After round 2 | Why |
|---|---|---|---|
| 11a case 2 ("done" twice, separate turns) | FAIL | FAIL (known limit) | the sentence now says "before you have spoken", which is honest, but a repeat after the agent spoke still skips a leg |
| N3 ("yes" / "left" that answers nothing) | RISK | PASS, 2 gaps | new bullet asks "Operator, are you at <expected_landmark>?" and acts only on a yes; "no", "ok" and "ready" are not covered |
| 4a (stop answered with a place in the same turn) | RISK | PASS | bullet 54 now only covers answers "that name no place" |
| 4a-ii ("Stopped." only) | PASS | PASS | same; "Stopped." no longer counts toward the three strikes (the rule now says "a place or a facing") |
| 8b (tool error) | PASS, 3 problems | PASS | retry with the same fields; visitor told to ask the organisers at registration; "hold position" only if a route was under way |
| N1 (three not accepted, reset after a step) | PASS | PASS | count resets on a step; hands over only after three in a row |
| N2 (Arabic happy path) | PASS | PASS | unchanged, arrival in Arabic |
| 11b ("done" before any route) | PASS | PASS | "Operator, no route yet." |
| "Done" after arrival | gap | fixed for the same trip, but NEW RISK | "already told the visitor they arrived" can also block a legitimate second trip |
| X2 "Done. I'm at the yellow pillar." (not in the list, checked because step 5 was restructured) | passed in the first run | RISK (new) | the "done" bullet has a MUST with current_id, the place bullet says send the place; the old word "instead" is gone |

### Transcripts

**11a case 2.** (Setup: kitchen route, first instruction "stop at the purple pillar" given.)
O: "Done."
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."
O: "Done."  (a repeat, separate turn, the agent has spoken in between)
[the sentence "If you hear done twice before you have spoken, count it as one" does not apply: I have spoken]
T> `{"destination_id":"kitchen","current_id":"sign_b","facing":"reception"}`
T< `{"status":"step","command":"Turn left. Walk straight and stop at the cafeteria menu boards.","next_id":"kitchen","expected_landmark":"the cafeteria menu boards","exit_pose":{"facing":"menu boards"},"remaining_steps":1,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, turn left. Walk straight and stop at the cafeteria menu boards."
Judge: FAIL, unchanged (robot still at the purple pillar). Two "done" heard before the agent speaks give one call, as the sentence says.

**N3.** (Setup: English visitor, kitchen route, first instruction "stop at the purple pillar" given, no question of mine open.)
O: "Left."
[bullet 56: a bare left that answers nothing is not done]
A: "Operator, are you at the purple pillar?"
O: "Yes."
[this answers my question and is a yes, so now it counts as done]
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."
Gap 1: O says "Yes." (meaning "understood") right after my first instruction, I ask "Operator, are you at the purple pillar?", O says "No, not yet." The prompt says "act only on a yes" and nothing about a no. No tool call, no rule for the words. A careful reader improvises; a small model may stay silent.
Gap 2: "left" as the answer to my facing question ("reception or team tables?") is an answer, so bullet 56 does not apply; the tool does not accept it:
T> `{"destination_id":"kitchen","current_landmark":"the yellow pillar","facing":"left"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","team tables"]}`
(it asks again and uses up one of the three tries). Also "ok" and "ready" are not on the list, although the team plan (`docs/WIN_PLAN.md`) lists them as normal operator replies, and a small model may read "ok" as "similar to done".
Judge: PASS for the case asked, with those gaps.

**4a.** (Setup: Arabic visitor, kitchen route, first instruction given.)
V: "لا لحظة، أبغى أروح طاولات الفرق بدال."
A: "Operator, stop. تمام، طاولات الفرق."
T> `{"destination_id":"team_tables"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`  [likely_start ignored]
A: "نغيّر الوجهة. Operator, once stopped, tell me what you see."
O: "Stopped. I'm between the black wall and the purple pillar."
[names a place, so bullet 54 (answers that name no place) does not apply; bullet 55 sends the place; no hold, no repeated question]
T> `{"destination_id":"team_tables","current_landmark":"between the black wall and the purple pillar"}`
T< `{"status":"needs_anchor","reason":"ambiguous_landmark","candidates":["the purple pillar","the pitch room door"]}`
A: "Operator, which is nearer: the purple pillar or the pitch room door?"
O: "The pitch room door, facing reception."
T> `{"destination_id":"team_tables","current_landmark":"the pitch room door","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"reception"},"remaining_steps":1,"destination_landmark":"the purple pillar"}`
A: "Operator, walk straight and stop at the purple pillar."
Judge: PASS. The round 1 conflict is gone.

**4a-ii.** (Same setup and first three agent lines.)
O: "Stopped."
[bullet 54: bare "stopped", no tool]
A: "Operator, hold position. Where is the robot, and what is it facing?"
O: "At the yellow pillar, facing reception."
T> `{"destination_id":"team_tables","current_landmark":"the yellow pillar","facing":"reception"}`
T< `{"status":"step","command":"Turn around. Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"pitch room"},"remaining_steps":1,"destination_landmark":"the purple pillar"}`
A: "Operator, turn around. Walk straight and stop at the purple pillar."
O: "Done."
T> `{"destination_id":"team_tables","current_id":"team_tables","facing":"pitch room"}`
T< `{"status":"at_destination","destination_id":"team_tables","expected_landmark":"the purple pillar","requires_physical_confirmation":true}`
A: "Operator, stop here. Can you confirm we're at the purple pillar?"
O: "Yes."
A: "وصلنا، هذي طاولات الفرق."
Judge: PASS.

**8b. Tool error.** I used a wrong route key, which gives the real handler's error answer with no "status".
(Setup: Arabic visitor, kitchen route, first instruction given.)
O: "Done."
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`  [sent with a wrong key]
T< HTTP 401 `{"error":"Invalid route key."}`
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`  [the one retry, exactly the same fields, wrong key again]
T< HTTP 401 `{"error":"Invalid route key."}`
A: "عذرًا، عندي مشكلة، اسأل المنظمين عند التسجيل. Operator, hold position."
[the visitor hears: sorry, I have a problem, ask the organisers at registration. No "not mapped".]
One-off error (same first call fails, the retry works):
T> same fields, good key
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."  [the error is never spoken; the exit pose was kept, so no wrong facing question]
First call of a trip fails twice (no route under way):
T> `{"destination_id":"kitchen"}` twice, both HTTP 401 `{"error":"Invalid route key."}`
A: "Sorry, I have a problem. Please ask the organisers at registration."  [no operator line]
Judge: PASS. All three round 1 problems are fixed.

**N1. Three not accepted, reset after a step.** (English visitor.)
V: "Take me to the kitchen please."
T> `{"destination_id":"kitchen"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
A: "Got it. Operator, we're going to the kitchen. Are we at the pitch room door, facing reception?"
O: "No, we're next to a red chair."  [not accepted 1]
T> `{"destination_id":"kitchen","current_landmark":"a red chair"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, I don't know that one. Are you at the pitch room door, the purple pillar, the yellow pillar or the cafeteria menu boards?"
O: "Next to the water cooler."  [not accepted 2]
T> `{"destination_id":"kitchen","current_landmark":"the water cooler"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, which place is the robot at: the pitch room door, the purple pillar, the yellow pillar or the cafeteria menu boards?"
O: "At the pitch room door, facing reception."
T> `{"destination_id":"kitchen","current_landmark":"the pitch room door","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"reception"},"remaining_steps":3,"destination_landmark":"the cafeteria menu boards"}`
A: "Let's go. Operator, walk straight and stop at the purple pillar."  [a step: count back to 0]
O: "I'm next to a glass door."  [not accepted 1 again]
T> `{"destination_id":"kitchen","current_landmark":"a glass door"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, I don't know that one. Are you at the pitch room door, the purple pillar, the yellow pillar or the cafeteria menu boards?"
O: "Near the lift."  [2]
T> `{"destination_id":"kitchen","current_landmark":"the lift"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, which place is the robot at: the pitch room door, the purple pillar, the yellow pillar or the cafeteria menu boards?"
O: "By the plants."  [3]
T> `{"destination_id":"kitchen","current_landmark":"the plants"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Sorry, please ask the organisers at registration for help. Operator, hold position. I can't match that place."
Judge: PASS. Five not-accepted answers in the whole trip, handover only after three in a row since the step. "Stopped." and "Done." do not count (they are not a place or a facing).

**N2. Happy path, Arabic visitor.**
V: "السلام عليكم، أبغى أروح الكافتيريا."
T> `{"destination_id":"kitchen"}`  T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
A: "تمام. Operator, we're going to the kitchen. Are we at the pitch room door, facing reception?"
O: "Yes."
T> `{"destination_id":"kitchen","current_landmark":"the pitch room door","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"reception"},"remaining_steps":3,"destination_landmark":"the cafeteria menu boards"}`
A: "يلا نمشي. Operator, walk straight and stop at the purple pillar."
O: "Done."
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."
O: "Done."
T> `{"destination_id":"kitchen","current_id":"sign_b","facing":"reception"}`
T< `{"status":"step","command":"Turn left. Walk straight and stop at the cafeteria menu boards.","next_id":"kitchen","expected_landmark":"the cafeteria menu boards","exit_pose":{"facing":"menu boards"},"remaining_steps":1,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, turn left. Walk straight and stop at the cafeteria menu boards."
O: "Done."
T> `{"destination_id":"kitchen","current_id":"kitchen","facing":"menu boards"}`
T< `{"status":"at_destination","destination_id":"kitchen","expected_landmark":"the cafeteria menu boards","requires_physical_confirmation":true}`
A: "Operator, stop here. Can you confirm we're at the cafeteria menu boards?"
O: "Confirmed."
A: "وصلنا، هذي الكافتيريا."
Judge: PASS. Identical to round 1; the restructure of step 5 did not change the happy path.

**11b and "done" after arrival.**
(a) O: "Done." (no destination yet) -> A: "Operator, no route yet." No tool call. PASS.
(b) O: "Done." (after I told the visitor they arrived) -> A: "Operator, no route yet." No tool call. PASS (the words are a bit odd, but safe).
(c) A second trip, same conversation:
V: "Now take me to the team tables."
T> `{"destination_id":"team_tables"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
A: "Got it. Operator, we're going to the team tables. Are we at the pitch room door, facing reception?"
O: "No, we're at the cafeteria menu boards, facing the menu boards."
T> `{"destination_id":"team_tables","current_landmark":"the cafeteria menu boards","facing":"menu boards"}`
T< `{"status":"step","command":"Turn around. Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"team tables"},"remaining_steps":2,"destination_landmark":"the purple pillar"}`
A: "Let's go. Operator, turn around. Walk straight and stop at the yellow pillar."
O: "Done."
[rule 16: "you have already told the visitor they arrived" is TRUE (trip 1 is still in the conversation). Read literally: A: "Operator, no route yet." and the robot never gets its next step. A careful reader scopes it to the current trip and calls:]
T> `{"destination_id":"team_tables","current_id":"sign_b","facing":"team tables"}`
T< `{"status":"step","command":"Turn right. Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"pitch room"},"remaining_steps":1,"destination_landmark":"the purple pillar"}`
Judge: (a) and (b) PASS; (c) RISK (new).

**X2. "Done. I'm at the yellow pillar." while heading for the purple pillar.**
Bullet 53 (done: MUST call with current_id = next_id) and bullet 55 (a named place: send only that place) both fire, and the old word "instead" is gone.
If "done" wins:
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."  (said to an operator who is already standing at the yellow pillar)
If the place wins (correct):
T> `{"destination_id":"kitchen","current_landmark":"the yellow pillar"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","team tables"]}`
then, with facing "reception": T< `{"status":"step","command":"Turn left. Walk straight and stop at the cafeteria menu boards.","next_id":"kitchen","expected_landmark":"the cafeteria menu boards","exit_pose":{"facing":"menu boards"},"remaining_steps":1,"destination_landmark":"the cafeteria menu boards"}`
Judge: RISK (new). A small model can take either.

### Still wrong or risky (worst first)

1. **"Done" and a place in the same sentence (X2).** New problem from the bullet split.
   CURRENT (bullet 53): `"done", "here" or similar: the robot is at that step's expected_landmark. You MUST call next_route_step again right away...`
   NEW: `"done", "here" or similar, and no place named: the robot is at that step's expected_landmark. You MUST call next_route_step again right away...`
   CURRENT (bullet 55): `A place the operator names: send only that place as current_landmark (facing separately).`
   NEW: `A place the operator names, even in the same sentence as "done": send only that place as current_landmark instead of current_id (facing separately).`

2. **"Already told the visitor they arrived" can block a second trip (11b c).**
   CURRENT (rule 16): `or you have already told the visitor they arrived,`
   NEW: `or the last trip has ended and nobody has asked for a new place since,`

3. **A repeated "done" after an instruction still skips a leg (11a case 2).** No wording fixes it without a question on every leg. Keep the sentence as it is, and tell operators to say "done" once, only when the robot has stopped at the place they were given. (Option, untested and not recommended: start every next instruction with "from <the place just reached>", which lets the operator catch a wrong "done" but makes every instruction longer.)

4. **Yes/no/ok words (N3).** Add handling for "no" and the words the team plan already expects.
   CURRENT (bullet 56): `A bare "yes", "no", "left" or "right" that does not answer your last question is not "done": ask once "Operator, are you at <expected_landmark>?" and act only on a yes.`
   NEW: `A bare "yes", "no", "ok", "ready", "left" or "right" that does not answer your last question is not "done": ask once "Operator, are you at <expected_landmark>?" and act only on a yes. On a no, ask "Operator, where is the robot?"`
   CURRENT (rule 19): `Short replies are never noise: "done", "yes", "no", "stop", "wait", "left", "right", "نعم".`
   NEW: `Short replies are never noise: "done", "yes", "no", "ok", "ready", "stop", "wait", "left", "right", "نعم".`

5. **"Left" or "right" as the answer to a facing question is thrown away by the tool.** The prompt gives no way to use it (the tool only knows named facings such as "reception"), so the agent asks again and the answer uses up one of the three tries.
   CURRENT (needs_anchor / current_orientation_required line): `If the operator instead names what is straight ahead of the robot, send their words as facing.`
   NEW: `If the operator instead names what is straight ahead of the robot, send their words as facing. "Left" or "right" is not a facing: ask them to name what is straight ahead.`

Nothing else new found. The prompt is now 2783 words, 16 percent longer than the original; step 5 is easier to read as bullets even though it is 226 words.

### Not tested in round 2
The live model, speech and noise, the audio bridge, the Hindi/Urdu flow, Camera notes (the new "only together with a position" line was only read), and research_fact. The tool error is a wrong-key 401 standing in for a real error. Only the scenarios named in the round 2 request were replayed, plus the second trip after an arrival and X2, because step 5 was restructured.

## Update 3 (applied after Update 2, NOT re-played)
Four of the five items from "Still wrong or risky" in Update 2 were applied to `agent/system-prompt.txt` as written, with no new replay: (1) the "done" bullet now says "with no place named" and the place bullet says "even in the same sentence as done ... instead of current_id"; (2) rule 16 now says "or the last trip has ended and nobody has asked for a new place since"; (4) "ok" and "ready" were added to the bare-reply bullet and to the never-noise list, and "on a no, ask where the robot is"; (5) "'Left' or 'right' is not a facing: ask them to name what is straight ahead" was added. Item 3 (a repeated "done" after an instruction) cannot be fixed with wording: tell the MangoBot operator to say "done" once, only when stopped at the place given (see `agent/SETTINGS_CHECKLIST.md`). These four edits are unchecked by any role-play: the first live check with the real model is the test.
