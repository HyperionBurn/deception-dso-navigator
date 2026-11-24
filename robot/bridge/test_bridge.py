"""Unit tests for navigator_bridge. Runs without rclpy/sounddevice — those
imports are lazy inside the IO classes."""

import base64
import io as stdio
import json
import struct
import sys
import threading
import time
import types
import unittest
from unittest import mock

sys.path.insert(0, __file__.rsplit('\\', 1)[0] if '\\' in __file__ else '.')
import navigator_bridge as nb


def args(**over):
    base = dict(url='https://example.test', code='secret', half_duplex=True,
                log_file=None, io_backend=None)
    base.update(over)
    return types.SimpleNamespace(**base)


def pcm(samples):
    return struct.pack(f'<{len(samples)}h', *samples)


def interleaved(frames):
    """frames: list of tuples of per-channel int16 values."""
    out = []
    for frame in frames:
        out.extend(frame)
    return pcm(out)


class DeinterleaveTests(unittest.TestCase):
    def test_average_mic_channels(self):
        # 6 channels: 4 mic (values 10,20,30,40) + 2 ref (1000, -1000)
        data = interleaved([(10, 20, 30, 40, 1000, -1000)] * 8)
        out = nb.deinterleave_mic(data, total_channels=6, mic_channels=4)
        self.assertEqual(len(out), 8 * 2)
        self.assertEqual(struct.unpack('<8h', out), (25,) * 8)

    def test_single_channel(self):
        data = interleaved([(1, 2, 3, 4, 5, 6), (7, 8, 9, 10, 11, 12)])
        out = nb.deinterleave_mic(data, 6, 4, channel=2)
        self.assertEqual(struct.unpack('<2h', out), (3, 9))

    def test_channel_out_of_range(self):
        with self.assertRaises(ValueError):
            nb.deinterleave_mic(interleaved([(1, 2, 3, 4, 5, 6)]), 6, 4, channel=4)

    def test_unaligned_bytes_ignored(self):
        self.assertEqual(nb.deinterleave_mic(b'\x01\x00\x00', 2, 1), b'')


class ResampleTests(unittest.TestCase):
    def test_same_rate_passthrough(self):
        data = pcm(range(-5, 5))
        self.assertEqual(nb.resample_linear(data, 16000), data)

    def test_downsample_length_and_shape(self):
        data = pcm([0, 1000, 0, -1000] * 250)          # 1000 samples @48k
        out = nb.resample_linear(data, 48000, 16000)
        samples = struct.unpack(f'<{len(out) // 2}h', out)
        self.assertEqual(len(samples), 333)            # 1000 * 16/48
        self.assertTrue(all(-1000 <= s <= 1000 for s in samples))

    def test_short_input(self):
        self.assertEqual(nb.resample_linear(pcm([5]), 8000), b'')


class PlaybackClockTests(unittest.TestCase):
    def test_active_window_and_tail(self):
        clock = nb.PlaybackClock(tail=0.4)
        clock.note(3200, now=100.0)                    # 0.1 s of audio
        self.assertTrue(clock.active(now=100.05))
        self.assertFalse(clock.active(now=100.55))     # ended 100.1 + 0.4 tail
        self.assertAlmostEqual(clock.remaining(now=100.05), 0.05)

    def test_stacked_notes_extend(self):
        clock = nb.PlaybackClock()
        clock.note(3200, now=100.0)
        clock.note(3200, now=100.0)
        self.assertAlmostEqual(clock.remaining(now=100.0), 0.2)

    def test_clear(self):
        clock = nb.PlaybackClock()
        clock.note(32000, now=100.0)
        clock.clear()
        self.assertFalse(clock.active(now=100.0))


class FakeWS:
    def __init__(self):
        self.sent = []
        self.closed = False

    def send(self, raw):
        self.sent.append(json.loads(raw))

    def close(self):
        self.closed = True


def make_bridge(**over):
    bridge = nb.Bridge(args(**over))
    bridge.ws = FakeWS()
    bridge.log = lambda *a, **k: None
    return bridge


