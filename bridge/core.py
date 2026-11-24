"""Session core: the part of the bridge that talks to ElevenLabs.

Plain Python and asyncio. No ROS and no audio-device imports, so it runs on a laptop.
It talks to two small things that an adapter provides:

  AudioSource  the microphone: gives 100 ms chunks (16 kHz, mono, 16-bit, little-endian)
  AudioSink    the speaker: plays 16 kHz PCM, can be stopped, says when sound really starts

The message shapes follow app/static/voice.mjs (the working browser client).
The bridge moves audio only. It never moves the robot.
"""
from __future__ import annotations

import array
import asyncio
import base64
import collections
import inspect
import json
import logging
import math
import sys
import time
import uuid
from dataclasses import dataclass, fields
from typing import Any, Callable, Optional

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

log = logging.getLogger("bridge")

RATE = 16000                      # Hz, what the robot gives and takes
BYTES_PER_SEC = RATE * 2          # 16-bit mono
CHUNK_S = 0.1
CHUNK_BYTES = int(BYTES_PER_SEC * CHUNK_S)   # 3200 bytes = 100 ms
SILENCE = bytes(CHUNK_BYTES)
AUDIO_FORMAT = "pcm_16000"
MAX_MESSAGE_BYTES = 16 * 1024 * 1024


class FormatError(Exception):
    """The agent does not use 16 kHz PCM. Retrying cannot fix this, so the bridge stops."""


class LinkProblem(Exception):
    """The server sent something that means the conversation cannot go on (treated as a drop)."""


# ------------------------------------------------------------------ settings
@dataclass
class Config:
    # --- when a visitor session starts and ends
    presence_from_mic: bool = True     # voice at the mic counts as "someone is there"
    quiet_end_s: float = 20.0          # end the session after this much quiet
    route_active: bool = False         # the app can set this; true = never end the session
    route_tools: tuple = ("next_route_step",)   # server tools whose use means "a route is active"
    route_idle_s: float = 300.0        # a route counts as active this long after its last tool call
    default_lang: str = "en"           # language of the local phrases at the start of a session
    source_label: str = "robot"        # dynamic variable "source"
    # --- microphone
    mic_gate: str = "none"             # "none" or "half_duplex" (mute the mic while the robot speaks)
    echo_tail_s: float = 0.3           # extra mute time after the robot stops speaking
    speech_threshold: int = 500        # loudness (RMS, 0..32767) that counts as speech
    speech_min_chunks: int = 2         # loud chunks in a row before speech starts
    end_silence_s: float = 0.6         # quiet this long = the person stopped speaking
    preroll_s: float = 1.0             # mic audio kept from before the conversation was ready
    # --- local fallback phrases
    phrases_json: str = ""             # default: bridge/phrases.json
    phrases_dir: str = ""              # default: bridge/phrases
    allow_unreviewed_phrases: bool = False
    heard_after_s: float = 1.5         # "I heard you" if no answer audio by then
    slow_after_s: float = 4.0          # "one moment" if still nothing by then
    # --- connection
    backoff_start_s: float = 1.0
    backoff_max_s: float = 15.0
    link_give_up_s: float = 120.0      # stop retrying after this long (unless a route is active)
    connect_timeout_s: float = 10.0
    metadata_timeout_s: float = 10.0   # server must answer the first message within this
    ws_ping_interval_s: Optional[float] = 10.0   # WebSocket keep-alive, finds dead links
    ws_ping_timeout_s: Optional[float] = 10.0
    # --- latency log
    latency_csv: str = ""              # empty = no log

    def __post_init__(self):
        if self.mic_gate not in ("none", "half_duplex"):
            raise ValueError("mic_gate must be 'none' or 'half_duplex', not %r" % (self.mic_gate,))
        self.route_tools = tuple(self.route_tools)

    @classmethod
    def from_dict(cls, values):
        known = {f.name for f in fields(cls)}
        unknown = sorted(set(values) - known)
        if unknown:
            raise ValueError("unknown config key(s): " + ", ".join(unknown))
        return cls(**values)


