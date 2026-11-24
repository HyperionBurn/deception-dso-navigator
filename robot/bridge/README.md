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
# on the robot (default --io robot --mic raw --half-duplex)
python3 robot/bridge/navigator_bridge.py

# single raw mic channel instead of averaging all mic channels
python3 robot/bridge/navigator_bridge.py --mic-channel 0

# VAD-processed mic (denoised 16 kHz mono stream)
python3 robot/bridge/navigator_bridge.py --mic vad

# speaker volume 0-100 (optional, best effort)
python3 robot/bridge/navigator_bridge.py --volume 80

# rehearsal / backup on a laptop mic+speaker (full duplex by default)
python robot/bridge/navigator_bridge.py --io laptop

# headless network check: silence in, audio discarded
python robot/bridge/navigator_bridge.py --io null
```

## Keys (stdin)

- `Enter` — end the session and start a fresh take
- `m` `Enter` — toggle mic mute
- `q` `Enter` or `Ctrl+C` — stop playback, abandon audio focus, quit

## Behaviour notes

- **Half duplex** (default on robot): while agent audio is playing plus a 400 ms
  tail, the bridge sends zeroed frames instead of mic audio (the raw mic has no
  echo cancellation). `--full-duplex` disables this.
- **Reconnect**: on an unexpected socket drop it retries with 1/2/4/8/16 s
  backoff (max 5) and injects a `contextual_update` containing the last ~12
  transcript lines so the agent resumes the conversation.
- Logs go to console and `robot/bridge/logs/<timestamp>.log`. The access code
  and signed URL are never printed.

## `--mic vad` caveat

`/agent/process_audio_output` only emits audio while VAD is active, which
requires the wake word first. In default mode VAD stays on only briefly after
each wake; in `only_voice` mode it stays active long once woken. Prefer
`--mic raw` for continuous capture unless the venue has configured
`only_voice`.

## Troubleshooting

- `session request failed` / `403` — wrong access code, or the robot has no
  outbound HTTPS. Check `curl -I https://deception-dso-navigator.vercel.app`.
- `IO failed to start` on robot — `aimdk_msgs` not in PYTHONPATH; run inside
  the AimDK container that has `py_examples`.
- `focus_gain=false` — another source holds playback focus; our priority is 6
  (INTERACTION_L6). Robot-side charging TTS is also level 6 and can preempt.
- Choppy robot audio — the raw capture topic is RELIABLE+VOLATILE; keep the
  bridge on the same host as hal_audio.

## Docs ambiguities to confirm with MangoBot

- `AudioPlayback.token_id`: docs say *changing* token_id clears the playback
  buffer; we keep it constant (`deception_navigator`) and rely on
  `StopAudioPlay` for interrupts.
- `ProcessedAudioOutput.stream_id`: the interface page shows both 0-based and
  1-based numbering in two fragments — we don't filter on it.
- `AudioCapture`: `info.channels` = mic + ref channels, mic channels first.
  `pkg_name` always empty in current firmware.
- `SetVolume(0)` auto-mutes; `SetVolume(>0)` un-mutes (documented linkage).
