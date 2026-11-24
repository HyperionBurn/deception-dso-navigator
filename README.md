# Voice of the Oasis · Team Deception

A bilingual voice navigator for the November 24 revised challenge. The visitor speaks Arabic or English. The agent translates intent for the MangoBot operator, gives one confirmed English instruction at a time, and listens for a physical stop and observed endpoint. It does not control the robot.

The website includes three clearly labelled practice simulations and team-gated live voice using the same private ElevenLabs agent as the robot. The route service starts empty and cannot return real directions until someone on the floor verifies the dedicated map. Use the latest organizer confirmation for slots and deadlines.

[Open the Deception website](https://deception-dso-navigator.vercel.app/). Practice requires no code. Ask the project owner for the team code before using live voice.

- [Start here](START%20HERE.md) for the actual requirements and evidence gates.
- [Course capture sheet](qa/physical-walk.md) for checked field data.
- [Route tool contract](app/lib/route-contract.md) for planner inputs, outcomes, and how to add checked edges.
- [Robot runbook](robot/UPDATED%20RUNBOOK.md) for the filming and audio procedure.

The Vercel project root is `app/`. Run `npm ci` and `npm test` from that folder for local checks. The browser bundle is plain HTML, CSS, and JavaScript. The server uses the ElevenLabs SDK to sign short-lived sessions. Configure team credentials only as server-side environment variables: `ELEVENLABS_API_KEY`, `NAVIGATOR_ACCESS_CODE`, and `NAVIGATOR_ROUTE_TOOL_KEY`. Never put values in source, public assets, or chat.
