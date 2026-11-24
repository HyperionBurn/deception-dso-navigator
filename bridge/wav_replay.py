"""Replay a WAV file as the microphone, and write what the agent says to a WAV file.

This makes the noise and music tests repeatable (plan section 4.7): record the visitor and
operator lines once, mix in crowd or music, and send the same audio every time.

The input must be 16 kHz, mono, 16-bit. Convert other files first, for example:
    ffmpeg -i in.mp3 -ar 16000 -ac 1 -sample_fmt s16 in.wav
"""
from __future__ import annotations

import asyncio
import math
import time
import wave
from typing import Optional

from .core import BYTES_PER_SEC, CHUNK_BYTES, CHUNK_S, RATE, SILENCE, AudioSink, AudioSource


class WavFormatError(ValueError):
    """The WAV file is not 16 kHz mono 16-bit."""


def read_wav_pcm(path: str) -> bytes:
    with wave.open(path, "rb") as w:
        found = (w.getframerate(), w.getnchannels(), w.getsampwidth())
        if found != (RATE, 1, 2):
            raise WavFormatError(
                "%s must be 16 kHz mono 16-bit, but it is %d Hz, %d channel(s), %d-bit."
                % (path, found[0], found[1], found[2] * 8))
        return w.readframes(w.getnframes())


class WavSource(AudioSource):
    """The microphone, played from a file. After the file a silent tail follows, so the agent
    can hear that the person stopped talking."""

    def __init__(self, path: str, realtime: bool = True, tail_silence_s: float = 3.0,
                 presence_at_start: bool = True):
        self.pcm = read_wav_pcm(path)
        self.realtime = realtime            # False = as fast as possible (timers will not make sense)
        self.presence_at_start = presence_at_start   # say "someone is here" when we start
        self._pos = 0
        self._tail_left = int(math.ceil(tail_silence_s / CHUNK_S - 1e-9))
        self._next_tick: Optional[float] = None

    async def start(self) -> None:
        if self.presence_at_start and self.on_presence:
            self.on_presence()

    async def read_chunk(self) -> Optional[bytes]:
        if self._pos < len(self.pcm):
            chunk = self.pcm[self._pos:self._pos + CHUNK_BYTES]
            chunk += bytes(CHUNK_BYTES - len(chunk))        # pad the last piece
            self._pos += CHUNK_BYTES
        elif self._tail_left > 0:
            self._tail_left -= 1
            chunk = SILENCE
        else:
            return None
        if self.realtime:
            now = time.monotonic()
            self._next_tick = (now if self._next_tick is None else self._next_tick) + CHUNK_S
            await asyncio.sleep(max(0.0, self._next_tick - now))
        else:
            await asyncio.sleep(0)
        return chunk


class WavSink(AudioSink):
    """The speaker, written to a file. Everything the agent said (and that was not dropped as
    stale) goes in one after the other; the file does not keep the real timing."""

    def __init__(self, path: str):
        self._wav = wave.open(path, "wb")
        self._wav.setnchannels(1)
        self._wav.setsampwidth(2)
        self._wav.setframerate(RATE)
        self._busy_until = 0.0
        self._closed = False

    def play(self, pcm: bytes) -> None:
        now = time.monotonic()
        was_idle = now >= self._busy_until
        self._busy_until = max(now, self._busy_until) + len(pcm) / BYTES_PER_SEC
        self._wav.writeframes(pcm)
        if was_idle and self.on_first_sample:
            self.on_first_sample()

    def stop(self) -> None:
        self._busy_until = 0.0

    async def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._wav.close()
