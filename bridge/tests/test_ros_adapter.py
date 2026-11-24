"""ROS adapter tests. No ROS is installed here: a small fake rclpy / aimdk_msgs stands in for it."""
import asyncio
import random
import struct
import subprocess
import sys
import threading
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

from bridge import ros_adapter
from bridge.core import CHUNK_BYTES, SILENCE

REPO_ROOT = Path(__file__).resolve().parents[2]

FORBIDDEN = ["command", "locomotion", "upper_body", "pnc_task", "integrated_command",
             "relocalization_pose", "SetMc", "MigrateSystemState"]


# ------------------------------------------------------------ import and the name guard
def test_ros_adapter_imports_without_ros():
    code = ("import sys, bridge.ros_adapter\n"
            "bad = [m for m in ('rclpy', 'aimdk_msgs') if m in sys.modules]\n"
            "assert not bad, bad\n")
    done = subprocess.run([sys.executable, "-c", code], cwd=str(REPO_ROOT),
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr


@pytest.mark.parametrize("word", FORBIDDEN)
def test_guard_blocks_every_forbidden_word(word):
    for name in ("/some/%s/topic" % word, "/aima/%s" % word.upper(), "/x/" + word.lower() + "_y"):
        with pytest.raises(ros_adapter.UnsafeNameError):
            ros_adapter.assert_safe_name(name)


def test_guard_blocks_real_motion_style_names():
    for name in ("/aima/mc/locomotion/velocity", "/aimdk_5Fmsgs/srv/SetMcAction",
                 "/aima/pnc/pnc_task_request", "/aima/hal/joint/upper_body/command"):
        with pytest.raises(ros_adapter.UnsafeNameError):
            ros_adapter.assert_safe_name(name)


def test_guard_allows_the_audio_names_and_rejects_junk():
    for name in ros_adapter.ALL_NAMES:
        ros_adapter.assert_safe_name(name)            # must not raise
    for junk in ("", None, 5):
        with pytest.raises(ros_adapter.UnsafeNameError):
            ros_adapter.assert_safe_name(junk)


def test_start_without_ros_gives_a_clear_message(monkeypatch):
    monkeypatch.setitem(sys.modules, "rclpy", None)   # None makes "import rclpy" fail
    adapter = ros_adapter.RosAdapter()
    with pytest.raises(ros_adapter.RosNotAvailable, match="source /opt/ros"):
        asyncio.run(adapter.start())


# ------------------------------------------------------------------ a fake ROS
class World:
    """Records everything the adapter does to the fake ROS."""

    def __init__(self):
        self.log = []                 # ("guard", name) / ("create", kind, name) / ("call", service)
        self.subs = {}
        self.pubs = {}
        self.clients = {}


class FakeFuture:
    def __init__(self, result):
        self._result = result

    def add_done_callback(self, callback):
        callback(self)

    def result(self):
        return self._result


class Message:
    def __init__(self, **fields):
        self.__dict__.update(fields)


def make_fake_ros(monkeypatch, world):
    SUCCESS = 1
    focus_ok = SimpleNamespace(reponse=SimpleNamespace(status=SimpleNamespace(value=SUCCESS)),
                               focus_response=SimpleNamespace(focus_gain=True))

    class FakePublisher:
        def __init__(self, topic):
            self.topic = topic
            self.messages = []

        def publish(self, msg):
            self.messages.append(msg)

    class FakeClient:
        def __init__(self, name):
            self.name = name

        def wait_for_service(self, timeout_sec=None):
            return True

        def call_async(self, request):
            world.log.append(("call", self.name))
            return FakeFuture(focus_ok if "RequestAudioFocus" in self.name else SimpleNamespace())

    class Node:
        def __init__(self, name):
            self.name = name

        def create_subscription(self, msg_type, topic, callback, qos):
            world.log.append(("create", "subscription", topic))
            world.subs[topic] = callback

        def create_publisher(self, msg_type, topic, qos):
            world.log.append(("create", "publisher", topic))
            world.pubs[topic] = FakePublisher(topic)
            return world.pubs[topic]

        def create_client(self, srv_type, name):
            world.log.append(("create", "client", name))
            world.clients[name] = FakeClient(name)
            return world.clients[name]

        def destroy_node(self):
            pass

    class Executor:
        def __init__(self):
            self._done = threading.Event()

        def add_node(self, node):
            pass

        def spin(self):
            self._done.wait()

        def shutdown(self):
            self._done.set()

    def module(name, **attrs):
        mod = types.ModuleType(name)
        mod.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, mod)
        return mod

    class Enum:
        KEEP_LAST = 1
        BEST_EFFORT = 2

    def service(name):
        return type(name, (), {"Request": type("Request", (Message,), {})})

    rclpy = module("rclpy", init=lambda **kw: None, shutdown=lambda: None)
    module("rclpy.executors", MultiThreadedExecutor=Executor)
    module("rclpy.node", Node=Node)
    module("rclpy.qos", QoSProfile=Message, QoSHistoryPolicy=Enum, QoSReliabilityPolicy=Enum)
    module("rclpy.signals", SignalHandlerOptions=SimpleNamespace(NO=0))
    rclpy.executors = sys.modules["rclpy.executors"]
    module("aimdk_msgs")
    module("aimdk_msgs.msg", AudioCapture=Message, AudioData=Message, AudioInfo=Message,
           AudioPlayback=Message,
           AudioVadStateType=SimpleNamespace(AUDIO_VAD_STATE_BEGIN=1),
           CommonState=SimpleNamespace(SUCCESS=SUCCESS), FocusRequester=Message,
           FocusResponse=Message, ProcessedAudioOutput=Message)
    module("aimdk_msgs.srv", AbandonAudioFocus=service("AbandonAudioFocus"),
           RequestAudioFocus=service("RequestAudioFocus"), StopAudioPlay=service("StopAudioPlay"))


