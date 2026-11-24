"""Core part 2: local fallback phrases, link drops, reconnects, quiet end, route, mic gate."""
import asyncio
import base64
import json
import time

from bridge.core import SILENCE, Phrases

from .fakes import Rig, async_test, wait_until, write_phrases


def make_phrases(tmp_path, allow=False, **kwargs):
    json_path, directory = write_phrases(str(tmp_path), **kwargs)
    return Phrases.load(json_path, directory, allow_unreviewed=allow)


def loud_chunks(conn):
    return sum(1 for m in conn.received
               if "user_audio_chunk" in m and base64.b64decode(m["user_audio_chunk"]) != SILENCE)


# ------------------------------------------------------------------ the phrase list
def test_phrases_load_and_fall_back_to_english(tmp_path):
    json_path, directory = write_phrases(str(tmp_path), languages=("en", "ar"))
    careful = Phrases.load(json_path, directory)                       # Arabic not reviewed yet
    assert careful.get("heard", "en").pcm[:2] == (1111).to_bytes(2, "little", signed=True)
    assert careful.get("heard", "ar").lang == "en"                     # falls back to English
    open_ = Phrases.load(json_path, directory, allow_unreviewed=True)
    assert open_.get("heard", "ar").lang == "ar"
    assert open_.get("no_such_phrase", "en") is None


def test_phrases_without_audio_files_are_skipped(tmp_path):
    json_path, directory = write_phrases(str(tmp_path))
    (tmp_path / "heard_en.pcm").unlink()
    phrases = Phrases.load(json_path, directory)
    assert phrases.get("heard", "en") is None
    assert phrases.get("one_moment", "en") is not None


# ------------------------------------------------------------- "I heard you", "one moment"
@async_test()
async def test_heard_then_one_moment_when_the_agent_is_slow(tmp_path):
    async with Rig(phrases=make_phrases(tmp_path)) as rig:
        rig.core.signal_presence()
        await rig.first_connection()
        rig.source.speak(4)                           # the visitor talks, then stops
        await wait_until(lambda: 1111 in rig.sink.markers(), 3, "the 'heard' phrase")
        await wait_until(lambda: 2222 in rig.sink.markers(), 3, "the 'one moment' phrase")
        await asyncio.sleep(0.6)
        assert rig.sink.markers() == [1111, 2222]     # each only once


@async_test()
async def test_no_filler_phrase_when_the_agent_answers_in_time(tmp_path):
    async with Rig(phrases=make_phrases(tmp_path)) as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        rig.source.speak(4)
        await asyncio.sleep(0.3)                      # speech has ended, timers are running
        await conn.send_audio(1, 101)
        await asyncio.sleep(1.6)                      # longer than both timers
        assert rig.sink.markers() == [101]


@async_test()
async def test_real_answer_cuts_off_a_phrase_that_is_still_playing(tmp_path):
    phrases = make_phrases(tmp_path / "p", seconds=1.0)
    async with Rig(phrases=phrases) as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        rig.source.speak(4)
        await wait_until(lambda: 1111 in rig.sink.markers(), 3, "the 'heard' phrase")
        await conn.send_audio(1, 101)                 # the answer starts while "heard" plays
        await wait_until(lambda: 101 in rig.sink.markers(), 3, "the answer")
        assert rig.sink.timeline() == [1111, "stop", 101]


@async_test()
async def test_phrase_language_follows_an_arabic_visitor(tmp_path):
    phrases = make_phrases(tmp_path, languages=("en", "ar"), allow=True)
    async with Rig(phrases=phrases) as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send({"type": "user_transcript",
                         "user_transcription_event": {"user_transcript": "اين المطبخ", "event_id": 5}})
        await asyncio.sleep(0.1)
        rig.source.speak(4)
        await wait_until(lambda: rig.sink.markers(), 3, "a phrase")
        assert rig.sink.markers()[0] == 1211          # the Arabic "heard"


# ------------------------------------------------------------------- link drops
@async_test()
async def test_reconnect_keeps_the_session_id_and_marks_it_resumed(tmp_path):
    async with Rig(phrases=make_phrases(tmp_path)) as rig:
        rig.core.signal_presence()
        first = await rig.first_connection()
        await first.drop()
        second = await rig.wait_connection(2)
        assert first.init["dynamic_variables"]["resumed"] is False
        assert second.init["dynamic_variables"]["resumed"] is True
        assert (second.init["dynamic_variables"]["session_id"]
                == first.init["dynamic_variables"]["session_id"])
        assert rig.core.conversation_id == "conv_2"   # a new conversation each time


@async_test()
async def test_operator_stop_plays_at_once_when_the_link_drops_during_a_route(tmp_path):
    async with Rig(phrases=make_phrases(tmp_path)) as rig:
        rig.core.signal_presence()
        first = await rig.first_connection()
        rig.core.route_active = True
        dropped = time.monotonic()
        await first.drop()
        await wait_until(lambda: 4444 in rig.sink.markers(), 1.0, "operator_stop")
        assert time.monotonic() - dropped < 1.0
        await wait_until(lambda: 3333 in rig.sink.markers(), 1.0, "connection_slow")
        assert rig.sink.markers()[:2] == [4444, 3333]


@async_test()
async def test_only_connection_slow_when_the_link_drops_without_a_route(tmp_path):
    async with Rig(phrases=make_phrases(tmp_path)) as rig:
        rig.core.signal_presence()
        first = await rig.first_connection()
        await first.drop()
        await wait_until(lambda: 3333 in rig.sink.markers(), 1.0, "connection_slow")
        await rig.wait_connection(2)
        assert 4444 not in rig.sink.markers()


