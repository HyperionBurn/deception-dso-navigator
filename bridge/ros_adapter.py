"""ROS 2 adapter for the AgiBot X2: robot microphone in, robot speaker out.

UNTESTED ON A REAL ROBOT. It is kept close to the organisers' starter bridge
(sources/organizer_docs/elevenlabs_robot_bridge.py): same topics, same message types, same
audio-focus handling, same pacing. It was only run against a small fake ROS in the tests.

Two microphone sources (setting `mic_source`):
  * "raw" (the default on the robot): /aima/hal/audio/capture. The raw microphones, always on, no
    wake word needed. Several channels are mixed down to one. There is NO echo cancellation, so
    run it with mic_gate = half_duplex (the robot would hear itself otherwise).
  * "wake_word": /agent/process_audio_output, the robot's own processed stream. It stays silent
    until the wake word is said. This was the first version.

Safety:
  * The bridge subscribes to the microphone topic and publishes ONLY to the audio playback
    topic. It also calls the three audio services (take focus, give focus back, stop playing).
  * assert_safe_name() runs before every publisher, subscription and service client is made.
    It refuses any name that looks like movement, mapping or system state.
  * One long-lived process. Never restart it in a loop: the organisers allow at most 2 ROS
    nodes started per second.

rclpy and the AimDK message packages are imported inside start(), so this file can be imported
on a laptop with no ROS installed.
"""
from __future__ import annotations

import array
import asyncio
import logging
import os
import sys
import threading
import time
from types import SimpleNamespace
from typing import Optional

from .core import BYTES_PER_SEC, CHUNK_BYTES, CHUNK_S, SILENCE, AudioSink, AudioSource

log = logging.getLogger("bridge.ros")

RATE = 16000
FOCUS_PRIORITY = 8                 # same value as AgiBot's stream example
MAX_MIC_BACKLOG = BYTES_PER_SEC    # keep at most 1 s of mic audio waiting; stale speech is useless

# The only topics and services this adapter touches (names as in the organisers' file).
MIC_TOPIC = "/agent/process_audio_output"        # mic_source "wake_word"
RAW_MIC_TOPIC = "/aima/hal/audio/capture"        # mic_source "raw"
MIC_SOURCES = ("raw", "wake_word")
FOCUS_RESPONSE_TOPIC = "/aima/hal/audio/focus_response"
PLAYBACK_TOPIC = "/aima/hal/audio/playback"
REQUEST_FOCUS_SERVICE = "/aimdk_5Fmsgs/srv/RequestAudioFocus"
ABANDON_FOCUS_SERVICE = "/aimdk_5Fmsgs/srv/AbandonAudioFocus"
STOP_PLAY_SERVICE = "/aimdk_5Fmsgs/srv/StopAudioPlay"
ALL_NAMES = (MIC_TOPIC, RAW_MIC_TOPIC, FOCUS_RESPONSE_TOPIC, PLAYBACK_TOPIC,
             REQUEST_FOCUS_SERVICE, ABANDON_FOCUS_SERVICE, STOP_PLAY_SERVICE)

# A topic or service name containing any of these is refused (case does not matter).
FORBIDDEN_WORDS = ("command", "locomotion", "upper_body", "pnc_task", "integrated_command",
                   "relocalization_pose", "SetMc", "MigrateSystemState")


class UnsafeNameError(RuntimeError):
    """A topic or service name that the bridge must never touch."""


class RosNotAvailable(RuntimeError):
    """ROS 2 or the AimDK messages cannot be imported."""


def assert_safe_name(name) -> None:
    """Raise UnsafeNameError if `name` could reach movement, mapping or system state."""
    if not isinstance(name, str) or not name.strip():
        raise UnsafeNameError("a topic or service name must be a non-empty string, got %r" % (name,))
    lowered = name.lower()
    for word in FORBIDDEN_WORDS:
        if word.lower() in lowered:
            raise UnsafeNameError("refusing %r: the name contains %r. The bridge handles audio "
                                  "only and never touches movement or system topics." % (name, word))