METADATA = {'type': 'conversation_initiation_metadata',
            'conversation_initiation_metadata_event': {
                'user_input_audio_format': 'pcm_16000',
                'agent_output_audio_format': 'pcm_16000'}}


class EventTests(unittest.TestCase):
    def test_ping_pong(self):
        bridge = make_bridge()
        bridge.on_event({'type': 'ping', 'ping_event': {'event_id': 7}})
        self.assertEqual(bridge.ws.sent, [{'type': 'pong', 'event_id': 7}])

    def test_metadata_negotiates(self):
        bridge = make_bridge()
        self.assertFalse(bridge.negotiated.is_set())
        bridge.on_event(METADATA)
        self.assertTrue(bridge.negotiated.is_set())

    def test_bad_format_closes_socket(self):
        bridge = make_bridge()
        ws = bridge.ws
        bad = json.loads(json.dumps(METADATA))
        bad['conversation_initiation_metadata_event']['agent_output_audio_format'] = 'pcm_24000'
        bridge.on_event(bad)
        self.assertTrue(ws.closed)
        self.assertFalse(bridge.negotiated.is_set())

    def test_audio_queued_only_after_negotiation(self):
        bridge = make_bridge()
        chunk = base64.b64encode(b'abcd').decode()
        bridge.on_event({'type': 'audio', 'audio_event': {'audio_base_64': chunk}})
        self.assertTrue(bridge.play_q.empty())
        bridge.negotiated.set()
        bridge.on_event({'type': 'audio', 'audio_event': {'audio_base_64': chunk}})
        self.assertEqual(bridge.play_q.get_nowait(), b'abcd')

    def test_interruption_clears_queue_and_clock(self):
        bridge = make_bridge()
        bridge.negotiated.set()
        bridge.play_q.put(b'aaaa')
        bridge.clock.note(32000)
        bridge.on_event({'type': 'interruption'})
        self.assertTrue(bridge.play_q.empty())
        self.assertFalse(bridge.clock.active())

    def _paced_bridge(self):
        class RecordingIO:
            def __init__(self, bridge):
                self.chunks = []

            def play(self, chunk):
                self.chunks.append((time.monotonic(), chunk))

            def stop_playback(self):
                pass

        bridge = make_bridge(io_backend=RecordingIO)
        threading.Thread(target=bridge._playback_worker, daemon=True).start()
        self.addCleanup(bridge.stop_event.set)
        return bridge

    def test_playback_keeps_real_time_pace(self):
        bridge = self._paced_bridge()
        audio = bytes(range(256)) * 125          # 32000 B = 1.0 s of pcm_16000
        started = time.monotonic()
        bridge.play_q.put(audio)
        while (sum(len(c) for _, c in bridge.io.chunks) < len(audio)
               and time.monotonic() - started < 3):
            time.sleep(0.01)
        elapsed = time.monotonic() - started
        self.assertEqual(b''.join(c for _, c in bridge.io.chunks), audio)
        # 1.0 s of audio with a 0.3 s lookahead is all published by about 0.7 s.
        self.assertGreater(elapsed, 0.5)
        self.assertLess(elapsed, 1.1)

    def test_interruption_drops_audio_not_yet_published(self):
        bridge = self._paced_bridge()
        bridge.play_q.put(b'\x01\x00' * 32000)    # 2.0 s
        time.sleep(0.25)
        bridge.clear_playback()
        published = len(bridge.io.chunks)
        self.assertGreater(published, 0)
        time.sleep(0.3)
        self.assertEqual(len(bridge.io.chunks), published)

    def test_transcripts_and_correction(self):
        bridge = make_bridge()
        bridge.on_event({'type': 'user_transcript',
                         'user_transcription_event': {'user_transcript': 'to the booth'}})
        bridge.on_event({'type': 'agent_response',
                         'agent_response_event': {'agent_response': 'turn left'}})
        bridge.on_event({'type': 'agent_response_correction',
                         'agent_response_correction_event': {'corrected_agent_response': 'turn right'}})
        self.assertEqual(list(bridge.transcripts),
                         [('VISITOR/OP', 'to the booth'), ('AGENT', 'turn right')])

    def test_reconnect_sends_contextual_update(self):
        bridge = make_bridge()
        bridge.reconnected = True
        bridge.transcripts.append(('VISITOR/OP', 'hello'))
        bridge.on_event(METADATA)
        updates = [m for m in bridge.ws.sent if m.get('type') == 'contextual_update']
        self.assertEqual(len(updates), 1)
        self.assertIn('network drop', updates[0]['text'])
        self.assertIn('VISITOR/OP: hello', updates[0]['text'])

    def test_first_session_sends_no_context(self):
        bridge = make_bridge()
        bridge.on_event(METADATA)
        self.assertFalse(any(m.get('type') == 'contextual_update' for m in bridge.ws.sent))


