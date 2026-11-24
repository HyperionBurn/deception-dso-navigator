# Robot bridge

The bridge moves **audio only** between the robot (mic and speaker, through ROS 2) and our
ElevenLabs voice agent (a WebSocket). It never moves the robot. The agent's knowledge and tools
live on the ElevenLabs side (server webhook tools), not here.

> `bridge/` is derived from the organisers' starter bridge (`elevenlabs_robot_bridge.py`).
> **Declare it as starter code in the submission.**

> **The ROS adapter (`ros_adapter.py`) is UNTESTED on a real robot.** It only ran against a small
> fake ROS in the tests. The first run on the robot is the real test.

## What is in here

| File | What it does |
|---|---|
| `core.py` | The session logic. No ROS, no audio devices, so it runs on any laptop. |
| `ros_adapter.py` | Robot mic and speaker (ROS 2). The mic is the raw microphone topic by default, or the wake-word topic. Imports ROS only when it starts. |
| `laptop_adapter.py` | Laptop mic and speaker, so we can all test without the robot. |
| `wav_replay.py` | Plays a WAV file as the mic and writes the agent's voice to a WAV file. |
| `render_phrases.py` | Makes the local fallback phrases with the ElevenLabs text-to-speech API. |
| `__main__.py` | `python -m bridge ...` |
| `phrases.json`, `config.example.json` | Phrase list and settings (no secrets). |
| `tests/` | Offline tests (fake ElevenLabs server on localhost). |

## What the core does

- Starts a conversation only when someone is there (voice at the mic, or the adapter's presence
  signal, for example the robot's own voice detector). Ends it after `quiet_end_s` of quiet,
  **never while a route is active**. Each visitor gets a new conversation and a new `session_id`.
- Sends `session_id`, `source: "robot"` and `resumed` as dynamic variables.
- Keeps the mic open while the robot speaks (so people can interrupt). `mic_gate: half_duplex`
  mutes it instead. On the robot that is the default, because the raw mic has no echo
  cancellation (see "First 10 minutes at the robot").
- Drops agent audio that is older than the last interruption (same rule as `voice.mjs`).
  Stopping the speaker runs in a thread, so it never blocks the socket.
- Plays local phrases: `heard` after `heard_after_s`, `one_moment` after `slow_after_s`,
  `connection_slow` when the link is down, `operator_stop` at once when the link drops while a
  route is active.
- On a lost link it reconnects (1 s up to 15 s), as a new conversation with the same `session_id`
  and `resumed: true`.
- Writes `latency.csv`: one row per visitor turn (see below).
- Answers any `client_tool_call` with an error result so the agent does not wait.
- Hooks for the app: `on_user_text`, `on_agent_text`, `on_event` (also gets `bridge_*` events:
  session start/end, link up/down). `core.signal_presence()` and `core.route_active = True/False`
  are for the app too.

## Run it on a laptop

```
pip install "websockets>=13" sounddevice
```

Use headphones (a laptop speaker next to its mic makes the agent hear itself). Then set **one** of:

```
# preferred: the team site gives a signed URL, so the ElevenLabs key never leaves the site
export BRIDGE_ACCESS_CODE=...                  # PowerShell:  $env:BRIDGE_ACCESS_CODE = "..."
# fallback: ask ElevenLabs directly (the key is then on this PC)
export ELEVENLABS_AGENT_ID=...  ELEVENLABS_API_KEY=...
```

```
python -m bridge --adapter laptop --config bridge/config.example.json
```

Say something. The conversation starts when you speak. Stop talking for 20 s and it ends.
Any setting can be changed with an environment variable `BRIDGE_<NAME>`, for example
`BRIDGE_QUIET_END_S=30` or `BRIDGE_MIC_GATE=half_duplex`. Press Ctrl+C to stop.

## Replay a WAV file (noise and music tests)

The file must be 16 kHz, mono, 16-bit. Convert with
`ffmpeg -i in.mp3 -ar 16000 -ac 1 -sample_fmt s16 in.wav`.

```
python -m bridge --adapter wav --wav-in test.wav --wav-out agent.wav --config bridge/config.example.json
```

It plays in real time (the agent needs that), adds 3 s of silence at the end, and stops when the
conversation is over. `--fast` replays quicker, but then the timers and the latency numbers mean
nothing. Change one setting per run, as in plan section 4.7.

## Latency numbers

Each turn is one row in `latency.csv`: when the person stopped talking (last loud mic chunk),
when the first agent audio arrived, when the first sample was played, and the gaps in ms.
Print the median and the worst case:

```
python -m bridge --latency-summary latency.csv
```

On the robot "first sample played" is the moment we hand audio to the robot, not the moment
sound comes out of the speaker.

## Make the local phrases

Only phrases with `"reviewed": true` are made, unless you add `--include-unreviewed`.
The English ones are reviewed. The Arabic ones are **not**: a teammate who speaks Gulf Arabic
must check the text in `phrases.json` first, then set `reviewed` to `true`.

```
export ELEVENLABS_API_KEY=...
python -m bridge.render_phrases --voice-id <the agent's voice id>
```

This writes `bridge/phrases/*.pcm` (not committed). Listen to every file once. The bridge plays an
unreviewed phrase only if `allow_unreviewed_phrases` is true; otherwise it uses the English one.
There is no Arabic `operator_stop` on purpose: the operator always hears English.

## First 10 minutes at the robot (the organisers' working order)

> **This comes from the organisers' email. They tested it on a robot. We have NOT run it yet.**
> No password and no address are written here on purpose. The organisers give us both. Never save
> them in this repo.

Hackathon rules: only code inside **our own folder** may run. Never run anything on the
organisers' PC1. Start **at most 2 ROS nodes per second** (every `ros2` command starts one node, so
type one command, wait a second, then the next one). Save files only under `/home/agi`.

