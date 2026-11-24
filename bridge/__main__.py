"""Start the bridge:  python -m bridge --adapter laptop|wav|ros [--config bridge/config.example.json]

Settings come from the config file, then from environment variables named BRIDGE_<SETTING>
(for example BRIDGE_QUIET_END_S=30). Secrets are only ever read from the environment:

    BRIDGE_ACCESS_CODE    the team access code. The bridge asks the team website for a signed URL,
                          so the ElevenLabs key never sits on the robot PC (preferred).
    ELEVENLABS_AGENT_ID   + ELEVENLABS_API_KEY: ask ElevenLabs for the signed URL directly (fallback).
    ELEVENLABS_AGENT_ID   alone: a public agent, no key needed.

The organisers' names still work: HALF_DUPLEX=1 (or 0), MIC_STREAM=1|2, VERBOSE=1.

With --adapter ros the defaults are the raw microphone (ros_mic_source = raw) and half duplex
(mic_gate = half_duplex), because the raw mic has no echo cancellation. The config file and the
BRIDGE_* variables can change both. Other adapters keep mic_gate = none.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import signal
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import fields

from .core import (Config, FormatError, SessionCore, format_latency_summary,
                   summarize_latency_csv)
from .laptop_adapter import LaptopAudioMissing
from .ros_adapter import RosNotAvailable, UnsafeNameError
from .wav_replay import WavFormatError

log = logging.getLogger("bridge")

DEFAULT_SITE = "https://deception-dso-navigator.vercel.app"
PUBLIC_SOCKET = "wss://api.elevenlabs.io/v1/convai/conversation"
SIGNED_URL_HOSTS = {"api.elevenlabs.io", "api.us.elevenlabs.io", "api.eu.residency.elevenlabs.io",
                    "api.in.residency.elevenlabs.io", "api.sg.residency.elevenlabs.io"}

# Settings that belong to the adapters and the start-up, not to SessionCore.
EXTRA_DEFAULTS = {"site_url": DEFAULT_SITE, "ros_mic_source": "raw", "ros_mic_stream": 0,
                  "ros_lead_s": 0.3, "wav_in": "", "wav_out": "out.wav", "wav_realtime": True,
                  "laptop_input_device": "", "laptop_output_device": ""}

# Config defaults that apply only with --adapter ros. They sit below the config file and the
# BRIDGE_* variables. (The raw mic has no echo cancellation, so the robot must not hear itself.)
ROBOT_CONFIG_DEFAULTS = {"mic_gate": "half_duplex"}


class SetupError(RuntimeError):
    """A start-up mistake the person can fix (missing variable, bad file ...)."""


class UrlError(SetupError):
    """Could not get a valid WebSocket URL."""


# ----------------------------------------------------------------------- settings
def _parse_like(default, text: str):
    """Turn an environment string into the same type as the default value."""
    if isinstance(default, bool):
        return text.strip().lower() in ("1", "true", "yes", "on")
    if text.strip().lower() == "none" and not isinstance(default, str):
        return None                       # "none" means "off" for numbers; for text it is a value (mic_gate)
    if isinstance(default, int):
        return int(text)
    if isinstance(default, float):
        return float(text)
    if isinstance(default, tuple):
        return tuple(part.strip() for part in text.split(",") if part.strip())
    return text


def load_settings(config_path, env=None, adapter=None):
    """Returns (Config, extras). Defaults < robot defaults (adapter "ros" only) < config file
    < BRIDGE_* environment variables."""
    env = os.environ if env is None else env
    config_defaults = {f.name: f.default for f in fields(Config)}
    file_values = {}
    if config_path:
        with open(config_path, encoding="utf-8") as f:
            file_values = json.load(f)
    unknown = sorted(set(file_values) - set(config_defaults) - set(EXTRA_DEFAULTS))
    if unknown:
        raise ValueError("unknown config key(s): " + ", ".join(unknown))
    config_values = dict(ROBOT_CONFIG_DEFAULTS) if adapter == "ros" else {}
    config_values.update({k: v for k, v in file_values.items() if k in config_defaults})
    extras = dict(EXTRA_DEFAULTS)
    extras.update({k: v for k, v in file_values.items() if k in EXTRA_DEFAULTS})

    for name, default in config_defaults.items():
        text = env.get("BRIDGE_" + name.upper(), "")
        if text.strip():
            config_values[name] = _parse_like(default, text)
    for name, default in EXTRA_DEFAULTS.items():
        text = env.get("BRIDGE_" + name.upper(), "")
        if text.strip():
            extras[name] = _parse_like(default, text)
    # The organisers' own variable names.
    if not env.get("BRIDGE_MIC_GATE", "").strip():
        if env.get("HALF_DUPLEX", "") == "1":
            config_values["mic_gate"] = "half_duplex"
        elif env.get("HALF_DUPLEX", "") == "0":
            config_values["mic_gate"] = "none"          # switch the robot default off
    if env.get("MIC_STREAM", "").strip() and not env.get("BRIDGE_ROS_MIC_STREAM", "").strip():
        extras["ros_mic_stream"] = int(env["MIC_STREAM"])
    return Config.from_dict(config_values), extras


# ------------------------------------------------------------------- signed URLs
def check_signed_url(url) -> str:
    """Accept only a real ElevenLabs conversation URL (same rules as signedSocketUrl in voice.mjs),
    so a wrong answer from the website cannot send the robot's audio somewhere else."""
    if not isinstance(url, str) or not url or len(url) > 8192 or re.search(r"[\s\x00-\x1f#]", url):
        raise UrlError("the signed URL is missing or has bad characters")
    parts = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    names = [name for name, _ in query]
    signatures = [v for name, v in query if name in ("conversation_signature", "token")]
    agents = [v for name, v in query if name == "agent_id"]
    if (parts.scheme != "wss" or parts.hostname not in SIGNED_URL_HOSTS or parts.port is not None
            or parts.username or parts.password or parts.path != "/v1/convai/conversation"
            or len(query) != 2 or len(agents) != 1 or len(signatures) != 1
            or not agents[0] or not signatures[0] or len(set(names)) != 2):
        raise UrlError("the signed URL does not look like an ElevenLabs conversation URL")
    return url


