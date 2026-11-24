#!/usr/bin/env python3
"""Voice of the Oasis — robot audio bridge.

Connects a microphone + speaker to the hosted ElevenLabs voice agent through
the same signed-URL websocket the browser client uses. Audio only: this program
never publishes motion or control topics.

  --io robot   rclpy topics/services on the AgiBot X2 (default)
  --io laptop  sounddevice default mic/speaker (rehearsal + backup)
  --io null    silence in, discard out (network smoke checks)
"""

import argparse
import base64
import collections
import datetime
import json
import os
import queue
import struct
import sys
import threading
import time
import urllib.request
from array import array

RATE = 16000
FORMAT = 'pcm_16000'
CHUNK_MS = 100
CHUNK_BYTES = RATE * CHUNK_MS // 1000 * 2       # 3200 B of S16LE mono
PUBLISH_MS = 50
PUBLISH_BYTES = RATE * PUBLISH_MS // 1000 * 2   # 1600 B
PLAYBACK_LOOKAHEAD = 1.0                       # max seconds queued on device
TAIL_SECONDS = 0.4
MIC_QUEUE_CHUNKS = 30                          # ~3 s of capture before dropping
TRANSCRIPT_LINES = 12
RECONNECT_DELAYS = [1, 2, 4, 8, 16]            # max 5 retries
SOCKET_TIMEOUT = 15.0
PKG_NAME = 'deception_navigator'
FOCUS_PRIORITY = 6
SILENCE = b'\x00' * CHUNK_BYTES
DEFAULT_SITE = 'https://deception-dso-navigator.vercel.app'


# ---------------------------------------------------------------------------
# Pure helpers (unit tested, no ROS/audio dependencies)
# ---------------------------------------------------------------------------

def deinterleave_mic(data, total_channels, mic_channels, channel=None):
    """Mono S16LE bytes from interleaved int16 frames. Mic channels come first;
    reference (echo) channels trail. Averages all mic channels, or takes a
    single `channel` index when given."""
    frame_bytes = 2 * total_channels
    if total_channels <= 0 or mic_channels <= 0 or len(data) % frame_bytes:
        return b''
    count = len(data) // frame_bytes
    if channel is not None:
        if not 0 <= channel < mic_channels:
            raise ValueError(f'mic channel {channel} outside 0..{mic_channels - 1}')
        out = array('h', bytes(count * 2))
        for frame in range(count):
            out[frame] = struct.unpack_from('<h', data, frame * frame_bytes + channel * 2)[0]
        return out.tobytes()
    out = array('h', bytes(count * 2))
    for frame in range(count):
        base = frame * frame_bytes
        acc = 0
        for ch in range(mic_channels):
            acc += struct.unpack_from('<h', data, base + ch * 2)[0]
        out[frame] = int(round(acc / mic_channels))
    return out.tobytes()


