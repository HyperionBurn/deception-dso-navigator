"""Core part 1: when a conversation starts, the first messages, ping/pong, audio rules."""
import asyncio
import base64
import time
import uuid

import pytest

from bridge.core import CHUNK_BYTES, FormatError

from .fakes import FakeServer, FakeSink, Rig, async_test, marker_of, wait_until


@async_test()
async def test_no_conversation_until_someone_is_there():
    async with Rig() as rig:
        await asyncio.sleep(0.5)                      # quiet room, mic running
        assert rig.server.connections == []
        rig.core.signal_presence()                    # e.g. the robot's wake word
        conn = await rig.first_connection()
        assert conn.init["type"] == "conversation_initiation_client_data"


@async_test()
async def test_speaking_near_the_mic_starts_a_conversation():
    async with Rig() as rig:
        rig.source.speak(10)                          # 1 s of loud audio
        await rig.first_connection()


@async_test()
async def test_start_message_carries_session_id_and_source():
    async with Rig() as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        variables = conn.init["dynamic_variables"]
        assert uuid.UUID(variables["session_id"]).version == 4
        assert variables["source"] == "robot"
        assert variables["resumed"] is False
        assert variables["session_id"] == rig.core.session_id


@async_test()
async def test_mic_audio_is_sent_in_100ms_chunks():
    async with Rig() as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await wait_until(lambda: conn.audio_chunks >= 3, what="mic chunks")
        first = conn.received[0]["user_audio_chunk"]
        assert len(base64.b64decode(first)) == CHUNK_BYTES


@async_test()
async def test_ping_gets_pong():
    async with Rig() as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send_ping(7)
        await wait_until(lambda: conn.of_type("pong"), what="pong")
        assert conn.of_type("pong")[0] == {"type": "pong", "event_id": 7}


@async_test()
async def test_wrong_audio_format_stops_with_a_clear_error():
    rig = Rig(server=FakeServer(agent_format="pcm_24000"))
    async with rig:
        rig.core.signal_presence()
        with pytest.raises(FormatError, match="pcm_16000"):
            await asyncio.wait_for(rig.task, 3)
        assert len(rig.server.connections) == 1       # no retry loop for a setup mistake


@async_test()
async def test_wrong_input_format_also_stops():
    rig = Rig(server=FakeServer(user_format="ulaw_8000"))
    async with rig:
        rig.core.signal_presence()
        with pytest.raises(FormatError):
            await asyncio.wait_for(rig.task, 3)


@async_test()
async def test_agent_audio_reaches_the_speaker():
    async with Rig() as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send_audio(1, 101)
        await conn.send_audio(2, 102)
        await wait_until(lambda: rig.sink.markers() == [101, 102], what="playback")


@async_test()
async def test_stale_audio_is_dropped_after_an_interruption():
    async with Rig() as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send_audio(1, 101)
        await conn.send_audio(2, 102)
        await conn.send_interruption(3)
        await conn.send_audio(2, 999)                 # in flight before the interruption: stale
        await conn.send_audio(4, 104)                 # the new answer
        await wait_until(lambda: 104 in rig.sink.markers(), what="new audio")
        assert 999 not in rig.sink.markers()
        assert rig.sink.timeline() == [101, 102, "stop", 104]


@async_test()
async def test_old_interruption_is_ignored():
    async with Rig() as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send_audio(10, 110)
        await conn.send_interruption(5)               # older than audio already played
        await conn.send_audio(11, 111)
        await wait_until(lambda: 111 in rig.sink.markers(), what="audio after old interruption")
        assert "stop" not in rig.sink.timeline()


@async_test()
async def test_stopping_playback_does_not_block_the_socket():
    sink = FakeSink(stop_delay=0.8)                   # a slow ROS stop service
    async with Rig(sink=sink) as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send_audio(1, 101)
        await wait_until(lambda: 101 in sink.markers(), what="first audio")
        await conn.send_interruption(2)
        await conn.send_audio(3, 103)                 # arrives while the stop is still running
        asked = time.monotonic()
        await conn.send_ping(9)
        await wait_until(lambda: conn.of_type("pong"), timeout=0.4, what="a quick pong")
        assert time.monotonic() - asked < 0.4
        # the new answer is held back until the stop is done, then played (not lost)
        await wait_until(lambda: 103 in sink.markers(), timeout=3, what="held audio")
        assert sink.timeline() == [101, "stop", 103]
        assert marker_of(b"\x07\x00") == 7            # helper sanity
