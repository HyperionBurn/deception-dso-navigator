"""Entry point: settings, signed URLs, laptop adapter message, command line. All offline."""
import asyncio
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from bridge import __main__ as entry
from bridge.core import Config
from bridge.laptop_adapter import LaptopAdapter, LaptopAudioMissing

BRIDGE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BRIDGE_DIR.parent

GOOD_URL = "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_1&conversation_signature=abc"


# ---------------------------------------------------------------------- settings
def test_example_config_loads_and_holds_no_secrets():
    text = (BRIDGE_DIR / "config.example.json").read_text(encoding="utf-8")
    data = json.loads(text)
    config, extras = entry.load_settings(str(BRIDGE_DIR / "config.example.json"), env={})
    assert isinstance(config, Config) and config.mic_gate == "none"
    assert extras["site_url"].startswith("https://")
    for key in data:
        assert not any(word in key.lower() for word in ("key", "secret", "token", "access_code", "password"))
    assert "xi-api-key" not in text.lower() and "sk_" not in text


def test_environment_overrides_the_config_file(tmp_path):
    path = tmp_path / "c.json"
    path.write_text(json.dumps({"quiet_end_s": 11, "mic_gate": "none"}))
    config, _ = entry.load_settings(str(path), env={"BRIDGE_QUIET_END_S": "7",
                                                    "BRIDGE_ALLOW_UNREVIEWED_PHRASES": "yes",
                                                    "BRIDGE_WS_PING_INTERVAL_S": "none",
                                                    "BRIDGE_ROUTE_TOOLS": "a,b"})
    assert config.quiet_end_s == 7.0 and config.allow_unreviewed_phrases is True
    assert config.ws_ping_interval_s is None and config.route_tools == ("a", "b")


def test_organiser_style_variables_still_work():
    config, extras = entry.load_settings(None, env={"HALF_DUPLEX": "1", "MIC_STREAM": "2"})
    assert config.mic_gate == "half_duplex" and extras["ros_mic_stream"] == 2


def test_a_typo_in_the_config_file_is_an_error(tmp_path):
    path = tmp_path / "c.json"
    path.write_text(json.dumps({"quiet_end": 5}))
    with pytest.raises(ValueError, match="quiet_end"):
        entry.load_settings(str(path), env={})


# -------------------------------------------------------------------- signed URLs
def test_signed_url_check_accepts_only_the_real_endpoint():
    assert entry.check_signed_url(GOOD_URL) == GOOD_URL
    token_style = "wss://api.us.elevenlabs.io/v1/convai/conversation?agent_id=a&token=t"
    assert entry.check_signed_url(token_style) == token_style
    for bad in ("ws://api.elevenlabs.io/v1/convai/conversation?agent_id=a&token=t",
                "wss://evil.example/v1/convai/conversation?agent_id=a&token=t",
                "wss://api.elevenlabs.io/other?agent_id=a&token=t",
                "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=a",
                "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=a&token=t&x=1",
                "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=a&token=t t",
                "wss://user:pw@api.elevenlabs.io/v1/convai/conversation?agent_id=a&token=t",
                "", None):
        with pytest.raises(entry.UrlError):
            entry.check_signed_url(bad)


class FakeSite(BaseHTTPRequestHandler):
    seen = {}
    reply = (200, {"signed_url": GOOD_URL})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeSite.seen = {"path": self.path, "origin": self.headers.get("Origin"),
                         "type": self.headers.get("Content-Type"), "body": body}
        status, payload = FakeSite.reply
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


@pytest.fixture
def site():
    server = HTTPServer(("127.0.0.1", 0), FakeSite)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield "http://127.0.0.1:%d" % server.server_address[1]
    server.shutdown()


def test_site_path_posts_the_access_code_with_the_sites_own_origin(site):
    FakeSite.reply = (200, {"signed_url": GOOD_URL})
    url = entry.fetch_signed_url_from_site(site, "team-code")
    assert url == GOOD_URL
    assert FakeSite.seen["path"] == "/api/session"
    assert FakeSite.seen["origin"] == site                      # session.mjs insists on this
    assert FakeSite.seen["type"] == "application/json"
    assert FakeSite.seen["body"] == {"access_code": "team-code"}


def test_site_path_reports_a_rejected_code_and_a_bad_answer(site):
    FakeSite.reply = (401, {"error": "Invalid access code."})
    with pytest.raises(entry.UrlError, match="access code"):
        entry.fetch_signed_url_from_site(site, "wrong")
    FakeSite.reply = (200, {"signed_url": "wss://evil.example/x"})
    with pytest.raises(entry.UrlError):
        entry.fetch_signed_url_from_site(site, "team-code")


def test_direct_api_path_uses_the_key_header(monkeypatch):
    seen = {}

    class Reply:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return json.dumps({"signed_url": GOOD_URL}).encode()

    def fake_urlopen(request, timeout=None):
        seen["url"] = request.full_url
        seen["key"] = {k.lower(): v for k, v in request.header_items()}.get("xi-api-key")
        return Reply()

    monkeypatch.setattr(entry.urllib.request, "urlopen", fake_urlopen)
    assert entry.fetch_signed_url_from_api("agent_1", "THE-KEY") == GOOD_URL
    assert seen["url"] == ("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url"
                           "?agent_id=agent_1")
    assert seen["key"] == "THE-KEY"


