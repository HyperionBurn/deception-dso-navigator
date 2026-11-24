# How we work in this repo (Team Deception)

Voice of the Oasis hackathon, 24-25 Nov 2026, Dtec Dubai Silicon Oasis. Challenge: AI Voice Navigator on Robot A. We build an ElevenLabs voice agent that tells a MangoBot operator, step by step in English, how to walk the robot to a place on one Dtec floor. It talks to the visitor in their own language (Arabic and English) and says when they have arrived.

## The plan we follow
- `docs/WIN_PLAN.md` is the plan Hussain approved on 24 Nov 2026. Read "Bottom line and next 3 hours" and section 4.11 (build order) first.
- `START HERE.md` is the repo handoff. Update it when one of its gates changes.
- If this file and the plan disagree, the plan wins. The organiser documents win over both.
- Robot slots, pitch order and the submission deadline are not confirmed yet. Plan in T (our first robot slot) and F (freeze), not in clock times.

## Rules from the organisers (never break these)
- Software only. We write no code that moves the robot and we never publish to a motion topic. MangoBot controls all movement.
- Robot code runs only in the MangoBot container, never on PC1. Start at most 2 ROS nodes per second: one long-lived process, no restart loop. Save only under `/home/agi`, never inside `aimdk*`.
- The agent says it is an AI, says when it does not know, and never guesses a route. Made-up facts are marked as demo data.
- English and Arabic in every route.
- No API key, coupon code, access code or workspace secret in the repo. Use `.env` files and Vercel environment variables. No internal robot addresses in the repo.

## How we work
- Nobody pushes to `main`. Every change reaches `main` through a pull request, so we can go back by reverting one PR.
- One branch per piece of work (`feat/...`, `fix/...`, `docs/...`). Keep pull requests small.
- Before you open a pull request: run `npm test` in `app/` and paste the result in the PR. Say plainly what you did not test.
- Do not say something works unless you ran it. "Not tested" is a fine thing to write.
- Each developer uses their own ElevenLabs sandbox agent for experiments. Only one person pushes the release agent. Never use `agents push` on the shared agent without asking Hussain.
- Keep it simple. No new framework or extra service unless the plan asks for it.
- Nothing about the Dtec floor is true until someone measured it. Until then it is demo data and must say so.
- Write docs and comments in plain, simple English.

## Where things are
- `app/` Vercel app: browser voice test page, route tool (`api/route.mjs`), planner (`lib/`), tests (`tests/`).
- `agent/` the agent prompt, place facts and setup notes.
- `qa/` test cases and the scorecard. `robot/` the robot slot runbook. `submission/` the judge packet draft.
- `docs/WIN_PLAN.md` the plan.
