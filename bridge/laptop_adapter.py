"""Laptop microphone and speaker, so everyone can test the bridge without the robot.

Needs the optional package `sounddevice`:  pip install sounddevice
Use headphones: a laptop speaker next to its microphone makes the agent hear itself.
"""
from __future__ import annotations

import asyncio
import threading
from typing import Optional

from .core import CHUNK_BYTES, RATE, AudioSink, AudioSource

MAX_WAITING_CHUNKS = 20          # about 2 s of mic audio; older audio is dropped


class LaptopAudioMissing(RuntimeError):
    """sounddevice (or PortAudio) is not installed."""


class LaptopAdapter(AudioSource, AudioSink):
    """One object that is both the microphone and the speaker."""

    def __init__(self, input_device=None, output_device=None):
        self.input_device = input_device or None      # None = the system default
        self.output_device = output_device or None
        self._queue: Optional[asyncio.Queue] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._buf = bytearray()
        self._lock = threading.Lock()
        self._playing = False
        self._streams = []

    async def start(self) -> None:
        try:
            import sounddevice as sd
        except (ImportError, OSError) as exc:
            raise LaptopAudioMissing(
                "The laptop adapter needs the 'sounddevice' package (%s). Install it with: "
                "pip install sounddevice" % exc) from exc
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue()
        mic = sd.RawInputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=CHUNK_BYTES // 2,
                                device=self.input_device, callback=self._on_input)
        speaker = sd.RawOutputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=800,
                                     device=self.output_device, callback=self._on_output)
        self._streams = [mic, speaker]
        for stream in self._streams:
            stream.start()

    async def close(self) -> None:
        streams, self._streams = self._streams, []
        for stream in streams:
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass

    # ----------------------------------------------------------------- microphone
    def _on_input(self, indata, frames, time_info, status):      # runs in the audio thread
        self._loop.call_soon_threadsafe(self._push, bytes(indata))

    def _push(self, chunk: bytes):
        if self._queue.qsize() >= MAX_WAITING_CHUNKS:
            self._queue.get_nowait()                            # drop the oldest
        self._queue.put_nowait(chunk)

    async def read_chunk(self) -> Optional[bytes]:
        return await self._queue.get()

    # -------------------------------------------------------------------- speaker
    def _on_output(self, outdata, frames, time_info, status):    # runs in the audio thread
        wanted = frames * 2
        with self._lock:
            chunk = bytes(self._buf[:wanted])
            del self._buf[:wanted]
        outdata[:len(chunk)] = chunk
        outdata[len(chunk):] = bytes(wanted - len(chunk))
        if chunk and not self._playing:
            self._playing = True
            if self.on_first_sample:
                self.on_first_sample()
        elif not chunk:
            self._playing = False

    def play(self, pcm: bytes) -> None:
        with self._lock:
            self._buf += pcm

    def stop(self) -> None:
        with self._lock:
            self._buf.clear()