1. Connect with ssh as the shared robot user. The address and the password come from the
   organisers.
2. Make our own folder under the home folder and stay in it (it must be inside `/home/agi`).
   ```
   mkdir -p ~/deception_bridge && cd ~/deception_bridge
   ```
   Put the `bridge/` folder in there. The email does not say how to copy files in; `scp` from a
   laptop should work (not tried).
3. Set up the shell. Do this again in every new terminal:
   ```
   source /opt/ros/humble/setup.bash
   export PYTHONPATH=/agibot/software/common/local/lib/python3.10/dist-packages:$PYTHONPATH
   export LD_LIBRARY_PATH=/agibot/software/common/lib:$LD_LIBRARY_PATH
   export AMENT_PREFIX_PATH=/agibot/software/common:$AMENT_PREFIX_PATH
   ```
4. Install what the bridge needs into our own folder. `pip --user` is not allowed. The robot has
   Python 3.10, ROS 2 Humble and numpy, but no other packages. See "What the robot needs" below:
   only `websockets` is missing.
   ```
   python3 -m pip install --no-deps --target ./pylib "websockets>=13"
   export PYTHONPATH=$PWD/pylib:$PYTHONPATH
   ```
5. Switch off the built-in assistant for our slot, then restart the robot's agent app:
   ```
   ros2 service call /aimdk_5Fmsgs/srv/SetAgentPropertiesRequest aimdk_msgs/srv/SetAgentPropertiesRequest "{contents: {properties: [{key: {value: 2}, value: only_voice}]}}"
   aima em stop-app agent
   aima em start-app agent
   ```
6. Check that nobody else is playing audio (look at the list of publishers):
   ```
   ros2 topic info -v --no-daemon /aima/hal/audio/playback
   ```
7. Only if the room is loud: turn the volume up (the default was 72).
   ```
   ros2 service call /aimdk_5Fmsgs/srv/SetVolume aimdk_msgs/srv/SetVolume "{audio_volume: 95}"
   ```
8. Put our agent in the environment and start the bridge **once**. Use `ELEVENLABS_AGENT_ID`
   (plus `ELEVENLABS_API_KEY` if the agent is private) or `BRIDGE_ACCESS_CODE`, as in "Run it on a
   laptop". `HALF_DUPLEX=1` is what the organisers use; it is also our default on the robot.
   ```
   export ELEVENLABS_AGENT_ID=...
   HALF_DUPLEX=1 python3 -m bridge --adapter ros --config bridge/config.example.json
   ```
9. Before you leave:
   - Press Ctrl+C to stop the bridge.
   - Put the volume back: same `SetVolume` call with `{audio_volume: 72}`.
   - Put the agent property back to normal: the same `SetAgentPropertiesRequest` call as in step 5,
     with `value: normal` instead of `value: only_voice`.
   - Restart the agent app: `aima em stop-app agent`, then `aima em start-app agent`.

### What the robot code does by default

With `--adapter ros` the bridge starts with these settings. The config file and the environment can
change them.

