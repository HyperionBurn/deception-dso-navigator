> Team copy of the plan Hussain follows (written 24 Nov 2026, checked by four independent reviewers, approved by Hussain). Read "Bottom line and next 3 hours" first, then section 4.11 (build order). The evidence files this plan cites (research notes, organiser PDFs, audit reports) are in Hussain's local folder, not in this repo, so ask him for any tag you cannot find. Changes to the plan go through a pull request, like code. The robot PC1 address was removed from this copy on purpose.

# Win Navigator: guide the operator, never guess, prove it

Written Tue 24 Nov 2026 by Claude account B (draft about 15:45 Dubai time, checker fixes applied about 16:00), from the notes of account A and the organiser documents. Status: DRAFT v2. Four independent checkers went through it and their fixes are in (section 10). Hussain has not approved it yet. Do not build until he says go. For the new "blind navigation" brief only. The old report (stationary robot) is outdated and was renamed OLD.

How to read the tags: [Guide] = organiser Team Guide v2. [Update] = organiser Team Guide Update (~15:00). [Kickoff] = ElevenLabs kickoff slides. [Nucleus] = Nucleus slides. [brief] = `00_HACKATHON_BRIEF.md`. Note names like [nav_protocol s3] = a file in `research_notes/Oasis Navigator hackathon win plan/`. [inference] = our own reasoning, not a fact. UNKNOWN = nobody has checked it. [W.. / D..] = a row in `audit_winners_business_claims.md`. A page tag like [Guide p4] = the page number in that organiser file.

---

## Bottom line and next 3 hours

**What wins.** 65% of the score is the product working and sounding right: working demo 25%, technical quality and ElevenLabs depth 20%, voice experience 20% [Guide p9]. Pitch is 10% and investment 10%. So we win by making three routes work every time on the real floor, in two languages, with an operator who does exactly what we say, and by showing the three things the Nucleus CTO's closing slide asks to see: when it mishears, when it is interrupted, when the network drops [Nucleus p10]. He is one of the six judges.

**The hard part is position.** The brief calls "knowing where the robot is" the hard part and allows any method [Update p3]. Our answer: a measured map of the floor, a plain-Python route planner behind the agent (the language model never counts steps or does turn math), short one-action instructions, a fixed set of reply words for the operator, and a re-plan from where the robot stands when the destination changes. Sensors (camera markers, lidar position) are a stretch we decide on in the first 10 minutes of the first robot slot. [inference, built on nav_protocol s1-s3 and sensing s7]

**Only 3 rivals** (Navigator solos team, Hercules, The Ghost Protocol) [brief]. The Update says teams were reshuffled and "fewer teams" [Update p1, p6], so check the new list. Rivals also use frontier AI tools, so general advice will not separate us. What separates us is evidence: a measured floor, many timed drills with a teammate as operator, numbers, and a calm failure demo. [inference]

