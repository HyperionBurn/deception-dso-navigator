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
import csv
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
from types import SimpleNamespace

RATE = 16000
FORMAT = 'pcm_16000'
CHUNK_MS = 100
CHUNK_BYTES = RATE * CHUNK_MS // 1000 * 2       # 3200 B of S16LE mono
PUBLISH_MS = 50
PUBLISH_BYTES = RATE * PUBLISH_MS // 1000 * 2   # 1600 B
PLAYBACK_LOOKAHEAD = 0.3                       # seconds of audio queued ahead (org bridge: lead)
TAIL_SECONDS = 0.5                             # speaking gate = queued audio + this (org: lead + 0.5)
MIC_QUEUE_CHUNKS = 30                          # ~3 s of capture before dropping
TRANSCRIPT_LINES = 12
RECONNECT_DELAYS = [1, 2, 4, 8, 16]            # max 5 retries
SOCKET_TIMEOUT = 15.0
PKG_NAME = 'deception_navigator'
FOCUS_PRIORITY = 8                             # same value as AgiBot's stream example / org bridge
PROD_AGENT_ID = 'agent_0101m86hthvjfm6vqeymg81may5e'
SILENCE = b'\x00' * CHUNK_BYTES
DEFAULT_SITE = 'https://deception-dso-navigator.vercel.app'

# --- "I'm listening" signals -------------------------------------------------
# Phase -> (SetPmuLed mode, r, g, b) + PlayEmoji emotion_id.
# LED modes: 0 steady, 1 breathing, 2 blinking, 3 flowing.
# Emoji ids per the interface doc's emotion_id table.
USER_SPEAK_SECONDS = 1.5
THINK_SECONDS = 6.0
TOUCH_DEBOUNCE_SECONDS = 2.0
SIGNAL_PRIORITY = 6   # below system fault emojis/LEDs so safety preempts us

# --- motion guard ------------------------------------------------------------
# Every ROS topic/service the bridge creates must pass guard_ros_name: it has
# to be on this audio-only allowlist AND free of motion/navigation fragments.
# Anything else raises at startup.
FORBIDDEN_NAME_PARTS = (
    'locomotion', 'command', 'upper_body', 'pnc_task', 'mc_', 'setmc',
    'migratesystemstate', 'joint', 'hand', 'slam', 'nav', 'relocal', 'mapping',
)
ALLOWED_ROS_NAMES = frozenset({
    '/aima/hal/audio/capture',
    '/agent/process_audio_output',
    '/aima/hal/audio/playback',
    '/aima/hal/audio/play_state',
    '/aima/hal/audio/focus_response',
    '/aima/hal/sensor/touch_head',
    '/aima/hal/sensor/rgbd_head_front/rgb_image/compressed',
    '/aimdk_5Fmsgs/srv/RequestAudioFocus',
    '/aimdk_5Fmsgs/srv/AbandonAudioFocus',
    '/aimdk_5Fmsgs/srv/StopAudioPlay',
    '/aimdk_5Fmsgs/srv/SetVolume',
    '/aimdk_5Fmsgs/srv/SetPmuLed',
    '/aimdk_5Fmsgs/srv/PlayEmoji',
})


def guard_ros_name(name):
    lowered = name.lower()
    for part in FORBIDDEN_NAME_PARTS:
        if part in lowered:
            raise ValueError(
                f'ROS name {name!r} refused: contains forbidden fragment {part!r}')
    if name not in ALLOWED_ROS_NAMES:
        raise ValueError(
            f'ROS name {name!r} refused: not on the bridge allowlist')
    return name


# --- local fallback phrases ---------------------------------------------------
PHRASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'phrases')
STALL_SECONDS = 6.0       # no agent audio this long after a user turn -> "One moment."
MIC_RMS_FLOOR = 300       # int16 RMS; quiet-room noise sits well below this
PHASE_SIGNALS = {
    'connecting':    {'led': (3, 255, 170, 0),   'emoji': 50},   # flowing amber, open eyes
    'listening':     {'led': (0, 0, 200, 80),    'emoji': 10},   # steady cyan, calm
    'user_speaking': {'led': (3, 0, 255, 0),     'emoji': 50},   # flowing green, open eyes
    'thinking':      {'led': (1, 255, 160, 0),   'emoji': 170},  # breathing amber, thinking
    'speaking':      {'led': (0, 120, 0, 255),   'emoji': 90},   # steady violet, happy
    'reconnecting':  {'led': (2, 255, 60, 0),    'emoji': 130},  # blinking orange, confused
    'error':         {'led': (0, 255, 0, 0),     'emoji': 110},  # steady red, sad
    'stopped':       {'led': (1, 30, 30, 30),    'emoji': 80},   # breathing dim, sleeping
}


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


class Debouncer:
    """True at most once per `seconds` window (monotonic clock)."""

    def __init__(self, seconds):
        self.seconds = seconds
        self._last = float('-inf')

    def ready(self, now=None):
        now = time.monotonic() if now is None else now
        if now - self._last < self.seconds:
            return False
        self._last = now
        return True