| Setting | Environment variable | Default on the robot | What it means |
|---|---|---|---|
| `ros_mic_source` | `BRIDGE_ROS_MIC_SOURCE` | `raw` | `raw` = the microphones on `/aima/hal/audio/capture`. Always on, no wake word. `wake_word` = the old `/agent/process_audio_output`, which is silent until the wake word. |
| `mic_gate` | `BRIDGE_MIC_GATE`, or `HALF_DUPLEX=1` / `HALF_DUPLEX=0` | `half_duplex` | The raw mic has no echo cancellation, so the mic is muted while the robot speaks. Otherwise the robot hears itself and answers itself. `none` keeps the mic open. |
| `ros_mic_stream` | `BRIDGE_ROS_MIC_STREAM`, or `MIC_STREAM` | `0` | Only used with `wake_word`. |

The raw mic message has several channels (6 = 4 microphones + 2 speaker-reference channels). The
bridge averages the real microphone channels (`mic_channels`, the first ones) into one 16 kHz mono
stream, like the organisers' code, and ignores the reference channels. Other adapters (laptop, wav)
still start with `mic_gate: none`. That is why `config.example.json` has no `mic_gate` line: a line
there would win over the robot default.

Because the mic is muted while the robot speaks, **nobody can interrupt the robot**. That is the
price of no echo cancellation. `echo_tail_s` (0.3 s) is the extra mute time after the robot stops.

### Our own checks once it runs

1. Ask the engineer whether the container can reach `wss://api.elevenlabs.io` on port 443 (and our
   site, if we use `BRIDGE_ACCESS_CODE`).
2. Look, do not touch (one command at a time):
   ```
   ros2 topic list
   ros2 topic info /aima/hal/audio/capture
   ros2 topic info /aima/hal/audio/playback
   ```
   Also look in the topic list for sensor, slam, task_master and mc/common names (only to read).
3. Play one saved phrase with the adapter (it asks for the speaker focus at priority 8).
   Run this in the folder that holds `bridge/`, after rendering the phrases:

```
python3 -c "import asyncio; from bridge.ros_adapter import RosAdapter as R
async def m():
    a = R(); await a.start(); a.play(open('bridge/phrases/heard_en.pcm','rb').read())
    await asyncio.sleep(3); await a.close()
asyncio.run(m())"
```

4. Start the bridge as in step 8. Speak Arabic and English. Check the first audio, and that the
   robot does not answer itself. If the end of its own sentence leaks back in, raise
   `BRIDGE_ECHO_TAIL_S`. If it does not hear quiet people, lower `BRIDGE_SPEECH_THRESHOLD`.