def resample_linear(data, src_rate, dst_rate=RATE):
    """Linear-interpolation resampler for S16LE mono bytes."""
    if src_rate == dst_rate or not data:
        return data
    src = array('h')
    src.frombytes(data[:len(data) // 2 * 2])
    if sys.byteorder == 'big':
        src.byteswap()
    n_in = len(src)
    n_out = int(n_in * dst_rate / src_rate)
    if n_in < 2 or n_out < 1:
        return b''
    out = array('h', bytes(n_out * 2))
    step = (n_in - 1) / n_out
    for i in range(n_out):
        pos = i * step
        j = int(pos)
        frac = pos - j
        nxt = src[j + 1] if j + 1 < n_in else src[j]
        value = src[j] + (nxt - src[j]) * frac
        out[i] = max(-32768, min(32767, int(round(value))))
    return out.tobytes()


class PlaybackClock:
    """Tracks how much queued agent audio still has to play, by duration."""

    def __init__(self, tail=TAIL_SECONDS):
        self.tail = tail
        self._end = 0.0

    def note(self, nbytes, now=None, rate=RATE):
        now = time.monotonic() if now is None else now
        self._end = max(self._end, now) + nbytes / (2 * rate)

    def active(self, now=None):
        now = time.monotonic() if now is None else now
        return now < self._end + self.tail

    def remaining(self, now=None):
        now = time.monotonic() if now is None else now
        return max(0.0, self._end - now)

    def clear(self):
        self._end = 0.0


def build_reconnect_text(transcripts):
    """Transcript memory injected after an unexpected socket drop."""
    lines = [f'{role}: {text}' for role, text in transcripts]
    history = ' / '.join(lines[-TRANSCRIPT_LINES:]) or '(nothing yet)'
    return ('Reconnected after a network drop. Conversation so far: ' + history +
            ' Continue from where it stopped; ask the operator to confirm '
            "the robot's position before any new step.")


def request_signed_url(site, code, opener=None):
    """POST {site}/api/session and return the signed websocket URL."""
    open_url = opener or urllib.request.urlopen
    request = urllib.request.Request(
        f'{site}/api/session',
        data=json.dumps({'access_code': code}).encode('utf-8'),
        headers={'content-type': 'application/json', 'origin': site},
        method='POST',
    )
    with open_url(request, timeout=SOCKET_TIMEOUT) as response:
        body = json.loads(response.read().decode('utf-8'))
    url = body.get('signed_url') or body.get('signedUrl')
    if not url:
        raise RuntimeError('session endpoint returned no signed URL')
    return url


# ---------------------------------------------------------------------------
# IO backends
# ---------------------------------------------------------------------------

class NullIO:
    """Silence in, discard out. Proves the socket path without audio devices."""

    name = 'null'

    def __init__(self, bridge):
        self._bridge = bridge
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        def feed():
            while not self._stop.wait(CHUNK_MS / 1000):
                self._bridge.feed_mic(SILENCE)
        self._thread = threading.Thread(target=feed, daemon=True)
        self._thread.start()

    def play(self, chunk):
        pass

    def stop_playback(self):
        pass

    def close(self):
        self._stop.set()


class LaptopIO:
    """sounddevice default mic + speaker at 16 kHz mono."""

    name = 'laptop'

    def __init__(self, bridge):
        self._bridge = bridge
        self._sd = None
        self._input = None
        self._output = None

    def start(self):
        import sounddevice as sd
        self._sd = sd
        self._input = sd.RawInputStream(
            samplerate=RATE, channels=1, dtype='int16', blocksize=RATE // 10,
            callback=self._on_mic,
        )
        self._output = sd.RawOutputStream(
            samplerate=RATE, channels=1, dtype='int16', blocksize=RATE // 20)
        self._input.start()
        self._output.start()

    def _on_mic(self, indata, frames, timing, status):
        self._bridge.feed_mic(bytes(indata))

    def play(self, chunk):
        if self._output and not self._output.active:
            self._output.start()
        self._output.write(chunk)

    def stop_playback(self):
        if self._output and self._output.active:
            self._output.abort()

    def close(self):
        for stream in (self._input, self._output):
            try:
                if stream:
                    stream.close()
            except Exception:
                pass


class RobotIO:
    """AgiBot X2 topics/services. Audio only — no motion interfaces."""

    name = 'robot'
    CAPTURE_TOPIC = '/aima/hal/audio/capture'
    PROCESSED_TOPIC = '/agent/process_audio_output'
    PLAYBACK_TOPIC = '/aima/hal/audio/playback'
    PLAY_STATE_TOPIC = '/aima/hal/audio/play_state'
    FOCUS_SRV = '/aimdk_5Fmsgs/srv/RequestAudioFocus'
    ABANDON_SRV = '/aimdk_5Fmsgs/srv/AbandonAudioFocus'
    STOP_SRV = '/aimdk_5Fmsgs/srv/StopAudioPlay'
    VOLUME_SRV = '/aimdk_5Fmsgs/srv/SetVolume'

    def __init__(self, bridge, mic='raw', mic_channel=None, volume=None):
        self._bridge = bridge
        self._mic_mode = mic
        self._mic_channel = mic_channel
        self._volume = volume
        self._node = None
        self._executor = None
        self._spin_thread = None
        self._pub = None
        self._focus_client = None
        self._abandon_client = None
        self._stop_client = None
        self._volume_client = None
        self._focus = False

    def start(self):
        import rclpy
        from rclpy.executors import MultiThreadedExecutor
        from rclpy.qos import (QoSDurabilityPolicy, QoSHistoryPolicy, QoSProfile,
                               QoSReliabilityPolicy)
        from aimdk_msgs.msg import (AudioCapture, AudioPlayback,
                                    PlayStateChange, ProcessedAudioOutput)
        from aimdk_msgs.srv import (AbandonAudioFocus, RequestAudioFocus,
                                    SetVolume, StopAudioPlay)
        self._msg = dict(AudioPlayback=AudioPlayback)
        self._srv = dict(focus=RequestAudioFocus, abandon=AbandonAudioFocus,
                         stop=StopAudioPlay, volume=SetVolume)
        self._rclpy = rclpy

        if not rclpy.ok():
            rclpy.init()
        self._node = rclpy.create_node('navigator_bridge')
        self._executor = MultiThreadedExecutor()
        self._executor.add_node(self._node)
        self._spin_thread = threading.Thread(
            target=self._executor.spin, daemon=True)
        self._spin_thread.start()

        self._pub = self._node.create_publisher(
            AudioPlayback, self.PLAYBACK_TOPIC, 10)
        self._node.create_subscription(
            PlayStateChange, self.PLAY_STATE_TOPIC, self._on_play_state,
            QoSProfile(history=QoSHistoryPolicy.KEEP_LAST, depth=10,
                       reliability=QoSReliabilityPolicy.BEST_EFFORT,
                       durability=QoSDurabilityPolicy.TRANSIENT_LOCAL))

        if self._mic_mode == 'vad':
            self._node.create_subscription(
                ProcessedAudioOutput, self.PROCESSED_TOPIC, self._on_vad_audio,
                QoSProfile(history=QoSHistoryPolicy.KEEP_LAST, depth=500,
                           reliability=QoSReliabilityPolicy.BEST_EFFORT,
                           durability=QoSDurabilityPolicy.TRANSIENT_LOCAL))
        else:
            self._node.create_subscription(
                AudioCapture, self.CAPTURE_TOPIC, self._on_raw_audio,
                QoSProfile(history=QoSHistoryPolicy.KEEP_LAST, depth=500,
                           reliability=QoSReliabilityPolicy.RELIABLE,
                           durability=QoSDurabilityPolicy.VOLATILE))

        self._focus_client = self._node.create_client(
            RequestAudioFocus, self.FOCUS_SRV)
        self._abandon_client = self._node.create_client(
            AbandonAudioFocus, self.ABANDON_SRV)
        self._stop_client = self._node.create_client(
            StopAudioPlay, self.STOP_SRV)
        self._volume_client = self._node.create_client(
            SetVolume, self.VOLUME_SRV)

        if self._volume is not None:
            self._set_volume(self._volume)
        self._request_focus()

    def _call(self, client, request, tries=8, timeout=0.25):
        """call_async + result wait with retries; ROS cross-host services are
        flaky per the vendor docs."""
        for _ in range(tries):
            future = client.call_async(request)
            try:
                return future.result(timeout=timeout)
            except Exception:
                continue
        return None

    def _requester(self):
        from aimdk_msgs.msg import FocusRequester
        requester = FocusRequester()
        requester.pkg_name = PKG_NAME
        requester.priority = FOCUS_PRIORITY
        requester.priority_weight = 0
        return requester

    def _request_focus(self):
        if not self._focus_client.wait_for_service(timeout_sec=5.0):
            self._bridge.log('FOCUS: RequestAudioFocus service unavailable; '
                             'publishing audio anyway')
            return
        request = self._srv['focus'].Request()
        request.focus_requester = self._requester()
        response = self._call(self._focus_client, request)
        gained = bool(response and response.focus_response.focus_gain)
        self._focus = gained
        self._bridge.log(f'FOCUS: request -> focus_gain={gained}')
        if not gained:
            self._bridge.log('FOCUS: not granted — playback may mix with '
                             'other sources')

    def _set_volume(self, volume):
        try:
            request = self._srv['volume'].Request()
            request.audio_volume = int(volume)
            self._call(self._volume_client, request, tries=2)
        except Exception as error:
            self._bridge.log(f'VOLUME: set failed: {error}')

    def _on_play_state(self, msg):
        state = getattr(msg.state, 'value', msg.state)
        self._bridge.log(f'PLAYSTATE: pkg={msg.pkg_name} state={state}')

    def _on_vad_audio(self, msg):
        self._bridge.feed_mic(bytes(msg.audio_data))

    def _on_raw_audio(self, msg):
        total = msg.info.channels or (msg.mic_channels + msg.ref_channels)
        mono = deinterleave_mic(bytes(msg.data.data), total,
                                msg.mic_channels, self._mic_channel)
        rate = msg.info.sample_rate
        if rate and rate != RATE:
            mono = resample_linear(mono, rate)
        if mono:
            self._bridge.feed_mic(mono)

    def play(self, chunk):
        playback = self._msg['AudioPlayback']()
        playback.pkg_name = PKG_NAME
        playback.token_id = PKG_NAME
        playback.info.channels = 1
        playback.info.sample_rate = RATE
        playback.data.data = list(chunk)
        self._pub.publish(playback)

    def stop_playback(self):
        if self._stop_client is None:
            return
        try:
            request = self._srv['stop'].Request()
            self._call(self._stop_client, request, tries=3)
        except Exception as error:
            self._bridge.log(f'PLAYBACK: stop call failed: {error}')

    def close(self):
        try:
            if self._abandon_client is not None:
                request = self._srv['abandon'].Request()
                request.focus_requester = self._requester()
                self._call(self._abandon_client, request, tries=3)
        except Exception:
            pass
        try:
            if self._node is not None:
                self._node.destroy_node()
            if self._rclpy is not None and self._rclpy.ok():
                self._rclpy.shutdown()
        except Exception:
            pass


IOS = {'robot': RobotIO, 'laptop': LaptopIO, 'null': NullIO}


# ---------------------------------------------------------------------------
# Bridge
# ---------------------------------------------------------------------------

class Bridge:
    def __init__(self, args, log=None):
        self.site = args.url.rstrip('/')
        self.code = args.code or os.environ.get('NAVIGATOR_ACCESS_CODE', '')
        self.half_duplex = args.half_duplex
        self._log_lines = []
        self._log_lock = threading.Lock()
        self._log_file = args.log_file
        if self._log_file:
            os.makedirs(os.path.dirname(self._log_file), exist_ok=True)
        self.log('bridge starting')

        self.io = args.io_backend(self) if args.io_backend else None

        self.clock = PlaybackClock()
        self._mic_buf = bytearray()
        self._mic_lock = threading.Lock()
        self.send_q = queue.Queue(maxsize=MIC_QUEUE_CHUNKS)
        self.play_q = queue.Queue()
        self.transcripts = collections.deque(maxlen=TRANSCRIPT_LINES)

        self.ws = None
        self._ws_lock = threading.Lock()
        self.negotiated = threading.Event()
        self.stop_event = threading.Event()
        self.fresh_event = threading.Event()
        self.muted = False
        self._backlog_warned = False
        self.connected = False
        self.reconnected = False

    # -- logging ------------------------------------------------------------

    def log(self, text):
        stamp = datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3]
        line = f'[{stamp}] {text}'
        with self._log_lock:
            try:
                print(line, flush=True)
            except UnicodeEncodeError:
                print(line.encode('ascii', 'replace').decode('ascii'), flush=True)
            if self._log_file:
                try:
                    with open(self._log_file, 'a', encoding='utf-8') as fh:
                        fh.write(line + '\n')
                except OSError:
                    pass

    def transcript(self, role, text):
        if not isinstance(text, str) or not text.strip():
            return
        text = text.strip()
        self.transcripts.append((role, text))
        self.log(f'{role}: {text}')

    # -- mic path ------------------------------------------------------------

    def feed_mic(self, pcm):
        with self._mic_lock:
            self._mic_buf.extend(pcm)
            while len(self._mic_buf) >= CHUNK_BYTES:
                chunk = bytes(self._mic_buf[:CHUNK_BYTES])
                del self._mic_buf[:CHUNK_BYTES]
                if self.send_q.full():
                    try:
                        self.send_q.get_nowait()
                    except queue.Empty:
                        pass
                    if not self._backlog_warned:
                        self._backlog_warned = True
                        self.log('NETWORK: send backlog full, dropping oldest mic audio')
                try:
                    self.send_q.put_nowait(chunk)
                except queue.Full:
                    pass

    def _mic_sender(self):
        while not self.stop_event.is_set():
            try:
                chunk = self.send_q.get(timeout=CHUNK_MS / 1000)
            except queue.Empty:
                chunk = SILENCE
            if not self.negotiated.is_set():
                continue
            if self.muted or (self.half_duplex and self.clock.active()):
                chunk = SILENCE
            self._send({'user_audio_chunk': base64.b64encode(chunk).decode('ascii')})

    # -- playback path -------------------------------------------------------

    def _playback_worker(self):
        pending = bytearray()
        while not self.stop_event.is_set():
            try:
                pending.extend(self.play_q.get(timeout=0.1))
            except queue.Empty:
                pass
            while True:
                try:
                    pending.extend(self.play_q.get_nowait())
                except queue.Empty:
                    break
            # Pace device writes: never run more than LOOKAHEAD ahead.
            while (self.clock.remaining() > PLAYBACK_LOOKAHEAD
                   and not self.stop_event.is_set()):
                try:
                    pending.extend(self.play_q.get(timeout=0.1))
                except queue.Empty:
                    pass
            if self.stop_event.is_set():
                break
            if len(pending) >= PUBLISH_BYTES or (pending and self.play_q.empty()):
                chunk = bytes(pending[:PUBLISH_BYTES])
                del pending[:PUBLISH_BYTES]
                self.clock.note(len(chunk))
                if self.io:
                    try:
                        self.io.play(chunk)
                    except Exception as error:
                        self.log(f'PLAYBACK: io error: {error}')

    def clear_playback(self):
        while True:
            try:
                self.play_q.get_nowait()
            except queue.Empty:
                break
        self.clock.clear()
        if self.io:
            try:
                self.io.stop_playback()
            except Exception:
                pass

    # -- websocket ------------------------------------------------------------

    def _send(self, message):
        with self._ws_lock:
            ws = self.ws
        if ws is None:
            return False
        try:
            ws.send(json.dumps(message))
            return True
        except Exception:
            return False

    def on_event(self, event):
        """One parsed server message. Mirrors app/static/voice.mjs handling."""
        kind = event.get('type') if isinstance(event, dict) else None
        if kind == 'conversation_initiation_metadata':
            meta = event.get('conversation_initiation_metadata_event') or {}
            if (meta.get('user_input_audio_format') != FORMAT or
                    meta.get('agent_output_audio_format') != FORMAT):
                self.log(f'PROTOCOL: unexpected audio format {meta!r}; closing')
                self._close_ws()
                return
            if not self.negotiated.is_set():
                self.negotiated.set()
                self.connected = True
                self.log('STATE: listening (negotiated pcm_16000)')
                if self.reconnected:
                    self._send({
                        'type': 'contextual_update',
                        'text': build_reconnect_text(self.transcripts),
                    })
            return
        if kind == 'ping':
            event_id = (event.get('ping_event') or {}).get('event_id')
            if isinstance(event_id, int):
                self._send({'type': 'pong', 'event_id': event_id})
            return
        if kind == 'audio':
            audio = event.get('audio_event') or {}
            payload = audio.get('audio_base_64')
            if self.negotiated.is_set() and isinstance(payload, str) and payload:
                try:
                    self.play_q.put_nowait(base64.b64decode(payload))
                except (ValueError, queue.Full):
                    pass
            return
        if kind == 'interruption':
            self.clear_playback()
            self.log('STATE: interrupted — playback cleared')
            return
        if kind == 'user_transcript':
            self.transcript('VISITOR/OP',
                            (event.get('user_transcription_event') or {}).get('user_transcript'))
            return
        if kind == 'agent_response':
            self.transcript('AGENT',
                            (event.get('agent_response_event') or {}).get('agent_response'))
            return
        if kind == 'agent_response_correction':
            text = (event.get('agent_response_correction_event') or {}).get('corrected_agent_response')
            if isinstance(text, str) and text.strip():
                if self.transcripts and self.transcripts[-1][0] == 'AGENT':
                    self.transcripts.pop()
                self.transcript('AGENT', text)
            return
        if kind == 'queue_status':
            status = (event.get('queue_status_event') or {}).get('status')
            self.log(f'STATE: queue {status}')
            return
        if kind == 'client_error':
            self.log('PROTOCOL: client_error from server')
            self._close_ws()
            return
        if kind in ('agent_tool_request', 'agent_tool_response', 'client_tool_call'):
            self.log(f'TOOL: {json.dumps(event, ensure_ascii=False)[:400]}')
            return

    def _close_ws(self):
        with self._ws_lock:
            ws, self.ws = self.ws, None
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass

    def _run_socket(self, url):
        import websocket
        ws = websocket.create_connection(
            url, subprotocols=['convai'], timeout=SOCKET_TIMEOUT,
            skip_utf8_validation=True)
        ws.settimeout(0.5)
        with self._ws_lock:
            self.ws = ws
        self.log('STATE: socket open')
        try:
            ws.send(json.dumps({'type': 'conversation_initiation_client_data'}))
        except Exception:
            return
        while not self.stop_event.is_set() and not self.fresh_event.is_set():
            try:
                raw = ws.recv()
            except Exception as error:
                name = type(error).__name__
                if 'timeout' in name.lower():
                    continue
                self.log(f'STATE: socket error ({name})')
                break
            if not raw:
                break
            try:
                event = json.loads(raw)
            except (ValueError, TypeError):
                continue
            try:
                self.on_event(event)
            except Exception as error:
                self.log(f'PROTOCOL: event handling error: {error}')
        self._close_ws()
        self.connected = False

    def run(self):
        if not self.code:
            self.log('ERROR: no access code (--code or NAVIGATOR_ACCESS_CODE)')
            return 2
        if self.io:
            try:
                self.io.start()
                self.log(f'STATE: {self.io.name} IO ready')
            except Exception as error:
                self.log(f'ERROR: {self.io.name} IO failed to start: {error}')
                return 2
        sender = threading.Thread(target=self._mic_sender, daemon=True)
        player = threading.Thread(target=self._playback_worker, daemon=True)
        keys = threading.Thread(target=self._key_reader, daemon=True)
        sender.start()
        player.start()
        keys.start()

        attempts = 0
        while not self.stop_event.is_set():
            self.fresh_event.clear()
            self.negotiated.clear()
            self.clear_playback()
            try:
                url = request_signed_url(self.site, self.code)
            except Exception as error:
                self.log(f'SESSION: signed URL request failed: {error}')
                url = None
            if url:
                try:
                    self._run_socket(url)
                    attempts = 0
                except Exception as error:
                    self.log(f'STATE: socket failed: {error}')
            if self.stop_event.is_set() or self.fresh_event.is_set():
                continue
            # Unexpected drop: reconnect with transcript memory.
            self.log('CONNECTION LOST')
            self.reconnected = True
            if attempts >= len(RECONNECT_DELAYS):
                self.log('ERROR: reconnect attempts exhausted; '
                         'press Enter for a fresh take or q to quit')
                self.fresh_event.wait(timeout=None if not self.stop_event.is_set() else 0)
                continue
            delay = RECONNECT_DELAYS[attempts]
            attempts += 1
            self.log(f'STATE: reconnecting in {delay}s (attempt {attempts})')
            self.stop_event.wait(delay)
        return 0

    # -- console keys ---------------------------------------------------------

    def _key_reader(self):
        self.log('KEYS: Enter = fresh take | m = mic mute | q = quit')
        while not self.stop_event.is_set():
            try:
                line = sys.stdin.readline()
            except Exception:
                return
            if line == '':            # stdin closed
                return
            line = line.strip().lower()
            if line == 'q':
                self.log('KEYS: quit requested')
                self.stop_event.set()
                return
            if line == 'm':
                self.muted = not self.muted
                self.log(f'KEYS: mic {"muted" if self.muted else "live"}')
            elif line == '':
                self.log('KEYS: fresh take')
                self.transcripts.clear()
                self.reconnected = False
                self.fresh_event.set()

    # -- shutdown --------------------------------------------------------------

    def shutdown(self):
        self.stop_event.set()
        self._close_ws()
        self.clear_playback()
        if self.io:
            try:
                self.io.close()
            except Exception:
                pass
        self.log('bridge stopped')


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description='Robot audio bridge for the navigator agent')
    parser.add_argument('--io', choices=sorted(IOS), default='robot')
    parser.add_argument('--mic', choices=['raw', 'vad'], default='raw',
                        help='robot mic source (raw capture topic or VAD-processed topic)')
    parser.add_argument('--mic-channel', type=int, default=None,
                        help='use a single raw mic channel instead of averaging')
    parser.add_argument('--code', default=None, help='access code (or NAVIGATOR_ACCESS_CODE)')
    parser.add_argument('--url', default=DEFAULT_SITE, help='site base URL')
    parser.add_argument('--volume', type=int, default=None,
                        help='robot speaker volume 0-100 (best effort)')
    duplex = parser.add_mutually_exclusive_group()
    duplex.add_argument('--half-duplex', dest='half_duplex', action='store_true', default=None)
    duplex.add_argument('--full-duplex', dest='half_duplex', action='store_false')
    parser.add_argument('--log-dir', default=os.path.join(os.path.dirname(__file__), 'logs'))
    args = parser.parse_args(argv)

    if args.half_duplex is None:
        args.half_duplex = args.io == 'robot'

    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    args.log_file = os.path.join(args.log_dir, f'{stamp}.log')
    if args.io == 'robot':
        args.io_backend = lambda bridge: RobotIO(
            bridge, mic=args.mic, mic_channel=args.mic_channel, volume=args.volume)
    else:
        args.io_backend = IOS[args.io]

    bridge = Bridge(args)
    try:
        code = bridge.run()
    except KeyboardInterrupt:
        code = 0
    finally:
        bridge.shutdown()
    return code


if __name__ == '__main__':
    sys.exit(main())