# ArUco DICT_4X4_50 marker id -> what the printed sign means. Printed PNGs live
# in robot/markers/ (same id doubles as the operator's sign and the camera's
# ground truth).
MARKER_LABELS = {
    **{i: f'sign {chr(ord("A") + i - 1)}' for i in range(1, 7)},
    **{10 + i: f'call booth {i}' for i in range(1, 5)},
    21: 'the meeting room',
    22: 'the conference room',
    23: 'the team tables',
    24: 'the kitchen',
}


class MarkerTracker:
    """Turns per-frame ArUco id lists into debounced sightings: a marker counts
    only after `stable_frames` consecutive frames that contain it, and each id
    reports at most once per `cooldown` seconds."""

    def __init__(self, stable_frames=3, cooldown=20.0):
        self.stable_frames = stable_frames
        self.cooldown = cooldown
        self._candidate = None
        self._streak = 0
        self._sent = {}

    def note(self, ids, now=None):
        """ids = marker ids visible in this processed frame. Returns the id of
        a newly confirmed sighting to report, or None."""
        now = time.monotonic() if now is None else now
        visible = {int(i) for i in ids} & set(MARKER_LABELS)
        if self._candidate in visible:
            self._streak += 1
        else:
            self._candidate = next(iter(visible), None)
            self._streak = 1 if self._candidate is not None else 0
        if self._candidate is None or self._streak < self.stable_frames:
            return None
        if now - self._sent.get(self._candidate, float('-inf')) < self.cooldown:
            return None
        self._sent[self._candidate] = now
        return self._candidate


class StallWatcher:
    """Fires once per user turn when no agent audio arrives within `seconds`
    of the transcript — the bridge then plays the "One moment." clip."""

    def __init__(self, seconds=STALL_SECONDS):
        self.seconds = seconds
        self._turn_at = None
        self._audio_at = 0.0
        self._fired = False

    def note_transcript(self, now=None):
        self._turn_at = time.monotonic() if now is None else now
        self._fired = False

    def note_audio(self, now=None):
        self._audio_at = time.monotonic() if now is None else now

    def reset(self):
        self._turn_at = None
        self._fired = False

    def should_fire(self, now=None):
        if self._turn_at is None or self._fired:
            return False
        if self._audio_at >= self._turn_at:
            return False
        now = time.monotonic() if now is None else now
        if now - self._turn_at >= self.seconds:
            self._fired = True
            return True
        return False


class PhrasePlayer:
    """Pushes pre-rendered local PCM clips (phrases/*.pcm, see make_phrases.py)
    into the normal playback queue — plays with no network. Missing files are
    skipped and logged once."""

    def __init__(self, bridge, directory=PHRASE_DIR):
        self._bridge = bridge
        self._dir = directory
        self._warned = set()

    def play(self, *names):
        for name in names:
            try:
                with open(os.path.join(self._dir, name + '.pcm'), 'rb') as fh:
                    data = fh.read()
            except OSError:
                if name not in self._warned:
                    self._warned.add(name)
                    self._bridge.log(
                        f'PHRASES: {name}.pcm missing (run make_phrases.py)')
                continue
            try:
                self._bridge.play_q.put_nowait(data)
            except queue.Full:
                pass


def rms_i16(pcm):
    """RMS of a little-endian s16 PCM buffer."""
    samples = array('h')
    samples.frombytes(pcm[:len(pcm) - len(pcm) % 2])
    if not samples:
        return 0.0
    return (sum(v * v for v in samples) / len(samples)) ** 0.5


class LatencyLog:
    """Per-turn timings: last loud mic frame (user speech end) -> first agent
    audio received -> first frame pushed to the device. Completed turns are
    appended to the CSV; summary() reports median and worst played latency."""

    FIELDS = ('turn', 'speech_end', 'transcript_ms', 'agent_audio_ms', 'played_ms')

    def __init__(self, path=None, rms_floor=MIC_RMS_FLOOR, now=time.monotonic):
        self._floor = rms_floor
        self._now = now
        self._speech_end = None
        self._turn = None
        self._rows = []
        self._fh = open(path, 'w', newline='', encoding='utf-8') if path else None
        if self._fh:
            csv.writer(self._fh).writerow(self.FIELDS)

    def note_mic(self, pcm, now=None):
        if rms_i16(pcm) >= self._floor:
            self._speech_end = self._now() if now is None else now

    def note_transcript(self, now=None):
        if self._speech_end is None:
            return
        at = self._now() if now is None else now
        self._turn = {'speech_end': self._speech_end, 'transcript_at': at,
                      'speech_end_wall': time.time() - (at - self._speech_end)}

    def note_agent_audio(self, now=None):
        if self._turn is not None and 'agent_at' not in self._turn:
            self._turn['agent_at'] = self._now() if now is None else now

    def note_played(self, now=None):
        if self._turn is None or 'agent_at' not in self._turn \
                or 'played_at' in self._turn:
            return
        turn = self._turn
        self._turn = None
        turn['played_at'] = self._now() if now is None else now
        self._rows.append(turn)
        if self._fh:
            csv.writer(self._fh).writerow([
                len(self._rows),
                datetime.datetime.fromtimestamp(
                    turn['speech_end_wall']).isoformat(timespec='seconds'),
                round((turn['transcript_at'] - turn['speech_end']) * 1000),
                round((turn['agent_at'] - turn['speech_end']) * 1000),
                round((turn['played_at'] - turn['speech_end']) * 1000),
            ])
            self._fh.flush()

    def summary(self):
        values = sorted(
            (r['played_at'] - r['speech_end']) * 1000 for r in self._rows)
        if not values:
            return 'no completed turns'
        mid = len(values) // 2
        median = values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2
        return f'{len(values)} turns, median {median:.0f} ms, worst {max(values):.0f} ms'

    def close(self):
        if self._fh:
            self._fh.close()
            self._fh = None


