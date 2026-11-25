# Team Deception | Three slides

Fill `[ ]` only with results from the filmed takes or QA. Leave them out rather than guess.

## Slide 1. The gap
**Title:** The robot can walk. Nobody on it knows the way.
- A visitor asks in Arabic, English or Hindi/Urdu.
- The operator speaks English and does exactly what he is told.
- Our agent is the only one who knows the route.
Picture: frame from Take 1, visitor and operator either side of the robot.

## Slide 2. How it works
**Title:** One step, one "done", no guesses.
- ElevenLabs agent: Scribe realtime listening, eleven_v4_turbo voice, 16 kHz audio both ways through our ROS 2 audio bridge (audio only; MangoBot moves the robot).
- Route tool over a map built from evidence only: `[ ]` places, `[ ]` checked legs. Anything else: "not mapped yet" and a handover.
- After each step the agent waits for the operator; when the destination changes it stops, asks where the robot is and replans.
Diagram: visitor → agent → route tool → English step → operator → "done" → next step.

## Slide 3. Results and next
**Title:** What we measured
- Takes: `[ ]` of 3 reached the right place. Holds instead of guesses: `[ ]`.
- Offline: `[ ]` planner and API tests, `[ ]` bridge tests, `[ ]`/28 live text drill checks.
- Next for DSO: the full Dtec floor surveyed once, printed signs at decision points, camera-confirmed arrival.
