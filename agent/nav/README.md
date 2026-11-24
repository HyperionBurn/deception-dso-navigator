# Agent for the navigation tools

These files are for the new "blind navigation" brief. They do NOT replace the live agent's prompt (`../system-prompt.txt`, which uses the older `next_route_step` tool). Nothing here has been pushed to ElevenLabs.

- `system-prompt.txt`: the new prompt. Short on purpose (about 1,100 tokens). It has one `[[TODO]]` block for five Gulf Arabic example conversations. A teammate who speaks Gulf Arabic must write or check them before this prompt goes on a real agent. Remove the block when done.
- `tools.json`: the seven webhook tools, one object each (`get_state`, `find_place`, `plan_route`, `confirm_step`, `report_landmark`, `change_destination`, `handover`). They call `POST /api/nav?tool=<name>` from the app (see `app/lib/nav/README.md`). Do not edit by hand: change `make-tools.mjs` and run `node agent/nav/make-tools.mjs`.
- `make-tools.mjs`: builds `tools.json`.

## How to try it (use your own sandbox agent, not the shared one)

1. In ElevenLabs, copy the agent to your own sandbox agent. Never use `agents push` on the shared agent without asking Hussain.
2. Add a workspace secret with the value of `NAVIGATOR_ROUTE_TOOL_KEY` and put its id in each tool's `secret_id` (the file has `REPLACE_WITH_SECRET_ID`). Never paste the value in the repo.
3. Create the seven tools (dashboard, or the CLI: `elevenlabs tools add "<name>" --type webhook --config-path <file>`), then attach them to your sandbox agent.
4. Paste `system-prompt.txt` into your sandbox agent.
5. The tool body sends `session_id` from a dynamic variable. The browser page and the robot bridge must send `session_id` when they start a conversation. (The bridge does; the browser page needs a small change, see its pull request.)
6. Test with the demo floor: set `NAVIGATOR_USE_DEMO_MAP=1` on the server. Without it the tools answer "no map" on purpose.

## Not verified

- The field names in `tools.json` (`dynamic_variable` inside the body schema, `pre_tool_speech`, `execution_mode`) come from the ElevenLabs docs read through a tool. Check each one in the dashboard before relying on it.
- Whether the agent says the silence nudge by itself needs test T4 (see the plan, section 4.3). Until then the prompt only says what to do after a silence prompt.
- The language-detection tool should be OFF for this prompt (test T1 decides). The prompt keeps the visitor's language by itself.
- First message to use (needs the Arabic speaker's check): "أهلًا، أنا دليل بالذكاء الاصطناعي. Hi, I'm an AI guide. Where would you like to go?"