def test_url_provider_prefers_the_site_then_the_key_then_a_public_agent():
    assert entry.choose_url_source({"BRIDGE_ACCESS_CODE": "c", "ELEVENLABS_API_KEY": "k",
                                    "ELEVENLABS_AGENT_ID": "a"}) == "site"
    assert entry.choose_url_source({"ELEVENLABS_API_KEY": "k", "ELEVENLABS_AGENT_ID": "a"}) == "api"
    assert entry.choose_url_source({"ELEVENLABS_AGENT_ID": "a"}) == "public"
    with pytest.raises(entry.UrlError, match="BRIDGE_ACCESS_CODE"):
        entry.choose_url_source({})
    provider = entry.make_url_provider({"ELEVENLABS_AGENT_ID": "agent_9"}, entry.DEFAULT_SITE)
    assert asyncio.run(provider()) == \
        "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_9"


# ----------------------------------------------------------------- laptop adapter
def test_laptop_adapter_explains_what_to_install(monkeypatch):
    monkeypatch.setitem(sys.modules, "sounddevice", None)       # None makes "import" fail
    with pytest.raises(LaptopAudioMissing, match="pip install sounddevice"):
        asyncio.run(LaptopAdapter().start())


# ------------------------------------------------------------------ command line
def test_command_line_help_and_latency_summary(tmp_path, capsys):
    done = subprocess.run([sys.executable, "-m", "bridge", "--help"], cwd=str(REPO_ROOT),
                          capture_output=True, text=True)
    assert done.returncode == 0 and "--adapter" in done.stdout
    csv_path = tmp_path / "latency.csv"
    csv_path.write_text("turn,end_to_audio_ms,audio_to_play_ms,end_to_play_ms\n1,900,100,1000\n"
                        "2,1900,100,2000\n", encoding="utf-8")
    assert entry.main(["--latency-summary", str(csv_path)]) == 0
    out = capsys.readouterr().out
    assert "median 1500 ms" in out and "worst 2000 ms" in out


def test_a_setup_mistake_gives_a_clear_error_not_a_traceback(monkeypatch, capsys):
    for name in ("BRIDGE_ACCESS_CODE", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"):
        monkeypatch.delenv(name, raising=False)
    assert entry.main(["--adapter", "laptop"]) == 2
    assert "BRIDGE_ACCESS_CODE" in capsys.readouterr().err


# --------------------------------------------------- robot defaults (raw mic, half duplex)
def test_robot_defaults_are_the_raw_mic_and_half_duplex():
    config, extras = entry.load_settings(None, env={}, adapter="ros")
    assert config.mic_gate == "half_duplex" and extras["ros_mic_source"] == "raw"


def test_other_adapters_keep_the_open_mic():
    for adapter in (None, "laptop", "wav"):
        config, _ = entry.load_settings(None, env={}, adapter=adapter)
        assert config.mic_gate == "none"


def test_the_example_config_gives_the_robot_defaults_and_the_laptop_an_open_mic():
    path = str(BRIDGE_DIR / "config.example.json")
    config, extras = entry.load_settings(path, env={}, adapter="ros")
    assert config.mic_gate == "half_duplex" and extras["ros_mic_source"] == "raw"
    config, _ = entry.load_settings(path, env={}, adapter="laptop")
    assert config.mic_gate == "none"


def test_config_file_and_environment_can_change_the_robot_defaults(tmp_path):
    path = tmp_path / "c.json"
    path.write_text(json.dumps({"mic_gate": "none", "ros_mic_source": "wake_word"}))
    config, extras = entry.load_settings(str(path), env={}, adapter="ros")
    assert config.mic_gate == "none" and extras["ros_mic_source"] == "wake_word"
    config, extras = entry.load_settings(None, env={"BRIDGE_MIC_GATE": "none",
                                                    "BRIDGE_ROS_MIC_SOURCE": "wake_word"}, adapter="ros")
    assert config.mic_gate == "none" and extras["ros_mic_source"] == "wake_word"


def test_organiser_half_duplex_variable_works_both_ways_on_the_robot():
    config, _ = entry.load_settings(None, env={"HALF_DUPLEX": "1"}, adapter="ros")
    assert config.mic_gate == "half_duplex"
    config, _ = entry.load_settings(None, env={"HALF_DUPLEX": "0"}, adapter="ros")
    assert config.mic_gate == "none"
    # our own variable is stronger than the organisers' one
    config, _ = entry.load_settings(None, env={"HALF_DUPLEX": "0", "BRIDGE_MIC_GATE": "half_duplex"},
                                    adapter="ros")
    assert config.mic_gate == "half_duplex"


def test_the_ros_adapter_is_built_with_the_chosen_mic_source():
    extras = dict(entry.EXTRA_DEFAULTS)
    source, sink = entry.build_adapters("ros", extras)
    assert source is sink and source.mic_source == "raw"
    extras["ros_mic_source"] = "wake_word"
    assert entry.build_adapters("ros", extras)[0].mic_source == "wake_word"


def test_a_wrong_mic_source_is_a_clear_start_error(monkeypatch, capsys):
    monkeypatch.setenv("BRIDGE_ACCESS_CODE", "team-code")
    monkeypatch.setenv("BRIDGE_ROS_MIC_SOURCE", "loud")
    assert entry.main(["--adapter", "ros"]) == 2
    assert "mic_source" in capsys.readouterr().err


def test_the_command_line_uses_the_robot_defaults_for_the_ros_adapter(monkeypatch):
    for name in ("BRIDGE_MIC_GATE", "HALF_DUPLEX", "BRIDGE_ROS_MIC_SOURCE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("BRIDGE_ACCESS_CODE", "team-code")
    seen = {}

    class StopAtOnce:
        def __init__(self, source, sink, provider, config, **hooks):
            seen["config"] = config

        async def run(self):
            pass

        def stop(self):
            pass

    monkeypatch.setattr(entry, "SessionCore", StopAtOnce)
    assert entry.main(["--adapter", "ros"]) == 0
    assert seen["config"].mic_gate == "half_duplex"