def _read_signed_url(reply_bytes: bytes) -> str:
    try:
        data = json.loads(reply_bytes)
    except ValueError:
        raise UrlError("the answer was not JSON") from None
    if not isinstance(data, dict):
        raise UrlError("the answer was not a JSON object")
    return check_signed_url(data.get("signed_url") or data.get("signedUrl"))


def fetch_signed_url_from_site(site_url: str, access_code: str, timeout: float = 8) -> str:
    """Ask the team website (app/api/session.mjs) for a signed URL. It insists on an Origin header
    equal to its own address."""
    site = urllib.parse.urlsplit(site_url)
    origin = "%s://%s" % (site.scheme, site.netloc)
    request = urllib.request.Request(
        origin + "/api/session", data=json.dumps({"access_code": access_code}).encode(),
        method="POST", headers={"Content-Type": "application/json", "Origin": origin,
                                "User-Agent": "robot-bridge/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as reply:
            return _read_signed_url(reply.read())
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise UrlError("the team website rejected the access code "
                           "(check BRIDGE_ACCESS_CODE)") from None
        raise UrlError("the team website answered HTTP %d" % exc.code) from None
    except (urllib.error.URLError, OSError) as exc:
        raise UrlError("cannot reach the team website: %s" % exc) from None


def fetch_signed_url_from_api(agent_id: str, api_key: str, timeout: float = 8) -> str:
    """Fallback: ask ElevenLabs directly. The API key then has to be on this PC."""
    url = ("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id="
           + urllib.parse.quote(agent_id, safe=""))
    request = urllib.request.Request(url, headers={"xi-api-key": api_key})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as reply:
            return _read_signed_url(reply.read())
    except urllib.error.HTTPError as exc:
        raise UrlError("ElevenLabs answered HTTP %d when asked for a signed URL" % exc.code) from None
    except (urllib.error.URLError, OSError) as exc:
        raise UrlError("cannot reach ElevenLabs: %s" % exc) from None


def choose_url_source(env) -> str:
    if env.get("BRIDGE_ACCESS_CODE", "").strip():
        return "site"
    if env.get("ELEVENLABS_AGENT_ID", "").strip():
        return "api" if env.get("ELEVENLABS_API_KEY", "").strip() else "public"
    raise UrlError("No way to reach the agent. Set BRIDGE_ACCESS_CODE (the team access code, "
                   "preferred) or ELEVENLABS_AGENT_ID (with ELEVENLABS_API_KEY if the agent is private).")


def make_url_provider(env, site_url: str):
    """An async function that returns a fresh WebSocket URL for each new conversation."""
    source = choose_url_source(env)
    agent_id = env.get("ELEVENLABS_AGENT_ID", "").strip()
    if source == "site":
        code = env["BRIDGE_ACCESS_CODE"].strip()
        blocking = lambda: fetch_signed_url_from_site(site_url, code)           # noqa: E731
    elif source == "api":
        key = env["ELEVENLABS_API_KEY"].strip()
        blocking = lambda: fetch_signed_url_from_api(agent_id, key)             # noqa: E731
    else:
        public = PUBLIC_SOCKET + "?agent_id=" + urllib.parse.quote(agent_id, safe="")
        blocking = lambda: public                                               # noqa: E731

    async def provider() -> str:
        return await asyncio.get_running_loop().run_in_executor(None, blocking)
    return provider


# ------------------------------------------------------------------------- start
def build_adapters(name: str, extras: dict):
    """Returns (source, sink). The robot and laptop adapters are one object doing both."""
    if name == "ros":
        from .ros_adapter import RosAdapter
        adapter = RosAdapter(mic_stream=extras["ros_mic_stream"], lead_s=extras["ros_lead_s"],
                             mic_source=extras["ros_mic_source"])
        return adapter, adapter
    if name == "laptop":
        from .laptop_adapter import LaptopAdapter
        adapter = LaptopAdapter(extras["laptop_input_device"], extras["laptop_output_device"])
        return adapter, adapter
    from .wav_replay import WavSink, WavSource
    if not extras["wav_in"]:
        raise SetupError("The wav adapter needs an input file: --wav-in some.wav (16 kHz mono 16-bit).")
    return (WavSource(extras["wav_in"], realtime=extras["wav_realtime"]),
            WavSink(extras["wav_out"]))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m bridge", description="Audio bridge between the robot and the ElevenLabs agent.")
    parser.add_argument("--adapter", choices=["laptop", "wav", "ros"],
                        help="laptop = laptop mic and speaker, wav = replay a file, ros = the robot")
    parser.add_argument("--config", help="JSON settings file, e.g. bridge/config.example.json")
    parser.add_argument("--wav-in", help="wav adapter: input file (16 kHz mono 16-bit)")
    parser.add_argument("--wav-out", help="wav adapter: where to write the agent's audio")
    parser.add_argument("--fast", action="store_true", help="wav adapter: replay faster than real time")
    parser.add_argument("--latency-summary", metavar="CSV",
                        help="print median and worst case from a latency CSV and exit")
    parser.add_argument("--verbose", action="store_true", help="show debug messages")
    args = parser.parse_args(argv)

    if args.latency_summary:
        try:
            print(format_latency_summary(summarize_latency_csv(args.latency_summary)))
        except OSError as exc:
            print("ERROR:", exc, file=sys.stderr)
            return 2
        return 0
    if not args.adapter:
        parser.error("choose an adapter: --adapter laptop|wav|ros")

    logging.basicConfig(level=logging.DEBUG if args.verbose or os.environ.get("VERBOSE") == "1"
                        else logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        datefmt="%H:%M:%S")
    try:
        config, extras = load_settings(args.config, adapter=args.adapter)
        if args.wav_in:
            extras["wav_in"] = args.wav_in
        if args.wav_out:
            extras["wav_out"] = args.wav_out
        if args.fast:
            extras["wav_realtime"] = False
        provider = make_url_provider(os.environ, extras["site_url"])
        source, sink = build_adapters(args.adapter, extras)
    except (SetupError, ValueError, OSError) as exc:
        print("ERROR:", exc, file=sys.stderr)
        return 2

    core = SessionCore(source, sink, provider, config,
                       on_user_text=lambda text: log.info("visitor: %s", text),
                       on_agent_text=lambda text: log.info("robot: %s", text))
    for name in ("SIGINT", "SIGTERM"):
        try:
            signal.signal(getattr(signal, name), lambda *_: core.stop())
        except (ValueError, AttributeError):
            pass                                  # not in the main thread, or no such signal here
    try:
        asyncio.run(core.run())
    except (FormatError, SetupError, RosNotAvailable, LaptopAudioMissing, WavFormatError,
            UnsafeNameError, OSError) as exc:
        print("ERROR:", exc, file=sys.stderr)
        return 2
    if config.latency_csv and os.path.exists(config.latency_csv):
        print(format_latency_summary(summarize_latency_csv(config.latency_csv)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