def phase_for(state, now=None):
    """Conversation phase for the signal table. `state` needs: error,
    reconnecting, negotiated, speaking, last_user_at (monotonic or 0)."""
    now = time.monotonic() if now is None else now
    if state.error:
        return 'error'
    if state.reconnecting:
        return 'reconnecting'
    if not state.negotiated:
        return 'connecting'
    if state.speaking:
        return 'speaking'
    if state.last_user_at and now - state.last_user_at < USER_SPEAK_SECONDS:
        return 'user_speaking'
    if state.last_user_at and now - state.last_user_at < THINK_SECONDS:
        return 'thinking'
    return 'listening'


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


def direct_signed_url(agent_id, api_key, opener=None):
    """GET ElevenLabs get-signed-url, like the organizers' bridge. A public
    agent needs no key; a private one needs ELEVENLABS_API_KEY."""
    if not api_key:
        return ('wss://api.elevenlabs.io/v1/convai/conversation'
                f'?agent_id={agent_id}')
    request = urllib.request.Request(
        'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url'
        f'?agent_id={agent_id}',
        headers={'xi-api-key': api_key})
    open_url = opener or urllib.request.urlopen
    with open_url(request, timeout=SOCKET_TIMEOUT) as response:
        body = json.loads(response.read().decode('utf-8'))
    url = body.get('signed_url') or body.get('signedUrl')
    if not url:
        raise RuntimeError('get-signed-url returned no signed URL')
    return url


