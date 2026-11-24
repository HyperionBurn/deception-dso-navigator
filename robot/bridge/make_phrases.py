#!/usr/bin/env python3
"""Pre-render the bridge's local fallback phrases to 16 kHz PCM clips.

The bridge plays these with no network: on CONNECTION LOST, on reconnect,
and when the agent stalls mid-turn (see PhrasePlayer/StallWatcher).

  python make_phrases.py                    # key from ../../app/.env.local
  ELEVENLABS_API_KEY=... python make_phrases.py

Writes phrases/*.pcm next to this script. The clips are committed — re-run
only when the voice or wording changes.
"""

import json
import os
import sys
import urllib.request
from array import array

VOICE = 'EXAVITQu4vr4xnSDxMaL'
MODELS = ('eleven_v4_turbo', 'eleven_multilingual_v2')
PHRASES = {
    'lost_en': 'Operator, stop. Stay where you are. I lost my connection.',
    'lost_ar': 'لحظة، انقطع الاتصال، بنكمل بعد شوي.',
    'back_en': "I'm back. Operator, tell me which sign you can see.",
    'wait_en': 'One moment.',
}
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'phrases')
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '..', '..', 'app', '.env.local')


def load_key():
    key = os.environ.get('ELEVENLABS_API_KEY', '').strip()
    if key:
        return key
    try:
        with open(ENV_FILE, encoding='utf-8') as fh:
            for line in fh:
                if line.startswith('ELEVENLABS_API_KEY='):
                    return line.split('=', 1)[1].strip().strip('"')
    except OSError:
        pass
    sys.exit('no ElevenLabs key: set ELEVENLABS_API_KEY or create app/.env.local')


def tts(key, text):
    for model in MODELS:
        request = urllib.request.Request(
            f'https://api.elevenlabs.io/v1/text-to-speech/{VOICE}'
            '?output_format=pcm_16000',
            data=json.dumps({'text': text, 'model_id': model}).encode('utf-8'),
            headers={'xi-api-key': key, 'content-type': 'application/json'},
            method='POST')
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read(), model
        except urllib.error.HTTPError as error:
            if model == MODELS[-1]:
                raise
            print(f'  {model}: HTTP {error.code}, trying next model')


def loud_stats(pcm):
    samples = array('h')
    samples.frombytes(pcm[:len(pcm) - len(pcm) % 2])
    peak = max((abs(v) for v in samples), default=0)
    return peak, len(samples) / 16000


def main():
    key = load_key()
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, text in PHRASES.items():
        pcm, model = tts(key, text)
        peak, seconds = loud_stats(pcm)
        if peak < 1000 or seconds < 0.3:
            sys.exit(f'{name}: clip looks silent/short '
                     f'(peak {peak}, {seconds:.2f}s) — not writing')
        path = os.path.join(OUT_DIR, name + '.pcm')
        with open(path, 'wb') as fh:
            fh.write(pcm)
        print(f'{name}: {seconds:.2f}s, peak {peak}, model {model} -> {path}')


if __name__ == '__main__':
    main()
