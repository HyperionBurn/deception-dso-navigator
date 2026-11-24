# Robot slot checklist — navigator_bridge.py

One page, in order. Fallback if anything blocks: run `--io laptop` on a laptop
next to the robot (same commands, plus `--mic raw` is irrelevant there).

## 1. Hand the folder to the robot (on PC2, never PC1)

```bash
scp -r bridge/ agi@<pc2>:/home/agi/deception/     # save only under /home/agi, never aimdk*
```

## 2. Inside the container on PC2

```bash
cd /home/agi/deception
pip3 install websocket-client numpy
# no pip internet? offline install from the vendored wheel:
# pip3 install --no-index --find-links vendor websocket-client numpy
source /opt/ros/humble/setup.bash && source <aimdk>/install/setup.bash   # engineer gives the AimDK path
export ELEVENLABS_API_KEY=sk_...        # private agent; from app/.env.local
# optional overrides:
# export ELEVENLABS_AGENT_ID=agent_...  # defaults to our prod agent
# export NAVIGATOR_ACCESS_CODE=...      # only needed for --session site
```

## 3. Preflight (one ROS node, ~15 s, prints PASS/FAIL)

```bash
python3 navigator_bridge.py --preflight
```

Checks imports, HTTPS, signed session URL, ROS topics, mic stream (say the
wake word while it listens 5 s), audio focus, speaker (`back_en.pcm`), and a
real websocket connect. Every FAIL line tells you what to ask for.

## 4. Run

```bash
python3 navigator_bridge.py                 # VAD mic, session auto (site → direct)
python3 navigator_bridge.py --half-duplex   # only if it interrupts itself
```

Enter = fresh take · `m` = mic mute · `q` = quit. Head touch = fresh take.

## 5. Talk

Say the robot's wake word once (MangoBot says which), then talk normally.

## If something goes wrong

| Symptom | Fix |
|---|---|
| It interrupts itself | Restart with `--half-duplex` (mic mutes while the robot speaks) |
| Speaker stays silent | Agent output must be `pcm_16000`; check `FOCUS: … focus_gain=false` in the log — ask MangoBot to check the agent module |
| No connection | No internet in the container — tell the engineer; or `--session direct` with `ELEVENLABS_API_KEY` |
| Loud room | Ask the engineer for the external mic, then `--mic-stream 2` |
| Repeats leg-1 instruction | Site route tool down — check `SESSION:`/`PROTOCOL:` log lines |

## The four questions for MangoBot

1. Which wake word wakes the mic stream?
2. What is the AimDK install path on PC2 (for `source <aimdk>/install/setup.bash`)?
3. Is `focus_gain` granted to us at priority 8 — can you watch `focus_response` if it flaps?
4. Is there an external mic we can use if the room is loud (`--mic-stream 2`)?

## Hard rules (from MangoBot/AgiBot)

- Code only inside the container on PC2. Never PC1 (<robot-ip>).
- At most 2 ROS nodes — our bridge runs exactly one.
- Save only under `/home/agi`, never in `aimdk*`. Keep a copy on your laptop.
- Don't touch OS, drivers, DDS, configs, firmware, power, hardware. No factory reset.
- Anything looks wrong → stop, call the MangoBot engineer.
