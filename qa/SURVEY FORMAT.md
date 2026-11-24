# Survey file format

One statement per line. Blank lines and lines starting with `#` are comments.
Ingest with `npm run map:ingest -- qa/survey.txt` (or `--dry-run` first).
Any unparseable line aborts with a line-numbered error and writes nothing.

## Statements

```
survey: <checked_at> | <checked_by> | <reference>
start: <id|LETTER> [facing <label> | heading <north|east|south|west>]
anchor <id|LETTER>: <landmark text> [| aliases: a, b, c]
leg <from> [facing <label> | heading <dir>] -> <to> : <action> [| exit facing <label> | exit heading <dir>]
```

- **survey** — becomes `map.survey` evidence inherited by every record.
- **start** — becomes `map.start`; only orders `known_landmarks` and seeds the
  audit route table. The planner never assumes the robot is at the start.
- **anchor** — `<id>` is a destination id (`call_booth_2`, `kitchen`, …) or a
  waypoint id. A **bare letter** (A, B, C…) is a taped sign: it maps to
  waypoint id `sign_a`, `sign_b`, … The landmark is the spoken cue.
- **leg** — a checked one-way edge; author both directions separately.
  `facing X`/`heading Y` after `from` is the required pose to take the leg
  (omit only for `approach`); `exit` is the pose the leg ends in.
  Actions: `straight` → walk_straight, `left` → left_then_straight,
  `right` → right_then_straight, `around` → around_then_straight,
  `approach` → approach_visible.
- `leg` endpoints must be declared anchors; a `.json` file with the
  `{anchors:[], edges:[]}` map shape is also accepted.

## EXAMPLE (fictional — not real floor data)

```
# Team taped letters A–D at decision points on 24 Nov 2026.
survey: 2026-11-24 16:40 | Wasif + Sahil | walk-1
start: A facing kitchen

anchor A: sign A by the entrance | aliases: letter A, entrance sign, اللافتة أ
anchor B: sign B at the corridor split | aliases: letter B, the split, اللافتة ب
anchor call_booth_2: Booth 2 sign | aliases: booth two, second booth, الكابينة الثانية
anchor kitchen: kitchen sign | aliases: المطبخ, food area
anchor C: sign C outside the call booths | aliases: letter C, اللافتة ج

leg A facing kitchen -> B : left | exit facing booths
leg B facing booths -> A : around | exit facing kitchen
leg B facing booths -> call_booth_2 : straight | exit facing booth two sign
leg call_booth_2 facing booth two sign -> B : around | exit facing booths
leg B facing booths -> kitchen : right | exit facing kitchen sign
leg C -> call_booth_2 : approach
```

Run `npm run map:ingest -- --dry-run qa/survey.example.txt` to see its audit.
