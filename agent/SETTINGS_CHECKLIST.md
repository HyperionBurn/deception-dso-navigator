# ElevenLabs settings checklist (for Wasif)

Written 24 Nov 2026 night. `scripts/push-agent.mjs` only sends the prompt and the first message. Everything below is a dashboard or API setting that only someone with the key can change.
The setting names come from `docs/RESEARCH.md` (read in the ElevenLabs docs, never tried on our agent). Check each name in the dashboard before you change it. Change ONE thing at a time, run the live check after each, undo it if a rule gets worse.

## 0. Before you start
- Pull main. In `app/`: `node --env-file=.env.local tests/floor-drive.mjs` and save the result. This is the baseline.
- Push the new prompt: `node --env-file=.env.local scripts/push-agent.mjs --dry-run`, then without `--dry-run`. The new prompt is about 1,600 characters longer than before, so also time the gap from end of speech to first audio (keep replies short) before and after.
- Run the live check again. The role-play of the new prompt is in `qa/sim/SIM_REPORT_after_prompt_fix.md` (played by Claude, not by the live model).

## 1. Route tool `next_route_step` (settings of the tool, not the agent)
- [ ] `interruption_mode` = `disable_during_tool`. Do NOT use `disable_during_tool_and_turn` (nobody could cut in).
- [ ] `response_timeout_secs` just above the slowest call you measure. The role-play notes say 6 s; not checked against Vercel cold starts.
- [ ] `tool_call_sound` = `typing` (optional).
- [ ] If the agent still uses `disable_interruptions` or `force_pre_tool_speech` (deprecated), remove them.
- [ ] Read the tool description in the dashboard. It must allow a first call with only the destination (no position). `app/lib/voice-preset.mjs` describes it as "use only after they explicitly confirm the robot is stopped", and a model that reads that may refuse the first call.

## 2. Turns and noise
- [ ] `turn_eagerness`: compare `patient` and `normal`, once with the music clip playing.
- [ ] `soft_timeout_config` about 3.0 s with our own short English filler. The default filler is "Hhmmmm...yeah.". No Arabic filler (no native review).
- [ ] Optional: switch on the `skip_turn` system tool. Today the prompt says "wait silently" but gives the model no way to stay silent. If you switch it on, add one prompt line: "For noise, use skip_turn." Do it only if rehearsal shows chatter.

## 3. Language and voice
- [ ] Run the 10-minute check by ear (plan test T1): two Arabic lines, two English lines. Listen for garbled Arabic. Check the language does not flip on one English word.
- [ ] Make Arabic the default language of the agent (the starter kit notes say Arabic audio can be garbled otherwise).
- [ ] Check which voice model really speaks. The docs say adding a language may move the agent to the v2.5 multilingual model (UNVERIFIED).
- [ ] Check that the English "Operator, ..." lines are not spoken in Arabic after an Arabic visitor turn.

## 4. Model and tests
- [ ] The live model is `deepseek-v41-flash` (small). If the rules fail in the live check, list the options with `GET /v1/convai/llm/list` (the old notes list is stale) and try one faster, stronger model.
- [ ] Agent tests, 5 repeats each (publish first, tests may run on the draft): one Tool Call test per route; Next Reply tests: operator line is one short sentence; a route tool error in the history, the agent must hold; "stopped" after "Operator, stop." must not advance a step; "done" twice in a row counts as one.

## 4b. Brief the MangoBot operator (30 seconds, before filming)
- [ ] Say "done" ONCE, only when you have stopped at the place the agent gave you. A second "done" is read as a new stop, and the agent cannot tell the difference.
- [ ] If the robot is not where the agent thinks, say the place you see ("I'm at sign B" or "the yellow pillar").
- [ ] Answer the agent's questions with a short "yes" or "no".

## 5. While you are in there
- [ ] Change `NAVIGATOR_ACCESS_CODE` in Vercel. The old code is still in the git history.
- [ ] `agent/setup.md` and `app/lib/route-contract.md` still say "never use a predicted next anchor" and "do not copy a predicted next_id". Prompt step 5 does use `current_id` = the step's `next_id` after "done". The prompt is what runs. Fix the docs later.

## Known planner problems (not fixed by the prompt PR)
From `qa/sim/SIM_REPORT.md` (re-run on main 7671419, all reproduce): a whole sentence in `current_landmark` ("I am at sign B, facing toward the pitch room") resolves to the wrong place; at sign B only "reception" and "team tables" work as a facing; "the cafeteria is on my left" and "I can see the cafeteria" both return `at_destination`; a facing with no position gives HTTP 400. The prompt now tells the agent to send only the place as `current_landmark`, the facing separately, and never a facing alone.