def session_url(session, site, code, agent_id, api_key, log=lambda *a: None):
    """Resolve a websocket URL. auto = our site first, direct ElevenLabs as
    fallback when an API key is configured."""
    if session == 'direct':
        log('SESSION: direct (get-signed-url)')
        return direct_signed_url(agent_id, api_key)
    try:
        url = request_signed_url(site, code)
        log('SESSION: site /api/session')
        return url
    except Exception:
        if session == 'site' or not api_key:
            raise
        log('SESSION: site path failed; using direct ElevenLabs')
        return direct_signed_url(agent_id, api_key)


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

    def set_phase(self, phase):
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

    def set_phase(self, phase):
        pass

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
    FOCUS_RESPONSE_TOPIC = '/aima/hal/audio/focus_response'
    FOCUS_SRV = '/aimdk_5Fmsgs/srv/RequestAudioFocus'
    ABANDON_SRV = '/aimdk_5Fmsgs/srv/AbandonAudioFocus'
    STOP_SRV = '/aimdk_5Fmsgs/srv/StopAudioPlay'
    VOLUME_SRV = '/aimdk_5Fmsgs/srv/SetVolume'
    LED_SRV = '/aimdk_5Fmsgs/srv/SetPmuLed'
    EMOJI_SRV = '/aimdk_5Fmsgs/srv/PlayEmoji'
    TOUCH_TOPIC = '/aima/hal/sensor/touch_head'
    # Front RGB-D camera, MJPEG — read-only, used by --camera-markers.
    CAMERA_TOPIC = '/aima/hal/sensor/rgbd_head_front/rgb_image/compressed'
    CAMERA_MIN_INTERVAL = 0.5          # decode at most 2 fps

    def __init__(self, bridge, mic='vad', mic_channel=None, mic_stream=0,
                 volume=None, signals=True, touch=True, camera_markers=False):
        self._bridge = bridge
        self._mic_mode = mic
        self._mic_channel = mic_channel
        # 0 = lock onto the first stream_id seen (org bridge behaviour);
        # a fixed value pins one stream (1 built-in, 2 external).
        self._stream_lock = mic_stream or None
        # Unique package name per run, like the org bridge: playback + focus
        # ownership are attributed to it and it bases the playback token.
        self._pkg = f'{PKG_NAME}-{os.getpid()}'
        self._token = 0
        self._volume = volume
        self._signals = signals
        self._touch = touch
        self._camera_markers = camera_markers
        self._cam_last = 0.0
        self._cv2 = None
        self._aruco = None
        self._markers = MarkerTracker()
        self._touch_debounce = Debouncer(TOUCH_DEBOUNCE_SECONDS)
        self._phase = None
        self._led_client = None
        self._emoji_client = None
        self._warned = set()
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
                                    FocusResponse, PlayStateChange,
                                    ProcessedAudioOutput, TouchState)
        from aimdk_msgs.srv import (AbandonAudioFocus, PlayEmoji, RequestAudioFocus,
                                    SetPmuLed, SetVolume, StopAudioPlay)
        self._msg = dict(AudioPlayback=AudioPlayback)
        self._srv = dict(focus=RequestAudioFocus, abandon=AbandonAudioFocus,
                         stop=StopAudioPlay, volume=SetVolume,
                         led=SetPmuLed, emoji=PlayEmoji)
        self._TouchState = TouchState
        self._rclpy = rclpy

        if not rclpy.ok():
            rclpy.init()
        self._node = rclpy.create_node('navigator_bridge')
        self._executor = MultiThreadedExecutor()
        self._executor.add_node(self._node)
        self._spin_thread = threading.Thread(
            target=self._executor.spin, daemon=True)
        self._spin_thread.start()

        self._pub = self._publisher(AudioPlayback, self.PLAYBACK_TOPIC, 10)
        self._subscription(FocusResponse, self.FOCUS_RESPONSE_TOPIC,
                           self._on_focus, 10)
        self._subscription(
            PlayStateChange, self.PLAY_STATE_TOPIC, self._on_play_state,
            QoSProfile(history=QoSHistoryPolicy.KEEP_LAST, depth=10,
                       reliability=QoSReliabilityPolicy.BEST_EFFORT,
                       durability=QoSDurabilityPolicy.TRANSIENT_LOCAL))

        if self._mic_mode == 'vad':
            self._subscription(
                ProcessedAudioOutput, self.PROCESSED_TOPIC, self._on_vad_audio,
                QoSProfile(history=QoSHistoryPolicy.KEEP_LAST, depth=500,
                           reliability=QoSReliabilityPolicy.BEST_EFFORT,
                           durability=QoSDurabilityPolicy.TRANSIENT_LOCAL))
        else:
            self._subscription(
                AudioCapture, self.CAPTURE_TOPIC, self._on_raw_audio,
                QoSProfile(history=QoSHistoryPolicy.KEEP_LAST, depth=500,
                           reliability=QoSReliabilityPolicy.RELIABLE,
                           durability=QoSDurabilityPolicy.VOLATILE))

        self._focus_client = self._client(RequestAudioFocus, self.FOCUS_SRV)
        self._abandon_client = self._client(AbandonAudioFocus, self.ABANDON_SRV)
        self._stop_client = self._client(StopAudioPlay, self.STOP_SRV)
        self._volume_client = self._client(SetVolume, self.VOLUME_SRV)

        if self._touch:
            self._subscription(TouchState, self.TOUCH_TOPIC, self._on_touch, 10)
        if self._camera_markers:
            self._start_camera(qos_class=QoSProfile, history=QoSHistoryPolicy,
                               reliability=QoSReliabilityPolicy)
        if self._signals:
            self._led_client = self._client(SetPmuLed, self.LED_SRV)
            self._emoji_client = self._client(PlayEmoji, self.EMOJI_SRV)

        if self._volume is not None:
            self._set_volume(self._volume)
        self._request_focus()

    def _publisher(self, msg_type, name, qos):
        return self._node.create_publisher(
            msg_type, guard_ros_name(name), qos)

    def _subscription(self, msg_type, name, callback, qos):
        return self._node.create_subscription(
            msg_type, guard_ros_name(name), callback, qos)

    def _client(self, srv_type, name):
        return self._node.create_client(srv_type, guard_ros_name(name))

    def _call(self, client, request, tries=8, timeout=0.25, stamp_obj=None):
        """call_async + result wait with retries; ROS cross-host services are
        flaky per the vendor docs. `stamp_obj` (a std_msgs Header) gets a fresh
        stamp before each attempt, like the vendor examples do."""
        for _ in range(tries):
            if stamp_obj is not None:
                stamp_obj.stamp = self._node.get_clock().now().to_msg()
            future = client.call_async(request)
            try:
                return future.result(timeout=timeout)
            except Exception:
                continue
        return None

    def _requester(self):
        from aimdk_msgs.msg import FocusRequester
        requester = FocusRequester()
        requester.pkg_name = self._pkg
        requester.priority = FOCUS_PRIORITY
        requester.priority_weight = 0
        return requester

    def _on_focus(self, msg):
        """focus_response: re-request if we lose playback focus (org bridge)."""
        if getattr(msg, 'pkg_name', None) == self._pkg and \
                not getattr(msg, 'focus_gain', True):
            self._bridge.log('FOCUS: lost, re-requesting')
            threading.Thread(target=self._request_focus, daemon=True).start()

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

    # --- "I'm listening" signals (all best-effort, never blocks audio) ---------

    def _warn_once(self, key, text):
        if key not in self._warned:
            self._warned.add(key)
            self._bridge.log(text)

    def set_phase(self, phase):
        if not self._signals or phase == self._phase or phase not in PHASE_SIGNALS:
            return
        self._phase = phase
        threading.Thread(target=self._emit_signals, args=(phase,),
                         daemon=True).start()

    def _emit_signals(self, phase):
        led, emoji = PHASE_SIGNALS[phase]['led'], PHASE_SIGNALS[phase]['emoji']
        if phase != self._phase:
            return  # a newer phase already superseded this emission
        try:
            self._set_led(*led)
        except Exception as error:
            self._warn_once('led', f'LED: signal failed ({error}); continuing without it')
        try:
            self._play_emoji(emoji)
        except Exception as error:
            self._warn_once('emoji', f'EMOJI: signal failed ({error}); continuing without it')

    def _set_led(self, mode, r, g, b):
        if self._led_client is None:
            return
        request = self._srv['led'].Request()
        request.led_strip_mode = mode
        request.r, request.g, request.b = r, g, b
        request.priority = SIGNAL_PRIORITY
        request.reset_priority = False   # never force-preempt system fault LEDs
        request.trace_id = 'navigator_bridge'
        # The LED strip is slow to respond (up to ~5 s per the docs).
        response = self._call(self._led_client, request, tries=2, timeout=5.0,
                              stamp_obj=request.request.header)
        if response is None:
            self._warn_once('led', 'LED: SetPmuLed unavailable; continuing without it')
        elif getattr(response, 'status_code', 0) == 0x1024:
            self._warn_once('led-prio', 'LED: priority insufficient; a higher-priority source owns the strip')

    def _play_emoji(self, emotion_id):
        if self._emoji_client is None:
            return
        request = self._srv['emoji'].Request()
        request.emotion_id = emotion_id
        request.mode = 2            # EMOTION_MODE_LOOP
        request.priority = SIGNAL_PRIORITY
        response = self._call(self._emoji_client, request, tries=2, timeout=1.0,
                              stamp_obj=request.header.header)
        if response is None:
            self._warn_once('emoji', 'EMOJI: PlayEmoji unavailable; continuing without it')
        elif not getattr(response, 'success', True):
            self._warn_once('emoji', f'EMOJI: rejected ({response.message}); continuing without it')

    def _on_touch(self, msg):
        if msg.event_type == getattr(self._TouchState, 'TOUCH', 2) and \
                self._touch_debounce.ready():
            self._bridge.head_touch()

    def _on_play_state(self, msg):
        state = getattr(msg.state, 'value', msg.state)
        self._bridge.log(f'PLAYSTATE: pkg={msg.pkg_name} state={state}')

    def _on_vad_audio(self, msg):
        """VAD mic stream. Locks onto the first stream_id seen (or the one
        pinned by --mic-stream) and drops frames from any other stream."""
        stream_id = getattr(msg, 'stream_id', 0)
        if self._stream_lock is None:
            self._stream_lock = stream_id
            self._bridge.log(f'MIC: locked onto stream_id {stream_id}')
        if stream_id != self._stream_lock:
            return
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

    # --- camera markers (read-only, --camera-markers) -------------------------

    def _start_camera(self, qos_class, history, reliability):
        try:
            import cv2
            import numpy as np
            from sensor_msgs.msg import CompressedImage
        except ImportError as error:
            self._bridge.log(
                f'CAMERA: markers disabled ({error}); install '
                'opencv-contrib-python-headless + numpy in the container')
            self._camera_markers = False
            return
        self._cv2, self._np = cv2, np
        aruco = cv2.aruco
        dictionary = aruco.getPredefinedDictionary(aruco.DICT_4X4_50)
        if hasattr(aruco, 'ArucoDetector'):
            self._detector = aruco.ArucoDetector(
                dictionary, aruco.DetectorParameters())
            self._aruco_dict = None
        else:   # OpenCV < 4.7
            self._detector = None
            self._aruco_dict = dictionary
        # SensorDataQoS: best_effort + volatile + keep last 5
        qos = qos_class(history=history.KEEP_LAST, depth=5,
                        reliability=reliability.BEST_EFFORT)
        self._subscription(CompressedImage, self.CAMERA_TOPIC,
                           self._on_camera, qos)
        self._bridge.log('CAMERA: ArUco markers on RGB-D front camera '
                         '(read-only, <=2 fps)')

    def _on_camera(self, msg):
        now = time.monotonic()
        if now - self._cam_last < self.CAMERA_MIN_INTERVAL:
            return
        self._cam_last = now
        cv2, np = self._cv2, self._np
        try:
            frame = cv2.imdecode(
                np.frombuffer(bytes(msg.data), np.uint8),
                cv2.IMREAD_GRAYSCALE)
        except Exception:
            return
        if frame is None:
            return
        if self._detector is not None:
            _, ids, _ = self._detector.detectMarkers(frame)
        else:
            _, ids, _ = cv2.aruco.detectMarkers(frame, self._aruco_dict)
        ids = [] if ids is None else [int(i) for i in ids.flatten()]
        marker = self._markers.note(ids, now)
        if marker is not None:
            label = MARKER_LABELS[marker]
            self._bridge.log(f'CAMERA: sees marker {marker} = {label}')
            self._bridge.send_contextual(
                f'Robot camera sees the marker for {label} '
                f'(id {marker}).')

    def play(self, chunk):
        playback = self._msg['AudioPlayback']()
        playback.pkg_name = self._pkg
        playback.token_id = f'{self._pkg}-{self._token}'
        playback.info.channels = 1
        playback.info.sample_rate = RATE
        playback.data.data = list(chunk)
        self._pub.publish(playback)

    def stop_playback(self):
        # A new token_id clears the robot's playback buffer (per the docs);
        # StopAudioPlay halts whatever is already sounding.
        self._token += 1
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
        self.session_mode = getattr(args, 'session', 'auto')
        self.agent_id = (getattr(args, 'agent_id', None)
                         or os.environ.get('ELEVENLABS_AGENT_ID')
                         or PROD_AGENT_ID)
        self.api_key = os.environ.get('ELEVENLABS_API_KEY', '').strip()
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
        self._pending = bytearray()
        self._play_lock = threading.Lock()
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
        self.dropping = False
        self.error_state = False
        self.last_user_at = 0.0
        self._phase = None
        self.latency = LatencyLog(getattr(args, 'latency_csv', None))
        self._stall = StallWatcher()
        self.phrases = PhrasePlayer(self)

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

    def _update_signals(self):
        phase = phase_for(SimpleNamespace(
            error=self.error_state,
            reconnecting=self.dropping,
            negotiated=self.negotiated.is_set(),
            speaking=self.clock.active(),
            last_user_at=self.last_user_at,
        ))
        if phase != self._phase:
            self._phase = phase
            if self.io and hasattr(self.io, 'set_phase'):
                try:
                    self.io.set_phase(phase)
                except Exception:
                    pass

    def _mic_sender(self):
        while not self.stop_event.is_set():
            self._update_signals()
            try:
                chunk = self.send_q.get(timeout=CHUNK_MS / 1000)
            except queue.Empty:
                chunk = SILENCE
            if not self.negotiated.is_set():
                continue
            if self.muted or (self.half_duplex and self.clock.active()):
                chunk = SILENCE
            self.latency.note_mic(chunk)
            if self.connected and self._stall.should_fire():
                self.phrases.play('wait_en')
            self._send({'user_audio_chunk': base64.b64encode(chunk).decode('ascii')})

    # -- playback path -------------------------------------------------------

    def _playback_worker(self):
        while not self.stop_event.is_set():
            with self._play_lock:
                while True:
                    try:
                        self._pending.extend(self.play_q.get_nowait())
                    except queue.Empty:
                        break
                # Pace device writes: never run more than LOOKAHEAD ahead.
                while (self._pending
                       and self.clock.remaining() <= PLAYBACK_LOOKAHEAD):
                    chunk = bytes(self._pending[:PUBLISH_BYTES])
                    del self._pending[:PUBLISH_BYTES]
                    self.clock.note(len(chunk))
                    if self.io:
                        try:
                            self.io.play(chunk)
                            self.latency.note_played()
                        except Exception as error:
                            self.log(f'PLAYBACK: io error: {error}')
            self.stop_event.wait(0.01)

    def clear_playback(self):
        with self._play_lock:
            while True:
                try:
                    self.play_q.get_nowait()
                except queue.Empty:
                    break
            self._pending.clear()
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

    def send_contextual(self, text):
        return self._send({'type': 'contextual_update', 'text': text})

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
                self.dropping = False
                self.log('STATE: listening (negotiated pcm_16000)')
                if self.reconnected:
                    self._send({
                        'type': 'contextual_update',
                        'text': build_reconnect_text(self.transcripts),
                    })
                    self.phrases.play('back_en')
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
                self._stall.note_audio()
                self.latency.note_agent_audio()
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
            self.last_user_at = time.monotonic()
            self._stall.note_transcript()
            self.latency.note_transcript()
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

    def _session_url(self):
        return session_url(self.session_mode, self.site, self.code,
                           self.agent_id, self.api_key, log=self.log)

    def run(self):
        need_code = self.session_mode == 'site' or \
            (self.session_mode == 'auto' and not self.api_key)
        if need_code and not self.code:
            self.log('ERROR: no access code (--code or NAVIGATOR_ACCESS_CODE)')
            return 2
        if self.session_mode == 'direct' and not self.api_key:
            self.log('SESSION: direct without ELEVENLABS_API_KEY — '
                     'works only if the agent is public')
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
                url = self._session_url()
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
            self.dropping = True
            self.phrases.play('lost_en', 'lost_ar')
            if attempts >= len(RECONNECT_DELAYS):
                self.error_state = True
                self.log('ERROR: reconnect attempts exhausted; '
                         'press Enter for a fresh take or q to quit')
                self.fresh_event.wait(timeout=None if not self.stop_event.is_set() else 0)
                continue
            delay = RECONNECT_DELAYS[attempts]
            attempts += 1
            self.log(f'STATE: reconnecting in {delay}s (attempt {attempts})')
            self.stop_event.wait(delay)
        self.log(f'LATENCY: {self.latency.summary()}')
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
                self.fresh_take('keys')

    def fresh_take(self, source='keys'):
        self.log(f'{source.upper()}: fresh take')
        self.transcripts.clear()
        self.reconnected = False
        self.dropping = False
        self.error_state = False
        self._stall.reset()
        self.fresh_event.set()

    def head_touch(self):
        self.log('TOUCH: head tapped')
        self.fresh_take('touch')

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
        if self.io and hasattr(self.io, 'set_phase'):
            try:
                self.io.set_phase('stopped')
            except Exception:
                pass
        self.latency.close()
        self.log('bridge stopped')