class MicBacklogTests(unittest.TestCase):
    def test_feed_mic_chunks_and_drops_oldest(self):
        bridge = make_bridge()
        bridge.negotiated.set()
        chunk = pcm([1] * 1600)
        for _ in range(nb.MIC_QUEUE_CHUNKS + 2):
            bridge.feed_mic(chunk)
        self.assertEqual(bridge.send_q.qsize(), nb.MIC_QUEUE_CHUNKS)
        self.assertTrue(bridge._backlog_warned)

    def test_partial_chunk_buffered(self):
        bridge = make_bridge()
        bridge.feed_mic(b'\x00' * 100)
        self.assertTrue(bridge.send_q.empty())
        bridge.feed_mic(b'\x00' * (nb.CHUNK_BYTES - 100))
        self.assertEqual(bridge.send_q.qsize(), 1)


class ReconnectTextTests(unittest.TestCase):
    def test_includes_roles_and_guidance(self):
        text = nb.build_reconnect_text([('VISITOR/OP', 'booth'), ('AGENT', 'go north')])
        self.assertIn('VISITOR/OP: booth', text)
        self.assertIn('AGENT: go north', text)
        self.assertIn('position', text)


class SignedUrlTests(unittest.TestCase):
    def test_posts_code_and_origin(self):
        captured = {}

        class Response:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return json.dumps({'signed_url': 'wss://x'}).encode()

        def opener(request, timeout=None):
            captured['request'] = request
            return Response()

        url = nb.request_signed_url('https://site.test', 'test-code', opener=opener)
        self.assertEqual(url, 'wss://x')
        req = captured['request']
        self.assertEqual(req.full_url, 'https://site.test/api/session')
        self.assertEqual(req.headers['Origin'], 'https://site.test')
        self.assertEqual(json.loads(req.data), {'access_code': 'test-code'})

    def test_missing_url_raises(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{}'

        with self.assertRaises(RuntimeError):
            nb.request_signed_url('https://site.test', 'x', opener=lambda r, timeout=None: Response())




class PhaseSignalTests(unittest.TestCase):
    def _state(self, **kw):
        base = dict(error=False, reconnecting=False, negotiated=True,
                    speaking=False, last_user_at=0.0)
        base.update(kw)
        return types.SimpleNamespace(**base)

    def test_error_beats_everything(self):
        state = self._state(error=True, reconnecting=True, negotiated=False,
                            speaking=True, last_user_at=100.0)
        self.assertEqual(nb.phase_for(state, now=100.0), 'error')

    def test_reconnecting(self):
        self.assertEqual(nb.phase_for(self._state(reconnecting=True), now=10.0),
                         'reconnecting')

    def test_connecting_before_negotiation(self):
        self.assertEqual(nb.phase_for(self._state(negotiated=False), now=10.0),
                         'connecting')

    def test_speaking_beats_user_speaking(self):
        state = self._state(speaking=True, last_user_at=99.5)
        self.assertEqual(nb.phase_for(state, now=100.0), 'speaking')

    def test_user_speaking_window(self):
        state = self._state(last_user_at=99.0)
        self.assertEqual(nb.phase_for(state, now=100.0), 'user_speaking')

    def test_thinking_window(self):
        state = self._state(last_user_at=95.0)
        self.assertEqual(nb.phase_for(state, now=100.0), 'thinking')

    def test_listening_after_windows(self):
        state = self._state(last_user_at=90.0)
        self.assertEqual(nb.phase_for(state, now=100.0), 'listening')

    def test_listening_with_no_transcript(self):
        self.assertEqual(nb.phase_for(self._state(), now=100.0), 'listening')

    def test_every_phase_has_signals(self):
        reachable = {'connecting', 'listening', 'user_speaking', 'thinking',
                     'speaking', 'reconnecting', 'error', 'stopped'}
        self.assertEqual(set(nb.PHASE_SIGNALS), reachable)
        for phase, signal in nb.PHASE_SIGNALS.items():
            mode, r, g, b = signal['led']
            self.assertIn(mode, (0, 1, 2, 3), phase)
            for channel in (r, g, b):
                self.assertTrue(0 <= channel <= 255, phase)
            self.assertIsInstance(signal['emoji'], int, phase)


class DebouncerTests(unittest.TestCase):
    def test_first_call_ready_then_blocked(self):
        d = nb.Debouncer(2.0)
        self.assertTrue(d.ready(now=10.0))
        self.assertFalse(d.ready(now=10.5))
        self.assertFalse(d.ready(now=11.9))

    def test_ready_after_window(self):
        d = nb.Debouncer(2.0)
        self.assertTrue(d.ready(now=10.0))
        self.assertTrue(d.ready(now=12.0))


class RosGuardTests(unittest.TestCase):
    def test_allowlist_names_pass(self):
        self.assertGreater(len(nb.ALLOWED_ROS_NAMES), 5)
        for name in nb.ALLOWED_ROS_NAMES:
            self.assertEqual(nb.guard_ros_name(name), name)

    def test_motion_and_nav_names_refused(self):
        for bad in ('/cmd_vel', '/aima/hal/locomotion/cmd',
                    '/aima/te/pnc_task_request', '/aima/te/integrated_command',
                    '/slam/lidar_odom', '/aima/hal/arm/joint_state',
                    '/foo/hand_pose', '/navigate_to_pose', '/nav/goal',
                    '/aimdk_5Fmsgs/srv/SetMcAction',
                    '/aima/hal/relocalization_pose', '/mapping/start'):
            with self.assertRaises(ValueError, msg=bad):
                nb.guard_ros_name(bad)

    def test_unknown_name_refused_even_if_harmless(self):
        with self.assertRaises(ValueError):
            nb.guard_ros_name('/aima/hal/audio/experimental')


class StallWatcherTests(unittest.TestCase):
    def test_fires_once_after_window(self):
        w = nb.StallWatcher(seconds=6.0)
        w.note_transcript(now=100.0)
        self.assertFalse(w.should_fire(now=104.0))
        self.assertTrue(w.should_fire(now=106.0))
        self.assertFalse(w.should_fire(now=107.0))   # once per turn

    def test_agent_audio_before_deadline_blocks(self):
        w = nb.StallWatcher(seconds=6.0)
        w.note_transcript(now=100.0)
        w.note_audio(now=103.0)
        self.assertFalse(w.should_fire(now=200.0))

    def test_new_turn_rearms(self):
        w = nb.StallWatcher(seconds=6.0)
        w.note_transcript(now=100.0)
        w.note_audio(now=101.0)
        w.note_transcript(now=110.0)
        self.assertTrue(w.should_fire(now=116.5))

    def test_no_turn_no_fire_and_reset(self):
        w = nb.StallWatcher(seconds=6.0)
        self.assertFalse(w.should_fire(now=100.0))
        w.note_transcript(now=100.0)
        w.reset()
        self.assertFalse(w.should_fire(now=200.0))


class PhrasePlayerTests(unittest.TestCase):
    def test_plays_file_into_play_queue(self):
        import tempfile, os
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, 'wait_en.pcm'), 'wb') as fh:
                fh.write(b'\x01\x02' * 1600)
            bridge = make_bridge()
            player = nb.PhrasePlayer(bridge, directory=tmp)
            player.play('wait_en')
            self.assertEqual(bridge.play_q.get_nowait(), b'\x01\x02' * 1600)

    def test_missing_file_skipped_not_fatal(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            bridge = make_bridge()
            player = nb.PhrasePlayer(bridge, directory=tmp)
            player.play('lost_en', 'lost_ar')
            player.play('lost_en')      # warning only once, never raises
            self.assertTrue(bridge.play_q.empty())


class RmsTests(unittest.TestCase):
    def test_silence_and_loud(self):
        self.assertEqual(nb.rms_i16(b'\x00' * 3200), 0.0)
        loud = pcm([8000] * 1600)
        self.assertAlmostEqual(nb.rms_i16(loud), 8000.0, places=0)

    def test_odd_bytes_ignored(self):
        self.assertEqual(nb.rms_i16(b'\xff'), 0.0)


class LatencyLogTests(unittest.TestCase):
    def _turn(self, log, loud_at=10.0, transcript_at=11.0,
              audio_at=12.0, played_at=12.5):
        log.note_mic(pcm([5000] * 1600), now=loud_at)
        log.note_mic(b'\x00' * 3200, now=loud_at + 0.2)   # silence keeps end
        log.note_transcript(now=transcript_at)
        log.note_agent_audio(now=audio_at)
        log.note_played(now=played_at)

    def test_full_turn_computes_deltas(self):
        log = nb.LatencyLog(now=lambda: 0.0)
        self._turn(log)
        self.assertEqual(len(log._rows), 1)
        row = log._rows[0]
        self.assertEqual(row['speech_end'], 10.0)
        self.assertEqual(row['played_at'], 12.5)
        self.assertIn('median 2500 ms, worst 2500 ms', log.summary())

    def test_mic_rms_floor_gates_speech_end(self):
        log = nb.LatencyLog(now=lambda: 0.0)
        log.note_mic(b'\x00' * 3200, now=5.0)          # silent: not speech
        log.note_transcript(now=6.0)
        log.note_agent_audio(now=7.0)
        log.note_played(now=7.5)
        self.assertEqual(log._rows, [])                 # no speech_end -> no turn

    def test_only_first_audio_and_first_play_count(self):
        log = nb.LatencyLog(now=lambda: 0.0)
        self._turn(log, audio_at=12.0, played_at=12.4)
        log._turn = {'speech_end': 10.0, 'transcript_at': 11.0,
                     'speech_end_wall': 0.0}
        log.note_agent_audio(now=13.0)
        log.note_agent_audio(now=14.0)                  # later chunks ignored
        log.note_played(now=14.5)
        self.assertEqual(log._rows[-1]['agent_at'], 13.0)

    def test_summary_median_and_worst(self):
        log = nb.LatencyLog(now=lambda: 0.0)
        self._turn(log, played_at=13.0)                 # 3000 ms
        self._turn(log, played_at=11.0)                 # 1000 ms
        self._turn(log, played_at=12.0)                 # 2000 ms
        self.assertEqual(log.summary(),
                         '3 turns, median 2000 ms, worst 3000 ms')

    def test_csv_written(self):
        import csv as csvmod, tempfile, os
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'lat.csv')
            log = nb.LatencyLog(path=path, now=lambda: 0.0)
            self._turn(log)
            log.close()
            with open(path, newline='') as fh:
                rows = list(csvmod.reader(fh))
        self.assertEqual(rows[0], list(nb.LatencyLog.FIELDS))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1][2:], ['1000', '2000', '2500'])


