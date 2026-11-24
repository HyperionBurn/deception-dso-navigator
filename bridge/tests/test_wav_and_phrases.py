"""WAV replay (noise tests), the shipped phrase list and the phrase renderer. All offline."""
import asyncio
import io
import json
import time
import wave
from pathlib import Path

import pytest

from bridge import render_phrases
from bridge.core import CHUNK_BYTES, SILENCE, Config, Phrases, SessionCore
from bridge.wav_replay import WavFormatError, WavSink, WavSource

from .fakes import FakeServer, async_test, tone

BRIDGE_DIR = Path(__file__).resolve().parents[1]


def write_wav(path, pcm, rate=16000, channels=1, width=2):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(pcm)


# --------------------------------------------------------------------- WavSource
@async_test()
async def test_wav_source_gives_100ms_chunks_then_a_silent_tail_then_none(tmp_path):
    audio = tone(1000, 4000)                           # 0.25 s: 2.5 chunks
    write_wav(tmp_path / "in.wav", audio)
    source = WavSource(str(tmp_path / "in.wav"), realtime=False, tail_silence_s=0.2,
                       presence_at_start=False)
    await source.start()
    chunks = []
    while True:
        chunk = await source.read_chunk()
        if chunk is None:
            break
        chunks.append(chunk)
    assert len(chunks) == 3 + 2                        # 3 chunks of audio, 2 of silent tail
    assert all(len(c) == CHUNK_BYTES for c in chunks)
    assert chunks[0] == audio[:CHUNK_BYTES]
    assert chunks[2] == audio[2 * CHUNK_BYTES:] + bytes(CHUNK_BYTES - len(audio[2 * CHUNK_BYTES:]))
    assert chunks[3] == SILENCE and chunks[4] == SILENCE


@async_test()
async def test_wav_source_real_time_mode_keeps_the_pace(tmp_path):
    write_wav(tmp_path / "in.wav", tone(1000, 4800))   # 0.3 s = 3 chunks
    source = WavSource(str(tmp_path / "in.wav"), realtime=True, tail_silence_s=0.0,
                       presence_at_start=False)
    await source.start()
    started = time.monotonic()
    while await source.read_chunk() is not None:
        pass
    assert time.monotonic() - started >= 0.25


@async_test()
async def test_wav_source_can_announce_presence_at_the_start(tmp_path):
    write_wav(tmp_path / "in.wav", tone(1000, 1600))
    source = WavSource(str(tmp_path / "in.wav"), realtime=False, presence_at_start=True)
    calls = []
    source.on_presence = lambda: calls.append(True)
    await source.start()
    assert calls == [True]


@pytest.mark.parametrize("rate,channels,width", [(44100, 1, 2), (16000, 2, 2), (16000, 1, 1)])
def test_wav_source_refuses_the_wrong_format(tmp_path, rate, channels, width):
    write_wav(tmp_path / "bad.wav", bytes(3200 * channels * width), rate, channels, width)
    with pytest.raises(WavFormatError, match="16 kHz mono 16-bit"):
        WavSource(str(tmp_path / "bad.wav"))


# ----------------------------------------------------------------------- WavSink
def test_wav_sink_writes_what_the_agent_said(tmp_path):
    out = tmp_path / "out.wav"
    sink = WavSink(str(out))
    firsts = []
    sink.on_first_sample = lambda: firsts.append(True)
    sink.play(tone(111, 1600))
    sink.play(tone(222, 1600))                         # right behind the first: not a new start
    asyncio.run(sink.close())
    with wave.open(str(out), "rb") as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 16000)
        assert w.readframes(w.getnframes()) == tone(111, 1600) + tone(222, 1600)
    assert firsts == [True]


# -------------------------------------------- the whole chain: WAV in, core, WAV out
@async_test()
async def test_replay_through_the_core_into_an_output_wav(tmp_path):
    write_wav(tmp_path / "in.wav", tone(3000, 8000))   # 0.5 s of loud audio
    source = WavSource(str(tmp_path / "in.wav"), realtime=True, tail_silence_s=0.3)
    sink = WavSink(str(tmp_path / "out.wav"))
    server = await FakeServer().start()

    async def answer(conn, message):
        if "user_audio_chunk" in message and conn.audio_chunks == 3:
            await conn.send_audio(1, 555, samples=3200)

    server.on_message = answer
    core = SessionCore(source, sink, lambda: server.url,
                       Config(quiet_end_s=0.6, end_silence_s=0.2, ws_ping_interval_s=None),
                       phrases=Phrases([]))
    await asyncio.wait_for(core.run(), 10)             # ends by itself: file done, session quiet
    await server.stop()
    with wave.open(str(tmp_path / "out.wav"), "rb") as w:
        assert w.readframes(w.getnframes()) == tone(555, 3200)


