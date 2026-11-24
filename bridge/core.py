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
import csv
import datetime
import inspect
import json
import logging
import math
import os
import statistics
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
    connect_timeout_s: float = 6.0
    metadata_timeout_s: float = 10.0   # server must answer the first message within this
    ws_ping_interval_s: Optional[float] = 5.0    # WebSocket keep-alive, finds dead links
    ws_ping_timeout_s: Optional[float] = 5.0
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


@dataclass
class Phrase:
    id: str
    lang: str
    text: str
    reviewed: bool
    pcm: bytes

    @property
    def seconds(self) -> float:
        return len(self.pcm) / BYTES_PER_SEC


class Phrases:
    """Pre-rendered local phrases (16 kHz PCM files listed in phrases.json)."""

    def __init__(self, items=(), allow_unreviewed: bool = False):
        self.items = list(items)
        self.allow_unreviewed = allow_unreviewed

    @classmethod
    def load(cls, json_path: str, pcm_dir: str, allow_unreviewed: bool = False) -> "Phrases":
        try:
            with open(json_path, encoding="utf-8") as f:
                entries = json.load(f)
        except (OSError, ValueError) as exc:
            log.warning("no phrase list (%s): the fallback phrases are off", exc)
            return cls([], allow_unreviewed)
        items = []
        for entry in entries:
            try:
                with open(os.path.join(pcm_dir, entry["file"]), "rb") as f:
                    pcm = f.read()
            except OSError:
                log.warning("phrase %s/%s has no audio file yet: run render_phrases.py",
                            entry.get("id"), entry.get("lang"))
                continue
            if not pcm or len(pcm) % 2:
                log.warning("phrase file %s is empty or not 16-bit PCM, skipped", entry["file"])
                continue
            items.append(Phrase(entry["id"], entry["lang"], entry.get("text", ""),
                                bool(entry.get("reviewed")), pcm))
        return cls(items, allow_unreviewed)

    def get(self, phrase_id: str, lang: str = "en") -> Optional[Phrase]:
        """The phrase in `lang`, else in English. Unreviewed phrases are used only if allowed."""
        for wanted in (lang, "en"):
            for phrase in self.items:
                if phrase.id == phrase_id and phrase.lang == wanted                         and (phrase.reviewed or self.allow_unreviewed):
                    return phrase
        return None


def arabic_looks_dominant(text: str) -> bool:
    arabic = sum(1 for c in text if "؀" <= c <= "ۿ" or "ݐ" <= c <= "ݿ")
    latin = sum(1 for c in text if c.isascii() and c.isalpha())
    return arabic > latin


class Turn:
    """One thing the visitor said, from the end of their speech until the answer is heard."""

    def __init__(self, t_end: float, number: int):
        self.t_end = t_end            # last loud mic chunk
        self.number = number
        self.wall = time.time()
        self.t_audio: Optional[float] = None    # first agent audio chunk received
        self.t_played: Optional[float] = None   # first sample really played
        self.timers: list = []        # pending "heard" / "one moment" timers


# ------------------------------------------------------------------ latency log
# Times are seconds on the bridge's own clock: only the differences mean something.
LATENCY_FIELDS = ["wall_time", "session_id", "conversation_id", "turn",
                  "t_speech_end", "t_first_audio", "t_first_played",
                  "end_to_audio_ms", "audio_to_play_ms", "end_to_play_ms"]
GAP_FIELDS = ("end_to_audio_ms", "audio_to_play_ms", "end_to_play_ms")


def append_latency_row(path: str, row: dict) -> None:
    new_file = not os.path.exists(path) or os.path.getsize(path) == 0
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=LATENCY_FIELDS)
        if new_file:
            writer.writeheader()
        writer.writerow(row)


def summarize_latency_csv(path: str) -> dict:
    """Median and worst case of each gap. A turn with no answer is counted but not averaged."""
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    summary = {"turns": len(rows),
               "unanswered": sum(1 for r in rows if not r.get(GAP_FIELDS[2]))}
    for field in GAP_FIELDS:
        values = [int(r[field]) for r in rows if r.get(field)]
        summary[field] = ({"n": len(values), "median": int(statistics.median(values)),
                           "worst": max(values)} if values else None)
    return summary