class FakeBridge:
    def __init__(self):
        self.logs = []
        self.mic = []

    def log(self, text):
        self.logs.append(text)

    def feed_mic(self, chunk):
        self.mic.append(chunk)

    def head_touch(self):
        pass


class StreamLockTests(unittest.TestCase):
    @staticmethod
    def msg(stream_id, data=b'\x01\x02'):
        vad = types.SimpleNamespace(value=0)
        return types.SimpleNamespace(stream_id=stream_id, audio_data=data,
                                     audio_vad_state=vad)

    def test_locks_first_stream_and_drops_others(self):
        bridge = FakeBridge()
        io = nb.RobotIO(bridge, mic='vad')
        io._on_vad_audio(self.msg(2, b'aa'))
        io._on_vad_audio(self.msg(1, b'dropped'))
        io._on_vad_audio(self.msg(2, b'bb'))
        self.assertEqual(io._stream_lock, 2)
        self.assertEqual(bridge.mic, [b'aa', b'bb'])

    def test_pinned_stream_ignores_first_seen(self):
        bridge = FakeBridge()
        io = nb.RobotIO(bridge, mic='vad', mic_stream=2)
        io._on_vad_audio(self.msg(1, b'dropped'))
        io._on_vad_audio(self.msg(2, b'kept'))
        self.assertEqual(bridge.mic, [b'kept'])