@async_test()
async def test_no_internet_at_the_start_says_so_once_and_keeps_trying(tmp_path):
    async with Rig(phrases=make_phrases(tmp_path), fail_urls=4) as rig:
        rig.core.signal_presence()
        await rig.first_connection(timeout=5)         # succeeds on the fifth try
        assert rig.urls_asked == 5
        assert rig.sink.markers() == [3333]           # said once, not on every try


@async_test()
async def test_retry_delay_grows_and_stops_growing_at_the_maximum():
    async with Rig(fail_urls=6) as rig:               # backoff 0.05 -> 0.2
        rig.core.signal_presence()
        await rig.first_connection(timeout=5)
        gaps = [b - a for a, b in zip(rig.url_times, rig.url_times[1:])]
        assert gaps[0] < gaps[2]                      # 0.05 then 0.2
        assert max(gaps) < 0.6                        # never above the maximum (plus slack)


@async_test()
async def test_a_hang_up_during_a_route_reconnects_but_not_without_one(tmp_path):
    async with Rig(phrases=make_phrases(tmp_path)) as rig:
        rig.core.signal_presence()
        first = await rig.first_connection()
        rig.core.route_active = True
        await first.ws.close(1000)                    # the agent ended the call (e.g. time limit)
        second = await rig.wait_connection(2)
        assert second.init["dynamic_variables"]["resumed"] is True
        assert 4444 in rig.sink.markers()


# --------------------------------------------------------- one visitor at a time
@async_test()
async def test_agent_hang_up_without_a_route_ends_the_visit_and_the_next_one_starts_fresh():
    async with Rig() as rig:
        rig.core.signal_presence()
        first = await rig.first_connection()
        await first.ws.close(1000)
        await asyncio.sleep(0.5)
        assert len(rig.server.connections) == 1       # no reconnect, no re-greeting an empty room
        rig.core.signal_presence()                    # a new visitor
        second = await rig.wait_connection(2)
        assert (second.init["dynamic_variables"]["session_id"]
                != first.init["dynamic_variables"]["session_id"])
        assert second.init["dynamic_variables"]["resumed"] is False


@async_test()
async def test_session_ends_after_quiet_and_never_during_a_route():
    async with Rig(quiet_end_s=0.6) as rig:
        rig.core.route_active = True
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await asyncio.sleep(1.2)                      # twice the quiet time
        assert not conn.closed                        # a route is active: stay connected
        rig.core.route_active = False
        await wait_until(lambda: conn.closed, 2.5, "the quiet end")
        await asyncio.sleep(0.5)
        assert len(rig.server.connections) == 1       # and it does not come back by itself


@async_test()
async def test_talking_keeps_the_session_open():
    async with Rig(quiet_end_s=0.6) as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        for _ in range(4):                            # a word every 0.4 s
            rig.source.speak(3)
            await asyncio.sleep(0.4)
        assert not conn.closed


# ------------------------------------------------------------ route tracking
@async_test()
async def test_route_tool_calls_mark_a_route_as_active(tmp_path):
    async with Rig(route_idle_s=0.5) as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        assert not rig.core.route_active
        await conn.send({"type": "agent_tool_request", "agent_tool_request": {
            "tool_name": "some_other_tool", "tool_call_id": "t0", "event_id": 5}})
        await asyncio.sleep(0.1)
        assert not rig.core.route_active              # not a route tool
        await conn.send({"type": "agent_tool_request", "agent_tool_request": {
            "tool_name": "next_route_step", "tool_call_id": "t1", "event_id": 6}})
        await wait_until(lambda: rig.core.route_active, 1, "route to become active")
        await wait_until(lambda: not rig.core.route_active, 2, "route to time out")


@async_test()
async def test_arriving_at_the_destination_ends_the_route():
    async with Rig(route_idle_s=60) as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send({"type": "agent_tool_request", "agent_tool_request": {
            "tool_name": "next_route_step", "tool_call_id": "t1", "event_id": 6}})
        await wait_until(lambda: rig.core.route_active, 1, "route to become active")
        await conn.send({"type": "agent_tool_response_full_payload",
                         "agent_tool_response_full_payload": {
                             "tool_name": "next_route_step", "tool_call_id": "t1",
                             "full_tool_result": json.dumps({"status": "at_destination"}),
                             "truncated": False}})
        await wait_until(lambda: not rig.core.route_active, 1, "route to end")


# ------------------------------------------------------------------- mic gate
@async_test()
async def test_half_duplex_sends_silence_while_the_robot_speaks():
    async with Rig(mic_gate="half_duplex") as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send_audio(1, 101, samples=16000)  # one second of agent speech
        await wait_until(lambda: rig.sink.markers(), 2, "playback")
        before = loud_chunks(conn)
        rig.source.speak(8)
        await asyncio.sleep(0.4)
        assert loud_chunks(conn) == before            # the visitor's chunks were muted


@async_test()
async def test_default_mic_gate_keeps_barge_in_possible():
    async with Rig() as rig:                          # mic_gate "none"
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send_audio(1, 101, samples=16000)
        await wait_until(lambda: rig.sink.markers(), 2, "playback")
        before = loud_chunks(conn)
        rig.source.speak(8)
        await asyncio.sleep(0.4)
        assert loud_chunks(conn) >= before + 6        # speech still goes through
