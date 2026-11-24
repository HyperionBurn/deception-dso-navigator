# Robot test handoff: run Team Deception's voice navigator on Robot A

**Audience:** an AI coding agent (and the teammate driving it) who will connect our ElevenLabs voice agent to the AgiBot X2 humanoid ("Robot A") during the team's robot slot at Voice of the Oasis (Dtec, Dubai Silicon Oasis, 24–25 Nov 2026).
**Goal of this session:** get the robot to listen and speak through our agent, prove the audio path works end to end, and collect evidence (preflight output + logs). Directions on the floor are **not** expected to work yet (see "What to expect").

Read this whole file before running anything. Follow the safety rules exactly.

---

## 1. Context in 60 seconds

- **Challenge (AI Voice Navigator, Team Guide Update 24 Nov):** a visitor asks the robot, in Arabic/English (Hindi/Urdu also supported), for a place on this floor (meeting room, conference room, four call booths, team tables, kitchen). A **MangoBot operator** walks the robot. Our agent clarifies the request, gives the operator short **English** instructions one step at a time ("Operator, turn left. Walk straight and stop at sign B."), calls the stop, and confirms arrival to the visitor in the visitor's language.
- **Our code never moves the robot.** MangoBot controls all motion. Our bridge only touches the robot's **audio** (mic in, speaker out), its **LED strip and face emoji**, the **head touch sensor**, and optionally reads the **front camera**. Nothing else.
- **Pieces:**
  - ElevenLabs agent (cloud): "Deception | DSO AI Voice Navigator", id `agent_0101m86hthvjfm6vqeymg81may5e`. Audio is PCM 16 kHz in and out.
  - Website + API (Vercel): `https://deception-dso-navigator.vercel.app`. `/api/session` hands out short-lived signed sessions for the agent (gated by the team access code). `/api/route` is the agent's route tool. `/api/research` answers Dtec/DSO facts.
  - **Robot bridge (what you run):** `robot/bridge/navigator_bridge.py`. One long-lived Python process, ROS 2 Humble, in MangoBot's container on the robot's **PC2**.

---

## 2. Safety rules (from MangoBot, AgiBot and the organisers): never break these