**Do these in the next 3 hours** (the clock is about 15:45; the first robot slot is unconfirmed):
1. Walk the floor and measure it. Make the map file (places, corridors, steps, one visible landmark per stop, big signs). We are at the venue; rivals' notes cannot do this.
2. Ask organisers the blocking questions in section 8: slots and deadline, how the operator drives, whether the operator can speak to the agent, may a second screen be in the video, how loud the music is and where its speaker stands. (Own markers and asking people nearby are already allowed [Update p2, p3], and the organisers bring the music and the new destination [Update p3].) The ElevenLabs mentors sit at our table until 17:00 today (one is also a judge) [Guide p4; Kickoff p11]: use them for the language-detection question, handover on a robot session, guardrails and the Arabic voice. The 17:00 checkpoint wants one sentence on our demo [Guide p2].
3. Split into five roles (section 5). The shared repo already exists (`HyperionBurn/deception-dso-navigator`, Wasif's prototype; section 11). Give each developer their own ElevenLabs agent copy so nobody overwrites the others.
4. Redeem the NEW ElevenLabs codes from the update email. Run the tests: T1 language switching (5 min, needs our Arabic speaker), T2 voices (10 min), T3 place-name recognition (5 min), T4 silence nudge (10 min, section 4.3). Details in section 4.6.
5. Turn the prototype planner (`blind_navigation_nav_proto.py`) into a tested library and put the real map in it.
6. Get a first agent working in the browser with the planner tools, then do the first teammate-as-operator walk before the first robot slot.
7. One teammate speaks Gulf Arabic (Hussain told us on 24 Nov). They check every Arabic line, run T1 and play the Arabic visitor in drills. They cannot be the operator in the same drill, so plan another person for that.

---

## 1. What the brief, the rules and the judges' slides ask

### The new job
A MangoBot operator walks the robot. He does not know where the visitor wants to go and does not speak the visitor's language. Our agent is the only one who knows the way. Flow: the visitor asks (own language, ideally Arabic) for a place on this floor; the agent plans and asks if unclear; it tells the operator step by step in English; the operator follows exactly, even when wrong; the agent calls the stop and tells the visitor in their language that they arrived [Update p2]. The floor has a meeting room, a conference room, four call booths, team tables, and a kitchen with tables and food. The organisers put up no markers [Update p2].

### Must have, and how we meet it

| Must have [Update p2] | How we meet it | How we prove it |
|---|---|---|
| 2+ languages in every route (3 better, with Arabic) | Arabic + English everywhere; Hindi only if a teammate tests it | Each filmed route uses both languages |
| Translation visitor <-> operator | One agent; operator lines English only, visitor lines in their language | Second screen shows both lines side by side |
| Directions the operator can follow step by step | One action per instruction, stop cue the operator can see, fixed reply words | Drill score sheet: instructions per route, confusions |
| Clarifying question when vague | One question that splits the candidates, guess said first | Scenario S02, S03 |
| Clear stop, arrival told to visitor | "Operator, stop here..." then arrival line in visitor language | Every drill |
| New route when destination changes | Stop first, fix position, re-plan, tell both people | Sweep test over every position and place; scenario S06 |

Stretch [Update p2]: robot knows where it is without asking; lidar or camera confirms arrival; visitor switches language mid-route.

### Rules every agent must follow [Guide p3-5, Update p1]
Built on ElevenLabs Agents. People talk to it and it answers out loud in real time. English and Arabic. It says it is an AI and says when it does not know (made-up answers cost points). Made-up facts must be marked as demo data. MangoBot controls all movement [Guide p3]; we write no movement code and never leave this floor [Update p2]. Robot teams run code only in the MangoBot container, never on PC1; no more than 2 ROS nodes per second; save only under /home/agi [Guide p5]. Keep API keys out of code and repos [Guide p4]. Say in the submission what starter kit we started from [brief s3; not in the Guide, origin unverified, maybe an organiser email; keep the rule]. If you miss your robot slot, it is gone [Guide p3].

### Scoring and time
Judges score 1-5, weighted: working demo 25, technical quality and ElevenLabs use 20, voice experience 20 (natural, fast, multilingual, hands over to a human), challenge fit and business feasibility 15, pitch 10, investment feasibility 10 [Guide p9]. Each team gets 8 minutes: 3 pitch, 3 demo, 2 questions; robot teams play their robot video as the demo [Update p6]. Submit one form: project link, 100 words, demo video, up to 3 slides; late is not judged [Update p6]. The old times (Round 1 Tue 18:00, Round 2 Wed 07:30, freeze 08:30, pitch 09:34) are NOT confirmed after the reshuffle [Update p1, p6]. We plan in T (our first robot slot) and F (freeze), and use 18:00 and 08:30 only as working guesses. There is also a separate "Best ElevenLabs build" prize [Guide p4]; winners rehearse Wed 11:00 and go on the main stage at 13:00 [Guide p2]. The old rule "robot teams add one unedited take, max 2 min" [Guide p9] is not repeated in the Update: ask (question 5).

### What the judges' slides tell us
The Nucleus slides are written by one of the six judges, so we read them as the closest thing to his scoring sheet [inference]. The Kickoff slides are ElevenLabs setup coaching and are still worth following. We turn each line into something we build or show.

| Line from the slides | What we do |
|---|---|
| One multilingual model; avoid two agents and a language switch [Nucleus p3] | One agent. Keep the visitor's language in state, not in a language switch. |
| Let it be interrupted by the person, not by the noise [Nucleus p4] | Keep barge-in. Do not rely on HALF_DUPLEX alone (it kills barge-in). Test with music. |
| Greet the person who steps up; signal "I heard you"; stop when they speak [Nucleus p6] | Short earcon on end of speech; greeting on first speech; stop on interruption. |
| Fast, then precise [Nucleus p7] | Echo the request first ("The kitchen, right?"), details after. Measure the gap from end of speech to first audio [Kickoff p8]. Target 1-2 s from speech in to speech out [Nucleus p7]. |
| Not sure? Hand over, then learn [Nucleus p8] | Handover tool + a log; the human's answer goes into the place table; replay shows no handover. |
| Voice that fits a robot body; never pretend to be human [Nucleus p9] | Calm steady voice, "I am an AI guide" in the first line, no laughs or sighs. |
| Show me: when it mishears, when it is interrupted, when the network drops [Nucleus p10] | We build and film all three (section 6). |
| Plan the intents; lean prompt; rules in prompt, facts in knowledge, live data in tools; one checkable success test first [Kickoff p4] | Five to eight intents (our choice, inside the Kickoff range); prompt under ~2,000 tokens; map and state in tools; first test = "easy route arrives". |
| Test with crowd noise on the real speaker and mic; change one setting at a time [Kickoff p8] | Noise protocol in section 4.7. |

---

## 2. What past winners did (only the audited, safe lessons)

Account A's research found no winning humanoid guide or concierge, so these are lessons about demos in general. Ranks and quotes below were re-checked against the pages by the audit [audit_winners]. We do not repeat anything the audit marked wrong.

- **A working demo is the biggest swing.** One judge who scored three events wrote it was "the single largest score differentiator"; another wrote that a strong project with a confusing demo loses to a simpler one the judges understand [audit_winners W40, W45]. That matches our 25% criterion.
- **Wifi fails at most events this judge judged** [W40]. A robotics engineer's demo checklist: make the demo work three times in a row, be paranoid about wifi, swap robots instead of debugging during a demo, use a "talker and a fixer" [W33]. We build the offline fallback and rehearse three clean runs in a row.
- **ElevenLabs depth is scored here** (20%, criterion 2 in the brief). [inference] At the Penn hackathon (12 Apr 2026) 34 of 41 teams used ElevenLabs, and "Best use of ElevenLabs" went to a project that hands a patient to a human with context [W13, W14]. So our handover story is worth building and showing. [inference]
- **Robot hackathon teams showed visible signals and small steps.** One 2nd-place team's judges praised breaking the task into sub-steps and a glowing-eye cue [W26]; one self-reported write-up (a voice-guided arm, no placement found) found a 10-second listening window worked better, a microphone that is off while the robot moves, and an operator who confirms the result [W31]. These support our short instructions, closed reply words and visible "I heard you".
- **Natural pauses can beat polish.** At one ElevenLabs event, a polished voice made phone recipients hang up while pauses and a mild accent kept them talking (one attendee's view) [W7]. We keep the voice calm and clear, not overly smooth.
- **GibberLink won the global prize at ElevenLabs' own worldwide hackathon (Feb 2025)** [W1]. We can mention it as a reminder that one memorable moment can win [inference]; our moment is the mid-route destination change.
- **Do not say** any ranking for a city event (the official post gives none; the SF ranks come from PostHog), anything about "what ElevenLabs judges reward", or any quote that is really a blog author's words [audit_winners (iii)].

---

## 3. The edge: do the work an AI chat cannot do, and show proof

Every rival can ask a frontier model for a plan. None can ask it to walk the Dtec floor. [inference] The edge is evidence from the real room, not clever ideas.

| # | Edge | Why rivals likely will not do it | Where it shows |
|---|---|---|---|
| a | Walk and measure the floor in hour 1; keep a measured map and photos at robot eye height | Costs real time away from the keyboard; the floor is only known to teams on site | Second screen map; pitch line "we measured it" |
| b | Teammate-as-operator drills, many times, with a score sheet | Boring; needs three people at once | Pass counts and instructions-per-route on a slide |
| c | Rehearse the surprise destination with random picks, plus a sweep test of every position x every place | Most will test one hand-picked change | Route 3 in the video |
| d | Test with loud music and crowd noise on the actual robot speaker and mic | Needs robot time; most test in a quiet corner (Nucleus names this trap) | Route 2; latency and false-turn numbers |
| e | Show the failure trio on purpose: mishear then recovery, interruption, network drop with local fallback | Teams hide failures | Pitch and video |
| f | Native-speaker review of the Arabic (one teammate speaks Gulf Arabic) | Easy to skip | Voice score; Q&A answer |
| g | Measured numbers: latency p50/p90, test pass rate, route success | Needs logging from day one | One slide, one caption per route |
| h | Second screen: map, position dot, exact words, languages, handover log | Extra work; we expect judges can follow the reasoning [inference] | Video if organisers allow it; live only if they allow it |
| i | Honest unknowns: asks, hands over, never guesses | Rivals bluff | Rule line "made-up answers cost points" |

**Do not build** (this stalls us): talking avatar, phone line, web-research service, cloud vision as the first position source, anything that moves the robot (out of scope [Update p2]). [inference from brief s9 and sensing s5]

---

## 4. What to build

### 4.1 The shape of the system

```
Visitor (any language) + Operator (English replies) + bystanders
        |  speak
   robot mic -> BRIDGE (on PC2, one long-lived process)
        |   session core (plain Python): ElevenLabs WebSocket, gating, metrics, fallback phrases
        |   ROS audio adapter (organisers' code, kept close to the original)
        |   laptop audio adapter (same core, so all five can test without the robot)
        v
   ELEVENLABS AGENT (one agent): Scribe v3 Live -> LLM -> v4 Turbo voice, PCM 16 kHz in and out
        |  tool calls
        v
   NAV SERVER (small FastAPI): map JSON, state per session, planner, handover log, second-screen feed
        |
   robot speaker <- bridge        second screen (laptop) <- server events
```
The bridge moves audio only; knowledge, tools and Arabic live in the agent [Guide p5]. Movement stays with MangoBot.

### 4.2 The navigation backend (the part rivals will not have)
Design is in [nav_protocol s1-s6]. The prototype `blind_navigation_nav_proto.py` has the map format, planner, position update and mid-route re-plan. Account A ran it and account B re-ran it on 24 Nov: 5 hand-written checks pass and all 1,168 position x direction x place combinations on the demo map reach the destination [nav_protocol s3]. That proves the planner only, not the floor: the sweep sets the robot's state directly, so it does not test the landmark-report path, other headings at a node, our wording, or operator mistakes. It uses demo data. It has not been reviewed by a second person (do that).

- **Map file.** Nodes (places and junctions) and edges (corridors with compass heading and step count) plus landmarks with a side. "North" is any fixed direction we choose; the operator never hears compass words. A stop cue must be looked up by the heading you arrive with (the test caught this bug) [nav_protocol s3A].
- **State per session:** position (node, or edge + steps done), heading, confidence (exact, counted, reported, guess), destination and queue, the last thing said, the visitor's language.
- **Tools** (webhook tools on the server; the model reads the returned text word for word): `get_state`, `find_place`, `check_place`, `plan_route`, `confirm_step`, `report_landmark`, `report_lost`, `report_blocked`, `set_position`, `change_destination`, `place_busy`, `mark_arrived`, `handover` [nav_protocol s3D]. `confirm_step` takes the step id so a repeat or a reconnect cannot move the plan twice. If a tool fails, the agent says one fixed line and stops the operator.
- **Why tools, not the prompt:** the model would have to count steps and rotate headings in its head; no source we read measures how reliable that is (UNKNOWN), and the server version is exact, testable word for word, and survives reconnects [nav_protocol s3G]. [inference]
- **Hosting choice (decide in hour 2):** server on a cloud host or a team laptop with a tunnel. Keep the planner a pure library so it can also run inside the bridge as client tools if venue wifi is bad. [inference]

### 4.3 What the agent says to the operator
One action per instruction, 12 words or fewer after the word "Operator,", stop cue the operator can see. (The prototype's booth, meeting-room and conference-room stop lines are 13 words with "Operator," in front, so shorten them.) Examples: "Operator, walk straight until booth two is on your left." "Operator, turn right." "Operator, stop here. Booth two is on your left." Operator replies come from a closed list: ok, ready, done, stopped, yes, no, free, busy, repeat, lost, blocked, wait, "I see X", "at X" (free and busy are for the booth check) [nav_protocol s2B]. The first utterance fixes the frame: "left and right always mean the robot's left and right." "Repeat" replays the same words. When something looks wrong the agent says "Operator, stop." first and explains after. Silence ladder [nav_protocol s2D]: no reply after the expected walk time plus 5 s (expected = 5 s + 0.8 s per step for a walk, 5 s for a turn) gives one yes/no question; 8 s more gives a hold; 10 s more gives a handover. A webhook server cannot make the agent speak by itself, so the nudge needs one of two untested ways: (1) `turn_timeout` about 10 s plus a prompt rule "if the operator is silent, call get_state and say the nudge"; (2) the bridge sends a timer text message. Test T4 (10 min, a teammate stays silent) picks one. It clashes with the long `turn_timeout` / `skip_turn` idea in 4.7; the test settles which wins. Also set `max_duration_seconds` 900 and `silence_end_call_timeout` -1 so the call never hangs up on a quiet operator. All timing numbers are starting points to measure on the floor.

### 4.4 Knowing where the robot is: three tiers
- **Tier 0 (must work, no sensors).** Floor graph, leg-by-leg route, operator reply words, a big printed sign at each stop that the operator can read back. Each confirmed stop at a cue resets the position, so counting errors do not pile up [nav_protocol s3; sensing s7].
- **Tier 1 (cheap extra, about 2 hours).** A phone QR check-in or a plain "arrived" button at each stop. Buildable and testable with no robot. Own markers and asking people nearby are allowed [Update p2, p3], so a QR scan or an "arrived" tap is fine; ask only whether any wall or furniture is off limits [sensing s4].
- **Tier 2 (stretch, decide at the first slot).** ArUco markers read from the robot's head camera (compressed topic, on PC2) give "the camera confirms the arrival". Or, if MangoBot already has the lidar map live (`/slam/lidar_odom`), turn that pose into "nodes reached". Both depend on topics we have not seen publish (UNKNOWN) [sensing s1, s3, s4].
- **Not in the first 6 hours:** cloud vision, lidar place-finding, our own SLAM [sensing s5-s6].
- **Read-only rule.** For sensors we only subscribe. The bridge itself publishes audio and calls the audio-focus and stop services; nothing else is published. We never publish to a motion topic and never call `SetMcAction`, `/aima/te/pnc_task_request`, or mapping or relocalisation interfaces. Add a code guard that refuses any topic or service name containing `command`, `locomotion`, `upper_body`, `pnc_task`, `integrated_command`, `relocalization_pose`, `SetMc` or `MigrateSystemState`, and a unit test for it [sensing s8].

### 4.5 The bridge
Use the organisers' bridge as the base (it follows AgiBot's docs but has NOT run on these robots yet) [Guide p5]. Account A's review lists what to change [bridge_code_review]. In order of damage to the demo:
1. **One endless conversation re-greets an empty room.** Start a conversation only when someone is there; end it after quiet; reset memory between visitors.
2. **HALF_DUPLEX kills barge-in.** Keep the mic open but gated if the robot hears itself; measure on the real robot.
3. **Late audio after an interruption can still play.** Drop audio older than the last interruption id.
4. **The stop call blocks the WebSocket thread.** Do it on another thread.
5. **No network fallback.** Pre-render short phrases at 16 kHz in both languages ("I heard you", "one moment", "the connection is slow, please repeat", "Operator, stop. Stay where you are.") and play them locally on a timer or when the link drops. This directly answers the "network drops" request.
6. **No latency numbers.** Log robot speech end -> first agent audio -> first sample played to a CSV; report median and worst case.
7. **Client tools are not answered** by the starter code; either answer them or use server tools only.
8. **Send dynamic variables at session start.** The nav server needs a `session_id` from the bridge [bridge_code_review 8; nav_protocol s3].
9. **The API key sits on the robot PC.** Use a restricted key and rotate it after the event [bridge_code_review 11].
10. Keep it ONE long-running process so we respect "2 ROS nodes per second" [Guide p5; sensing s8]. The `res.reponse` spelling is AgiBot's own and is not a bug [bridge_code_review 7].
Split the code into a session core (no ROS) and a ROS adapter so everyone can test on laptops; keep a laptop adapter and a WAV replay for repeatable noise tests.

### 4.6 One agent, three kinds of voices
Config details are in [multilingual s1-s9] and [agent_config s13]. These are starting values from documentation read through a summarising tool; confirm every field name in the dashboard before relying on it.
- **Models:** speech recognition Scribe v3 Live [Kickoff p7]; voice `eleven_v4_turbo` (fallback `eleven_flash_v2_5`, which cannot use IPA pronunciation entries; these two names come from the multilingual note, not from any organiser slide); audio PCM 16 kHz both ways (required for the robot) [Guide p5; multilingual s1-2]. Pick the LLM from the live list (`GET /v1/convai/llm/list`), because the ElevenLabs model list changed this week: `gemini-3.6-flash` was retired on 19 Nov; `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o` and `gpt-4o-mini` shut down on 14 Jan 2027; the `gpt-5` family now falls back to newer models [audit_elevenlabs_recovered, changelog 17 Nov]. The docs' own picks: GLM 5.2 or GPT-6 Luna to start, DeepSeek Flash 4.1 or Gemini 3.5 Flash-Lite for lowest latency, Claude Sonnet 5.5 for hard reasoning [same file, prompting-guide page]. No latency table exists, so run the same six requests on two or three models and compare [agent_config s4]. Prompts over about 2,000 tokens add latency.
- **Do not copy account A's starter JSON blindly** [agent_config s13]. Known problems: it is written for the old lobby brief (tools `book_visit`, `send_route_to_phone`); it sets the base language to Arabic and also an Arabic preset; it has one voice and no multi-voice labels; it turns `language_detection` on (our baseline is off, see below); it turns `speculative_turn` on although the default is off; it keeps `end_call` with no guard (a hang-up in a one-take video would be a disaster); it turns the filler on at 3.0 s with a placeholder line (the platform's own default text is "Hhmmmm...yeah."), so set a real line or -1. Use it only for field names, and check each field in the dashboard.
- **Guardrails** (a dashboard Security-tab feature, general since 19 Oct 2026 [audit_elevenlabs_recovered]): turn on focus and prompt-injection, and add a custom rule "operator lines are English, one action, 12 words or fewer after the word Operator". Use streaming mode for voice (blocking adds about 200-500 ms); never use `end_call` as a rule action [agent_config s9; multilingual s4].
- **Language handling.** The built-in language-detection tool assumes one user. Our operator speaks English all the time, so it may flip back and forth. Baseline: tool OFF, keep the visitor's language in state, and let the model pick the language of each sentence. This DEPARTS from the ElevenLabs kickoff, which says turn the tool ON [Kickoff p7, p9], so T1 is the first test and the mentors are the first people to ask. T1 (5 min, our Gulf Arabic speaker) decides between OFF and ON [multilingual s1]. For voices, A/B them in T2: (1) one voice, no tags (simplest); (2) multi-voice labels (`Operator`, `Arabic`, optional `Hindi`). Whether one voice id can sit under two labels is UNKNOWN, and the bridge must strip any label text if it shows up in `agent_response`. The docs disagree on whether switching mid-call is allowed; the tool page looks newer (inferred; neither page is dated) and says it is allowed [multilingual s1]. Also follow the other Kickoff p7 rules: name the dialect in the first line of the prompt ("Gulf Arabic"), do not copy the caller's dialect, say system values in Arabic, and pick the voice from the market we build for.
- **Mixed Arabic/English in one sentence:** nobody documents how the voice model handles it; test by ear (T2). Keep each sentence in one language; names stay in Latin letters and go into the pronunciation dictionary as `alias` entries.
- **Numbers:** avoid digits; use ordinals and landmarks ("second booth").
- **Third language:** Hindi only if a teammate tests it for 10 minutes; otherwise skip. Do not demo an untested language [multilingual s5].
- **Voice:** one calm, clear voice, stability about 0.6, no laughs or sighs, never a cloned human voice. First line says it is an AI. The speed setting is not available on v4 or v4 Turbo (ElevenLabs speed-control page [audit_elevenlabs_recovered]); use Flash v2.5 if we need speed 0.7-1.2 [multilingual s6].
- **Prompt:** sectioned, short, under about 2,000 tokens: role, who is talking, output format, route loop, new destination, guardrails, handover, five Gulf Arabic example conversations written or checked by our Gulf Arabic speaker. Skeleton in [multilingual s4]; adapt it before use (it assumes `plan_route(from=...)`, `update_state`, `request_human_help` and a spoken line before slow tools, while our design keeps position on the server, calls the tool `handover`, and turns `pre_tool_speech` off). No blanket "reply in the user's language" rule [Kickoff p7]. About 20 place facts stay in the prompt, no RAG [agent_config s7].
- **Who is talking:** Arabic = visitor; a one-word English reply from the closed list = operator; a full English sentence naming a place = confirm once, and say "Operator, stop" first if the robot is moving. There is no documented way in agents to separate two speakers on one mic, so do not plan on diarization [multilingual s3]. A single English "done" must never change the visitor's language [nav_protocol s2C].
- **Handover:** `transfer_to_number` works only on phone calls, so use a webhook tool plus the `flag_issue_for_review` system tool (behaviour on a robot WebSocket session UNKNOWN) [multilingual s9].

### 4.7 Noise, music and crowds
Start values and a one-setting-at-a-time protocol are in [multilingual s7]: Filter background speech ON (dashboard), `turn_eagerness` normal then try patient, `speculative_turn` off then try on, a long `turn_timeout` while the operator walks (this clashes with the silence nudge in 4.3; test T4 settles it), `interruption_ignore_terms` for backchannels (never "stop", "wait", "done"), keywords for place names (unverified that the live recogniser honours them, test T3; they cost extra), noisy-environment detection OFF (Enterprise-only, detects voices only, and its action is wrong for a robot), HALF_DUPLEX only if the robot hears itself. Music with lyrics is the worst case because lyrics are speech. Protocol: record 10 visitor lines and 6 operator replies once, mix them with crowd and music at three noise levels, replay as audio chunks, log what the agent heard, count false turns and false interruptions, change one setting per run. Then repeat once on the real speaker and mic in the room, and once with a crowd of teammates around the robot (the organisers' phones-take-the-network warning) [Nucleus p5].

### 4.8 Second screen
One laptop beside the visitor: map with route, travelled part, a robot dot with an arrow and a confidence ring; the exact English line to the operator and the translated line to the visitor; step counter; last operator word; "heard:" line (what speech recognition got, so the music route proves itself); a network chip; an event log; a handover box. Text at least about 28 px so it is readable on video. Driven by the server state plus events the bridge posts (`user_transcript`, `agent_response`, socket state), with no extra model call; the server sends English strings and the model writes the Arabic [nav_protocol s6C, s3D]. Whether it may appear in the video is UNKNOWN: ask first [nav_protocol s6D].

### 4.9 Money and limits (check before each slot)
ElevenLabs agents cost $0.08 per minute plus the LLM at cost [audit_winners D34, D35]. Creator ($22, $11 the first month) gives 275 included minutes and 10 concurrent calls on the agents pricing page; an older developer page says 250 [audit_elevenlabs_recovered]. Rough budget: 50 (robot rounds) + 75 (five devs x 15 min) + 21 (three pitch rehearsals) + 20 (filming) = 166 min, about 169 with 8-minute rehearsals, plus audio-replay test runs; how test runs are billed is UNKNOWN [integration s6 inference]. So do regression tests as text-only runs and keep voice minutes for the robot. Burst mode charges 2x only for calls above the 10-call limit, and the create-agent schema defaults it to on [audit_elevenlabs_recovered]; turn it off for the demo. Billing counts connection time, so never leave an agent connected. Do not leave dev agents connected overnight. Have a hot-spare agent in a second workspace.

### 4.10 Team workflow in the repo
`agents push` overwrites the agent it targets, so five people pushing one agent will clobber each other [integration s3]. Use: agent config as JSON in the repo; one sandbox agent copy per developer; one release agent pushed by one person (from CI if time allows); `agents pull` before any push if Architect or the dashboard changed it. Architect (the built-in assistant) is worth 15-20 minutes for a first prompt draft and tests; it needs a paid plan and always requires a publish [multilingual s8]. Keys live only in each developer's `.env`. Rollback: ElevenLabs now versions every agent (the API pages say the opt-in flag is deprecated; one docs page still says opt-in), but git stays our rollback. Two developers pushing the same tool id may collide (UNKNOWN).

### 4.11 Build order: must have first, stretch last

| Tier | What | Done when |
|---|---|---|
| MVP (before the first robot slot) | Real map + planner + tools; one agent in two languages; operator lines in English; clarifying question; stop and arrival line; bridge audio on a laptop; AI disclosure; local fallback phrases; second screen v0 | Easy route works with a teammate as operator, 3 clean runs |
| Core (before feature freeze) | Mid-route destination change; operator reply words and timer ladder; music and noise tuning; handover and the place-table learning loop; latency log; Arabic reviewed by a native speaker; full second screen | Scenarios S01, S02, S05-S11 pass; sweep test passes on the real map |
| Stretch (only if Core is green) | Tier 1 QR or button; Tier 2 camera marker or lidar pose; third language; visitor language switch mid-route; camera confirms arrival | Probe at the first slot says it is safe and worth it |

---

## 5. The work plan

All times are guesses until organisers send the new slots. T = our first robot slot (old guess Tue 18:00). F = freeze (working guess Wed 08:30).

| When | Goal | Checkpoint |
|---|---|---|
| Now to +1 h | Walk and measure the floor; ask organiser questions; roles; repo; agent copies; redeem new codes; T1, T2, T3 tests | Map v0 written; questions asked |
| +1 h to T-1 h | Planner library + real map + unit tests; server tools; agent v1 in browser; second screen v0; bridge split; first teammate-operator walk; print signs and markers | One easy route works end to end on the floor with a phone |
| T-1 h to T | Ready for the robot: laptop with bridge, copies of everything, fallback phrases rendered, probe scripts, question list for the engineer; be early, a missed slot is gone [Guide p3] | Checklist ticked |
| T (first slot, about 30 min) | First 10 min read-only probe and audio test; then one full route on the robot; log latency and echo; film a backup take only if allowed | Decide Tier 2 or stay Tier 0/1 |
| T to F-8 h | Fix what the robot showed; tune noise settings one at a time; Arabic review; music and crowd tests; handover and learn loop | Feature freeze at F-8 h |
| F-8 h to F-3 h | Test and rehearse only; three clean runs in a row; pitch drafts; slides; 100 words; project link | Release freeze at F-3 h |
| F-3 h to the second slot | Pre-flight; sleep in shifts; credits check; backup video ready | Go/no-go |
| Second slot (filming; a guess: Guide p3 says round 2, Update p3 says "in your robot slot") | Find an organiser first (they bring the music and the new destination); film route 1, 2, 3, one take each | Footage saved twice |
| Before F | Submit; check the form; late is not judged | Submitted |

### First 10 minutes at the robot (all read-only first) [robot_and_starter_kit s2, sensing s7]
1. Ask the engineer: wake word, `only_voice` mode on, and is `wss://api.elevenlabs.io` on port 443 reachable from the container?
2. One command at a time, 1-2 seconds apart (each `ros2` call starts a node): `ros2 topic list`, then `ros2 topic info` on the mic and speaker topics. Check the sensor, slam, task_master and mc/common topics for Tier 2.
3. Run the SDK's own mic listener once to see real chunk sizes and which `stream_id` is the built-in mic (the docs contradict each other: 0 or 1).
4. Play one cached phrase through the speaker topic with an audio-focus request at priority 8; then without focus, to learn if focus is needed.
5. Start our bridge once. Say the wake word. Speak Arabic and English. Check first audio, self-interruption (HALF_DUPLEX or external mic if needed) and barge-in.
6. Stress: someone talks over it, a phone plays crowd noise, then cut only the internet uplink (with the engineer's OK; this caution is ours, not an organiser rule) and check the local phrase.
7. Write down timings on paper, the exact start command, and back up the code.

### Roles (merge two if only 4 people)
1. **Agent, prompt and Arabic:** agent config as code, prompt, five Gulf Arabic examples, guardrails, voices (T1, T2), first message with AI disclosure.
2. **Backend, map and route tools:** map file, planner, tools, state, sweep test, handover log, second-screen feed.
3. **Bridge, robot and resilience:** bridge split, fixes in 4.5, fallback phrases, latency log, probe scripts, robot questions.
4. **Tests and noise:** ElevenLabs tests with repeat counts, text harness with a simulated operator, noise and music protocol, drill score sheets.
5. **Demo, pitch, video, venue data and submission:** floor measuring, signs, second-screen polish, pitch, slides, video plan, form, compliance checklist.

Reserve one person at every slot as "talker" (speaks to judges and organisers) and one as "fixer" (keeps the keyboard) [audit_winners W33].

---

## 6. Video, pitch and questions

### The three routes (up to 3 minutes total, one take each, cuts only between routes) [Update p3, p6]
Robot teams play their video in the jury slot; a live demo only if the organisers allow it [Update p6]. Keep the visitor, the robot and the operator in the shot. Find an organiser before starting: they bring the music and the new destination. Time budget (estimates; stopwatch them in rehearsal): route 1 about 50 s, route 2 about 45 s, route 3 about 65 s, cards between about 10 s [nav_protocol s6A].

1. **Easy route (we choose).** Arabic request that needs one clarifying question, the booth check, three instructions with one visible turn, the stop call to the operator in English first, then the arrival line in Arabic [Update p2]. Pick a destination with one real turn.
2. **Music route (they supply the track).** The same loop under music. The agent echoes the request first ("The kitchen, right?") so a misheard word is corrected before the robot moves. The second screen shows what it heard.
3. **Change of destination (they set it).** Stop at once, fix the position with one landmark question, re-plan from where the robot stands, tell both people in their languages, new first instruction. Run the sweep test on the real map beforehand so any destination works. This is the strongest moment; do not rush it.
Show the failure trio: a mishear that the agent recovers from (route 2), an interruption ("wait, not the booth") that makes the agent stop first, and a network drop with the local fallback line. Whether those can be inside the three takes depends on the video rules; otherwise show them on a slide or in the pitch. UNKNOWN: ask [Update p3].

### The 3-minute pitch (4 beats, from the Guide: problem and who has it, the demo, why it matters for DSO, what comes next) [Guide p9]
- **0:00-0:30 Problem.** Visitors on a floor like Dtec's ask people nearby; an operator walking a robot cannot understand them; one sentence, no jargon.
- **0:30-1:30 What we built and the proof.** The agent is the only one who knows the way. We measured the floor, ran N drills with a teammate as operator, M of N arrived, median reply gap X s (fill from our own logs; never quote numbers we did not measure). Say the one honest limit: position comes from operator confirmation unless the robot's own map is on.
- **1:30-2:15 Why it matters for DSO.** Sourced facts only: Dtec has 108,000 sq ft and over 1,000 startups from 90 countries [audit D11]; DSO's own portal has 340+ digital services [D14]; ElevenLabs' own Gulf workshop says most Gulf customer conversations mix Arabic and English, often in one sentence [D18]. Do not say DSO has 5,000+ companies (that is DIEZ across three zones) and do not use market sizes for guide robots [audit (iii)].
- **2:15-3:00 What comes next.** Real position from the robot's own map so the operator is not needed to guess; more floors and buildings; handover answers that teach the agent. Cost framing with labelled assumptions: voice platform price is $0.08 per minute plus LLM at cost [D34]; a one-minute guided walk is about $0.08 of voice at that rate (our filmed routes run 45 to 65 s); a 3-minute session is about $0.24 [assumption: 3 minutes]. Say what is an assumption. Criteria 4 and 6 (challenge fit and investment) are 25% of the score and the six judges are the audience; there is no investor among them [audit D60, D66]. So give two or three honest lines (who runs a floor like this, why a spoken guide helps visitors who cannot be understood by the operator, what a supervised pilot would measure), all marked as assumptions.

### Likely questions (our guess; honest answers, no bluff)
- *How do you know where the robot is?* Map, counted legs, operator confirmation at each stop, one landmark question when unsure; camera or lidar only if the platform exposes it. We say what we measured.
- *What if the operator is wrong or silent?* The agent notices from his report or from the clock, tells him to stop, re-locates, and after two failed questions hands over.
- *What if the network drops?* Local phrases tell the operator to stop and stay; the server state survives; on reconnect the agent asks where he is.
- *Why one agent for both languages?* The Nucleus slide says two agents plus a language switch restarts the conversation [Nucleus p3]; ours is one agent and keeps the visitor's language in state.
- *Why not use the robot's own navigation?* Movement is out of scope and controlled by MangoBot [Guide p3; Update p2].
- *Who pays and why?* Say what we know (price per minute, who runs a floor like Dtec) and mark the rest as assumptions; never state a market size for this product.
- *Did you use the starter kit?* We state exactly what we took (section 9).

---

## 7. Risks and fallbacks

| Risk | What happens | Fallback |
|---|---|---|
| Robot slots or deadline change | Plan shifts | Plan in T and F; ask now; keep every artifact runnable on a laptop |
| Bridge fails on the robot | No voice on the robot | First slot tests it first; laptop adapter gives a recorded-demo fallback; engineer call |
| Operator cannot or does not reply by voice | Confirm loop breaks | Timer-only ladder; a button or phone page for "done"; ask in the first minute at the slot |
| Wrong turn by operator | Position wrong | Operator report fixes it; landmark questions; hold instruction first |
| Music or crowd confuses speech recognition | False turns, missed requests | Echo-back confirm; keywords; background-speech filter; external mic; test early |
| Network drops or crowd takes bandwidth | Agent silent | Local phrases; reconnect with `get_state`; second hotspot or wired option; ask engineer about internet in the container |
| Arabic sounds wrong | Voice score drops | Native-speaker review; use fewer, simpler Arabic lines; do not claim Emirati dialect |
| Surprise destination breaks the map | Route 3 fails | Sweep test on the real map; simple "stop, ask, re-plan" rule |
| Credits run out | Agent stops | Check usage before each slot; spare workspace; offline phrases |
| Two people overwrite the agent | Lost work | One agent copy per dev; git is the rollback |
| Sensor probes upset the robot | Safety, penalty | Read-only, compressed cameras only, long-lived process, engineer's OK first |

---

## 8. Questions to ask

**Organisers, now (blocking):**
1. New robot slots, pitch order and the submission deadline? Was our orientation slot held (it was Tue 13:00 in the Guide), and was the bridge tested there [Guide p3, p5]?
2. How does the operator drive (controller, step commands, voice)? Can he speak to the agent and hear the robot speaker? Where does he stand?
3. On the surprise route, is the first visitor still served, or replaced?
4. We plan our own printed signs or markers and an "arrived" tap; the Update allows both [Update p2]. Is any wall or furniture off limits?
5. May a second screen show in the video? May our failure moments be inside the takes? Does the old rule "robot teams add one unedited take, max 2 min" [Guide p9] still apply? Where and when do we film (our guess: our robot slot)?
6. Is a cloud model call for one yes/no answer fine under "build on ElevenLabs Agents"? (Do not rely on it.)
7. Where is `x2-audio-guide.en.md`? How loud is the music and where is its speaker? (The organisers bring it [Update p3].)

**MangoBot engineer, at the first slot (read-only first):**
8. Run `ros2 topic list` for sensor, slam, task_master, perception and mc/common; do the head camera compressed topics publish? May we read them read-only, and at what rate and CPU?
9. Is the lidar map and `/slam/lidar_odom` live? What does `/task_master/state` show?
10. While the operator walks, does `/aima/mc/common/state` change? Robot walking speed and step length?
11. Does the container have outbound internet and port 443? Is `cv2.aruco` there? CPU and memory we may use?
12. Which mic stream, built-in or external? Is the stream echo-cancelled? What is the wake word and how long does voice-only mode stay armed?
Full lists: [robot_and_starter_kit s3 (20 questions)] and [sensing s2 (10 questions)].

---

## 9. Compliance checklist

- [ ] Agent runs on ElevenLabs Agents. [Guide p3]
- [ ] First line says it is an AI; it says "I do not know" instead of guessing. [Guide p3]
- [ ] English and Arabic work in every route; a third language only if tested. [Update p2]
- [ ] Anything not measured by us and not given by the organisers is marked as demo data on screen and in the pitch [Guide p3, p8]; things we measured are called "measured on site".
- [ ] No movement code; no publishing to motion topics; code only in the container; never PC1. [Guide p5]
- [ ] At most 2 ROS nodes per second: one long-lived process; no restart loop. [Guide p5]
- [ ] Save only under /home/agi; never inside aimdk*; back up code on the laptop. [Guide p5]
- [ ] No API key, coupon code or workspace secret in the repo; note the workspace ID. [Guide p4]
- [ ] Say in the submission what starter code we started from (organisers' bridge; any starter-kit parts; keep the licence notice, the kit repo is MIT). [brief s3; not in the Guide, origin unverified]
- [ ] Submission by the deadline: project link, 100 words, demo video (3 routes, up to 3 min, one take each [Update p3]), up to 3 slides. [Update p6]
- [ ] Find an organiser before filming. [Update p3]

Starter kit: its Navigator preset is for the old lobby brief and no longer fits. Cherry-pick small parts only (the WebSocket helper and the phone bridge's audio-buffering idea were rated reusable); do not use it as the base; delete research, Twilio, avatar, hold music and branding [robot_and_starter_kit s9]. Its preset prompt has no AI disclosure, a blanket reply-in-the-user's-language rule, and a "send route to phone" tool that sends nothing: do not copy those. [robot_and_starter_kit]

---

## 10. What we still do not know, and what changed in the audit

**Unknown (ask or test):** robot slots and deadline; how the operator drives and whether he speaks to the agent; walking speed and step length; whether any robot sensor topic publishes on the hackathon robots; whether the container has internet; the wake word and how long voice-only mode lasts; whether the mic stream is echo-cancelled; whether the language-detection tool flaps with an English-speaking operator (T1); how Arabic and English mixed in one voice sentence sounds (T2); whether `flag_issue_for_review` works on a robot session; real Arabic accuracy for Gulf speech; test run billing; whether a second screen may be in the video; which silence-nudge method works (T4).

**Audit status (24 Nov, about 16:00).** Four independent checkers read this plan, and their fixes are applied: organiser claims (`plan_audit_organiser.md`), design versus research notes (`plan_audit_notes.md`), winners, pitch and numbers (`plan_audit_winners.md`), and the ElevenLabs claims, recovered from account A's cut-off audit (`audit_elevenlabs_recovered.md`). All four files are in `research_notes/Oasis Navigator hackathon win plan/`. Caveats that remain: (1) ElevenLabs field names, defaults and prices come from docs read through tools, so confirm each in the dashboard before relying on it; (2) the recovered ElevenLabs audit never checked its "inferences and gaps" sections or the resilience note's code; (3) the realtime token prices could not be found, so none are quoted; (4) the prototype planner is only proven on demo data; (5) the repo audit in section 11 was read-only and did not test the live voice.

**Evidence index** (all in `research_notes/Oasis Navigator hackathon win plan/` unless noted): agent_config (agent settings), integration_resilience (protocol, CLI, tests, pricing, resilience), robot_and_starter_kit (X2 audio path, rules, starter kit), past_winners_and_playbook and dso_context_business_jury (both outdated for the brief; use with audit_winners_business_claims.md), bridge_code_review, multilingual_three_party_voice, blind_navigation_protocol, blind_navigation_nav_proto.py, robot_sensing_localization. Organiser documents in `sources/organizer_docs/` and `sources/organizer_docs_update1/`. Checker reports: `plan_audit_organiser.md`, `plan_audit_notes.md`, `plan_audit_winners.md`, `audit_elevenlabs_recovered.md`. Team repo: https://github.com/HyperionBurn/deception-dso-navigator (section 11).

---

## 11. The team repo: what Wasif has already built (read-only audit, 24 Nov about 16:00)

Repo: `HyperionBurn/deception-dso-navigator`. 3 commits on 24 Nov, 35 files, about 2,400 lines. I cloned it to a scratch folder and changed nothing in the repo. All 24 of its own tests pass on Node 24 (`npm test` in `app/`; the first run was slow on this Windows PC, about 100 s, the second 14 s). The live site `deception-dso-navigator.vercel.app` answers, and its status page says live voice is ready. I did not try the voice.

**What it is.** A Vercel web app (plain HTML and JavaScript plus small Node functions). A visitor talks to the ElevenLabs agent in the browser after typing a team access code. It has: the agent's prompt and place facts (`agent/`), a `next_route_step` webhook that returns one step at a time, a browser voice client, an offline practice mode with three scripted scenarios (easy, noise, reroute), QA sheets, a robot runbook and a judge-packet draft. Every document says "NOT READY": no floor evidence yet.

**Good.**
- It matches the new brief. The prompt says it is an AI, holds when it is unsure, says "Operator, stop now" before anything else when the destination changes, never guesses a route, and only announces arrival after the operator confirms the stop.
- Safe by design. The API key stays on the server; the access code is compared in constant time; the signed voice link is checked; strict browser security headers; no secret in the files or in the git history (I scanned both); `.env` and `.private/` are ignored.
- The route planner is small, strict and tested. `app/lib/route-contract.md` says exactly what proof each map entry needs.
- The browser voice client checks 16 kHz audio both ways, drops stale audio after an interruption, and handles ping and queue messages.

**Gaps and risks, against this plan.**
1. **The floor map is empty** (0 places, 0 corridors), so the agent cannot give one direction yet. This is step 1 of our plan: walk and measure.
2. **Place matching is exact text** (only case and spaces are cleaned). "Booth 2 door" and "booth two door" do not match, and one misheard word means "needs anchor". Fix: match by place id plus a list of spoken names, or put a printed letter at each stop and let the operator read it back.
3. **Every step needs the operator to report the cue, the facing and that the robot stopped.** Safe, but slow for three routes inside 3 minutes. Time one step in a drill before we decide.
4. **The server forgets everything between calls.** The model carries the position in the conversation. Our plan keeps the position on the server by session id so it survives a reconnect, and adds the silence timers.
5. **Nothing for the robot yet.** It is browser-only: no bridge, no robot audio, no fallback phrases for a network drop, no latency log. The rules say a browser rehearsal does not count as the robot video.
6. **No second screen, no handover tool, no change-destination tool** beyond the prompt rule.
7. **One shared agent id** is written in `agent/setup.md` and in the code. If five people edit it, they overwrite each other. Use one sandbox copy each (section 4.10). The agent's settings (language detection, voice, LLM, guardrails) live in the ElevenLabs dashboard, not in git, so we cannot see them from the repo; check them against section 4.6.
8. **The planner contradicts its own QA rule.** Its turn steps give two commands in one line ("Turn left. Walk straight and stop at ..."), but `qa/cases.md` fails any "multi-command turn". Split these into two steps, or change the QA rule. Also check each line stays within 12 words after "Operator,".

**How it fits (my recommendation, not a decision).** Keep it. Use his app as the browser test page and the host for the second screen. Keep his security and voice client. Extend the planner with place ids and spoken names, session state, our closed reply words and the extra tools (`handover`, `change_destination`, `place_busy`, `mark_arrived`). Add the robot bridge as a separate folder. Hussain and Wasif decide; nothing in the repo was changed.
