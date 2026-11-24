"""ROS adapter tests. No ROS is installed here: a small fake rclpy / aimdk_msgs stands in for it."""
import asyncio
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
    module("aimdk_msgs.msg", AudioData=Message, AudioInfo=Message, AudioPlayback=Message,
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
def test_adapter_creates_only_the_audio_endpoints_and_checks_each_name_first(world):
    async def scenario():
        adapter = ros_adapter.RosAdapter(poll_s=0.005)
        await adapter.start()
        await adapter.close()

    asyncio.run(scenario())
    created = [(e[1], e[2]) for e in world.log if e[0] == "create"]
    assert sorted(created) == sorted([
        ("subscription", ros_adapter.MIC_TOPIC),
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
        adapter = ros_adapter.RosAdapter(poll_s=0.005)
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
        adapter = ros_adapter.RosAdapter(poll_s=0.005)
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