class TokenBumpTests(unittest.TestCase):
    def test_stop_playback_bumps_token_and_calls_stop(self):
        io = nb.RobotIO(FakeBridge())

        class Request:
            pass

        client = object()
        io._srv = {'stop': types.SimpleNamespace(Request=Request)}
        io._stop_client = client
        calls = []
        io._call = lambda c, r, **kw: calls.append((c, r)) or object()

        token = io._token
        io.stop_playback()
        self.assertEqual(io._token, token + 1)
        self.assertEqual(len(calls), 1)
        self.assertIs(calls[0][0], client)
        self.assertIsInstance(calls[0][1], Request)

    def test_play_uses_bumped_token(self):
        io = nb.RobotIO(FakeBridge())
        published = []

        class FakePlayback:
            def __init__(self):
                self.pkg_name = ''
                self.token_id = ''
                self.info = types.SimpleNamespace()
                self.data = types.SimpleNamespace()

        io._msg = {'AudioPlayback': FakePlayback}
        io._pub = types.SimpleNamespace(publish=published.append)
        io.play(b'\x00\x00')
        io._token += 1
        io.play(b'\x00\x00')
        self.assertNotEqual(published[0].token_id, published[1].token_id)
        self.assertTrue(published[1].token_id.endswith('-1'))