def fmt_check(name, ok, detail=''):
    return f"{'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail else ''}"


def _reachable(url):
    """True when the host answers over HTTPS (any status counts)."""
    try:
        urllib.request.urlopen(url, timeout=8)
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


def run_preflight(args):
    """On-robot checklist: prints PASS/FAIL lines and exits. One ROS node,
    read-only subscriptions plus a short speaker test."""
    results = []

    def check(name, ok, detail=''):
        results.append((name, ok, detail))
        print(fmt_check(name, ok, detail), flush=True)

    check('python', sys.version_info >= (3, 8), sys.version.split()[0])
    modules = [('websocket', True), ('numpy', False)]
    if getattr(args, 'camera_markers', False):
        modules.append(('cv2', True))
    for mod, required in modules:
        try:
            __import__(mod)
            check(f'import {mod}', True)
        except ImportError:
            check(f'import {mod}', not required,
                  'missing' if required else 'missing (not needed by robot path)')
    ros_ok = False
    try:
        import rclpy  # noqa: F401
        import aimdk_msgs  # noqa: F401
        ros_ok = True
        check('import rclpy + aimdk_msgs', True)
    except ImportError as error:
        check('import rclpy + aimdk_msgs', False, str(error))

    check('https api.elevenlabs.io', _reachable('https://api.elevenlabs.io/'))
    check('https session site', _reachable(args.url))

    site = args.url.rstrip('/')
    code = args.code or os.environ.get('NAVIGATOR_ACCESS_CODE', '')
    agent_id = (args.agent_id or os.environ.get('ELEVENLABS_AGENT_ID')
                or PROD_AGENT_ID)
    api_key = os.environ.get('ELEVENLABS_API_KEY', '').strip()
    url = None
    try:
        url = session_url(args.session, site, code, agent_id, api_key,
                          log=lambda *a: None)
        check('signed session url', True,
              f'{args.session} path')
    except Exception as error:
        check('signed session url', False, str(error)[:120])

    if not ros_ok:
        for name in ('ros topics', 'mic stream', 'audio focus', 'speaker test'):
            check(name, False, 'skipped (no rclpy)')
    else:
        _preflight_ros(args, check)

    if url:
        _preflight_socket(url, check)
    else:
        check('agent websocket', False, 'skipped (no session url)')

    failed = sum(1 for _, ok, _ in results if not ok)
    print(f'-- preflight: {len(results) - failed} PASS, {failed} FAIL --')
    return 1 if failed else 0


