# Missing places: one question each, and the survey lines to fill in

Written 25 Nov 2026 from `evidence/floor/` (videos 3440-3442, their transcripts and OCR) and `qa/FLOOR FROM VIDEO.md`.
The evidence names none of these places, so nothing below is in the map. Each place goes live only after someone on the floor answers its question and walks its legs.

What the evidence does say:
- OCR of every full-size frame: no frame contains "meeting", "conference", "booth", "call" or "phone".
- The narration names only the pitch room, the cafeteria, the printer/scanner/lockers corner, "small private rooms" (tenant offices with frosted doors, not booths), the main staircase, the main hall, toilets and reception.
- The pitch room (3440 0:00-0:14) may be the "conference room", and the dim room behind its glass wall (0:00-0:03) may be the "meeting room". Both are guesses; neither is used.

## How to make one place live
1. Ask the question below and walk there from the nearest checked anchor (pitch room door, purple pillar, yellow pillar, cafeteria menu boards).
2. Fill the blanks (`___`) in its lines and paste them into `qa/survey.txt`. One `leg` line per direction walked. `<turn>` is one of `straight`, `left`, `right`, `around`.
3. `npm run map:ingest ../qa/survey.txt`, `npm run map:check`, `npm test`, then a pull request and a deploy.

## Robot start
**Question for the MangoBot operator:** "Where exactly will you put the robot at the start of each take, and which way will it face?"
**Photo:** from behind the robot at its start spot, showing what it faces.
Today the map assumes the pitch room door facing reception (from the video, not walked). If the answer matches, keep the line. If not, add the spot as an anchor and walk legs from it.
```text
start: A facing reception
# or, if the start is somewhere else:
anchor robot_start: ___ | aliases: start, the start, نقطة البداية
start: robot_start facing ___
leg robot_start facing ___ -> ___ : <turn> | exit facing ___
leg ___ facing ___ -> robot_start : <turn> | exit facing ___
```

## Meeting room
**Question for Adam or Seruga:** "Which door is the meeting room? Is it the dim room behind the pitch room's glass wall?"
**Photo:** the meeting room door with its sign, taken from the walkway.
```text
anchor meeting_room: ___ (exact sign or cue at the door) | aliases: meeting room, the meeting room, غرفة الاجتماعات
leg ___ facing ___ -> meeting_room : <turn> | exit facing ___
leg meeting_room facing ___ -> ___ : <turn> | exit facing ___
```

## Conference room
**Question for Adam or Seruga:** "Which room is the conference room? Is it the pitch room where the orientation was?"
**Photo:** the conference room door with its sign.
If it is the pitch room: the agent only routes to the guide ids, so the pitch room door must carry the id `conference_room`. In `qa/survey.txt`, rename anchor `A` to `conference_room` (keep its aliases, add the two below) and rename `A` in every leg and in `start`. Anchor ids must be unique, so do not add a second anchor at the same door.
```text
anchor conference_room: ___ | aliases: conference room, the conference room, قاعة المؤتمرات
leg ___ facing ___ -> conference_room : <turn> | exit facing ___
leg conference_room facing ___ -> ___ : <turn> | exit facing ___
```

## Call booths 1 to 4
**Question for Adam or Seruga:** "Where are the four call booths, and which one is booth 1, 2, 3 and 4?"
**Photo:** one photo from the walkway that shows all four booth doors, with a teammate pointing at booth 1.
If the booths stand in a row, walk to the first one and give each next booth its own short leg.
```text
anchor call_booth_1: ___ | aliases: booth one, first booth, call booth one, الكابينة الأولى
anchor call_booth_2: ___ | aliases: booth two, second booth, call booth two, الكابينة الثانية
anchor call_booth_3: ___ | aliases: booth three, third booth, call booth three, الكابينة الثالثة
anchor call_booth_4: ___ | aliases: booth four, fourth booth, call booth four, الكابينة الرابعة
leg ___ facing ___ -> call_booth_1 : <turn> | exit facing ___
leg call_booth_1 facing ___ -> call_booth_2 : straight | exit facing ___
leg call_booth_2 facing ___ -> call_booth_3 : straight | exit facing ___
leg call_booth_3 facing ___ -> call_booth_4 : straight | exit facing ___
leg call_booth_4 facing ___ -> ___ : <turn> | exit facing ___
```
The guide does not say whether booths are numbered on the doors. If they are not, agree a numbering with the organisers and write it down; the agent must say the same number the operator can see.

## Already live, still to walk
Every leg in `qa/survey.txt` comes from video 3440, not from a walk. Walk each one in both directions before filming (see "Verification walk" in `qa/FLOOR FROM VIDEO.md`).
