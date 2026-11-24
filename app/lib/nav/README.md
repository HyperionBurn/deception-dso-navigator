# Navigation tools (the part that knows the way)

The voice agent never counts steps or turns. It calls these tools and says what they return.

- `say_operator`: say it to the operator, word for word, in English.
- `tell_visitor_en`, `question_visitor_en`: say it to the visitor, in the visitor's language.
- `step_id`: pass it back in `confirm_step`. A repeated or old id is ignored, so the robot is never moved twice.
- If a result has `status: "no_map"`, "handover" or "unknown_place": give no directions, say you do not know, ask for a person.

Files: `map.mjs` (map checks), `planner.mjs` (cheapest route, one action per instruction), `tools.mjs` (all tools),
`store.mjs` (where state is kept), `demo-map.mjs` (made-up floor), `dtec-map.mjs` (the real floor, empty until measured).

## Endpoint

`POST /api/nav?tool=<name>` with header `x-navigator-route-key: <NAVIGATOR_ROUTE_TOOL_KEY>` and a flat JSON body
`{ "session_id": "...", ...arguments }`. `session_id` is 8 to 64 letters, digits, `_` or `-`; the bridge or browser
sends it to the agent as a dynamic variable so every tool call carries it.

| Tool | Arguments | What it does |
|---|---|---|
| `get_state` | none | Position, last words, and a `nudge` when the operator has been quiet (ask, then hold, then handover). |
| `find_place` | `query` | Matches a spoken name (English or Arabic). Several matches give one question to ask the visitor. |
| `plan_route` | `destination_id`, `lang` | First asks the operator to confirm the start point, then gives the first instruction. |
| `confirm_step` | `step_id`, `result`, `thing`, `side` | Operator replies. `result` is one of: ok, ready, done, stopped, yes, no, free, busy, repeat, lost, blocked, wait, see, at. |
| `report_landmark` | `thing`, `side` | Fixes the position from something the operator sees. |
| `report_lost` | none | Hold, then ask what the operator sees. A second time hands over. |
| `set_position` | `node`, `heading` or `edge`, `dir`, `done` | A person fixes the position. |
| `change_destination` | `destination_id`, `lang` | Hold first. After the operator is stopped, ask what they see, then plan from there. Returns `tell` for both people. |
| `place_busy` | `place_id` | Marks a place busy and plans to the nearest free one of the same kind. |
| `mark_arrived` | none | Safe to call at any time. It only says arrived after the operator confirmed the endpoint. |
| `handover` | `reason` | Holds the operator and logs why. |

## Settings (environment variables)

- `NAVIGATOR_ROUTE_TOOL_KEY`: secret for the header above (already used by `/api/route`).
- `NAVIGATOR_USE_DEMO_MAP=1`: use the made-up demo floor for testing. Leave it off at the event unless the real map is empty on purpose.
- `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`): where to keep state between calls.
  Without them state is kept in the server's memory, which Vercel can drop between calls. Add the Upstash Redis integration in Vercel.

## Putting in the real floor

Fill `dtec-map.mjs` using the shape in `demo-map.mjs`. Every node, edge and landmark needs `checked_by` and `checked_at`.
Run `npm test` in `app/`: the checks reject compass words, long cues and unconnected places. Then run the same sweep test on the real map.