def _preflight_ros(args, check):
    import rclpy
    from rclpy.qos import (QoSDurabilityPolicy, QoSHistoryPolicy, QoSProfile,
                           QoSReliabilityPolicy)
    from aimdk_msgs.msg import AudioPlayback, ProcessedAudioOutput
    from aimdk_msgs.srv import RequestAudioFocus, StopAudioPlay

    if not rclpy.ok():
        rclpy.init()
    node = rclpy.create_node('navigator_preflight')
    pkg = f'{PKG_NAME}-preflight-{os.getpid()}'
    try:
        names = {n for n, _ in node.get_topic_names_and_types()}
        topics = [RobotIO.PROCESSED_TOPIC, RobotIO.PLAYBACK_TOPIC]
        if getattr(args, 'camera_markers', False):
            topics.append(RobotIO.CAMERA_TOPIC)
        for topic in topics:
            check(f'topic {topic}', topic in names)
        slam = sorted(n for n in names if n.startswith(('/slam', '/localization')))
        check('slam/localization topics (info)', True,
              ', '.join(slam) if slam else 'none publishing')

        # Mic: listen on the VAD stream for 5 s.
        stats = {'count': 0, 'streams': set(), 'vad_begin': False}
        qos = QoSProfile(history=QoSHistoryPolicy.KEEP_LAST, depth=500,
                         reliability=QoSReliabilityPolicy.BEST_EFFORT,
                         durability=QoSDurabilityPolicy.TRANSIENT_LOCAL)

        def on_mic(msg):
            stats['count'] += 1
            stats['streams'].add(getattr(msg, 'stream_id', 0))
            state = getattr(getattr(msg, 'audio_vad_state', None), 'value', None)
            if state == 1:   # AUDIO_VAD_STATE_BEGIN
                stats['vad_begin'] = True

        node.create_subscription(ProcessedAudioOutput,
                                 RobotIO.PROCESSED_TOPIC, on_mic, qos)
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            rclpy.spin_once(node, timeout_sec=0.1)
        if stats['count']:
            check('mic stream (/agent/process_audio_output)', True,
                  f"{stats['count']} msgs in 5s, stream_ids "
                  f"{sorted(stats['streams'])}, vad_begin={stats['vad_begin']}")
        else:
            check('mic stream (/agent/process_audio_output)', False,
                  'no messages in 5s — is the robot in voice-only mode? '
                  'say the wake word once')

        # Focus + speaker: request focus, play back_en.pcm, release.
        focus_client = node.create_client(RequestAudioFocus, RobotIO.FOCUS_SRV)
        gained = False
        if focus_client.wait_for_service(timeout_sec=5.0):
            from aimdk_msgs.msg import FocusRequester
            request = RequestAudioFocus.Request()
            request.focus_requester = FocusRequester(
                pkg_name=pkg, priority=FOCUS_PRIORITY)
            try:
                future = focus_client.call_async(request)
                deadline = time.monotonic() + 4.0
                while not future.done() and time.monotonic() < deadline:
                    rclpy.spin_once(node, timeout_sec=0.05)
                if future.done():
                    response = future.result()
                    gained = bool(response and response.focus_response.focus_gain)
            except Exception:
                pass
        check('audio focus (RequestAudioFocus)', gained,
              f'priority {FOCUS_PRIORITY}' if gained else 'not granted — '
              'playback may mix or stay silent')

        clip = os.path.join(PHRASE_DIR, 'back_en.pcm')
        try:
            with open(clip, 'rb') as fh:
                pcm = fh.read()
        except OSError:
            pcm = b''
        if pcm:
            pub = node.create_publisher(AudioPlayback,
                                        RobotIO.PLAYBACK_TOPIC, 10)
            time.sleep(0.3)   # let the subscriber match
            sent = 0
            for i in range(0, len(pcm), CHUNK_BYTES):
                msg = AudioPlayback()
                msg.pkg_name = pkg
                msg.token_id = f'{pkg}-0'
                msg.info.channels = 1
                msg.info.sample_rate = RATE
                msg.data.data = list(pcm[i:i + CHUNK_BYTES])
                pub.publish(msg)
                sent += CHUNK_BYTES
                rclpy.spin_once(node, timeout_sec=0.05)
            check('speaker test (played back_en.pcm)', True,
                  f'{len(pcm)} bytes — did you hear "I\'m back…"?')
            stop_client = node.create_client(StopAudioPlay, RobotIO.STOP_SRV)
            if stop_client.wait_for_service(timeout_sec=1.0):
                stop_client.call_async(StopAudioPlay.Request())
        else:
            check('speaker test (played back_en.pcm)', False,
                  'phrases/back_en.pcm missing — run make_phrases.py')
    finally:
        node.destroy_node()