def downmix_to_mono(data, channels: int, mic_channels: int) -> bytes:
    """Mix the raw capture to mono 16 kHz S16LE, the same way as the organisers' code:
    take the first `mic_channels` channels of each frame and average them. The channels after
    that are the speaker reference and are ignored. The average goes towards zero, like numpy's
    astype. A broken tail (odd byte, half a frame) is dropped."""
    channels = int(channels)
    if channels < 1:
        raise ValueError("channels must be 1 or more, got %r" % (channels,))
    mics = min(max(int(mic_channels), 1), channels)      # out of range: first mic only / all channels
    frame_bytes = 2 * channels
    usable = len(data) - len(data) % frame_bytes
    samples = array.array("h")
    samples.frombytes(bytes(data[:usable]))
    if sys.byteorder == "big":
        samples.byteswap()
    if mics == 1:
        mono = samples[::channels]
    else:
        columns = [samples[i::channels] for i in range(mics)]
        mono = array.array("h", [int(sum(frame) / mics) for frame in zip(*columns)])
    if sys.byteorder == "big":
        mono.byteswap()
    return mono.tobytes()


class RosAdapter(AudioSource, AudioSink):
    """Microphone and speaker of the robot, through ROS 2. One object is both source and sink."""

    def __init__(self, mic_stream: int = 0, lead_s: float = 0.3, poll_s: float = 0.05,
                 mic_source: str = "raw"):
        if mic_source not in MIC_SOURCES:
            raise ValueError("mic_source must be one of %s, not %r"
                             % (", ".join(MIC_SOURCES), mic_source))
        self.mic_source = mic_source       # "raw" or "wake_word", see the top of this file
        self.mic_stream = mic_stream       # wake_word only: 0 = first heard, 1 built-in, 2 external
        self.lead_s = lead_s               # seconds of audio queued ahead in the robot's buffer
        self.poll_s = poll_s
        self.pkg = "voo_bridge%d" % os.getpid()
        self.token = 0
        self.running = False
        self._started = False
        self._closed = False
        self._mic_buf = bytearray()
        self._mic_lock = threading.Lock()
        self._warned = set()
        self._next_tick: Optional[float] = None
        self._spk = bytearray()
        self._spk_lock = threading.Lock()
        self._speaker_thread: Optional[threading.Thread] = None
        self._spin_thread: Optional[threading.Thread] = None
        self.ros = None
        self.node = None

    # ------------------------------------------------------------------ start / stop
    def _import_ros(self):
        try:
            import rclpy
            from rclpy.executors import MultiThreadedExecutor
            from rclpy.node import Node
            from rclpy.qos import QoSHistoryPolicy, QoSProfile, QoSReliabilityPolicy
            from aimdk_msgs.msg import (AudioData, AudioInfo, AudioPlayback, AudioVadStateType,
                                        CommonState, FocusRequester, FocusResponse,
                                        ProcessedAudioOutput)
            from aimdk_msgs.srv import AbandonAudioFocus, RequestAudioFocus, StopAudioPlay
        except ImportError as exc:
            raise RosNotAvailable(
                "Cannot import ROS 2 or the AimDK messages (%s). On the robot's PC2 run "
                "'source /opt/ros/humble/setup.bash' and 'source <path to aimdk>/install/setup.bash' "
                "first (ask MangoBot for the path), then start the bridge again." % exc) from exc
        audio_capture = None
        if self.mic_source == "raw":
            try:
                from aimdk_msgs.msg import AudioCapture as audio_capture
            except ImportError as exc:
                raise RosNotAvailable(
                    "The AimDK messages here have no AudioCapture type (%s), so the raw microphone "
                    "%s cannot be used. Set the setting ros_mic_source to wake_word "
                    "(BRIDGE_ROS_MIC_SOURCE=wake_word) to use %s instead."
                    % (exc, RAW_MIC_TOPIC, MIC_TOPIC)) from exc
        self.ros = SimpleNamespace(
            rclpy=rclpy, MultiThreadedExecutor=MultiThreadedExecutor, Node=Node,
            AudioCapture=audio_capture, QoSProfile=QoSProfile, QoSHistoryPolicy=QoSHistoryPolicy,
            QoSReliabilityPolicy=QoSReliabilityPolicy, AudioData=AudioData, AudioInfo=AudioInfo,
            AudioPlayback=AudioPlayback, AudioVadStateType=AudioVadStateType,
            CommonState=CommonState, FocusRequester=FocusRequester, FocusResponse=FocusResponse,
            ProcessedAudioOutput=ProcessedAudioOutput, AbandonAudioFocus=AbandonAudioFocus,
            RequestAudioFocus=RequestAudioFocus, StopAudioPlay=StopAudioPlay)

    async def start(self) -> None:
        if self._started:
            return
        self._import_ros()
        ros = self.ros
        try:
            from rclpy.signals import SignalHandlerOptions
            ros.rclpy.init(signal_handler_options=SignalHandlerOptions.NO)
        except (ImportError, TypeError):
            ros.rclpy.init()
        self.node = ros.Node("voo_elevenlabs_bridge")
        mic_qos = ros.QoSProfile(history=ros.QoSHistoryPolicy.KEEP_LAST, depth=500,
                                 reliability=ros.QoSReliabilityPolicy.BEST_EFFORT)
        if self.mic_source == "raw":
            self._subscribe(ros.AudioCapture, RAW_MIC_TOPIC, self.on_raw_mic, mic_qos)
        else:
            self._subscribe(ros.ProcessedAudioOutput, MIC_TOPIC, self.on_mic, mic_qos)
        self._subscribe(ros.FocusResponse, FOCUS_RESPONSE_TOPIC, self.on_focus, 10)
        self.player = self._publisher(ros.AudioPlayback, PLAYBACK_TOPIC, 10)
        self.focus_cli = self._client(ros.RequestAudioFocus, REQUEST_FOCUS_SERVICE)
        self.abandon_cli = self._client(ros.AbandonAudioFocus, ABANDON_FOCUS_SERVICE)
        self.stop_cli = self._client(ros.StopAudioPlay, STOP_PLAY_SERVICE)

        self._executor = ros.MultiThreadedExecutor()
        self._executor.add_node(self.node)
        self._spin_thread = threading.Thread(target=self._executor.spin, daemon=True)
        self._spin_thread.start()
        self._started = True
        self.running = True

        loop = asyncio.get_running_loop()
        if not await loop.run_in_executor(None, self.take_focus):
            log.warning("continuing without confirmed focus; the speaker may stay silent")
        self._speaker_thread = threading.Thread(target=self._speaker_loop, daemon=True)
        self._speaker_thread.start()

    async def close(self) -> None:
        """Give the speaker back and shut ROS down. Safe to call twice."""
        if not self._started or self._closed:
            return
        self._closed = True
        await asyncio.get_running_loop().run_in_executor(None, self._close_blocking)

    def _close_blocking(self):
        self.running = False
        for step in (self.stop, self.drop_focus, self._executor.shutdown,
                     self.node.destroy_node, self.ros.rclpy.shutdown):
            try:
                step()
            except Exception as exc:
                log.warning("shutdown step failed: %s", exc)
        log.info("speaker released, bye")

    # ---------------------------------------------- guarded creation (name check first)
    def _subscribe(self, msg_type, topic, callback, qos):
        assert_safe_name(topic)
        return self.node.create_subscription(msg_type, topic, callback, qos)

    def _publisher(self, msg_type, topic, qos):
        assert_safe_name(topic)
        if topic != PLAYBACK_TOPIC:
            raise UnsafeNameError("the bridge may publish only to %s, not %s" % (PLAYBACK_TOPIC, topic))
        return self.node.create_publisher(msg_type, topic, qos)

    def _client(self, srv_type, name):
        assert_safe_name(name)
        return self.node.create_client(srv_type, name)

    # ------------------------------------------------------------------- ROS services
    def call(self, client, request, tries=8, timeout=0.25):
        """AgiBot's advice: cross-host ROS services need retries."""
        for _ in range(tries):
            if not client.wait_for_service(timeout_sec=timeout):
                continue
            future = client.call_async(request)
            done = threading.Event()
            future.add_done_callback(lambda f: done.set())
            if done.wait(timeout * 4) and future.result() is not None:
                return future.result()
        return None

    def requester(self):
        return self.ros.FocusRequester(pkg_name=self.pkg, priority=FOCUS_PRIORITY)

    def take_focus(self) -> bool:
        request = self.ros.RequestAudioFocus.Request()
        request.focus_requester = self.requester()
        result = self.call(self.focus_cli, request)
        # "reponse" is AgiBot's own spelling. It is always SUCCESS: only focus_gain tells.
        ok = (result is not None and result.reponse.status.value == self.ros.CommonState.SUCCESS
              and result.focus_response.focus_gain)
        log.info("speaker focus: %s", "yes" if ok else "NO (ask MangoBot to check the agent module)")
        return bool(ok)

    def drop_focus(self):
        request = self.ros.AbandonAudioFocus.Request()
        request.focus_requester = self.requester()   # must match the request exactly
        self.call(self.abandon_cli, request, tries=3)

    def on_focus(self, msg):
        if msg.pkg_name == self.pkg and not msg.focus_gain:
            log.warning("speaker focus lost, asking again")
            threading.Thread(target=self.take_focus, daemon=True).start()

    # ---------------------------------------------------------------------- microphone
    def _warn_once(self, key, text, *args):
        if key not in self._warned:
            self._warned.add(key)
            log.warning(text, *args)

    def on_raw_mic(self, msg):
        """mic_source "raw": one AudioCapture message. A bad message is dropped (and reported
        once); an error here must never stop the ROS spin thread."""
        try:
            info = msg.info
            rate = getattr(info, "sample_rate", None)
            if rate not in (None, 0, RATE):
                self._warn_once("rate", "the raw mic says %s Hz, not %d Hz: the voice will sound wrong",
                                rate, RATE)
            mono = downmix_to_mono(bytes(msg.data.data), info.channels, msg.mic_channels)
        except Exception as exc:
            self._warn_once(("bad", type(exc).__name__), "dropping a raw mic message that cannot be "
                            "read (%s: %s); more of the same stay quiet", type(exc).__name__, exc)
            return
        if not mono:
            return
        with self._mic_lock:
            self._mic_buf += mono

    def on_mic(self, msg):
        if self.mic_stream == 0:
            self.mic_stream = msg.stream_id
            log.info("listening on mic stream %s", msg.stream_id)
        if msg.stream_id != self.mic_stream:
            return
        if msg.audio_vad_state.value == self.ros.AudioVadStateType.AUDIO_VAD_STATE_BEGIN \
                and self.on_presence:
            self.on_presence()             # the robot's own voice detector heard someone
        with self._mic_lock:
            self._mic_buf += bytes(msg.audio_data)

    async def read_chunk(self) -> Optional[bytes]:
        """Every 100 ms: the next 100 ms of mic audio, or silence if the robot heard nothing
        (so ElevenLabs can tell when the person stopped talking)."""
        now = time.monotonic()
        if self._next_tick is None or now - self._next_tick > 1.0:
            self._next_tick = now          # first call, or we fell far behind: restart the clock
        self._next_tick += CHUNK_S
        await asyncio.sleep(max(0.0, self._next_tick - time.monotonic()))
        with self._mic_lock:
            excess = len(self._mic_buf) - MAX_MIC_BACKLOG
            if excess > 0:
                del self._mic_buf[:excess - excess % 2]    # drop the oldest, keep samples aligned
            if len(self._mic_buf) >= CHUNK_BYTES:
                chunk = bytes(self._mic_buf[:CHUNK_BYTES])
                del self._mic_buf[:CHUNK_BYTES]
                return chunk
        return SILENCE

    # ----------------------------------------------------------------------- speaker
    def play(self, pcm: bytes) -> None:
        """Queue audio. Returns at once; the speaker thread paces it out in real time."""
        with self._spk_lock:
            self._spk += pcm

    def _publish(self, pcm: bytes):
        ros = self.ros
        msg = ros.AudioPlayback()
        msg.pkg_name = self.pkg
        msg.token_id = "%s-%d" % (self.pkg, self.token)
        msg.info = ros.AudioInfo(channels=1, sample_rate=RATE)
        msg.data = ros.AudioData(data=array.array("B", pcm))
        self.player.publish(msg)

    def _speaker_loop(self):
        """Speaker loop, paced at real time with a small lead (as in the organisers' file)."""
        clock = None
        sent = 0
        while self.running:
            with self._spk_lock:
                have = len(self._spk)
            if not have:
                clock, sent = None, 0
                time.sleep(min(self.poll_s, 0.02))
                continue
            new_burst = clock is None
            if new_burst:
                clock = time.monotonic()
            allowed = int((time.monotonic() - clock + self.lead_s) * BYTES_PER_SEC) - sent
            if allowed >= CHUNK_BYTES or (allowed > 0 and have < CHUNK_BYTES):
                n = min(have, max(CHUNK_BYTES, allowed - allowed % 2))
                with self._spk_lock:
                    pcm = bytes(self._spk[:n])
                    del self._spk[:n]
                self._publish(pcm)
                sent += len(pcm)
                if new_burst and self.on_first_sample:
                    # Approximate: this is when we handed the audio to the robot, not when
                    # sound comes out of the speaker.
                    self.on_first_sample()
            time.sleep(self.poll_s)

    def stop(self) -> None:
        """Throw away queued audio and tell the robot to stop. Can take seconds: the core calls
        this in a thread."""
        with self._spk_lock:
            self._spk.clear()
        self.token += 1                    # a new token_id clears the robot's playback buffer
        self.call(self.stop_cli, self.ros.StopAudioPlay.Request(), tries=2)