class SessionUrlTests(unittest.TestCase):
    def test_direct_mode_uses_elevenlabs(self):
        with mock.patch.object(nb, 'direct_signed_url',
                               return_value='wss://direct') as direct, \
             mock.patch.object(nb, 'request_signed_url') as site:
            self.assertEqual(
                nb.session_url('direct', 'https://s', 'c', 'agent', 'key'),
                'wss://direct')
            direct.assert_called_once_with('agent', 'key')
            site.assert_not_called()

    def test_auto_prefers_site(self):
        with mock.patch.object(nb, 'request_signed_url',
                               return_value='wss://site'), \
             mock.patch.object(nb, 'direct_signed_url') as direct:
            self.assertEqual(
                nb.session_url('auto', 'https://s', 'c', 'agent', 'key'),
                'wss://site')
            direct.assert_not_called()

    def test_auto_falls_back_to_direct_on_site_failure(self):
        with mock.patch.object(nb, 'request_signed_url',
                               side_effect=RuntimeError('down')), \
             mock.patch.object(nb, 'direct_signed_url',
                               return_value='wss://direct') as direct:
            self.assertEqual(
                nb.session_url('auto', 'https://s', 'c', 'agent', 'key'),
                'wss://direct')
            direct.assert_called_once_with('agent', 'key')

    def test_auto_without_key_reraises_site_error(self):
        with mock.patch.object(nb, 'request_signed_url',
                               side_effect=RuntimeError('down')), \
             mock.patch.object(nb, 'direct_signed_url') as direct:
            with self.assertRaises(RuntimeError):
                nb.session_url('auto', 'https://s', 'c', 'agent', '')
            direct.assert_not_called()

    def test_site_mode_never_falls_back(self):
        with mock.patch.object(nb, 'request_signed_url',
                               side_effect=RuntimeError('down')), \
             mock.patch.object(nb, 'direct_signed_url') as direct:
            with self.assertRaises(RuntimeError):
                nb.session_url('site', 'https://s', 'c', 'agent', 'key')
            direct.assert_not_called()


class PreflightFormatTests(unittest.TestCase):
    def test_pass_and_fail_lines(self):
        self.assertEqual(nb.fmt_check('mic', True, '3 msgs'),
                         'PASS  mic — 3 msgs')
        self.assertEqual(nb.fmt_check('mic', False), 'FAIL  mic')


