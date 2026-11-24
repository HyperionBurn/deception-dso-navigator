# Our bridge vs the organisers' starter bridge

Compared line by line: `robot/bridge/navigator_bridge.py` against
`robot/reference/organisers_elevenlabs_robot_bridge.py` (25 Nov 2026). Audio only in both; neither touches a motion topic.

| Part | Organisers | Ours | Same? |
|---|---|---|---|
| Mic topic (default) | `/agent/process_audio_output`, `ProcessedAudioOutput`, KEEP_LAST 500, BEST_EFFORT | same (`--mic vad`) | yes |
| Mic stream | lock on first `stream_id`, or `MIC_STREAM` | lock on first, or `--mic-stream` | yes |
| Raw mic | none | `--mic raw`: `/aima/hal/audio/capture`, `AudioCapture`, mic channels averaged, ref channels dropped, resampled to 16 kHz | ours only |
| Mic to agent | 100 ms `user_audio_chunk`, silence when nothing heard | same (3200 B chunks; silence on empty) | yes |
| Half duplex | drop mic while speaking (`lead + 0.5 s`) | send silence while queued audio + 0.5 s plays | yes |
| Speaker topic | `/aima/hal/audio/playback`, `AudioPlayback`, channels 1, 16000 Hz, `pkg_name`, `token_id = pkg-N` | same | yes |
| Speaker pace | 100 ms chunks, 0.3 s lead | 100 ms chunks, 0.3 s lookahead | yes |
| Agent output rate | resample if not 16 kHz | refuse anything but `pcm_16000` both ways (closes socket) | stricter |
| Interruption | clear buffer, new token, `StopAudioPlay` | same | yes |
| Audio focus | `RequestAudioFocus` priority 8, re-request on loss, abandon on exit | same | yes |
| Service calls | `wait_for_service` per try, `call_async`, done callback, wait `timeout*4` | **was** `future.result(timeout=…)`, which rclpy does not accept, so every call failed silently; now the organisers' pattern, with each try's done-event bound to that try (the organisers' lambda reads the loop variable, so a late reply to try 1 wakes try 2 early) | fixed in this PR |
| Focus success check | `status == SUCCESS and focus_gain` | `focus_gain` only | close enough |
| Socket | `get-signed-url` with API key, or public agent id | our site (team access code) first, direct signed URL as fallback | ours adds |
| Ping | pong with `event_id` | same | yes |
| Extras | none | reconnect with transcript context, "one moment" phrase, latency CSV, LEDs/emoji, head touch, volume, preflight, optional camera markers | ours only |

## What the service-call bug meant on the robot
`_call` is used by audio focus, stop playback, volume, LEDs, emoji and focus release. With rclpy's `Future.result()` (no arguments), each try raised `TypeError`, was swallowed, and the call returned `None`. So on the robot: focus was never confirmed, `--volume` did nothing, barge-in did not call `StopAudioPlay` (only the token change cleared the buffer), and LEDs/emoji never changed. `--preflight` was not affected (it spins its own node).

## Proof (no robot)
`python -m pytest -q robot/bridge/test_bridge.py`: 87 passed, 2 skipped. With the old `_call`, 6 of the new tests fail; without the per-try binding, 1 fails.
- `ServiceCallTests`: fake client + a future with the same surface as `rclpy.task.Future`.
- `MicPathTests`: robot mic message → `RobotIO` → `Bridge` → exact `user_audio_chunk` bytes on the socket (raw 16 kHz with and without `info`, raw 48 kHz, VAD stream, half duplex, before negotiation).
- `PlaybackPathTests`: agent `audio` event → `RobotIO.play` → `AudioPlayback` messages: bytes in order, 3200 B each, 1 ch / 16000 Hz, our `pkg_name`/token, real-time pace; interruption starts token `-1`.

## Not proven
Nothing here ran against real `rclpy`/`aimdk_msgs` or the robot. Whether `AudioCapture` has an `info` field is not in the vendor docs; the code now works either way.
