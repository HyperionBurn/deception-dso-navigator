"""Test helpers: a fake ElevenLabs WebSocket server, a fake mic and a fake speaker.

Everything runs on localhost. Nothing here talks to the real ElevenLabs API or to ROS.
"""
import asyncio
import base64
import collections
import functools
import json
import struct
import time

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from bridge.core import (BYTES_PER_SEC, CHUNK_BYTES, SILENCE, AudioSink, AudioSource,
                         Config, Phrases, SessionCore)

LOUD = struct.pack("<h", 3000) * (CHUNK_BYTES // 2)  # one 100 ms chunk of "speech"


def tone(marker, samples=160):
    """A tiny PCM clip where every sample is `marker`, so a test can tell clips apart."""
    return struct.pack("<h", marker) * samples


def marker_of(pcm):
    return struct.unpack_from("<h", pcm)[0]


def async_test(timeout=20):
    """Run an async test function with plain pytest (no pytest-asyncio needed)."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            return asyncio.run(asyncio.wait_for(fn(*args, **kwargs), timeout))
        return wrapper
    return deco


async def wait_until(cond, timeout=3.0, what="condition"):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("timed out waiting for " + what)


# ------------------------------------------------------------------ fake mic
class FakeSource(AudioSource):
    """Mic. Tests queue chunks with speak()/be_quiet(); an empty queue gives silence."""

    def __init__(self, pace_s=0.02):
        self.pace_s = pace_s          # 5x faster than real time, to keep tests short
        self.script = collections.deque()
        self.finished = False
        self.started = False
        self.closed = False

    def speak(self, chunks):
        self.script.extend([LOUD] * chunks)

    def be_quiet(self, chunks):
        self.script.extend([SILENCE] * chunks)

    def finish(self):
        self.finished = True

    async def start(self):
        self.started = True

    async def read_chunk(self):
        await asyncio.sleep(self.pace_s)
        if self.script:
            return self.script.popleft()
        return None if self.finished else SILENCE

    async def close(self):
        self.closed = True


# --------------------------------------------------------------- fake speaker
class FakeSink(AudioSink):
    """Speaker. Records what was played and when stop() was called."""

    def __init__(self, stop_delay=0.0):
        self.stop_delay = stop_delay
        self.events = []              # ("play", marker, nbytes) or ("stop",)
        self.stop_times = []
        self._busy_until = 0.0
        self.closed = False

    def play(self, pcm):
        now = time.monotonic()
        was_idle = now >= self._busy_until
        self._busy_until = max(now, self._busy_until) + len(pcm) / BYTES_PER_SEC
        self.events.append(("play", marker_of(pcm), len(pcm)))
        if was_idle and self.on_first_sample:
            self.on_first_sample()

    def stop(self):
        time.sleep(self.stop_delay)   # a slow ROS service call
        self.events.append(("stop",))
        self.stop_times.append(time.monotonic())
        self._busy_until = 0.0

    def close(self):
        self.closed = True

    def markers(self):
        return [e[1] for e in self.events if e[0] == "play"]

    def timeline(self):
        return [e[1] if e[0] == "play" else "stop" for e in self.events]


# ------------------------------------------------------- fake ElevenLabs server
class Conn:
    """One conversation as the fake server sees it."""

    def __init__(self, ws, number):
        self.ws = ws
        self.number = number
        self.init = None
        self.received = []
        self.audio_chunks = 0
        self.closed = False

    async def send(self, obj):
        await self.ws.send(json.dumps(obj))

    async def send_audio(self, event_id, marker, samples=160):
        await self.send({"type": "audio", "audio_event": {
            "audio_base_64": base64.b64encode(tone(marker, samples)).decode(),
            "event_id": event_id}})

    async def send_ping(self, event_id=7):
        await self.send({"type": "ping", "ping_event": {"event_id": event_id, "ping_ms": 20}})

    async def send_interruption(self, event_id):
        await self.send({"type": "interruption", "interruption_event": {"event_id": event_id}})

    async def drop(self):
        """Cut the connection without a close handshake, like a lost network."""
        self.ws.transport.abort()

    def of_type(self, kind):
        return [m for m in self.received if m.get("type") == kind]


class FakeServer:
    """Speaks just enough of the ElevenLabs conversation protocol for the tests."""

    def __init__(self, agent_format="pcm_16000", user_format="pcm_16000", send_metadata=True):
        self.agent_format = agent_format
        self.user_format = user_format
        self.send_metadata = send_metadata
        self.connections = []
        self.on_message = None        # optional async hook: (conn, message)
        self.server = None
        self.url = None

    async def start(self):
        self.server = await serve(self._handler, "127.0.0.1", 0)
        port = self.server.sockets[0].getsockname()[1]
        self.url = "ws://127.0.0.1:%d/v1/convai/conversation?agent_id=test&token=t" % port
        return self

    async def stop(self):
        self.server.close()
        await self.server.wait_closed()

    async def _handler(self, ws):
        conn = Conn(ws, len(self.connections) + 1)
        self.connections.append(conn)
        try:
            conn.init = json.loads(await ws.recv())
            if self.send_metadata:
                await conn.send({
                    "type": "conversation_initiation_metadata",
                    "conversation_initiation_metadata_event": {
                        "conversation_id": "conv_%d" % conn.number,
                        "agent_output_audio_format": self.agent_format,
                        "user_input_audio_format": self.user_format}})
            async for raw in ws:
                message = json.loads(raw)
                conn.received.append(message)
                if "user_audio_chunk" in message:
                    conn.audio_chunks += 1
                if self.on_message:
                    await self.on_message(conn, message)
        except ConnectionClosed:
            pass
        finally:
            conn.closed = True


# ------------------------------------------------------------- everything together
def fast_config(**overrides):
    """Short timers so a test takes a fraction of a second. The mic runs 5x real time."""
    values = dict(quiet_end_s=30.0, speech_threshold=500, speech_min_chunks=2,
                  end_silence_s=0.2, preroll_s=0.4, heard_after_s=0.5, slow_after_s=1.2,
                  backoff_start_s=0.05, backoff_max_s=0.2, link_give_up_s=5.0,
                  metadata_timeout_s=2.0, ws_ping_interval_s=None)
    values.update(overrides)
    return Config(**values)


class Rig:
    """Fake server + fake mic + fake speaker + a running SessionCore."""

    def __init__(self, phrases=None, server=None, sink=None, source=None, hooks=None,
                 fail_urls=0, **config):
        self.server = server or FakeServer()
        self.source = source or FakeSource()
        self.sink = sink or FakeSink()
        self.config = fast_config(**config)
        self.phrases = phrases if phrases is not None else Phrases([])
        self.hooks = hooks or {}
        self.core = None
        self.task = None
        self.urls_asked = 0
        self.url_times = []
        self.fail_urls = fail_urls    # the first N URL requests fail, like "no internet"

    async def _url(self):
        self.urls_asked += 1
        self.url_times.append(time.monotonic())
        if self.urls_asked <= self.fail_urls:
            raise OSError("no internet")
        return self.server.url

    async def __aenter__(self):
        await self.server.start()
        self.core = SessionCore(self.source, self.sink, self._url, self.config,
                                phrases=self.phrases, **self.hooks)
        self.task = asyncio.create_task(self.core.run())
        return self

    async def __aexit__(self, *exc):
        self.core.stop()
        await asyncio.wait_for(asyncio.gather(self.task, return_exceptions=True), 5)
        await self.server.stop()

    async def wait_connection(self, number=1, timeout=3.0):
        """The Nth connection, after its first message arrived and the core is ready for audio."""
        await wait_until(lambda: len(self.server.connections) >= number
                         and self.server.connections[number - 1].init is not None,
                         timeout, "connection %d" % number)
        await wait_until(lambda: self.core.ready, timeout, "the core to be ready")
        return self.server.connections[number - 1]

    async def first_connection(self, timeout=3.0):
        return await self.wait_connection(1, timeout)


def write_phrases(directory, languages=("en",), only=None, seconds=0.1):
    """Write phrases.json plus tiny PCM files. Markers: heard 1111, one_moment 2222,
    connection_slow 3333, operator_stop 4444 (Arabic copies add 100)."""
    import os
    markers = {"heard": 1111, "one_moment": 2222, "connection_slow": 3333, "operator_stop": 4444}
    items = []
    os.makedirs(directory, exist_ok=True)
    for lang in languages:
        for pid, marker in markers.items():
            if only and pid not in only:
                continue
            marker += 100 if lang == "ar" else 0
            name = "%s_%s.pcm" % (pid, lang)
            with open(os.path.join(directory, name), "wb") as f:
                f.write(tone(marker, int(16000 * seconds)))
            items.append({"id": pid, "lang": lang, "text": pid + " " + lang,
                          "file": name, "reviewed": lang == "en"})
    with open(os.path.join(directory, "phrases.json"), "w") as f:
        json.dump(items, f)
    return os.path.join(directory, "phrases.json"), directory
