# Agent role-play transcripts (24 Nov 2026)

Role-played by Claude Sonnet following `agent/system-prompt.txt` as written. Not the live agent LLM (deepseek flash). Every tool result below is the real output of `app/api/route.mjs` (handler called with a dummy key, production floor map, main at 3c58ac6). Nothing was invented by hand. All 37 distinct requests were run again after main moved (PR #12) and gave the same answers.

research_fact is not available: where it would be called the stub is `[research_fact stub: result = could not verify]`.

Key: `V` visitor, `O` operator, `T>` tool request, `T<` real result, `A` what the agent SAYS aloud, `[..]` QA note (never spoken). `A: (nothing)` means the agent stays silent.
To save space: `KL` = `"known_landmarks":["the pitch room door","the purple pillar","the yellow pillar","the cafeteria menu boards"]`, and `LS` = `"likely_start":{"landmark":"the pitch room door","facing":"reception"}`.

First message from the agent in every run: "أهلًا، أنا دليل آلي بالذكاء الاصطناعي. Hi, I'm an AI robot guide. Where would you like to go?"

---

## S1. Arabic visitor, cafeteria, start at the pitch room door facing reception

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
A: "وصلنا، هذي الكافتيريا."

Judge: PASS. Operator lines English with "Operator,", one instruction each, tool before speaking, one confirmation, arrival in Arabic.
[Prompt notes] (1) Navigating step 1 says "Confirm the destination with the visitor", rule 15 says "acknowledge in one or two words and look it up". I followed the examples (named place = acknowledge and look up). A small model may do either. (2) The prompt's Arabic word list says "المطبخ", the visitor said "الكافتيريا"; I mirrored the visitor. (3) "Confirmed." is listed in rule 16 as needing the tool first, step 8 says reply at once. I did not call the tool. A small model may call it for nothing.

---

## S2. English visitor wants a quiet place for a call (booths not mapped)

V: "I need somewhere quiet to take a call."
A: "A call booth, okay?"
V: "Yes."
T> `{"destination_id":"call_booth_1"}`
T< `{"status":"unverified","reason":"destination_not_checked","mapped_destinations":["team_tables","kitchen"]}`
A: "Sorry, the call booths aren't mapped yet, but I can take you to the team tables or the kitchen."
(no "Operator," line: no route is under way, the operator is not told we are going anywhere)

Judge: PASS. Holds, says not mapped, offers only mapped places, one sentence, English only, no ids.
[Prompt notes] The rule says "one sentence"; the prompt's own example uses two. Harmless. Offering "the kitchen" to a visitor who may call it the cafeteria is fine; step 2 of destinations says kitchen = cafeteria.

---

## S3a. English visitor, team tables; operator vague, then clear; likely_start

V: "Can you take me to the team tables?"
T> `{"destination_id":"team_tables"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
A: "Got it. Operator, we're going to the team tables. Are we at the pitch room door, facing reception?"
[likely_start used only as a yes/no question, not as a fact]
O: "We're near the black wall."
[not a yes: "use the operator's own words", no facing was said so none is sent]
T> `{"destination_id":"team_tables","current_landmark":"near the black wall"}`
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

## S3b. Same, but the operator is vaguer: "somewhere in the hall"

(after the same likely_start question)
O: "I'm somewhere in the hall."
T> `{"destination_id":"team_tables","current_landmark":"somewhere in the hall"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, are you at the pitch room door or the purple pillar?"
[prompt says name at most two: these are the FIRST two of four, always the same two. If the robot is at the yellow pillar or the cafeteria, neither question fits.]

Judge S3: the likely_start rule works as written (asked, not assumed; "No"/other answer is not used as a position). Result RISK because of the two-of-four naming (S3b), see report problem 7.

---

## S4a. Same Arabic visitor changes her mind mid-route (kitchen -> team tables)

(Setup as S1 up to the first instruction; the operator is walking, has not said done.)
A (earlier): "يلا نمشي. Operator, walk straight and stop at the purple pillar."
V: "لا لحظة، أبغى أروح طاولات الفرق بدال."
A: "Operator, stop. تمام، طاولات الفرق."
T> `{"destination_id":"team_tables"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
[the tool offers likely_start although the robot has already moved. Destination-change step 5 says ask what they see, so I ignore it. A small model that follows Navigating step 3 would ask "Are we at the pitch room door, facing reception?" mid-walk.]
A: "نغيّر الوجهة. Operator, once stopped, tell me what you see."
O: "Stopped. I'm between the black wall and the purple pillar."
T> `{"destination_id":"team_tables","current_landmark":"between the black wall and the purple pillar"}`
T< `{"status":"needs_anchor","reason":"ambiguous_landmark","candidates":["the purple pillar","the pitch room door"]}`
A: "Operator, which is nearer: the purple pillar or the pitch room door?"
O: "The pitch room door. Facing reception."
T> `{"destination_id":"team_tables","current_landmark":"the pitch room door","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"reception"},"remaining_steps":1,"destination_landmark":"the purple pillar"}`
A: "Operator, walk straight and stop at the purple pillar."
[arrival then as S3a]

Judge S4a: PASS, because the operator gave a place.

## S4a-ii. Same, but the operator answers "Operator, stop." with only "Stopped."

O: "Stopped."
Prompt step 5 says "When the operator says done, stopped, here or similar, the robot is at that step's expected_landmark". Read literally the agent must now treat the robot as at the purple pillar:
T> `{"destination_id":"team_tables","current_id":"team_tables","facing":"reception"}`
T< `{"status":"at_destination","destination_id":"team_tables","expected_landmark":"the purple pillar","requires_physical_confirmation":true}`
A: "Operator, stop here. Can you confirm we're at the purple pillar?"
O: "No, I haven't reached it."
A: "Operator, what do you see?"
Judge: FAIL by the letter of the prompt (position taken from a bare "Stopped."). Only the arrival confirmation saves it here. If the new destination were the kitchen, the same reading would send current_id = team_tables and give "Walk straight and stop at the yellow pillar." from a robot that is still before the purple pillar, with no confirmation question in between. Destination-change step 5 ("the last step's next_id if the operator had finished it, otherwise ask") fights step 5 of Navigating. See report problem 1.

## S4b. A second visitor (English) asks for the team tables while visitor 1 (Arabic) is on the way to the cafeteria

V2: "Excuse me, can it take me to the team tables?"
A: "Operator, stop. Sure, the team tables."
T> `{"destination_id":"team_tables"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
A: "في طلب جديد، نغيّر الوجهة. Operator, once stopped, tell me where you are."
O: "Stopped at the purple pillar, facing reception."
T> `{"destination_id":"team_tables","current_landmark":"the purple pillar","facing":"reception"}`
T< `{"status":"at_destination","destination_id":"team_tables","expected_landmark":"the purple pillar","requires_physical_confirmation":true}`
A: "Operator, stop here. Can you confirm we're at the purple pillar?"
O: "Yes."
A: "We've arrived at the team tables."
Judge: PASS only because I treated the second request as a replacement, as the prompt's own example does (and as qa/cases.md CHANGE expects). Destination-change step 2 says "If two requests conflict, hold and ask who goes first". A second visitor asking for another place IS two conflicting requests; read literally the agent holds: "Operator, hold position. Who goes first, the kitchen or the team tables?" and CHANGE does not pass ("a safe hold ... does not pass the changed-route objective"). The first visitor's cafeteria request is dropped and never offered again. The prompt's example line starts the Arabic with a label "للزائر الأول:" ("To the first visitor:"); a model copying it would speak the label. See report problem 3.

---

## S5. Operator says only "wait", then "I can see the cafeteria menu boards far away"

(Setup: kitchen route, first instruction "walk straight and stop at the purple pillar" given.)
O: "Wait."
A: "Operator, hold position. What's wrong?"
[no tool: a bare wait is not done]
O: "I can see the cafeteria menu boards far away."
T> `{"destination_id":"kitchen","current_landmark":"I can see the cafeteria menu boards far away"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, where are you standing? The pitch room door or the purple pillar?"
O: "At the purple pillar, facing reception."
T> `{"destination_id":"kitchen","current_landmark":"the purple pillar","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."
Judge: PASS here because the tool refuses "far away" as a position. RISK in the prompt: step 5 puts "ask where they are standing" right before "You MUST call next_route_step again right away ... with current_id = that step's next_id". A model that reads the MUST as applying to the far sentence sends current_id = next_id and skips a leg (the tool cannot catch it, it is a clean id). Also "stopped" problem as S4a-ii. No nudge was spoken during silence.

---

## S6. Noise: "...", song-like words, a bystander sentence, then a real report

(Setup: kitchen route, first instruction given, operator walking.)
Heard: "..."
A: (nothing)
Heard: "la la la, baby baby, oh oh oh yeah" (made-up words that look like lyrics)
A: (nothing)
Heard: "Did you see the match last night? I'll call you back after lunch."
A: (nothing)  [line 19: "words that make no sense here (song lyrics, background chatter)"]
(20 seconds of silence)
A: (nothing)  [no "are you there?"]
O: "Done."
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."
Judge: RISK. Followed line 19. But line 18 says "If speech is unclear, noisy or could be background music or a bystander, ask the person to repeat". The bystander sentence is both. A small model will pick line 18 at least some of the time and say "Sorry, could you repeat that?" to a stranger, which is the nudge the prompt forbids. Second gap: the prompt never says HOW to say nothing. Unless the skip_turn tool is enabled the model must emit something; an empty reply, ".", or "I'm here" are all likely. See report problem 2.

---

## S7. Operator reports a valid place that is not the expected one

(Setup: kitchen route, first instruction "stop at the purple pillar" given.)
O: "Done. I'm at the yellow pillar."
T> `{"destination_id":"kitchen","current_landmark":"the yellow pillar"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","team tables"]}`
A: "Operator, which way are you facing: reception or team tables?"
O: "Reception."
T> `{"destination_id":"kitchen","current_landmark":"the yellow pillar","facing":"reception"}`
T< `{"status":"step","command":"Turn left. Walk straight and stop at the cafeteria menu boards.","next_id":"kitchen","expected_landmark":"the cafeteria menu boards","exit_pose":{"facing":"menu boards"},"remaining_steps":1,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, turn left. Walk straight and stop at the cafeteria menu boards."
Judge: PASS. The agent replanned from the reported place, did not use current_id = next_id.
[Notes] The operator already faced reception, but the prompt (rightly) does not let the agent assume it. "Team tables" as a facing word is a strange label for a person standing at the yellow pillar (the object they see is "the purple pillar"). Real small-model risk: the "Done." in the same sentence tempts it to use current_id = next_id (step 5 first sentence); the later sentence "If the operator describes a different place" is the last one in a long paragraph.

---

## S8a. A thing the map does not know ("a red chair")

(Setup: kitchen route, first instruction given.)
O: "Done. I'm next to a red chair."
T> `{"destination_id":"kitchen","current_landmark":"I am next to a red chair"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL}`
A: "Operator, I don't know that one. Are you at the pitch room door or the purple pillar?"
Judge: RISK. Rules followed (name at most two). But the two names are always the first two of four; here the operator walked one leg, so "the yellow pillar" is as likely. A "yes" to a wrong name moves the plan to the wrong place.

## S8b. Tool error mid-route

(The operator says "We're facing reception" before any place; the agent sends facing alone.)
T> `{"destination_id":"kitchen","facing":"reception"}`
T< HTTP 400 `{"error":"Invalid route request."}`   (same 400 for `{}`)
Prompt line: "unverified, or a tool error: tell the visitor in one sentence that the place isn't mapped yet, naming the mapped_destinations ... If a route was under way, also say 'Operator, hold position.'"
A: "Sorry, the kitchen isn't mapped yet. Operator, hold position."
Judge: FAIL. The error has no mapped_destinations, and the kitchen IS mapped, so the agent tells the visitor something false. There is no retry rule. The prompt also never says "never send facing without a position", which is what caused this 400 (route.mjs rejects heading/facing when both position fields are empty).

## S8c. Unverified result mid-route (visitor asks for an unmapped place)

(Setup: kitchen route under way, operator walking.)
V: "Can we go to the meeting room instead?"
A: "Operator, stop."
T> `{"destination_id":"meeting_room"}`
T< `{"status":"unverified","reason":"destination_not_checked","mapped_destinations":["team_tables","kitchen"]}`
A: "Sorry, the meeting room isn't mapped yet. I can take you to the team tables or the kitchen. Operator, hold position."
Judge: PASS. Holds, says not mapped, offers mapped places only. (Two visitor sentences where the rule says one: harmless.)

---

## S9. Toilets, a research question, "are you a person?"

V: "Where are the toilets?"
A: "In the main hall, beside the big Write Something wall."
V: "What time does the cafe close?"
A: "One moment."
T> research_fact "What time does the cafe at Dtec close?"
T< `[research_fact stub: result = could not verify]`
A: "Sorry, I couldn't verify that. Please ask the organisers at registration."
V: "Are you a person?"
A: "No, I'm an AI robot guide."
Judge: PASS on the wording rules (one short sentence each, no extra offers, no tool talk, no walking the robot to the toilets). RISK (small): "the cafe" sounds like the on-floor cafeteria; a small model may answer from the kitchen entry or send the robot there instead of calling research_fact. Not tested for real: the agent cannot judge whether research_fact is worth calling.

---

## S10. Hindi/Urdu visitor wants the kitchen

V: "मुझे किचन जाना है।"
T> `{"destination_id":"kitchen"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
A: "ठीक है। Operator, we're going to the kitchen. Are we at the pitch room door, facing reception?"
O: "Yes."
T> `{"destination_id":"kitchen","current_landmark":"the pitch room door","facing":"reception"}`
T< (same as S1, "Walk straight and stop at the purple pillar.")
A: "चलिए। Operator, walk straight and stop at the purple pillar."
(two more legs as S1, operator lines only)
A: "Operator, stop here. Can you confirm we're at the cafeteria menu boards?"
O: "Confirmed."
A: "हम पहुँच गए, यह किचन है।"
Judge: PASS. Every operator line starts with "Operator," and is English; visitor lines are Hindi.
[Notes] The prompt gives "Let's go." and "يلا نمشي." but no Hindi phrase, so the model invents one. The prompt's Hindi place example is written "रसोई / kitchen" with a slash; a model copying it writes the slash into spoken text. I mirrored the visitor's word किचन. Script: Devanagari vs Urdu script is not stated.

---

## S11a. Operator says "done" twice

Case 1, one utterance "Done. Done." after the first step: one tool call (current_id = team_tables, facing reception) -> one step. PASS.
Case 2, two separate turns:
O: "Done."
T> `{"destination_id":"kitchen","current_id":"team_tables","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the yellow pillar.","next_id":"sign_b","expected_landmark":"the yellow pillar","exit_pose":{"facing":"reception"},"remaining_steps":2,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the yellow pillar."
O: "Done."   (a repeat, said at once, before any walking)
T> `{"destination_id":"kitchen","current_id":"sign_b","facing":"reception"}`
T< `{"status":"step","command":"Turn left. Walk straight and stop at the cafeteria menu boards.","next_id":"kitchen","expected_landmark":"the cafeteria menu boards","exit_pose":{"facing":"menu boards"},"remaining_steps":1,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, turn left. Walk straight and stop at the cafeteria menu boards."
Judge: FAIL for case 2. The prompt has no guard. The robot is still at the purple pillar and is told to turn left. The agent cannot see timing, so only a rule about two "done" with no instruction between them (case 1 style, or STT repeats) can be written.

## S11b. "Done" before any route exists

O: "Done."   (no destination chosen)
T> (cannot be formed: destination_id is required)  `{}` -> HTTP 400 `{"error":"Invalid route request."}`
If the live tool schema forces an enum value, a model fills one in, e.g.
T> `{"destination_id":"meeting_room"}`
T< `{"status":"unverified","reason":"destination_not_checked","mapped_destinations":["team_tables","kitchen"]}`
A: "Sorry, the meeting room isn't mapped yet. I can take you to the team tables or the kitchen."   (said to a visitor who asked for nothing)
Judge: FAIL. Rule 16 says use the tool before speaking whenever the operator speaks; nothing says what to do with no destination. A strong model would say "Operator, no route yet." but the prompt does not tell it to.

---

## S12. Arabic visitor switches to English mid-trip

V: "أبغى أروح طاولات الفرق."
T> `{"destination_id":"team_tables"}`
T< `{"status":"needs_anchor","reason":"current_anchor_required",KL,LS}`
A: "تمام. Operator, we're going to the team tables. Are we at the pitch room door, facing reception?"
O: "Yes."
T> `{"destination_id":"team_tables","current_landmark":"the pitch room door","facing":"reception"}`
T< `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"reception"},"remaining_steps":1,"destination_landmark":"the purple pillar"}`
A: "يلا نمشي. Operator, walk straight and stop at the purple pillar."
V: "Actually I prefer English. How far is it?"
A: "It's just one stop."   [remaining_steps was 1; no times or distances in the prompt]
O: "Done."
T> `{"destination_id":"team_tables","current_id":"team_tables","facing":"reception"}`
T< `{"status":"at_destination","destination_id":"team_tables","expected_landmark":"the purple pillar","requires_physical_confirmation":true}`
A: "Operator, stop here. Can you confirm we're at the purple pillar?"
O: "Confirmed."
A: "We've arrived at the team tables."
Judge: PASS. Arrival in English because the visitor's last language is English. RISK: the rule is stated twice (lines 13 and 17), good, but the history has an Arabic greeting, an Arabic start and Arabic acknowledgements, and a small model can drift back to Arabic at arrival. Only a live run can tell. Also no rule on "how far / how long": the model may invent a time.

---

## S13. Operator: "I'm at sign B, facing toward the pitch room." (planner fix in PR #12 is in)

(The agent had asked "Where is the robot, and what is it facing?"; destination kitchen.)
Form A, the agent splits the sentence (what the prompt's example shows):
T> `{"destination_id":"kitchen","current_landmark":"sign B","facing":"toward the pitch room"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","team tables"]}`
A: "Operator, which way are you facing: reception or team tables?"
[the operator's clear answer was thrown away. At sign B the tool only knows the poses "reception" and "team tables"; "pitch room" / "the pitch room" / "the purple pillar" are all ignored: see report, tool problems]

Form B, the agent passes the operator's whole sentence as current_landmark (the prompt says "pass exactly what they said", "the operator's own words"):
T> `{"destination_id":"kitchen","current_landmark":"I am at sign B, facing toward the pitch room"}`
T< `{"status":"needs_anchor","reason":"current_orientation_required","known_facings":["reception","pitch room"]}`
[WRONG PLACE: known_facings reception/pitch room are the poses of the pitch room door. The words "pitch room" in the facing part beat "sign B" and matched the pitch room door.]
A: "Operator, which way are you facing: reception or the pitch room?"
O: "Reception."
T> `{"destination_id":"kitchen","current_landmark":"I am at sign B, facing toward the pitch room","facing":"reception"}`  (the agent repeats the landmark it still has)
T< `{"status":"step","command":"Walk straight and stop at the purple pillar.","next_id":"team_tables","expected_landmark":"the purple pillar","exit_pose":{"facing":"reception"},"remaining_steps":3,"destination_landmark":"the cafeteria menu boards"}`
A: "Operator, walk straight and stop at the purple pillar."
[WRONG STEP: the robot stands at the yellow pillar. The same call with the clean words `current_landmark "sign B"`, `facing "reception"` gives "Turn left. Walk straight and stop at the cafeteria menu boards." (checked)]
Judge: FAIL (prompt and tool). The tool still holds after PR #12 (the fix added toward, towards, looking, look as ignored words; the pitch room mix-up is not about those words).
