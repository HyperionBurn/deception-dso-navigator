# Navigator audio bridge

Connects the AgiBot X2 mic + speaker (ROS2) to the hosted ElevenLabs voice
agent over the same signed-URL websocket the browser client uses. Audio only —
it never publishes motion or control topics.

## Setup (MangoBot container / laptop on the robot)

```sh
pip install -r robot/bridge/requirements.txt   # sounddevice/numpy not needed on the robot
export NAVIGATOR_ACCESS_CODE=...               # or pass --code
```

`rclpy` + `aimdk_msgs` must already be in the container (they are, per the
AgiBot AimDK image — the `py_examples` package uses the same imports).

## Run

```sh
# preflight first — one ROS node, PASS/FAIL checklist, then exits
python3 robot/bridge/navigator_bridge.py --preflight

# on the robot (default --io robot --mic vad --session auto, full duplex)
python3 robot/bridge/navigator_bridge.py

# raw capture mic instead of the VAD stream (averages all mic channels)
python3 robot/bridge/navigator_bridge.py --mic raw --mic-channel 0

# pin a VAD stream: 0 = first seen (default), 1 built-in, 2 external mic
python3 robot/bridge/navigator_bridge.py --mic-stream 2

# session paths: auto (site → ElevenLabs fallback, default),
# direct (ELEVENLABS_AGENT_ID + ELEVENLABS_API_KEY → get-signed-url),
# site (our /api/session only, needs the access code)
python3 robot/bridge/navigator_bridge.py --session direct

# if it interrupts itself: mic mutes while the robot speaks (org advice)
python3 robot/bridge/navigator_bridge.py --half-duplex

# ArUco sign markers via the RGB-D front camera (read-only, needs cv2+numpy)
python3 robot/bridge/navigator_bridge.py --camera-markers

# speaker volume 0-100 (optional, best effort)
python3 robot/bridge/navigator_bridge.py --volume 80

# robot extras, both on by default in --io robot
python3 robot/bridge/navigator_bridge.py --no-signals   # no LED strip / face emoji
python3 robot/bridge/navigator_bridge.py --no-touch     # no head-touch fresh take

# rehearsal / backup on a laptop mic+speaker
python robot/bridge/navigator_bridge.py --io laptop

# headless network check: silence in, audio discarded
python robot/bridge/navigator_bridge.py --io null
```

## Keys (stdin)

- `Enter` — end the session and start a fresh take
- `m` `Enter` — toggle mic mute
- `q` `Enter` or `Ctrl+C` — stop playback, abandon audio focus, quit

## Behaviour notes

- **Half duplex** (off by default, like the organizers' bridge): with
  `--half-duplex`, while agent audio is playing plus a 500 ms tail the bridge
  sends zeroed frames instead of mic audio. Enable it if the robot interrupts
  itself on its own speaker echo.
- **Mic stream**: `--mic vad` (default) locks onto the first `stream_id` seen
  on `/agent/process_audio_output` and drops the rest — the approved MangoBot
  voice-only-mode path: say the wake word once, then talk continuously.
- **Playback**: publishes paced with a 0.3 s lead; on `interruption` the queue
  is drained, `token_id` is bumped (a new token clears the robot's playback
  buffer) and `StopAudioPlay` is called.
- **Audio focus**: requested at priority 8 on start; if `focus_response`
  reports a loss for our pkg_name it is re-requested automatically.
- **Camera markers** (`--camera-markers`): read-only subscription to the RGB-D
  front camera's MJPEG topic, ArUco DICT_4X4_50 at ≤2 fps. A marker seen in 3
  consecutive processed frames is sent to the agent as a `contextual_update`,
  at most once per marker per 20 s. Marker ids → signs in `MARKER_LABELS`;
  printable pages in `robot/markers/`; the full sensor inventory is
  `robot/SENSORS.md`. Without `cv2` it logs once and disables.
- **Reconnect**: on an unexpected socket drop it retries with 1/2/4/8/16 s
  backoff (max 5) and injects a `contextual_update` containing the last ~12
  transcript lines so the agent resumes the conversation.
- Logs go to console and `robot/bridge/logs/<timestamp>.log`. The access code
  and signed URL are never printed.
- **Motion guard**: every ROS topic/service the bridge opens passes
  `guard_ros_name` — an audio-only allowlist plus a fragment denylist
  (`locomotion`, `command`, `pnc_task`, `slam`, `nav`, `joint`, `hand`,
  `relocal`, `mapping`, `mc_`, …). Anything else raises at startup.
- **Fallback phrases** (`phrases/*.pcm`, rendered by `make_phrases.py`):
  played locally with no network — CONNECTION LOST → "Operator, stop…" in
  English + Arabic, reconnect → "I'm back…", >6 s of agent silence after a
  user turn → "One moment." (once per turn).
- **Latency log**: per turn, user-speech-end → first agent audio → first
  frame played is appended to `robot/bridge/logs/latency-<ts>.csv`; the
  median and worst case print on quit.

## "I'm listening" signals (robot mode)

The LED strip + face screen follow the conversation phase (`PHASE_SIGNALS` in
the code): flowing amber while connecting, steady green when listening, flowing
green while the visitor is talking, breathing amber while thinking, steady blue
while the agent speaks, blinking orange on reconnect, steady red on error, dim
breathing when stopped. Emoji loops match (open eyes, calm, thinking, happy,
confused, sad, sleeping). Both services are called with priority 6 and
`reset_priority=false` — system fault LEDs/emojis always preempt us. A tap on
the head touch sensor (`/aima/hal/sensor/touch_head`, 2 s debounce) starts a
fresh take, same as `Enter`. Everything is best-effort and never blocks audio;
`--no-signals` / `--no-touch` disable. If the LED strip seems stuck, another
source may hold a higher priority — see troubleshooting; per the docs you can
stop `task_manager` on PC1 (`aima em stop-app task_manager`) to keep the strip.

## `--mic vad` caveat

`/agent/process_audio_output` only emits audio while VAD is active, which
requires the wake word first. MangoBot puts the robot in voice-only mode for
the slot, so VAD stays on once woken — say the wake word once, then talk
normally. `--mic raw` remains as a fallback for continuous capture.

## Troubleshooting

- `session request failed` / `403` — wrong access code, or the robot has no
  outbound HTTPS. With `--session direct` only `api.elevenlabs.io` must be
  reachable. Check `curl -I https://deception-dso-navigator.vercel.app`.
- `IO failed to start` on robot — `aimdk_msgs` not in PYTHONPATH; run inside
  the AimDK container that has `py_examples` and `source` the install setup.
- `focus_gain=false` — another source holds playback focus; we request at
  priority 8 like the organizers' bridge. Ask MangoBot to check the agent
  module.
- Choppy robot audio — the raw capture topic is RELIABLE+VOLATILE; keep the
  bridge on the same host as hal_audio.

## Docs ambiguities to confirm with MangoBot

- `ProcessedAudioOutput.stream_id`: the interface page shows both 0-based and
  1-based numbering in two fragments — we lock onto the first one seen.
- `AudioCapture`: `info.channels` = mic + ref channels, mic channels first.
  `pkg_name` always empty in current firmware.
- `SetVolume(0)` auto-mutes; `SetVolume(>0)` un-mutes (documented linkage).
