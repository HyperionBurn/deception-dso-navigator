# Updated QA | Start here

**NOT READY.** No survey, blind walk, robot take or final video is verified. The former stationary kiosk cases and scorecard schema 1 are obsolete for this challenge.

1. On site, complete the [course capture sheet](physical-walk.md). Agree on a course revision, a checked start pose, endpoints and directed steps. List coverage gaps.
2. Run the [spoken cases](cases.md). You can rehearse voice logic with a clearly marked fixture. For field credit, use only the surveyed floor data. A teammate plays the operator and walks the actual course before robot access.
3. Use the [updated runbook](../robot/UPDATED%20RUNBOOK.md) for all three recorded Robot A routes. Check the assembled video with sound.
4. Record observations and evidence references in [browser-scorecard.json](browser-scorecard.json). The filename is retained for existing links. It now covers survey, blind walks and filming. Use PASS / FAIL / NOT_RUN. A PASS needs an evidence reference. Record actual durations in seconds. Leave unknown values blank or null. Do not copy synthetic evidence into this scorecard.

```powershell
python -B .\qa\score.py .\qa\browser-scorecard.json
```

The local checker checks completeness and consistency of manual records. It does not verify the floor, listen to speech, inspect footage or submit anything. Exit codes: 0 recorded gates complete, 1 check failed, 2 evidence incomplete, 3 invalid input. A result of 0 still needs human sign-off on the cited evidence.
