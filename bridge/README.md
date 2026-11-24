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
| `ros_adapter.py` | Robot mic and speaker (ROS 2). Imports ROS only when it starts. |
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
  mutes it instead, only if the robot hears itself.
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

## First 10 minutes at the robot (read-only first)

From plan section 5. One `ros2` command at a time, 1-2 seconds apart (each call starts a ROS node).

1. Ask the engineer: the wake word, is `only_voice` mode on, and can the container reach
   `wss://api.elevenlabs.io` on port 443 (and our site, if we use `BRIDGE_ACCESS_CODE`).
2. Look, do not touch:
   ```
   ros2 topic list
   ros2 topic info /agent/process_audio_output
   ros2 topic info /aima/hal/audio/playback
   ```
   Also look in the topic list for sensor, slam, task_master and mc/common names (only to read).
3. Run the SDK's own mic listener once (`mic_receiver`, ask MangoBot for the path). Note the chunk
   size and which `stream_id` is the built-in mic (the docs say 0 or 1). Set `ros_mic_stream` to it.
4. Play one saved phrase with the adapter (it asks for the speaker focus at priority 8).
   Run this in the folder that holds `bridge/`, after rendering the phrases:

```
python3 -c "import asyncio; from bridge.ros_adapter import RosAdapter as R
async def m():
    a = R(); await a.start(); a.play(open('bridge/phrases/heard_en.pcm','rb').read())
    await asyncio.sleep(3); await a.close()
asyncio.run(m())"
```

5. Start the bridge once: `python3 -m bridge --adapter ros --config bridge/config.example.json`.
   Say the wake word, speak Arabic and English. Check the first audio, whether the robot
   interrupts itself (then try `BRIDGE_MIC_GATE=half_duplex` or an external mic), and barge-in.
6. Stress: talk over it, play crowd noise from a phone, then (with the engineer's OK) cut only the
   internet uplink and check that the local phrase plays.
7. Write the timings on paper, write down the exact start command, and back up the code.

Start the bridge **once** and leave it running. The organisers allow at most 2 ROS nodes started per
second, so never restart it in a loop. The code refuses any topic or service whose name contains
`command`, `locomotion`, `upper_body`, `pnc_task`, `integrated_command`, `relocalization_pose`,
`SetMc` or `MigrateSystemState` (`assert_safe_name`), and it may publish only to the audio
playback topic.

## Tests

```
python -m pytest bridge/tests -q
```

All offline. They use a fake ElevenLabs server on localhost and a fake ROS. Python 3.10 or newer;
the only outside package is `websockets` (version 13 or newer).

## Unverified (guesses and gaps)

- **ROS adapter:** never ran on a robot. The robot's voice detector start (`AUDIO_VAD_STATE_BEGIN`)
  as "someone is here", the mic `stream_id`, and the audio focus handling are copied from the
  organisers' file, not checked.
- **Agent setup needed:** the agent must send these events to the client: `ping`, `audio`,
  `interruption`, `user_transcript`, `agent_response`, `agent_tool_request`,
  `agent_tool_response_full_payload`. Without `agent_tool_request` the bridge cannot know a route
  started (use `core.route_active` then). The docs say `agent_tool_response_full_payload` has to be
  switched on. Both audio formats must be `pcm_16000`, or the bridge stops with an error.
- **Route tracking:** a route counts as active for `route_idle_s` (300 s) after each call of the
  tool `next_route_step` (name taken from `agent/setup.md`), and ends early when that tool's full
  result contains `at_destination`. These rules are our guess.
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
