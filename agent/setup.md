# AI Voice Navigator handoff

Use the existing private agent `Deception | DSO AI Voice Navigator` (`agent_0101m86hthvjfm6vqeymg81may5e`) for the revised Robot A challenge. These files define the live agent behavior. They do not indicate that Robot A has been connected or that a route has been verified.

- Use `system-prompt.txt` and `destination-facts.txt` together. Replace the old venue facts and route rules. Use English and Arabic for visitors. Label every instruction to the operator in English. In voice preview, check that an Arabic visitor turn does not cause the English operator instruction to be spoken in Arabic.
- Example first message: “أهلًا، أنا دليل بالذكاء الاصطناعي. Hi, I’m an AI guide. Where would you like to go?”
- Only the MangoBot operator controls motion. The agent gives spoken instructions and waits for explicit physical acknowledgment. Until verified anchors and route records are available, the agent can clarify intent and ask for evidence, but must hold.

## `next_route_step` tool

This read-only webhook is implemented by the website's `POST /api/route` function. It does not control the robot. See the [route contract](../app/lib/route-contract.md) for fields, statuses, and how to add checked records. The starting map deliberately contains no verified anchors or edges.

Send the confirmed `destination_id`, either the actual observed `current_landmark` or an already resolved `current_id`, and exactly one confirmed orientation (`heading` or `facing`). Do not pass both landmark and ID or both orientation fields. Never substitute a predicted next anchor for an observation.

- `step`: read one English operator command and wait for observed completion.
- `needs_anchor` or `unverified`: hold with no movement instruction and ask for evidence if it can help.
- `at_destination`: request a stop and observed endpoint cue before confirming arrival to the visitor.

The webhook uses a separate workspace secret in its request header. The agent never sees the value, and browser credentials are not used for this tool.

## Check and record

First rehearse with a teammate acting as the operator. Check a vague Arabic request, English operator instructions, noisy speech, a missing or mismatched anchor, an ambiguous acknowledgment, and a second visitor changing the destination mid-step. Check that an endpoint mismatch blocks arrival and that arrival follows an explicit stop and the operator's matching observation. Use mock data for rehearsal only. Use no physical directions until the team verifies them on the floor.

The revised guide calls for three routes: a simple request, a request with organizer-supplied music, and a second visitor requesting an organizer-selected destination mid-route. Use at least two languages per route. Film within the assigned robot slot. Keep the visitor, robot, and operator in shot. The combined video is at most three minutes, with cuts only between routes. Jury time is three minutes for the pitch, three for the demo, and two for questions. The final team list, robot slots, submission deadline, and pitch order are pending per the update.
