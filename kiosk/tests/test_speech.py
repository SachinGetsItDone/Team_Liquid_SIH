"""Speech-lane tests: real Module A ASR + TTS wired through the kiosk API.

The ASR round-trip test synthesizes speech with the OS TTS and transcribes it
with faster-whisper. It self-skips when either dependency or the model is
unavailable, so the suite stays green on a machine without the speech stack.
"""
from __future__ import annotations

import base64
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from kiosk import services as svc  # noqa: E402
from kiosk import store as store_mod  # noqa: E402
from kiosk.server import app  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "STORE", store_mod.SessionStore(tmp_path / "sessions"))
    monkeypatch.setattr(store_mod, "sessions_dir", lambda: tmp_path / "sessions")
    monkeypatch.setattr(svc, "STORE", store_mod.STORE)
    return TestClient(app)


def _caps(client):
    return client.get("/api/speech").json()


def _session(client) -> str:
    return client.post("/api/sessions", json={
        "language": "en", "respondent": {"role": "patient"},
        "visit": {"type": "new"}, "notice_acknowledged": True,
    }).json()["session_id"]


def test_speech_capabilities_shape(client):
    caps = _caps(client)
    assert set(caps) >= {"asr", "tts", "auto_speak_default"}
    assert caps["asr"]["engine"] == "faster-whisper"


def test_tts_returns_wav(client):
    caps = _caps(client)
    if not caps["tts"]["available"]:
        pytest.skip("OS TTS unavailable")
    res = client.post("/api/speech/tts", json={"text": "Please take a seat.", "lang": "en"})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("audio/wav")
    assert res.content[:4] == b"RIFF"
    assert len(res.content) > 1000


def test_tts_rejects_empty_and_overlong(client):
    assert client.post("/api/speech/tts", json={"text": "", "lang": "en"}).status_code == 422
    assert client.post("/api/speech/tts",
                       json={"text": "x" * 700, "lang": "en"}).status_code == 413


def test_asr_round_trip(client):
    caps = _caps(client)
    if not (caps["asr"]["available"] and caps["tts"]["available"]):
        pytest.skip("speech stack unavailable")
    tts = client.post("/api/speech/tts",
                      json={"text": "I have chest pain and I feel breathless", "lang": "en"})
    assert tts.status_code == 200
    audio_b64 = base64.b64encode(tts.content).decode()
    sid = _session(client)
    res = client.post(f"/api/sessions/{sid}/asr", json={"audio_b64": audio_b64})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["engine"] == "faster-whisper"
    text = body["text"].lower()
    assert "chest" in text or "breathless" in text or "pain" in text


def test_asr_rejects_bad_audio(client):
    sid = _session(client)
    assert client.post(f"/api/sessions/{sid}/asr", json={"audio_b64": ""}).status_code == 422
    assert client.post(f"/api/sessions/{sid}/asr", json={"audio_b64": "!!!"}).status_code == 422