# ------------------------------------------------------------------ the phrase list
def load_phrase_list():
    with open(BRIDGE_DIR / "phrases.json", encoding="utf-8") as f:
        return json.load(f)


def test_phrase_list_is_complete_and_short():
    phrases = load_phrase_list()
    for item in phrases:
        assert set(item) == {"id", "lang", "text", "file", "reviewed"}
        assert len(item["text"]) <= 60
    ids_in_english = {p["id"] for p in phrases if p["lang"] == "en"}
    assert ids_in_english == {"heard", "one_moment", "connection_slow", "operator_stop"}
    assert len({p["file"] for p in phrases}) == len(phrases)
    assert all(p["reviewed"] for p in phrases if p["lang"] == "en")
    assert not any(p["reviewed"] for p in phrases if p["lang"] == "ar")   # a Gulf Arabic speaker must check
    assert {p["text"] for p in phrases if p["id"] == "operator_stop"} == {"Operator, stop. Stay where you are."}


def test_rendered_audio_is_not_committed():
    ignore = (BRIDGE_DIR / ".gitignore").read_text()
    assert "phrases/*.pcm" in ignore


# -------------------------------------------------------------- the phrase renderer
def test_only_reviewed_phrases_are_rendered_unless_asked():
    phrases = load_phrase_list()
    only_reviewed = render_phrases.select_phrases(phrases)
    assert only_reviewed and all(p["reviewed"] for p in only_reviewed)
    everything = render_phrases.select_phrases(phrases, include_unreviewed=True)
    assert len(everything) == len(phrases)


def test_render_all_writes_one_file_per_selected_phrase(tmp_path):
    asked = []

    def fake_fetch(text, voice_id, api_key, model_id, lang):
        asked.append((text, voice_id, api_key, lang))
        return tone(7, 800)

    written = render_phrases.render_all(str(BRIDGE_DIR / "phrases.json"), str(tmp_path), "VOICE",
                                        "KEY", "model-x", fetch=fake_fetch)
    assert sorted(Path(w).name for w in written) == [
        "connection_slow_en.pcm", "heard_en.pcm", "one_moment_en.pcm", "operator_stop_en.pcm"]
    assert all(lang == "en" for *_, lang in asked)
    assert (tmp_path / "heard_en.pcm").read_bytes() == tone(7, 800)
    render_phrases.render_all(str(BRIDGE_DIR / "phrases.json"), str(tmp_path), "VOICE", "KEY",
                              "model-x", include_unreviewed=True, fetch=fake_fetch)
    assert (tmp_path / "heard_ar.pcm").exists()


def test_render_refuses_empty_or_odd_audio(tmp_path):
    with pytest.raises(render_phrases.RenderError):
        render_phrases.render_all(str(BRIDGE_DIR / "phrases.json"), str(tmp_path), "V", "K", "m",
                                  fetch=lambda *a: b"")
    with pytest.raises(render_phrases.RenderError):
        render_phrases.render_all(str(BRIDGE_DIR / "phrases.json"), str(tmp_path), "V", "K", "m",
                                  fetch=lambda *a: b"\x01\x02\x03")


def test_render_needs_a_key_and_a_voice(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("ELEVENLABS_VOICE_ID", raising=False)
    with pytest.raises(SystemExit, match="ELEVENLABS_API_KEY"):
        render_phrases.main([])
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
    with pytest.raises(SystemExit, match="voice"):
        render_phrases.main([])


def test_tts_request_asks_for_16khz_pcm(monkeypatch):
    seen = {}

    class Reply(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(request, timeout=None):
        seen["url"] = request.full_url
        seen["headers"] = {k.lower(): v for k, v in request.header_items()}
        seen["body"] = json.loads(request.data)
        return Reply(tone(5, 100))

    monkeypatch.setattr(render_phrases.urllib.request, "urlopen", fake_urlopen)
    pcm = render_phrases.fetch_tts_pcm("Hello", "VOICE1", "SECRET", "eleven_flash_v2_5", "en")
    assert pcm == tone(5, 100)
    assert seen["url"].startswith("https://api.elevenlabs.io/v1/text-to-speech/VOICE1")
    assert "output_format=pcm_16000" in seen["url"]
    assert seen["headers"]["xi-api-key"] == "SECRET"
    assert seen["body"]["text"] == "Hello" and seen["body"]["model_id"] == "eleven_flash_v2_5"