def _preflight_socket(url, check):
    """Connect like the real run: negotiate pcm_16000 and receive the first
    agent audio."""
    import websocket
    got = {'meta': False, 'audio': False, 'format': ''}
    try:
        ws = websocket.create_connection(url, subprotocols=['convai'],
                                         timeout=SOCKET_TIMEOUT,
                                         skip_utf8_validation=True)
    except Exception as error:
        check('agent websocket', False, f'connect: {error}')
        return
    try:
        ws.send(json.dumps({'type': 'conversation_initiation_client_data'}))
        ws.settimeout(12.0)
        deadline = time.monotonic() + 12.0
        while time.monotonic() < deadline and not got['audio']:
            try:
                event = json.loads(ws.recv())
            except Exception:
                break
            if event.get('type') == 'ping':
                ws.send(json.dumps({'type': 'pong',
                                    'event_id': event['ping_event']['event_id']}))
            elif event.get('type') == 'conversation_initiation_metadata':
                meta = event['conversation_initiation_metadata_event']
                got['meta'] = True
                got['format'] = meta.get('agent_output_audio_format', '')
            elif event.get('type') == 'audio':
                got['audio'] = True
    finally:
        try:
            ws.close()
        except Exception:
            pass
    check('agent websocket (first audio)', got['audio'],
          got['format'] if got['audio'] else
          ('connected but no audio in 12s' if got['meta'] else 'no metadata'))


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description='Robot audio bridge for the navigator agent')
    parser.add_argument('--io', choices=sorted(IOS), default='robot')
    parser.add_argument('--mic', choices=['raw', 'vad'], default='vad',
                        help='robot mic source (VAD stream after wake word, or raw capture topic)')
    parser.add_argument('--mic-channel', type=int, default=None,
                        help='use a single raw mic channel instead of averaging')
    parser.add_argument('--mic-stream', type=int, default=0,
                        help='VAD mic stream to use (0 = first seen, 1 built-in, 2 external)')
    parser.add_argument('--session', choices=['auto', 'site', 'direct'], default='auto',
                        help='auto: our /api/session then direct ElevenLabs fallback; '
                             'direct: get-signed-url with ELEVENLABS_API_KEY')
    parser.add_argument('--agent-id', default=None,
                        help='agent for --session direct (or ELEVENLABS_AGENT_ID)')
    parser.add_argument('--preflight', action='store_true',
                        help='run the on-robot checklist and exit (no conversation)')
    parser.add_argument('--code', default=None, help='access code (or NAVIGATOR_ACCESS_CODE)')
    parser.add_argument('--url', default=DEFAULT_SITE, help='site base URL')
    parser.add_argument('--volume', type=int, default=None,
                        help='robot speaker volume 0-100 (best effort)')
    duplex = parser.add_mutually_exclusive_group()
    duplex.add_argument('--half-duplex', dest='half_duplex', action='store_true', default=None)
    duplex.add_argument('--full-duplex', dest='half_duplex', action='store_false')
    parser.add_argument('--no-signals', action='store_true',
                        help='robot only: disable LED strip + screen emoji phase signals')
    parser.add_argument('--camera-markers', action='store_true',
                        help='read-only ArUco marker sightings on the RGB-D '
                             'front camera, sent to the agent as '
                             'contextual_update (needs cv2 in the container)')
    parser.add_argument('--no-touch', action='store_true',
                        help='robot only: disable head-touch fresh take')
    parser.add_argument('--log-dir', default=os.path.join(os.path.dirname(__file__), 'logs'))
    args = parser.parse_args(argv)

    if args.half_duplex is None:
        args.half_duplex = False   # org bridge default; --half-duplex opts in

    if args.preflight:
        return run_preflight(args)

    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    args.log_file = os.path.join(args.log_dir, f'{stamp}.log')
    args.latency_csv = os.path.join(args.log_dir, f'latency-{stamp}.csv')
    if args.io == 'robot':
        args.io_backend = lambda bridge: RobotIO(
            bridge, mic=args.mic, mic_channel=args.mic_channel,
            mic_stream=args.mic_stream, volume=args.volume,
            signals=not args.no_signals, touch=not args.no_touch,
            camera_markers=args.camera_markers)
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
