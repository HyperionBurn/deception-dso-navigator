"""Render the local fallback phrases with the ElevenLabs text-to-speech REST API.

Run it by hand, once, with a real key (it is NOT run by the tests):

    set ELEVENLABS_API_KEY=...          (Windows)    export ELEVENLABS_API_KEY=...   (Linux)
    python -m bridge.render_phrases --voice-id <the agent's voice id>

It reads bridge/phrases.json and writes one raw PCM file (16 kHz, mono, 16-bit, little-endian)
per phrase into bridge/phrases/. Only phrases with "reviewed": true are rendered, unless you
pass --include-unreviewed. Use the same voice as the live agent so the hand-over is not jarring.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://api.elevenlabs.io"
DEFAULT_MODEL = "eleven_flash_v2_5"   # a guess: set --model to the model your agent's voice uses


class RenderError(RuntimeError):
    pass


def select_phrases(phrases, include_unreviewed: bool = False):
    """Only phrases that a person has checked, unless told otherwise."""
    return [p for p in phrases if include_unreviewed or p.get("reviewed")]


def fetch_tts_pcm(text: str, voice_id: str, api_key: str, model_id: str, lang: str = "") -> bytes:
    """One text-to-speech call. Returns raw PCM, 16 kHz."""
    url = "%s/v1/text-to-speech/%s?output_format=pcm_16000" % (API, urllib.parse.quote(voice_id, safe=""))
    body = {"text": text, "model_id": model_id}
    if lang and "multilingual_v2" not in model_id:      # that model has no language_code field
        body["language_code"] = lang
    request = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/pcm"})
    try:
        with urllib.request.urlopen(request, timeout=60) as reply:
            return reply.read()
    except urllib.error.HTTPError as exc:
        raise RenderError("ElevenLabs answered HTTP %d for %r" % (exc.code, text)) from None
    except (urllib.error.URLError, OSError) as exc:
        raise RenderError("cannot reach ElevenLabs: %s" % exc) from None


def render_all(json_path: str, out_dir: str, voice_id: str, api_key: str, model_id: str,
               include_unreviewed: bool = False, fetch=fetch_tts_pcm):
    """Render the selected phrases into out_dir. Returns the list of files written."""
    with open(json_path, encoding="utf-8") as f:
        phrases = select_phrases(json.load(f), include_unreviewed)
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for phrase in phrases:
        pcm = fetch(phrase["text"], voice_id, api_key, model_id, phrase["lang"])
        if not pcm or len(pcm) % 2:
            raise RenderError("got empty or odd-sized audio for %s/%s: not 16-bit PCM"
                              % (phrase["id"], phrase["lang"]))
        path = os.path.join(out_dir, phrase["file"])
        with open(path, "wb") as f:
            f.write(pcm)
        written.append(path)
    return written


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Render the fallback phrases to 16 kHz PCM files.")
    parser.add_argument("--voice-id", default=os.environ.get("ELEVENLABS_VOICE_ID", ""),
                        help="voice id (or set ELEVENLABS_VOICE_ID)")
    parser.add_argument("--model", default=os.environ.get("ELEVENLABS_TTS_MODEL", DEFAULT_MODEL))
    parser.add_argument("--phrases-json", default=os.path.join(HERE, "phrases.json"))
    parser.add_argument("--out-dir", default=os.path.join(HERE, "phrases"))
    parser.add_argument("--include-unreviewed", action="store_true",
                        help="also render phrases not marked reviewed (check them by ear first)")
    parser.add_argument("--dry-run", action="store_true", help="only list what would be rendered")
    args = parser.parse_args(argv)

    if args.dry_run:
        with open(args.phrases_json, encoding="utf-8") as f:
            for p in select_phrases(json.load(f), args.include_unreviewed):
                print("%s/%s -> %s: %s" % (p["id"], p["lang"], p["file"], p["text"]))
        return 0
    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Set the ELEVENLABS_API_KEY environment variable first.")
    if not args.voice_id.strip():
        raise SystemExit("Give a voice: --voice-id <id> or the ELEVENLABS_VOICE_ID variable.")
    try:
        files = render_all(args.phrases_json, args.out_dir, args.voice_id.strip(), api_key,
                           args.model, args.include_unreviewed)
    except RenderError as exc:
        print("ERROR:", exc, file=sys.stderr)
        return 2
    for path in files:
        print("wrote", path, "(%.1f s)" % (os.path.getsize(path) / 32000))
    return 0


if __name__ == "__main__":
    sys.exit(main())