# ----------------------------------------------------------- adapter interfaces
class AudioSource:
    """The microphone. An adapter subclasses this."""

    on_presence: Optional[Callable[[], None]] = None   # the core sets this; call it from any thread

    async def start(self) -> None:
        pass

    async def read_chunk(self) -> Optional[bytes]:
        """Wait for the next 100 ms chunk (3200 bytes). Return None when the source is finished."""
        raise NotImplementedError

    async def close(self) -> None:
        pass


class AudioSink:
    """The speaker. An adapter subclasses this."""

    on_first_sample: Optional[Callable[[], None]] = None   # the core sets this; call it from any thread

    def play(self, pcm: bytes) -> None:
        """Queue PCM for playback. Must return quickly. Call on_first_sample when sound really
        starts coming out after being idle."""
        raise NotImplementedError

    def stop(self) -> None:
        """Throw away everything queued and stop now. May block (the core calls it in a thread)."""
        raise NotImplementedError

    def close(self) -> None:
        pass


# ------------------------------------------------------------------- small helpers
def rms(pcm: bytes) -> float:
    """Loudness of 16-bit little-endian PCM."""
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    if sys.byteorder == "big":
        samples.byteswap()
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


def valid_id(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _noop(*_args):
    pass


class Phrases:
    """Pre-rendered local phrases. Filled in a later step."""

    def __init__(self, items=(), allow_unreviewed=False):
        self.items = list(items)
        self.allow_unreviewed = allow_unreviewed

    def get(self, phrase_id, lang="en"):
        return None


# ------------------------------------------------------------------ the core
class SessionCore:
    """One visitor session = one or more ElevenLabs conversations. Audio in, audio out."""

    def __init__(self, source: AudioSource, sink: AudioSink, url_provider, config: Config = None,
                 phrases: Phrases = None, on_user_text=None, on_agent_text=None, on_event=None,
                 clock=time.monotonic):
        self.source = source
        self.sink = sink
        self.url_provider = url_provider          # (async) function: returns a fresh WebSocket URL
        self.config = config or Config()
        self.phrases = phrases if phrases is not None else Phrases()
        self.on_user_text = on_user_text or _noop     # hooks for the app: keep them quick
        self.on_agent_text = on_agent_text or _noop
        self.on_event = on_event or _noop
        self.clock = clock

        self.session_id: Optional[str] = None
        self.conversation_id: Optional[str] = None

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._wake: Optional[asyncio.Event] = None
        self._stopping = False
        self._session_task: Optional[asyncio.Future] = None
        self._in_session = False
        self._presence = False
        self._source_done = False

        # microphone side
        slots = max(0, int(round(self.config.preroll_s / CHUNK_S)))
        self._preroll = collections.deque(maxlen=slots)
        self._loud_run = 0
        self._in_speech = False

        # the current conversation (one WebSocket)
        self._ws = None
        self._negotiated = False
        self._audio_open = False
        self._negotiated_count = 0
        self._first_audio_id = 0       # audio older than the last interruption is dropped
        self._latest_audio = -1
        self._held: list = []          # audio that arrived while a stop was running
        self._stop_task: Optional[asyncio.Future] = None

    # ------------------------------------------------------------- app-facing API
    @property
    def ready(self) -> bool:
        """True while a conversation is open and the agent has agreed on the audio format."""
        return self._negotiated

    def signal_presence(self) -> None:
        """Someone is here (wake word, robot VAD, ...). Safe to call from any thread."""
        loop = self._loop
        if loop is None:
            self._presence = True         # run() has not started yet: remember it
        elif not loop.is_closed():
            loop.call_soon_threadsafe(self._on_presence)

    def stop(self) -> None:
        """Ask run() to finish. Safe to call from any thread."""
        self._stopping = True
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._do_stop)

    async def run(self) -> None:
        """Run until stop() is called (or the source ends and no session is left)."""
        self._loop = asyncio.get_running_loop()
        self._wake = asyncio.Event()
        if self._presence:
            self._wake.set()
        self.source.on_presence = self.signal_presence
        self.sink.on_first_sample = self._sink_first_sample
        await self.source.start()
        mic = asyncio.ensure_future(self._mic_loop())
        try:
            while not self._stopping:
                await self._wake.wait()
                self._wake.clear()
                if self._stopping:
                    break
                if self._presence:
                    self._presence = False
                    self._session_task = asyncio.ensure_future(self._run_session())
                    try:
                        await self._session_task
                    except asyncio.CancelledError:
                        if not self._stopping:
                            raise
                    self._session_task = None
                if self._source_done:
                    break
        finally:
            mic.cancel()
            await asyncio.gather(mic, return_exceptions=True)
            await self._shutdown()

    # --------------------------------------------------------------- run helpers
    def _do_stop(self):
        self._wake.set()
        if self._session_task is not None:
            self._session_task.cancel()

    async def _shutdown(self):
        try:
            await self._loop.run_in_executor(None, self.sink.stop)
        except Exception as exc:
            log.warning("could not stop playback at shutdown: %s", exc)
        for closer in (self.source.close(),):
            try:
                await closer
            except Exception as exc:
                log.warning("could not close the mic: %s", exc)
        try:
            self.sink.close()
        except Exception as exc:
            log.warning("could not close the speaker: %s", exc)

    def _on_presence(self):
        if self._in_session or self._stopping:
            return
        self._presence = True
        self._wake.set()

    def _sink_first_sample(self):
        pass

    def _emit(self, event: dict) -> None:
        try:
            self.on_event(event)
        except Exception:
            log.exception("on_event hook failed")

    # ------------------------------------------------------------------ microphone
    async def _mic_loop(self):
        while True:
            chunk = await self.source.read_chunk()
            if chunk is None:
                self._source_done = True
                self._wake.set()
                return
            loud = rms(chunk) >= self.config.speech_threshold
            self._track_speech(loud)
            if self._audio_open:
                await self._send_json({"user_audio_chunk": base64.b64encode(chunk).decode()})
            else:
                self._preroll.append(chunk)

    def _track_speech(self, loud: bool):
        cfg = self.config
        if loud:
            self._loud_run += 1
            if self._loud_run >= cfg.speech_min_chunks and not self._in_speech:
                self._in_speech = True
                if cfg.presence_from_mic:
                    self._on_presence()
        else:
            self._loud_run = 0
            self._in_speech = False

    # ------------------------------------------------------------------- session
    async def _run_session(self):
        self._in_session = True
        self.session_id = str(uuid.uuid4())
        self._negotiated_count = 0
        self._emit({"type": "bridge_session_start", "session_id": self.session_id})
        try:
            url = self.url_provider()
            if inspect.isawaitable(url):
                url = await url
            await self._serve_connection(url)
        except FormatError:
            raise
        except Exception as exc:
            log.warning("conversation ended: %s", exc)
        finally:
            self._in_session = False
            self._preroll.clear()
            self._emit({"type": "bridge_session_end", "session_id": self.session_id})

    def _init_message(self) -> dict:
        return {"type": "conversation_initiation_client_data",
                "dynamic_variables": {"session_id": self.session_id,
                                      "source": self.config.source_label,
                                      "resumed": self._negotiated_count > 0}}

    async def _serve_connection(self, url: str):
        cfg = self.config
        self._negotiated = False
        self._audio_open = False
        self._first_audio_id = 0
        self._latest_audio = -1
        self._held = []
        async with connect(url, subprotocols=["convai"], max_size=MAX_MESSAGE_BYTES,
                           open_timeout=cfg.connect_timeout_s,
                           ping_interval=cfg.ws_ping_interval_s,
                           ping_timeout=cfg.ws_ping_timeout_s) as ws:
            self._ws = ws
            try:
                await ws.send(json.dumps(self._init_message()))
                async for raw in ws:
                    await self._on_message(raw)
            finally:
                self._ws = None
                self._negotiated = False
                self._audio_open = False

    async def _send_json(self, obj: dict) -> None:
        ws = self._ws
        if ws is None:
            return
        try:
            await ws.send(json.dumps(obj))
        except ConnectionClosed:
            pass          # the receive loop notices the closed link

    # -------------------------------------------------------------- server events
    async def _on_message(self, raw):
        if not isinstance(raw, str):
            return
        try:
            event = json.loads(raw)
        except ValueError:
            log.warning("ignored a message that is not JSON")
            return
        if not isinstance(event, dict):
            return
        kind = event.get("type")
        if kind != "audio":
            self._emit(event)     # audio is too big and too frequent for the app hook
        if kind == "conversation_initiation_metadata":
            await self._on_metadata(event.get("conversation_initiation_metadata_event") or {})
        elif kind == "ping":
            event_id = (event.get("ping_event") or {}).get("event_id")
            if valid_id(event_id):
                await self._send_json({"type": "pong", "event_id": event_id})
        elif kind == "audio":
            if self._negotiated:
                self._on_audio_event(event.get("audio_event") or {})
        elif kind == "interruption":
            self._on_interruption(event.get("interruption_event") or {})
        elif kind == "user_transcript":
            text = (event.get("user_transcription_event") or {}).get("user_transcript")
            if isinstance(text, str) and text.strip():
                self._safe_hook(self.on_user_text, text)
        elif kind == "agent_response":
            text = (event.get("agent_response_event") or {}).get("agent_response")
            if isinstance(text, str) and text.strip():
                self._safe_hook(self.on_agent_text, text)

    def _safe_hook(self, hook, *args):
        try:
            hook(*args)
        except Exception:
            log.exception("app hook failed")

    async def _on_metadata(self, meta: dict):
        agent_format = meta.get("agent_output_audio_format")
        user_format = meta.get("user_input_audio_format")
        if agent_format != AUDIO_FORMAT or user_format != AUDIO_FORMAT:
            raise FormatError(
                "The agent must use %s in both directions, but the server says agent output = %r "
                "and user input = %r. Set both audio formats to PCM 16000 Hz in the ElevenLabs "
                "agent settings." % (AUDIO_FORMAT, agent_format, user_format))
        if self._negotiated:
            return
        self._negotiated = True
        self._negotiated_count += 1
        self.conversation_id = meta.get("conversation_id")
        log.info("conversation ready: agent speaks %s, listens to %s", agent_format, user_format)
        await self._open_audio()

    async def _open_audio(self):
        """Send the mic audio kept so far, then go live. No await between the last check of the
        queue and the flag, so no chunk is lost or sent out of order."""
        while self._preroll:
            chunk = self._preroll.popleft()
            await self._send_json({"user_audio_chunk": base64.b64encode(chunk).decode()})
        self._audio_open = True

    # ------------------------------------------------------------- agent audio
    def _on_audio_event(self, audio: dict):
        event_id = audio.get("event_id")
        data = audio.get("audio_base_64")
        # Same rule as voice.mjs: drop audio older than the last interruption (or out of order).
        if (not valid_id(event_id) or event_id < self._first_audio_id
                or event_id < self._latest_audio or not isinstance(data, str) or not data):
            return
        try:
            pcm = base64.b64decode(data)
        except ValueError:
            return
        if not pcm or len(pcm) % 2:
            return
        self._latest_audio = event_id
        self._give_to_speaker(pcm)

    def _give_to_speaker(self, pcm: bytes):
        if self._stop_task is not None and not self._stop_task.done():
            self._held.append(pcm)        # a stop is running: play this after it, not before
            return
        self._write_audio(pcm)

    def _write_audio(self, pcm: bytes):
        try:
            self.sink.play(pcm)
        except Exception:
            log.exception("speaker failed to take audio")

    def _on_interruption(self, interruption: dict):
        if not self._negotiated:
            return
        event_id = interruption.get("event_id")
        if valid_id(event_id) and (event_id < self._first_audio_id or event_id < self._latest_audio):
            return                        # an old interruption, nothing to do
        self._first_audio_id = max(self._first_audio_id,
                                   event_id if valid_id(event_id) else self._latest_audio + 1)
        self._begin_stop()

    def _begin_stop(self):
        """Stop the speaker without blocking the receive loop (the stop call can take seconds)."""
        self._held.clear()
        if self._stop_task is None or self._stop_task.done():
            self._stop_task = asyncio.ensure_future(self._run_stop())

    async def _run_stop(self):
        try:
            await self._loop.run_in_executor(None, self.sink.stop)
        except Exception:
            log.exception("stopping playback failed")
        held, self._held = self._held, []
        for pcm in held:
            self._write_audio(pcm)
