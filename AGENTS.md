# AGENTS.md — Team Deception, Voice of the Oasis (AI Voice Navigator, Robot A)

Read first: `START HERE.md`, `AI Voice Navigator - PRD.md`. Brief = 24 Nov Team Guide Update (robot walked by a MangoBot operator; agent understands visitor in Arabic/English, routes, instructs operator in English, calls stop, confirms arrival in visitor's language; film easy / organizer music / organizer destination change, ≤3:00 total).

## Commands (run from `app/`)
- `npm test` — all unit/hosting/route/map tests (must stay green).
- `npm run map:check` — audits `lib/floor-map.mjs`, prints rejected records, warnings and every route as numbered English commands. Exit 1 on rejected records.
- `node --env-file=.env.local scripts/push-agent.mjs [--dry-run]` — pushes `agent/system-prompt.txt` + first message to the live ElevenLabs agent (prompt text only; tools untouched).
- `node --env-file=.env.local tests/live-voice-smoke.mjs` — opt-in live test: synthetic Arabic/English speech → production session → agent; asserts route tool call. Costs credits.
- `npx vercel --prod --yes` — deploy (project root `app/`, alias deception-dso-navigator.vercel.app).

## Facts
- Agent `agent_0101m86hthvjfm6vqeymg81may5e`, LLM deepseek-v41-flash, TTS eleven_v4_turbo, ASR scribe_realtime, pcm_16000 both ways, tool `next_route_step` → `POST /api/route` (header `x-navigator-route-key`).
- Team access code for live voice: `<access code>` (case/whitespace-insensitive). Secrets live only in Vercel env, `app/.env.local`, `app/.private/` (gitignored). Never print or commit them.
- Floor map starts empty; fill it from the floor survey (`qa/FLOOR INTAKE.md`), anchors with `aliases` (EN+AR), map-level `survey` evidence, optional `start`. Matching is token-based (see `lib/route-contract.md`).
- Robot audio bridge: `robot/bridge/` (ROS2 audio topics only — never motion). AgiBot docs cached in `.cache/x2-python.txt`.

## Decisions
- Hybrid routing: tolerant landmark matching + checked directed legs; agent advances on operator "done" using `next_id`/`exit_pose`; holds and asks when unsure. Never invent landmarks or routes.