5. Stress: talk over it, play crowd noise from a phone, then (with the engineer's OK) cut only the
   internet uplink and check that the local phrase plays.
6. Write the timings on paper, write down the exact start command, and back up the code.

Start the bridge **once** and leave it running. Never restart it in a loop (2 ROS nodes per second at
most). The code refuses any topic or service whose name contains `command`, `locomotion`,
`upper_body`, `pnc_task`, `integrated_command`, `relocalization_pose`, `SetMc` or
`MigrateSystemState` (`assert_safe_name`), and it may publish only to the audio playback topic.

## What the robot needs (Python packages)

The robot code path is `python -m bridge --adapter ros`. It imports these outside packages:

| Package | Used by | Pure Python? | How it gets there |
|---|---|---|---|
| `websockets` (13 or newer) | `core.py`, needed by every adapter | **Yes.** It needs no other packages, and it has an optional C speed-up with a Python fallback. | `python3 -m pip install --no-deps --target ./pylib "websockets>=13"` |
| `rclpy`, `aimdk_msgs` | `ros_adapter.py`, imported only when the bridge starts | Not applicable: they come with ROS 2 Humble and the robot, not from pip. | Step 3 above |
| `numpy` | nothing in the bridge | Not used. The mixing is plain Python (`array`). | Already on the robot, not needed |

Everything else the robot path imports is in the Python standard library (`asyncio`, `json`,
`urllib`, `array`, and so on). `sounddevice` is only for the laptop adapter, and the tests need
`pytest`. Neither goes on the robot.

How we know: we read the imports of `core.py`, `ros_adapter.py` and `__main__.py`, and looked at the
`websockets` 15.0.1 copy on the build PC (no required packages; the C file `speedups` is optional and
the code falls back to Python if it is missing). We did not run `pip` for the robot, so we do not
know which file pip will pick there. Both work. Python 3.10 is fine for `websockets`.

## Tests

```
python -m pytest bridge/tests -q
```

All offline. They use a fake ElevenLabs server on localhost and a fake ROS. Python 3.10 or newer;
the only outside package is `websockets` (version 13 or newer), plus `pytest`. One test checks the
mono mixing against the organisers' numpy code and is skipped if numpy is not installed.

## Unverified (guesses and gaps)

- **ROS adapter:** never ran on a robot. The audio focus handling is copied from the organisers'
  file, not checked. With `wake_word`, the robot's voice detector start (`AUDIO_VAD_STATE_BEGIN`)
  as "someone is here" and the mic `stream_id` are copied too, not checked.
- **Raw mic (`ros_mic_source: raw`):** only run against a fake ROS. The topic name, the message type
  `AudioCapture`, its fields (`data.data`, `info.channels`, `mic_channels`) and the mic QoS (best
  effort, depth 500, same as the old mic topic) come from the organisers' email and file. The mixing
  gives the same bytes as their numpy code in a test, but we never saw a real message. Our guesses:
  a `mic_channels` below 1 means "first mic only", above `channels` means "all channels", and half a
  frame at the end of a message is dropped.
- **Raw mic, presence:** there is no voice detector in the raw mode. "Someone is here" comes from the
  mic loudness only (`speech_threshold` 500, never tried on this mic). Quiet speech may need a lower
  value.
- **Half duplex:** it stops the robot hearing itself, but nobody can interrupt it. We have not
  measured how much of the robot's own voice still leaks in at the end (`echo_tail_s`).
- **`pip install --no-deps --target ./pylib` for `websockets` on the robot:** not tried. We expect it
  to work (see "What the robot needs").
- **The organisers' steps** (service calls, `aima em ...`, volume): copied from their email, not run
  by us.
- **Agent setup needed:** the agent must send these events to the client: `ping`, `audio`,
  `interruption`, `user_transcript`, `agent_response`, `agent_tool_request`,
  `agent_tool_response_full_payload`. Without `agent_tool_request` the bridge cannot know a route
  started (use `core.route_active` then). The docs say `agent_tool_response_full_payload` has to be
  switched on. Both audio formats must be `pcm_16000`, or the bridge stops with an error.
- **Route tracking:** a route counts as active for `route_idle_s` (300 s) after each call of one
  of the routing tools: `plan_route`, `confirm_step`, `report_landmark`, `change_destination`,
  `next_route_step` (the list is `route_tools`; `get_state`, `find_place` and `handover` do not
  count). It ends early when one of those tools' full result contains `at_destination`. The tool
  names are the agent's current webhook tools; the rules are our guess.
- **`resumed`** is always sent (`false` on the first connection, `true` after a reconnect). The
  brief only asked for `true` on reconnects.
- **Stale audio:** we copy `voice.mjs` (drop if `event_id` is lower than the last interruption).
  The ElevenLabs Python SDK drops if it is lower or equal. Same in practice if ids are unique
  (our inference).
- **WebSocket sub-protocol:** we offer `convai` like the browser client. The organisers' bridge
  does not. If the server refuses it, remove it in `core.py`.
- **Signed URL from the site:** the request (`POST /api/session`, `Origin` header) follows
  `app/api/session.mjs` and works against a fake server. It was never run against the real site.
  A new URL is asked for on every (re)connect.
- **After a normal hang-up** by the agent, with no route active, the visit ends and the next
  presence starts a new visitor. With a route active the bridge reconnects.
- **Local phrase language** switches to Arabic once an Arabic `user_transcript` arrives (and
  Arabic phrases are allowed). An English "done" never switches it back.
- **Numbers to tune on the robot:** `speech_threshold` 500, `quiet_end_s` 20, `heard_after_s` 1.5,
  `slow_after_s` 4, keep-alive 5 s. The speech detector is a simple loudness check on the mic, and
  it ignores loud sound while the robot itself is speaking.
- **Phrase rendering:** model `eleven_flash_v2_5` is a default guess (set `--model` to match the
  agent). The PCM from the API is assumed to be 16-bit little-endian mono; listen to the files.
- **Billing:** we did not check how ElevenLabs bills a connection that is open but quiet. The
  bridge opens a conversation only when someone is there to keep that small.
- **Laptop adapter:** not run with a real microphone (the `sounddevice` package is not on the build
  PC). Tests ran on Windows with Python 3.11 only. The code was syntax-checked for 3.10 but not run
  on 3.10.
- **Not done:** the "play a phrase without audio focus" probe from step 4 has no switch yet; ask
  the engineer or use the SDK's own `play_audio_stream` example.
