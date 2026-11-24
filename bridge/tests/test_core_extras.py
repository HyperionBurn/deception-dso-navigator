"""Core part 3: latency CSV, client tools, queue status, errors, app hooks."""
import asyncio
import csv

from bridge.core import LATENCY_FIELDS, format_latency_summary, summarize_latency_csv

from .fakes import Rig, async_test, wait_until


def read_rows(path):
    try:
        with open(path, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))
    except FileNotFoundError:
        return []


# ------------------------------------------------------------------ latency log
@async_test()
async def test_latency_csv_gets_one_row_per_turn_with_sane_gaps(tmp_path):
    path = str(tmp_path / "latency.csv")
    async with Rig(latency_csv=path) as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        for turn in (1, 2):
            rig.source.speak(4)                       # the visitor talks ...
            await asyncio.sleep(0.3)                  # ... stops; the answer takes a while
            await conn.send_audio(turn * 2, 100 + turn)
            await wait_until(lambda: len(read_rows(path)) >= turn, 3, "csv row %d" % turn)
            await asyncio.sleep(0.3)
        rows = read_rows(path)
    assert [r["turn"] for r in rows] == ["1", "2"]
    for row in rows:
        assert list(row.keys()) == LATENCY_FIELDS
        assert row["session_id"] == rig.core.session_id
        assert row["conversation_id"] == "conv_1"
        to_audio, to_play, total = (int(row[k]) for k in
                                    ("end_to_audio_ms", "audio_to_play_ms", "end_to_play_ms"))
        assert 100 <= to_audio <= 700                 # about 0.3 s minus the end-of-speech wait
        assert 0 <= to_play <= 150                    # the fake speaker starts at once
        assert abs(total - (to_audio + to_play)) <= 2
        assert float(row["t_speech_end"]) < float(row["t_first_audio"]) <= float(row["t_first_played"])


@async_test()
async def test_unanswered_turn_is_logged_with_empty_gaps(tmp_path):
    path = str(tmp_path / "latency.csv")
    async with Rig(latency_csv=path) as rig:
        rig.core.signal_presence()
        await rig.first_connection()
        rig.source.speak(4)
        await asyncio.sleep(0.5)
        rig.source.speak(4)                           # a second turn: the first got no answer
        await wait_until(lambda: len(read_rows(path)) >= 1, 3, "the unanswered row")
    first = read_rows(path)[0]
    assert first["turn"] == "1"
    assert first["t_first_audio"] == "" and first["end_to_play_ms"] == ""


def test_latency_summary_shows_median_and_worst_case(tmp_path):
    path = tmp_path / "latency.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=LATENCY_FIELDS)
        writer.writeheader()
        for number, total in enumerate([900, 1200, 3000, 1000], start=1):
            writer.writerow({"turn": number, "end_to_audio_ms": total - 100,
                             "audio_to_play_ms": 100, "end_to_play_ms": total})
        writer.writerow({"turn": 5})                  # no answer: counted, not averaged
    summary = summarize_latency_csv(str(path))
    assert summary["turns"] == 5 and summary["unanswered"] == 1
    assert summary["end_to_play_ms"] == {"n": 4, "median": 1100, "worst": 3000}
    text = format_latency_summary(summary)
    assert "median" in text and "worst" in text and "1100" in text and "3000" in text


# ------------------------------------------------------------------ client tools
@async_test()
async def test_client_tool_call_gets_an_error_result_so_the_agent_does_not_hang():
    seen = []
    async with Rig(hooks={"on_event": seen.append}) as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send({"type": "client_tool_call", "client_tool_call": {
            "tool_name": "show_map", "tool_call_id": "tc_1", "parameters": {},
            "event_id": 9, "expects_response": True}})
        await wait_until(lambda: conn.of_type("client_tool_result"), 2, "a tool result")
        result = conn.of_type("client_tool_result")[0]
        assert result["tool_call_id"] == "tc_1"
        assert result["is_error"] is True
        assert isinstance(result["result"], str) and result["result"]
        assert any(e.get("type") == "client_tool_call" for e in seen)     # and it is logged


@async_test()
async def test_client_tool_call_that_expects_no_answer_gets_none():
    async with Rig() as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send({"type": "client_tool_call", "client_tool_call": {
            "tool_name": "x", "tool_call_id": "tc_2", "event_id": 9, "expects_response": False}})
        await conn.send_ping(3)
        await wait_until(lambda: conn.of_type("pong"), 2, "pong")
        assert conn.of_type("client_tool_result") == []


# --------------------------------------------------------- queue and server errors
@async_test()
async def test_queue_status_pauses_the_mic_until_admitted():
    async with Rig() as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send({"type": "queue_status", "queue_status_event": {"status": "waiting"}})
        await asyncio.sleep(0.2)
        waiting = conn.audio_chunks
        await asyncio.sleep(0.3)
        assert conn.audio_chunks == waiting           # nothing is sent while we wait in line
        await conn.send({"type": "queue_status", "queue_status_event": {"status": "admitted"}})
        await wait_until(lambda: conn.audio_chunks > waiting + 3, 2, "the mic to resume")


@async_test()
async def test_queue_timeout_and_client_error_make_the_bridge_reconnect():
    async with Rig() as rig:
        rig.core.signal_presence()
        first = await rig.first_connection()
        await first.send({"type": "queue_status", "queue_status_event": {"status": "timed_out"}})
        second = await rig.wait_connection(2)
        await second.send({"type": "client_error",
                           "error_event": {"code": 400, "message": "bad request"}})
        await rig.wait_connection(3)


@async_test()
async def test_server_that_never_answers_the_first_message_is_retried():
    from .fakes import FakeServer
    server = FakeServer(send_metadata=False)
    async with Rig(server=server, metadata_timeout_s=0.3) as rig:
        rig.core.signal_presence()
        await wait_until(lambda: len(server.connections) >= 2, 4, "a second try")


@async_test()
async def test_a_slow_connection_is_announced_once_while_waiting(tmp_path):
    from bridge.core import Phrases
    from .fakes import FakeServer, write_phrases
    json_path, directory = write_phrases(str(tmp_path))
    server = FakeServer(send_metadata=False)          # connects, but never answers
    async with Rig(server=server, phrases=Phrases.load(json_path, directory),
                   slow_after_s=0.6, metadata_timeout_s=5.0) as rig:
        rig.core.signal_presence()
        await wait_until(lambda: 3333 in rig.sink.markers(), 3, "connection_slow")
        await asyncio.sleep(0.5)
        assert rig.sink.markers() == [3333]


# ------------------------------------------------------------------- app hooks
@async_test()
async def test_app_hooks_receive_text_and_events_and_cannot_break_the_bridge():
    users, agents, events = [], [], []

    def bad_hook(text):
        raise RuntimeError("the app has a bug")

    async with Rig(hooks={"on_user_text": users.append, "on_agent_text": bad_hook,
                          "on_event": events.append}) as rig:
        rig.core.signal_presence()
        conn = await rig.first_connection()
        await conn.send({"type": "user_transcript",
                         "user_transcription_event": {"user_transcript": "where is the kitchen",
                                                      "event_id": 4}})
        await conn.send({"type": "agent_response",
                         "agent_response_event": {"agent_response": "Operator, walk straight."}})
        await conn.send_ping(5)
        await wait_until(lambda: conn.of_type("pong"), 2, "pong after the failing hook")
    assert users == ["where is the kitchen"]
    kinds = [e["type"] for e in events]
    assert "bridge_session_start" in kinds and "user_transcript" in kinds
    assert "audio" not in kinds