if __name__ == '__main__':
    unittest.main()


class MarkerTrackerTests(unittest.TestCase):
    def test_stable_after_three_frames(self):
        t = nb.MarkerTracker(stable_frames=3, cooldown=20.0)
        self.assertIsNone(t.note([2], now=0.0))
        self.assertIsNone(t.note([2], now=0.5))
        self.assertEqual(t.note([2], now=1.0), 2)

    def test_gap_resets_streak(self):
        t = nb.MarkerTracker(stable_frames=3)
        t.note([2], now=0.0)
        t.note([2], now=0.5)
        t.note([], now=1.0)                      # lost sight of it
        self.assertIsNone(t.note([2], now=1.5))
        self.assertIsNone(t.note([2], now=2.0))
        self.assertEqual(t.note([2], now=2.5), 2)

    def test_debounce_once_per_cooldown(self):
        t = nb.MarkerTracker(stable_frames=2, cooldown=20.0)
        t.note([2], now=0.0)
        self.assertEqual(t.note([2], now=0.5), 2)
        self.assertIsNone(t.note([2], now=1.0))  # inside cooldown
        self.assertIsNone(t.note([2], now=19.9))
        self.assertEqual(t.note([2], now=21.0), 2)

    def test_unknown_ids_ignored(self):
        t = nb.MarkerTracker(stable_frames=2)
        self.assertIsNone(t.note([99], now=0.0))
        self.assertIsNone(t.note([99], now=0.5))
        self.assertIsNone(t.note([99], now=1.0))

    def test_marker_switch_picks_new_stable_id(self):
        t = nb.MarkerTracker(stable_frames=2)
        t.note([2], now=0.0)
        t.note([2], now=0.5)                     # fires id 2
        t.note([11], now=1.0)
        self.assertEqual(t.note([11], now=1.5), 11)

    def test_label_table_covers_plan(self):
        self.assertEqual(nb.MARKER_LABELS[2], 'sign B')
        self.assertEqual(nb.MARKER_LABELS[11], 'call booth 1')
        self.assertEqual(nb.MARKER_LABELS[24], 'the kitchen')
        self.assertEqual(len(nb.MARKER_LABELS), 14)


try:
    import cv2
    import numpy as np
    HAS_ARUCO = hasattr(cv2, 'aruco') and hasattr(cv2.aruco, 'generateImageMarker')
except ImportError:
    cv2 = np = None
    HAS_ARUCO = False


class MarkerObservationTests(unittest.TestCase):
    def square(self, cx, cy, side):
        half = side / 2
        return [[cx - half, cy - half], [cx + half, cy - half],
                [cx + half, cy + half], [cx - half, cy + half]]

    def test_centred_square_with_intrinsics(self):
        obs = nb.marker_observation(self.square(640, 360, 100), 1280, fx=960)
        self.assertAlmostEqual(obs['side_px'], 100.0)
        self.assertAlmostEqual(obs['distance_m'], 1.22, places=2)
        self.assertEqual(obs['bearing'], 'ahead')
        self.assertTrue(obs['at'])

    def test_off_centre_is_not_at(self):
        obs = nb.marker_observation(self.square(128, 360, 100), 1280, fx=960)
        self.assertEqual(obs['bearing'], 'left')
        self.assertFalse(obs['at'])

    def test_size_fallback_without_intrinsics(self):
        near = nb.marker_observation(self.square(640, 360, 100), 1280)
        self.assertIsNone(near['distance_m'])
        self.assertTrue(near['at'])
        far = nb.marker_observation(self.square(640, 360, 40), 1280)
        self.assertFalse(far['at'])

    def test_marker_name(self):
        self.assertEqual(nb.marker_name(2), 'sign B')
        self.assertEqual(nb.marker_name(24), 'the kitchen marker')
        self.assertEqual(nb.marker_name(11), 'call booth 1 marker')