def format_latency_summary(summary: dict) -> str:
    lines = ["turns: %d (no answer: %d)" % (summary["turns"], summary["unanswered"])]
    labels = {"end_to_audio_ms": "speech end -> first agent audio",
              "audio_to_play_ms": "first agent audio -> first sample played",
              "end_to_play_ms": "speech end -> first sample played (what the visitor feels)"}
    for field in GAP_FIELDS:
        stats = summary[field]
        if stats:
            lines.append("%s: median %d ms, worst %d ms (%d turns)"
                         % (labels[field], stats["median"], stats["worst"], stats["n"]))
        else:
            lines.append("%s: no data" % labels[field])
    return "\n".join(lines)


def print_latency_summary(path: str) -> None:
    print(format_latency_summary(summarize_latency_csv(path)))


# ------------------------------------------------------------------ the core
WATCH_S = 0.05                    # how often the connection watcher looks at the clock


class SessionCore:
    """One visitor session = one or more ElevenLabs conversations. Audio in, audio out."""

    def __init__(self, source: AudioSource, sink: AudioSink, url_provider, config: Config = None,
                 phrases: Phrases = None, on_user_text=None, on_agent_text=None, on_event=None,
                 clock=time.monotonic):
        self.source = source
        self.sink = sink
        self.url_provider = url_provider          # (async) function: returns a fresh WebSocket URL
        self.config = config or Config()
        cfg = self.config
        if phrases is None:
            here = os.path.dirname(os.path.abspath(__file__))
            phrases = Phrases.load(cfg.phrases_json or os.path.join(here, "phrases.json"),
                                   cfg.phrases_dir or os.path.join(here, "phrases"),
                                   cfg.allow_unreviewed_phrases)
        self.phrases = phrases
        self.on_user_text = on_user_text or _noop     # hooks for the app: keep them quick
        self.on_agent_text = on_agent_text or _noop
        self.on_event = on_event or _noop
        self.clock = clock

        self.session_id: Optional[str] = None
        self.conversation_id: Optional[str] = None
        self.visitor_lang = cfg.default_lang

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._wake: Optional[asyncio.Event] = None
        self._stopping = False
        self._session_task: Optional[asyncio.Future] = None
        self._in_session = False
        self._presence = False
        self._source_done = False
        self._last_activity = clock()

        # route: a human is walking the robot, so the session must not end
        self._route_manual = cfg.route_active
        self._route_until: Optional[float] = None

        # microphone side
        slots = max(0, int(round(cfg.preroll_s / CHUNK_S)))
        self._preroll = collections.deque(maxlen=slots)
        self._end_chunks = max(1, math.ceil(cfg.end_silence_s / CHUNK_S - 1e-9))
        self._loud_run = 0
        self._quiet_run = 0
        self._in_speech = False
        self._last_voiced = 0.0
        self._turn: Optional[Turn] = None
        self._turn_count = 0

        # speaker side
        self._playing_until = 0.0      # when the audio we handed over should be finished
        self._local_until = 0.0        # same, for local phrases only

        # the current conversation (one WebSocket)
        self._ws = None
        self._negotiated = False
        self._ready_this_try = False
        self._audio_open = False
        self._queued = False           # waiting in line at ElevenLabs
        self._negotiated_count = 0
        self._end_reason: Optional[str] = None
        self._outage_announced = False
        self._slow_timer = None
        self._first_audio_id = 0       # audio older than the last interruption is dropped
        self._latest_audio = -1
        self._held: list = []          # audio that arrived while a stop was running
        self._stop_task: Optional[asyncio.Future] = None

    # ------------------------------------------------------------- app-facing API
    @property
    def ready(self) -> bool:
        """True while a conversation is open and the agent has agreed on the audio format."""
        return self._negotiated

    @property
    def route_active(self) -> bool:
        """True while a human operator is walking the robot. The session never ends then."""
        if self._route_manual:
            return True
        return self._route_until is not None and self.clock() < self._route_until

    @route_active.setter
    def route_active(self, value: bool) -> None:
        self._route_manual = bool(value)
        if not value:
            self._route_until = None

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
        try:
            await self.source.close()
        except Exception as exc:
            log.warning("could not close the mic: %s", exc)
        try:
            self.sink.close()
        except Exception as exc:
            log.warning("could not close the speaker: %s", exc)

    def _touch(self):
        """Something happened that shows a visitor is still here."""
        self._last_activity = self.clock()

    def _on_presence(self):
        self._touch()
        if self._in_session or self._stopping:
            return
        self._presence = True
        self._wake.set()

    def _sink_first_sample(self):
        """The speaker says sound really started. Safe to call from any thread."""
        now = self.clock()
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._on_first_sample, now)

    def _on_first_sample(self, when: float):
        turn = self._turn
        # Ignore local phrases: they play before the answer audio has arrived.
        if turn is None or turn.t_audio is None or turn.t_played is not None or when < turn.t_audio:
            return
        turn.t_played = when
        self._finish_turn()

    def _emit(self, event: dict) -> None:
        try:
            self.on_event(event)
        except Exception:
            log.exception("on_event hook failed")

    def _safe_hook(self, hook, *args):
        try:
            hook(*args)
        except Exception:
            log.exception("app hook failed")

    # ------------------------------------------------------------------ microphone
    def _agent_is_playing(self, now: float) -> bool:
        return now < self._playing_until + self.config.echo_tail_s

    async def _mic_loop(self):
        cfg = self.config
        while True:
            chunk = await self.source.read_chunk()
            if chunk is None:
                self._source_done = True
                self._wake.set()
                return
            now = self.clock()
            playing = self._agent_is_playing(now)
            if playing and cfg.mic_gate == "half_duplex":
                chunk = SILENCE            # robot is talking: do not let it hear itself
            loud = rms(chunk) >= cfg.speech_threshold
            # While the robot talks, loud sound is probably its own voice: not a new turn.
            self._track_speech(now, loud and not playing)
            if self._audio_open:
                await self._send_json({"user_audio_chunk": base64.b64encode(chunk).decode()})
            else:
                self._preroll.append(chunk)

    def _track_speech(self, now: float, voiced: bool):
        cfg = self.config
        if voiced:
            self._loud_run += 1
            self._quiet_run = 0
            self._last_voiced = now
            self._touch()
            if self._loud_run >= cfg.speech_min_chunks and not self._in_speech:
                self._in_speech = True
                if cfg.presence_from_mic:
                    self._on_presence()
        else:
            self._loud_run = 0
            if self._in_speech:
                self._quiet_run += 1
                if self._quiet_run >= self._end_chunks:
                    self._in_speech = False
                    self._quiet_run = 0
                    self._on_speech_end(self._last_voiced)

    def _on_speech_end(self, t_last_voiced: float):
        """The visitor stopped talking: start the clocks for the 'I heard you' phrases."""
        if not (self._in_session and self._audio_open):
            return
        cfg = self.config
        self._finish_turn()                    # an earlier turn with no answer is logged as such
        self._turn_count += 1
        turn = self._turn = Turn(t_last_voiced, self._turn_count)
        waited = self.clock() - t_last_voiced
        turn.timers = [
            self._loop.call_later(max(0.0, cfg.heard_after_s - waited),
                                  self._fire_filler, turn, "heard"),
            self._loop.call_later(max(0.0, cfg.slow_after_s - waited),
                                  self._fire_filler, turn, "one_moment"),
        ]

    def _fire_filler(self, turn: Turn, phrase_id: str):
        if turn is self._turn and turn.t_audio is None and self._audio_open:
            self._play_local(phrase_id)

    def _cancel_turn_timers(self):
        if self._turn is not None:
            for timer in self._turn.timers:
                timer.cancel()
            self._turn.timers = []

    def _finish_turn(self):
        """Write the open turn to the latency log (gaps stay empty if it got no answer)."""
        turn, self._turn = self._turn, None
        if turn is None:
            return
        for timer in turn.timers:
            timer.cancel()
        if not self.config.latency_csv:
            return

        def ms(start, end):
            return "" if start is None or end is None else int(round((end - start) * 1000))

        def seconds(t):
            return "" if t is None else "%.3f" % t

        wall = datetime.datetime.fromtimestamp(turn.wall).isoformat(timespec="milliseconds")
        row = {"wall_time": wall, "session_id": self.session_id,
               "conversation_id": self.conversation_id or "", "turn": turn.number,
               "t_speech_end": seconds(turn.t_end), "t_first_audio": seconds(turn.t_audio),
               "t_first_played": seconds(turn.t_played),
               "end_to_audio_ms": ms(turn.t_end, turn.t_audio),
               "audio_to_play_ms": ms(turn.t_audio, turn.t_played),
               "end_to_play_ms": ms(turn.t_end, turn.t_played)}
        try:
            append_latency_row(self.config.latency_csv, row)
        except OSError as exc:
            log.warning("could not write the latency log: %s", exc)

    # ------------------------------------------------------------------- session
    def _session_over(self) -> bool:
        """No visitor activity for quiet_end_s, and no route, and the robot is not talking."""
        if self._stopping:
            return True
        if self.route_active:
            return False
        now = self.clock()
        if self._agent_is_playing(now):
            return False
        return now - self._last_activity >= self.config.quiet_end_s

    async def _get_url(self) -> str:
        url = self.url_provider()
        if inspect.isawaitable(url):
            url = await url
        return url

    async def _run_session(self):
        cfg = self.config
        self._in_session = True
        self.session_id = str(uuid.uuid4())       # one per visitor, kept across reconnects
        self.visitor_lang = cfg.default_lang      # new visitor: nothing carried over
        self._negotiated_count = 0
        self._outage_announced = False
        self._touch()
        self._emit({"type": "bridge_session_start", "session_id": self.session_id})
        backoff = cfg.backoff_start_s
        down_since: Optional[float] = None
        try:
            while not self._session_over():
                self._arm_slow_timer()
                self._ready_this_try = False
                try:
                    url = await self._get_url()
                    outcome = await self._serve_connection(url)
                except FormatError:
                    raise
                except Exception as exc:
                    outcome = "dropped"
                    log.warning("link problem: %s: %s", type(exc).__name__, exc)
                finally:
                    self._cancel_slow_timer()
                if self._ready_this_try:
                    backoff, down_since = cfg.backoff_start_s, None
                if outcome == "ended":
                    break
                if outcome == "closed" and not self.route_active:
                    break                         # the agent hung up and nobody is walking: done
                # The link is down, or the agent hung up in the middle of a route.
                now = self.clock()
                down_since = now if down_since is None else down_since
                self._announce_link_down()
                if not self.route_active and now - down_since > cfg.link_give_up_s:
                    log.warning("giving up after %.0f s without a link", now - down_since)
                    break
                await self._sleep_unless_over(backoff)
                backoff = min(backoff * 2, cfg.backoff_max_s)
        finally:
            self._in_session = False
            self._finish_turn()
            self._turn_count = 0
            self._preroll.clear()
            self._emit({"type": "bridge_session_end", "session_id": self.session_id})

    async def _sleep_unless_over(self, seconds: float):
        end = self.clock() + seconds
        while self.clock() < end and not self._session_over():
            await asyncio.sleep(min(WATCH_S, max(0.0, end - self.clock())))

    # ---- telling people the link is bad
    def _arm_slow_timer(self):
        self._cancel_slow_timer()
        self._slow_timer = self._loop.call_later(self.config.slow_after_s, self._connecting_is_slow)

    def _cancel_slow_timer(self):
        if self._slow_timer is not None:
            self._slow_timer.cancel()
            self._slow_timer = None

    def _connecting_is_slow(self):
        if self._in_session and not self._negotiated:
            self._announce_link_down()

    def _announce_link_down(self):
        """Once per outage: stop the operator if a route is on, then tell the visitor."""
        if self._outage_announced:
            return
        self._outage_announced = True
        log.warning("link is down (route active: %s)", self.route_active)
        self._emit({"type": "bridge_link", "state": "down"})
        if self.route_active:
            self._play_local("operator_stop", "en")
        self._play_local("connection_slow")

    def _play_local(self, phrase_id: str, lang: Optional[str] = None) -> bool:
        phrase = self.phrases.get(phrase_id, lang or self.visitor_lang)
        if phrase is None:
            log.warning("no local phrase %r available (run render_phrases.py)", phrase_id)
            return False
        log.info("local phrase: %s (%s)", phrase_id, phrase.lang)
        self._local_until = max(self._local_until, self.clock()) + phrase.seconds
        self._give_to_speaker(phrase.pcm)
        return True

    # ---- one WebSocket
    def _init_message(self) -> dict:
        return {"type": "conversation_initiation_client_data",
                "dynamic_variables": {"session_id": self.session_id,
                                      "source": self.config.source_label,
                                      "resumed": self._negotiated_count > 0}}

    async def _serve_connection(self, url: str) -> str:
        """Run one conversation. Returns "ended" (we closed it, visit over) or "closed" (the
        server closed it normally). A lost link raises an exception instead."""
        cfg = self.config
        self._negotiated = False
        self._audio_open = False
        self._queued = False
        self._end_reason = None
        self._first_audio_id = 0
        self._latest_audio = -1
        self._held = []
        async with connect(url, subprotocols=["convai"], max_size=MAX_MESSAGE_BYTES,
                           open_timeout=cfg.connect_timeout_s,
                           ping_interval=cfg.ws_ping_interval_s,
                           ping_timeout=cfg.ws_ping_timeout_s) as ws:
            self._ws = ws
            watcher = asyncio.ensure_future(self._watch(ws, self.clock()))
            try:
                await ws.send(json.dumps(self._init_message()))
                async for raw in ws:
                    await self._on_message(raw)
            finally:
                watcher.cancel()
                await asyncio.gather(watcher, return_exceptions=True)
                self._ws = None
                self._negotiated = False
                self._audio_open = False
        if self._end_reason == "no_metadata":
            raise LinkProblem("the server did not answer the first message")
        return "ended" if self._end_reason == "over" else "closed"

    async def _watch(self, ws, opened_at: float):
        """Close the connection when the server is silent at the start or the visit is over."""
        while True:
            await asyncio.sleep(WATCH_S)
            if not self._negotiated and self.clock() - opened_at > self.config.metadata_timeout_s:
                self._end_reason = "no_metadata"
            elif self._session_over():
                self._end_reason = "over"
            else:
                continue
            await ws.close()
            return

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
                self._touch()
                if arabic_looks_dominant(text):
                    self.visitor_lang = "ar"   # an English "done" from the operator never flips it back
                self._safe_hook(self.on_user_text, text)
        elif kind == "agent_response":
            text = (event.get("agent_response_event") or {}).get("agent_response")
            if isinstance(text, str) and text.strip():
                self._touch()
                self._safe_hook(self.on_agent_text, text)
        elif kind == "client_tool_call":
            await self._on_client_tool_call(event.get("client_tool_call") or {})
        elif kind == "queue_status":
            self._on_queue_status((event.get("queue_status_event") or {}).get("status"))
        elif kind == "client_error":
            message = (event.get("error_event") or {}).get("message")
            raise LinkProblem("the server reported an error: %s" % (message,))
        elif kind == "agent_tool_request":
            request = event.get("agent_tool_request") or {}
            self._touch()
            if request.get("tool_name") in self.config.route_tools:
                self._route_until = self.clock() + self.config.route_idle_s
        elif kind == "agent_tool_response_full_payload":
            payload = event.get("agent_tool_response_full_payload") or {}
            if payload.get("tool_name") in self.config.route_tools \
                    and "at_destination" in str(payload.get("full_tool_result", "")):
                self._route_until = None       # arrived: the route is over

    async def _on_client_tool_call(self, call: dict):
        """We use server (webhook) tools only. If a client tool is called anyway, say it failed,
        so the agent does not wait for an answer that never comes."""
        log.warning("the agent called client tool %r, but this bridge has none", call.get("tool_name"))
        call_id = call.get("tool_call_id")
        if call_id and call.get("expects_response", True):
            await self._send_json({"type": "client_tool_result", "tool_call_id": call_id,
                                   "result": "This robot has no client tools. Use a server tool.",
                                   "is_error": True})

    def _on_queue_status(self, status):
        """ElevenLabs may put us in a waiting line (same handling as voice.mjs)."""
        if status == "waiting" and self._negotiated and not self._queued:
            self._queued = True
            self._audio_open = False          # do not send mic audio while we wait in line
            log.info("waiting in line at ElevenLabs")
        elif status == "admitted" and self._queued:
            self._queued = False
            self._first_audio_id, self._latest_audio = 0, -1
            self._begin_stop()                # stop any hold music
            self._preroll.clear()
            self._audio_open = True
        elif status == "timed_out":
            raise LinkProblem("the wait in line at ElevenLabs timed out")

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
        self._ready_this_try = True
        self._negotiated_count += 1
        self._cancel_slow_timer()
        if self._outage_announced:
            self._outage_announced = False
            self._emit({"type": "bridge_link", "state": "up"})
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
        self._touch()
        if self._turn is not None and self._turn.t_audio is None:
            self._turn.t_audio = self.clock()
            self._cancel_turn_timers()            # the answer is coming: no filler phrases
        if self.clock() < self._local_until:      # a local phrase is still playing: cut it off
            self._local_until = 0.0
            self._begin_stop()
        self._give_to_speaker(pcm)

    def _give_to_speaker(self, pcm: bytes):
        if self._stop_task is not None and not self._stop_task.done():
            self._held.append(pcm)        # a stop is running: play this after it, not before
            return
        self._write_audio(pcm)

    def _write_audio(self, pcm: bytes):
        self._playing_until = max(self.clock(), self._playing_until) + len(pcm) / BYTES_PER_SEC
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
        self._playing_until = 0.0
        self._local_until = 0.0
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
