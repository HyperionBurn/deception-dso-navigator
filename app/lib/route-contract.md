# Dtec indoor route tool

The November 24 Team Guide Update lists the destinations on page 2. The production map starts with zero checked anchors and edges. A destination ID is a logical label. It does not establish the sign, door, floor location, or booth numbering. Confirm which booth a visitor wants before choosing an ID.

POST JSON to `/api/route`. Send the server secret `NAVIGATOR_ROUTE_TOOL_KEY` in `x-navigator-route-key`. Use a separate secret from the browser code and provider key.

| Request field | Meaning |
|---|---|
| `destination_id` | Required. One of `meeting_room`, `conference_room`, `call_booth_1`–`call_booth_4`, `team_tables`, `kitchen`. |
| `current_id` | The anchor currently observed. Use this or `current_landmark`, never both. A prior observation is usable only while the operator confirms it still describes their position. Do not copy a predicted `next_id` into this field. |
| `current_landmark` | The raw label the operator reports at their current position, in English or Arabic. The tool normalizes case, punctuation, tashkeel, tatweel, alef/taa-marbuta/alef-maqsura variants, Arabic-Indic digits, number words (one–four, first–fourth and Arabic ordinals), a leading `ال`, and common filler words. An anchor matches when its landmark or an alias is a word-subset of the observation; the longest matching phrase wins. A tie returns `ambiguous_landmark`. The phrases "sign A"–"sign F" with a capital letter match as one token, so they hit letter aliases without matching a generic "sign". Omit both position fields if unknown. |
| `heading` | Optional observed compass direction: `north`, `east`, `south` or `west`. |
| `facing` | Optional observed label that the operator faces. It resolves like `current_landmark` against edge facing labels and anchor phrases; an unrecognized or ambiguous value is ignored. It may also name the landmark of the next stop: when the `walk_straight` legs from the current anchor to that landmark share one entry pose, that pose is used, and a pose label used directly by a leg from the current anchor always wins. Use this or `heading`, never both. |

| Response status | Agent action |
|---|---|
| `step` | Read the English `command` to the operator. Ask them to report where they stopped and what they face. Use `expected_landmark` to check the observation. `exit_pose`, `remaining_steps` and `destination_landmark` describe the rest of the chosen route. Plan again from the reported anchor and pose. |
| `needs_anchor` | Ask for the current landmark if the reason is `current_anchor_required`; `known_landmarks` lists recognized stops and `ambiguous_landmark` adds `candidates`. When no position was supplied at all, `likely_start` names the checked start landmark and pose to confirm by yes/no. Ask for a fresh orientation observation if the reason is `current_orientation_required`; `known_facings` lists usable poses. Do not give a turn or movement command. |
| `unverified` | No checked route for this input. Do not give a movement command. `mapped_destinations` lists the other destination ids that do have a checked anchor, when any. A destination with no checked anchor returns `destination_not_checked` before the current position is looked at, so a destination-only request answers whether the place is mapped. |
| `at_destination` | The reported anchor is the checked destination. Ask the operator to stop and physically confirm the `expected_landmark` before announcing arrival to the visitor. |

When the destination changes, replace `destination_id` and request a new step. If the operator has moved since the last observation, ask where they stand before calling the tool. The endpoint does not maintain position or infer that the operator completed a step.

## Add checked field evidence

- Anchor fields: `id`, `landmark`, and `evidence`, plus optional `aliases` (English and/or Arabic phrases visitors may actually say). Use a canonical ID for a destination or a unique snake_case ID for a waypoint. Give the exact landmark phrase an operator can recognize at the stopping point. Do not add instructions or coordinates to the landmark phrase. Aliases must not collide across anchors; the audit warns when they do.
- Edge fields: `from`, `to`, `action`, `entry_pose`, `exit_pose`, and `evidence`. Each edge is one directed leg. Check each direction separately. Check access and the whole leg on the event floor. Split paths at observable stopping points when needed.
- A map may carry `survey` (`checked_at`, `checked_by`, `reference`) and `start` (`anchor`, `heading` or `facing`). The survey supplies evidence to records that have none; records with explicit evidence keep their own. The start only orders `known_landmarks` and the audit table — the planner never assumes the robot is there.
- Every `evidence` has `checked_at` (date and local time), `checked_by`, and `reference` (a specific check record). Record the actual location, visible cues, stopping point, poses, and walked direction in that check record. No placeholder evidence.
- A pose is `{ heading: 'north' }` or `{ facing: 'the checked cue label' }`. Authored poses use exact labels; observed `facing` text is resolved tolerantly to those labels before the search compares poses exactly. Use `exit_pose: null` when no single exit pose was checked. A later pose-dependent leg cannot use that exit. A planned exit pose is for search only. The agent must observe the actual pose before starting the next leg.
- Actions: `walk_straight`, `left_then_straight`, `right_then_straight`, `around_then_straight`, `approach_visible`. The first four require a checked entry pose. For `approach_visible` with `entry_pose: null`, check that the operator can safely turn to face the endpoint landmark and approach it from any starting orientation. Use a specific entry pose if that condition does not hold.

The planner selects the shortest checked route by leg count. When equally short routes exist, it uses the order in which the edges appear in the map. It returns only the first leg. `planFullRoute` returns the same route's legs for validation, and `npm run map:check` audits the map: dropped records with reasons, a route table from every anchor and pose, and warnings. Synthetic data belongs in tests only.
