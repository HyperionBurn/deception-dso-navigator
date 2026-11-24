# Team Deception — Navigator handoff

**Use the November 24 Team Guide Update.** The original stationary lobby demo has been superseded. Only a MangoBot operator may move Robot A. The agent translates visitor intent into English, gives one verified instruction, waits for a physical observation, and confirms the stop and endpoint before telling the visitor they have arrived.

**Deployment:** [Deception website](https://deception-dso-navigator.vercel.app/) · [private GitHub source](https://github.com/HyperionBurn/deception-dso-navigator). Live voice uses a team code; it is not included in Git. The project owner's local copy is `app/.private/team-access-code.txt`. The same private ElevenLabs agent is configured with the `next_route_step` webhook. Vercel build readiness and 24 local checks passed. Live browser audio and Robot A remain unverified.

| Gate | What proves it |
|---|---|
| **Browser voice** | A visitor speaks Arabic or English, the agent clarifies the request, and an English operator instruction is clearly distinct. A reply about unknown routes gives no movement direction. |
| **Floor data** | Checked anchors, facing cues, and directed route legs for the actual event floor. No route is verified until the team surveys it. |
| **Robot A** | MangoBot supervises the same private agent and organizer audio bridge. Verify 16 kHz PCM both ways, physical speech, audible stops, role separation, and a clean session. |
| **Film** | Three continuous routes: easy, organizer music, organizer destination change. Visitor, robot, and operator stay in shot. The combined video is at most three minutes, with cuts only between routes. |

Confirm the final robot slots, submission deadline and pitch order with the organizer. The update supersedes the old challenge pages and adds a **3-minute pitch, 3-minute demo, and 2-minute Q&A**.

- [Revised PRD](AI%20Voice%20Navigator%20-%20PRD.md)
- [Course capture sheet](qa/physical-walk.md) and [rehearsal cases](qa/cases.md)
- [Robot A runbook](robot/UPDATED%20RUNBOOK.md) and [judge packet draft](submission/Deception%20-%20Judge%20Packet%20Draft.md)
- [ElevenLabs configuration](agent/setup.md) and [route tool contract](app/lib/route-contract.md)

The earlier 12 simulated responses covered the superseded destination guide. They do not qualify this challenge. No hardware or live microphone result is implied by a deployed website, a signed URL, or a passing mock test.