@unittest.skipUnless(HAS_ARUCO, 'cv2.aruco not installed')
class CameraMarkerEventTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        bridge = types.SimpleNamespace(
            log=lambda *a, **k: None,
            send_contextual=self.sent.append)
        io = nb.RobotIO.__new__(nb.RobotIO)
        io._bridge = bridge
        io._cv2, io._np = cv2, np
        dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        io._detector = cv2.aruco.ArucoDetector(
            dictionary, cv2.aruco.DetectorParameters())
        io._aruco_dict = None
        io._cam_last = 0.0
        io._markers = nb.MarkerTracker()
        io._at_markers = nb.MarkerTracker(stable_frames=2, cooldown=30.0)
        io._camera_fx = None
        io._camera_info_width = None
        self.io = io
        self.dictionary = dictionary

    def frame_with_marker(self, marker_id, side, cx, cy=360):
        marker = cv2.aruco.generateImageMarker(self.dictionary, marker_id, side)
        frame = np.full((720, 1280), 255, np.uint8)
        y0, x0 = cy - side // 2, cx - side // 2
        frame[y0:y0 + side, x0:x0 + side] = marker
        ok, jpeg = cv2.imencode('.jpg', frame)
        self.assertTrue(ok)
        return types.SimpleNamespace(data=jpeg.tobytes())

    def feed(self, msg, frames=5):
        for _ in range(frames):
            self.io._cam_last = 0.0      # reset the frame throttle
            self.io._on_camera(msg)

    def test_at_marker_reports_position_once(self):
        self.feed(self.frame_with_marker(24, 200, 640))
        self.assertEqual(self.sent,
                         ['Camera: the robot is now at the kitchen marker.'])

    def test_seen_marker_reports_bearing_once(self):
        self.feed(self.frame_with_marker(24, 60, 150))
        self.assertEqual(self.sent,
                         ['Camera: the kitchen marker is visible to the left.'])


class JudgeScreenTests(unittest.TestCase):
    def test_off_by_default(self):
        seen = []

        class Recorder:
            def __init__(self, a):
                seen.append(a)

            def run(self):
                return 0

            def shutdown(self):
                pass

        with mock.patch.object(nb, 'Bridge', Recorder):
            nb.main(['--io', 'laptop', '--log-dir', '.'])
            nb.main(['--io', 'laptop', '--log-dir', '.', '--judge-screen', '8765'])
        self.assertIsNone(seen[0].judge_screen)
        self.assertEqual(seen[1].judge_screen, 8765)
        self.assertIsNone(make_bridge().judge)

    def test_page_shows_latest_operator_step_and_escapes_text(self):
        lines = [('VISITOR/OP', 'وين المطبخ؟'),
                 ('AGENT', 'Operator, walk straight and stop at the purple pillar.'),
                 ('VISITOR/OP', '<script>alert(1)</script> Done.'),
                 ('AGENT', 'Operator, walk straight and stop at the yellow pillar.'),
                 ('AGENT', 'تمام.')]
        page = nb.render_judge_page(lines, '2 turns, median 900 ms, worst 1200 ms')
        self.assertIn('<h1>Operator, walk straight and stop at the yellow pillar.</h1>', page)
        self.assertIn('وين المطبخ؟', page)
        self.assertNotIn('<script>', page)
        self.assertIn('&lt;script&gt;', page)
        self.assertIn('median 900 ms', page)

    def test_server_serves_live_transcript_on_localhost_only(self):
        import urllib.request
        bridge = make_bridge()
        bridge.transcripts.append(('AGENT', 'Operator, stop here.'))
        screen = nb.JudgeScreen(bridge, 0)
        try:
            self.assertEqual(screen._server.server_address[0], '127.0.0.1')
            url = f'http://127.0.0.1:{screen.port}/'
            body = urllib.request.urlopen(url, timeout=5).read().decode('utf-8')
            self.assertIn('<h1>Operator, stop here.</h1>', body)
            bridge.transcripts.append(('AGENT', 'Operator, turn left.'))
            body = urllib.request.urlopen(url, timeout=5).read().decode('utf-8')
            self.assertIn('<h1>Operator, turn left.</h1>', body)
            with self.assertRaises(Exception):
                urllib.request.urlopen(url + 'other', timeout=5)
        finally:
            screen.close()