1. Run code **only inside the container MangoBot opens for you on PC2**. **Never on PC1.** Never touch the OS, drivers, DDS, algorithm configs, firmware, power or hardware. No factory reset.
2. Save files **only under `/home/agi`**, never inside any `aimdk*` folder. Keep a copy on the laptop.
3. **At most 2 ROS nodes per second.** The bridge is one process with one node. Do not run it in a restart loop, and don't run several `ros2` CLI commands back to back without a pause.
4. **No motion.** The bridge has a built-in guard (`guard_ros_name`) that refuses any topic or service name outside an audio/LED/emoji/touch/camera allowlist, and any name containing `locomotion`, `command`, `upper_body`, `pnc_task`, `mc_`, `joint`, `hand`, `slam`, `nav`, `relocal`, `mapping`. **Do not edit or bypass this guard.**
5. If anything on the robot looks wrong (unexpected motion, alarms, odd sounds), **stop the bridge (`q` or Ctrl+C) and call the MangoBot engineer.**
6. **Secrets:** never paste API keys or the team access code into files, commits, chat logs or screenshots. Pass them as environment variables only. The team access code comes from Wasif (ask him; it isn't written in the repo on purpose).

---

## 3. Get the code

```bash
git clone https://github.com/HyperionBurn/deception-dso-navigator.git
cd deception-dso-navigator
```
The repo is private. The cloning GitHub account must be a collaborator (ask Wasif).

Everything needed on the robot is in `robot/bridge/`:

| File | Purpose |
|---|---|
| `navigator_bridge.py` | The bridge (robot / laptop / null modes, preflight, signals, camera markers) |
| `QUICKSTART.md` | One-page slot checklist (short version of this file) |
| `README.md` | Full bridge reference |
| `requirements.txt` | `websocket-client` (+ `numpy`; laptop mode also needs `sounddevice`) |
| `vendor/` | Offline wheel of `websocket-client` for containers without pip internet |
| `phrases/*.pcm` | Pre-recorded offline phrases (connection lost / back / one moment), EN + AR |
| `test_bridge.py` | Unit tests (`python -m unittest test_bridge.py`, no ROS needed) |

Related: `robot/SENSORS.md` (camera/LiDAR topics, read-only), `robot/markers/markers.pdf` (printable sign + ArUco marker sheets), `.cache/org-bridge.py` is NOT in git (the organisers' original bridge came by email; ours matches its behaviour).

---

## 4. Prepare the robot container (MangoBot does the first part)

1. **Ask MangoBot to:** put the robot in **voice-only mode**, open your container on **PC2**, tell you the **AimDK install path**, the **wake word**, and which **mic** is active (built-in or external).
2. **Copy the bridge to PC2** (from the laptop; the engineer gives the address/user):
   ```bash
   scp -r robot/bridge agi@<PC2-address>:/home/agi/deception
   ```
3. **Inside the container:**
   ```bash
   cd /home/agi/deception
   pip3 install websocket-client numpy
   # If pip has no internet, install the bundled wheel instead:
   # pip3 install --no-index --find-links vendor websocket-client
   source /opt/ros/humble/setup.bash
   source <aimdk>/install/setup.bash        # exact path from the MangoBot engineer
   export NAVIGATOR_ACCESS_CODE='<team code from Wasif>'
   ```
   Optional instead of the code: `export ELEVENLABS_API_KEY=...` (only if Wasif gives you the key) enables `--session direct`.

---

## 5. Preflight (always run first)

```bash
python3 navigator_bridge.py --preflight
```
It runs one ROS node for about 15 s, prints a PASS/FAIL checklist and exits. **Say the robot's wake word while it listens to the mic.** It checks:

1. Python imports (`websocket-client`, `numpy`, `rclpy`, `aimdk_msgs`)
2. DNS + HTTPS to `api.elevenlabs.io` and to our site
3. Signed session URL (site path with the code, or direct with the key)
4. ROS topics exist: `/agent/process_audio_output` (mic, VAD stream) and `/aima/hal/audio/playback` (speaker)
5. Mic messages arrive (count, `stream_id`s seen, whether VAD "speech begin" appears)
6. Speaker focus granted (`RequestAudioFocus`)
7. Speaker test: plays `phrases/back_en.pcm`. You should **hear** "I'm back…" from the robot
8. A real websocket connect to the agent and its first-message audio
9. Lists any `/slam/*` or `/localization*` topics (information only)

**Copy the full preflight output and send it to Wasif.** Each FAIL line says what to fix or ask.

---

## 6. Run the bridge

```bash
python3 navigator_bridge.py
```
Defaults (match the organisers' official bridge): `--io robot`, `--mic vad` (voice-only stream, locks to the first `stream_id` seen), **full duplex**, speaker focus priority 8 (re-requested if lost), interruption = clear queue + new playback token + `StopAudioPlay`, 0.3 s playback lead, `--session auto` (our site first, then direct with the key if set).

**Then:** say the wake word **once**, then talk normally.

**Keys while running:** `Enter` = end conversation and start a fresh one (fresh take) · `m` + Enter = mute/unmute mic · `q` + Enter (or Ctrl+C) = quit cleanly. **Head touch** on the robot = fresh take (2 s debounce).

**Useful flags:**

| Flag | When |
|---|---|
| `--half-duplex` | The robot hears itself and interrupts its own speech. Mic mutes while it speaks (loses barge-in). |
| `--mic-stream N` | Force a specific VAD stream id (0 = first seen). Ask MangoBot which id the external mic uses; the docs are ambiguous. |
| `--mic raw` | Only if the VAD stream never arrives: uses `/aima/hal/audio/capture` (no wake word, not echo-cancelled; pair with `--half-duplex`). |
| `--volume N` | Speaker volume 0–100 (best effort). |
| `--camera-markers` | Front RGB-D camera reads our printed ArUco signs and tells the agent "Robot camera sees the marker for sign B". Needs OpenCV (`cv2` with aruco) in the container; ask MangoBot. Read-only. |
| `--no-signals` / `--no-touch` | Disable LED/emoji phase signals / head-touch fresh take. |
| `--session site` / `direct` | Force a session path. |

**What you'll see on the robot:** LED and face change with phase (connecting, listening, user speaking, thinking, speaking, reconnecting, error). If the network drops, the robot says locally "Operator, stop. Stay where you are. I lost my connection." (EN + AR), reconnects automatically (backoff 1/2/4/8/16 s) and gives the agent the last 12 lines so it continues.

**Logs:** `logs/<timestamp>.log` (transcripts, state changes) and `logs/latency-<timestamp>.csv` (per turn: speech end → transcript → first agent audio → played). Median and worst latency print on quit. **Send both files to Wasif.** They contain transcripts but no secrets.

---

## 7. Test script for this slot (do in order, note PASS/FAIL for each)

1. **Preflight** all PASS (or note which FAIL).
2. **Greeting:** after start, the robot says "أهلًا، أنا دليل آلي بالذكاء الاصطناعي. Hi, I'm an AI robot guide. Where would you like to go?"
3. **Arabic request:** after the wake word, say "أبغى مكان هادي أسوي فيه مكالمة". Expect the Arabic reply "تبي كابينة مكالمات؟" (call booth?).
4. **Confirm:** "إيه". Expect Arabic confirmation + an English line starting "Operator, we're going to a call booth…" and a question about where the robot is.
5. **Operator line:** "Operator here, at sign A facing the kitchen." Expect it to check the route and then **hold** and ask what the operator can see (the real map is still empty; that is correct behaviour).
6. **English + destination change:** "English please, actually take me to the kitchen." Expect English, "Operator, stop." (or hold) and the new destination confirmed.
7. **Interruption:** talk over the robot while it speaks. Expect it to stop speaking within about 0.5 s. If it instead keeps interrupting **itself**, restart with `--half-duplex` and note that.
8. **Fact question:** "What bus goes to Dubai Silicon Oasis?" Expect "One moment" then an answer (routes 50, 320, 365, 366, X25).
9. **Hindi (optional):** "मुझे रसोई जाना है". Expect a Hindi reply and an English operator line.
10. **Fresh take:** press Enter (or touch the head). Expect a new greeting.
11. **Network drop (optional, ask first):** briefly disconnect the container network. Expect the local "Operator, stop…" phrase, then reconnection.
12. **Camera markers (optional):** with OpenCV available, run with `--camera-markers` and hold a page from `robot/markers/markers.pdf` in front of the robot's chest camera for about 2 s. Expect a log line about the marker; the agent now knows that sign.

---

## 8. What to expect, honestly

- **Works today (tested against production):** greeting; Arabic/English/Hindi understanding and replies (Arabic and Hindi audio verified clean by transcribing the agent's own speech); clarifying questions; separate English operator lines; destination changes; route tool calls; facts via research; recognising requests under loud background music.
- **Works on the rehearsal (fictional) map only:** multi-step routes (new step after every "Done", stop, confirm, arrival) and re-planning after a destination change.
- **Not yet:** **real floor directions.** The production floor map is empty until the team walks the floor and records signs and legs (`qa/SURVEY FORMAT.md`, then `npm run map:ingest` in `app/`). Until then the agent will hold at every step. This is expected.
- **Never run on the robot before:** robot mode of the bridge (written exactly from the AgiBot docs and the organisers' bridge, unit-tested, but this slot is its first real run).

---

## 9. Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| Preflight FAIL on HTTPS / session | No internet in the container → tell the engineer. Fallback: laptop mode (below). |
| `aimdk_msgs` import fails | AimDK `setup.bash` not sourced, or the wrong path → ask the engineer. |
| No mic messages | Robot not in voice-only mode, wake word not said, or a different stream → ask MangoBot; try `--mic-stream N`; last resort `--mic raw --half-duplex`. |
| Speaker silent | Focus not granted (log shows `focus_gain=false`), or volume → ask MangoBot; try `--volume 70`. Agent output must be `pcm_16000` (it is). |
| Robot interrupts itself | Restart with `--half-duplex`. |
| Robot talks over people / barge-in fails | Normal in half duplex; in full duplex check the log for `interruption` events. |
| Agent keeps saying "are you there" | Should be fixed (noise turns ignored, 15 s timeout). Note it in the log if seen. |
| Repeats the same instruction | Route tool problem → check `SESSION:`/`PROTOCOL:` log lines, send the log to Wasif. |
| Loud room, misses speech | Ask the engineer for the external mic, then `--mic-stream <id>`. |
| Anything unexpected on the robot | `q` / Ctrl+C, call the MangoBot engineer. |

**Laptop fallback** (container has no internet, or robot audio fails): on a laptop next to the robot, with a speaker,
```bash
cd robot/bridge
pip install websocket-client numpy sounddevice
python navigator_bridge.py --io laptop --code '<team code>'
```
**Network check only** (no audio devices): `python navigator_bridge.py --io null --code '<team code>'`.

---

## 10. Questions to ask MangoBot at the slot

1. Is the robot in voice-only mode, and what is the wake word?
2. Which mic is active, and which `stream_id` does it publish on `/agent/process_audio_output`?
3. Does the container have internet (to `api.elevenlabs.io` and `deception-dso-navigator.vercel.app`)?
4. To interrupt playback, is `StopAudioPlay` plus a new `token_id` the intended path?
5. Mic topic QoS: RELIABLE or BEST_EFFORT? (The docs disagree; the bridge uses the documented table values.)
6. Can OpenCV (`opencv-contrib-python-headless`) be installed in the container for `--camera-markers`?
7. Is `/slam/lidar_odom` publishing (a map loaded and the robot relocalised)? Read-only interest only.

---

## 11. What to send back to Wasif after the slot

1. Full preflight output.
2. `logs/*.log` and `logs/latency-*.csv` from `/home/agi/deception/logs/`.
3. PASS/FAIL for each step in section 7, plus anything odd (self-interruption, missed words, delays).
4. Answers to the questions in section 10.
5. Any floor walk notes (sign positions, facing directions, turns between signs) for the map.

**Do not** edit `navigator_bridge.py` on the robot unless Wasif asks. If a change is needed, make it on the laptop, run `python -m unittest test_bridge.py`, copy it over, and tell Wasif what changed.