@pytest.fixture
def world(monkeypatch):
    w = World()
    make_fake_ros(monkeypatch, w)
    real_guard = ros_adapter.assert_safe_name

    def recording_guard(name):
        w.log.append(("guard", name))
        real_guard(name)

    monkeypatch.setattr(ros_adapter, "assert_safe_name", recording_guard)
    return w


def mic_message(stream_id, first_byte=1, vad=0):
    return SimpleNamespace(stream_id=stream_id, audio_data=bytes([first_byte, 0]) * (CHUNK_BYTES // 2),
                           audio_vad_state=SimpleNamespace(value=vad))


# ------------------------------------------------------------ the adapter on the fake
@pytest.mark.parametrize("source, mic_topic", [("wake_word", ros_adapter.MIC_TOPIC),
                                               ("raw", ros_adapter.RAW_MIC_TOPIC)])
def test_adapter_creates_only_the_audio_endpoints_and_checks_each_name_first(world, source, mic_topic):
    async def scenario():
        adapter = ros_adapter.RosAdapter(poll_s=0.005, mic_source=source)
        await adapter.start()
        await adapter.close()

    asyncio.run(scenario())
    created = [(e[1], e[2]) for e in world.log if e[0] == "create"]
    assert sorted(created) == sorted([
        ("subscription", mic_topic),
        ("subscription", ros_adapter.FOCUS_RESPONSE_TOPIC),
        ("publisher", ros_adapter.PLAYBACK_TOPIC),
        ("client", ros_adapter.REQUEST_FOCUS_SERVICE),
        ("client", ros_adapter.ABANDON_FOCUS_SERVICE),
        ("client", ros_adapter.STOP_PLAY_SERVICE)])
    for index, entry in enumerate(world.log):
        if entry[0] == "create":
            assert ("guard", entry[2]) in world.log[:index], "no name check before " + entry[2]


def test_a_forbidden_name_is_refused_before_anything_is_created(world):
    async def scenario():
        adapter = ros_adapter.RosAdapter(poll_s=0.005)
        await adapter.start()
        before = len(world.log)
        with pytest.raises(ros_adapter.UnsafeNameError):
            adapter._publisher(object, "/aima/hal/joint/upper_body/command", 10)
        created_after = [e for e in world.log[before:] if e[0] == "create"]
        assert created_after == []
        await adapter.close()

    asyncio.run(scenario())


def test_mic_audio_comes_out_in_100ms_chunks_and_silence_when_quiet(world):
    async def scenario():
        adapter = ros_adapter.RosAdapter(poll_s=0.005, mic_source="wake_word")
        await adapter.start()
        presence = []
        adapter.on_presence = lambda: presence.append(True)
        callback = world.subs[ros_adapter.MIC_TOPIC]
        callback(mic_message(stream_id=2, first_byte=9))      # first stream heard: we lock on it
        callback(mic_message(stream_id=1, first_byte=7, vad=1))   # another stream: ignored
        first = await adapter.read_chunk()
        second = await adapter.read_chunk()
        await adapter.close()
        return presence, first, second

    presence, first, second = asyncio.run(scenario())
    assert presence == []                                 # only the locked stream counts
    assert len(first) == CHUNK_BYTES and first[0] == 9
    assert second == SILENCE


def test_robot_voice_activity_counts_as_presence(world):
    async def scenario():
        adapter = ros_adapter.RosAdapter(poll_s=0.005, mic_source="wake_word")
        await adapter.start()
        presence = []
        adapter.on_presence = lambda: presence.append(True)
        world.subs[ros_adapter.MIC_TOPIC](mic_message(stream_id=1, vad=1))   # VAD begin
        await adapter.close()
        return presence

    assert asyncio.run(scenario()) == [True]


def test_playback_goes_to_the_playback_topic_and_stop_calls_the_stop_service(world):
    async def scenario():
        adapter = ros_adapter.RosAdapter(poll_s=0.005, lead_s=5.0)
        await adapter.start()
        first_sample = []
        adapter.on_first_sample = lambda: first_sample.append(True)
        adapter.play(bytes(CHUNK_BYTES))
        await asyncio.sleep(0.3)
        playback = world.pubs[ros_adapter.PLAYBACK_TOPIC].messages
        assert playback and playback[0].pkg_name == adapter.pkg
        assert playback[0].info.sample_rate == 16000 and playback[0].info.channels == 1
        old_token = playback[0].token_id
        assert first_sample == [True]
        await asyncio.get_running_loop().run_in_executor(None, adapter.stop)
        assert ("call", ros_adapter.STOP_PLAY_SERVICE) in world.log
        adapter.play(bytes(CHUNK_BYTES))
        await asyncio.sleep(0.3)
        assert playback[-1].token_id != old_token         # a new token clears the robot's buffer
        await adapter.close()

    asyncio.run(scenario())


def test_adapter_takes_the_speaker_focus_at_start_and_gives_it_back(world):
    async def scenario():
        adapter = ros_adapter.RosAdapter(poll_s=0.005)
        await adapter.start()
        assert ("call", ros_adapter.REQUEST_FOCUS_SERVICE) in world.log
        await adapter.close()
        assert ("call", ros_adapter.ABANDON_FOCUS_SERVICE) in world.log

    asyncio.run(scenario())


# ------------------------------------------------------------ raw microphone (the default)
def pack(samples):
    return struct.pack("<%dh" % len(samples), *samples)


def unpack(pcm):
    return list(struct.unpack("<%dh" % (len(pcm) // 2), pcm))


def capture_message(samples, channels, mic_channels, rate=16000):
    """What /aima/hal/audio/capture gives: msg.data.data, msg.info.channels, msg.mic_channels."""
    return SimpleNamespace(data=SimpleNamespace(data=pack(samples)),
                           info=SimpleNamespace(channels=channels, sample_rate=rate),
                           mic_channels=mic_channels)


def test_the_default_mic_source_is_raw_and_a_bad_one_is_refused():
    assert ros_adapter.RosAdapter().mic_source == "raw"
    assert ros_adapter.RosAdapter(mic_source="wake_word").mic_source == "wake_word"
    with pytest.raises(ValueError, match="mic_source"):
        ros_adapter.RosAdapter(mic_source="loud")


def test_downmix_stereo_averages_the_two_mics():
    pcm = ros_adapter.downmix_to_mono(pack([100, 200, -100, -300, 7, 8]), channels=2, mic_channels=2)
    assert unpack(pcm) == [150, -200, 7]                  # (7 + 8) / 2 = 7.5 -> 7


def test_downmix_six_channels_uses_only_the_real_mics():
    # 4 mics, then 2 speaker-reference channels that are very loud and must be ignored.
    frame_a = [10, 20, 30, 41, 9999, -9999]              # mean of the mics 25.25 -> 25
    frame_b = [-10, -20, -30, -41, 9999, 9999]           # mean -25.25 -> -25 (towards zero, not -26)
    pcm = ros_adapter.downmix_to_mono(pack(frame_a + frame_b), channels=6, mic_channels=4)
    assert unpack(pcm) == [25, -25]


def test_downmix_with_one_mic_keeps_the_first_channel_only():
    pcm = ros_adapter.downmix_to_mono(pack([5, 900, 6, 900, 7, 900]), channels=2, mic_channels=1)
    assert unpack(pcm) == [5, 6, 7]


def test_downmix_of_a_mono_message_is_a_plain_copy():
    pcm = ros_adapter.downmix_to_mono(pack([1, -2, 32767, -32768]), channels=1, mic_channels=1)
    assert unpack(pcm) == [1, -2, 32767, -32768]


def test_downmix_extreme_values_do_not_wrap_around():
    loud = [32767] * 4
    low = [-32768] * 4
    mixed = [32767, 32767, -32768, -32768]               # sum -2, mean -0.5 -> 0
    pcm = ros_adapter.downmix_to_mono(pack(loud + low + mixed), channels=4, mic_channels=4)
    assert unpack(pcm) == [32767, -32768, 0]


def test_downmix_odd_or_partial_data_drops_the_broken_tail_and_never_raises():
    two_frames = pack(list(range(1, 13)))                # 2 frames of 6 channels
    for tail in (b"\x01", pack([5, 5, 5]), pack([5, 5, 5]) + b"\x01"):
        pcm = ros_adapter.downmix_to_mono(two_frames + tail, channels=6, mic_channels=4)
        assert unpack(pcm) == [2, 8]                     # (1+2+3+4)/4 = 2.5 -> 2, (7+8+9+10)/4 = 8.5 -> 8
    assert ros_adapter.downmix_to_mono(b"", channels=6, mic_channels=4) == b""
    assert ros_adapter.downmix_to_mono(b"\x01", channels=2, mic_channels=2) == b""


def test_downmix_clamps_a_strange_mic_channels_value():
    data = pack([1, 2, 3, 4, 5, 6])
    assert unpack(ros_adapter.downmix_to_mono(data, channels=6, mic_channels=99)) == [3]    # all 6
    assert unpack(ros_adapter.downmix_to_mono(data, channels=6, mic_channels=0)) == [1]     # first only
    assert unpack(ros_adapter.downmix_to_mono(data, channels=6, mic_channels=-3)) == [1]
    with pytest.raises(ValueError, match="channels"):
        ros_adapter.downmix_to_mono(data, channels=0, mic_channels=1)


@pytest.mark.parametrize("channels, mic_channels", [(1, 1), (2, 2), (2, 1), (6, 4), (6, 6), (4, 3)])
def test_downmix_matches_the_organisers_numpy_code(channels, mic_channels):
    np = pytest.importorskip("numpy")
    rng = random.Random(channels * 10 + mic_channels)
    samples = [rng.choice([-32768, 32767, rng.randint(-32768, 32767)]) for _ in range(channels * 400)]
    raw = pack(samples)
    a = np.frombuffer(raw, dtype="<i2").reshape(-1, channels)[:, :mic_channels]
    expected = np.clip(a.astype(np.int32).mean(axis=1), -32768, 32767).astype("<i2").tobytes()
    assert ros_adapter.downmix_to_mono(raw, channels, mic_channels) == expected


def test_raw_mic_chunks_are_mono_100ms_and_ignore_the_reference_channels(world):
    frames = CHUNK_BYTES // 2                             # 1600 mono samples = 100 ms
    samples = []
    for _ in range(frames):
        samples += [1000, 2000, 3000, 4000, 30000, -30000]    # 4 mics + 2 loud reference channels

    async def scenario():
        adapter = ros_adapter.RosAdapter(poll_s=0.005)    # raw is the default
        await adapter.start()
        presence = []
        adapter.on_presence = lambda: presence.append(True)
        world.subs[ros_adapter.RAW_MIC_TOPIC](capture_message(samples, channels=6, mic_channels=4))
        first = await adapter.read_chunk()
        second = await adapter.read_chunk()
        await adapter.close()
        return presence, first, second

    presence, first, second = asyncio.run(scenario())
    assert len(first) == CHUNK_BYTES and unpack(first) == [2500] * frames   # (1000+2000+3000+4000)/4
    assert second == SILENCE
    assert presence == []                                 # no wake-word detector here; the core listens


def test_a_broken_raw_message_is_dropped_and_the_mic_keeps_working(world):
    async def scenario():
        adapter = ros_adapter.RosAdapter(poll_s=0.005)
        await adapter.start()
        callback = world.subs[ros_adapter.RAW_MIC_TOPIC]
        callback(capture_message([1, 2, 3, 4], channels=0, mic_channels=0))   # nonsense: no channels
        callback(SimpleNamespace())                                           # not even the fields
        callback(capture_message([300] * (CHUNK_BYTES // 2), channels=1, mic_channels=1))
        chunk = await adapter.read_chunk()
        await adapter.close()
        return chunk

    chunk = asyncio.run(scenario())
    assert unpack(chunk) == [300] * (CHUNK_BYTES // 2)


def test_raw_mode_says_clearly_when_the_capture_message_type_is_missing(world, monkeypatch):
    monkeypatch.delattr(sys.modules["aimdk_msgs.msg"], "AudioCapture")
    adapter = ros_adapter.RosAdapter(poll_s=0.005)
    with pytest.raises(ros_adapter.RosNotAvailable, match="AudioCapture") as caught:
        asyncio.run(adapter.start())
    assert "wake_word" in str(caught.value)               # tells the person how to go back


def test_wake_word_mode_does_not_need_the_capture_message_type(world, monkeypatch):
    monkeypatch.delattr(sys.modules["aimdk_msgs.msg"], "AudioCapture")

    async def scenario():
        adapter = ros_adapter.RosAdapter(poll_s=0.005, mic_source="wake_word")
        await adapter.start()
        await adapter.close()

    asyncio.run(scenario())
    assert ("create", "subscription", ros_adapter.MIC_TOPIC) in world.log
