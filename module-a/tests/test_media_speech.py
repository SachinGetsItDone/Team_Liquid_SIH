"""Speech I/O tests: mic recorder, WAV codec, offline ASR, TTS, voice loop."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pytest

from media.adapters import ASRResult, RecordingTTS
from media.config import MediaConfig
from media.session import HistorySession
from media.speech import (FasterWhisperASR, MicrophoneRecorder, SystemTTS,
                          _to_wav, list_input_devices, wav_to_float32)
from media.voice import run_voice_session


# ------------------------------------------------------------------ devices

def test_lists_input_devices():
    try:
        devices = list_input_devices()
    except Exception as exc:                      # no PortAudio / no audio
        pytest.skip(f"sounddevice unavailable: {exc}")
    assert all(d["channels"] >= 1 for d in devices)


# --------------------------------------------------------------- WAV codec

def test_wav_round_trip():
    samples = (0.1 * np.sin(np.linspace(0, 20, 16000))).astype("float32")
    wav = _to_wav(samples, 16000)
    back = wav_to_float32(wav, 16000)
    assert len(back) == len(samples)
    assert np.max(np.abs(back - samples)) < 0.01


def test_wav_resamples_to_16k():
    samples = np.zeros(44100, dtype="float32")
    back = wav_to_float32(_to_wav(samples, 44100), 16000)
    assert abs(len(back) - 16000) <= 50


# ------------------------------------------------------------- mic recorder

def test_microphone_recorder_stops_on_silence(monkeypatch):
    speech = [np.full(480, 0.2, dtype="float32") for _ in range(4)]
    quiet = [np.zeros(480, dtype="float32") for _ in range(8)]

    class FakeStream:
        def __init__(self, blocks):
            self._blocks = iter(blocks)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self, n):
            try:
                return next(self._blocks), False
            except StopIteration:
                return np.zeros(n, dtype="float32"), False

    rec = MicrophoneRecorder(energy_threshold=0.05, block_ms=30)
    monkeypatch.setattr(rec, "_open_stream",
                        lambda: FakeStream(speech + quiet))
    wav = rec.record(max_seconds=5.0, silence_seconds=0.06)
    assert len(wav) > 44


# ---------------------------------------------------------------- voice loop

class _ScriptedRecorder:
    def record(self, max_seconds: float = 15.0, **kw) -> bytes:
        return b"fake-wav"


class _ScriptedASR:
    """Returns canned transcripts in order."""
    def __init__(self, texts):
        self._texts = list(texts)

    def transcribe(self, audio) -> ASRResult:
        text = self._texts.pop(0) if self._texts else ""
        return ASRResult(text=text, conf=0.9)


def test_voice_loop_speaks_and_records():
    tts = RecordingTTS()
    session = HistorySession(session_id="A-VOICE", consent_ref="tok",
                             tts=tts, config=MediaConfig(language="en"))
    asr = _ScriptedASR(["I have chest pain and breathlessness", "chest pain"])
    events = run_voice_session(session, asr, _ScriptedRecorder(), tts,
                               max_turns=2)
    # max_turns counts answered turns; a red-flag acknowledgement turn is extra
    answered = [e for e in events if e.turn != "ack"]
    assert len(answered) == 2
    assert answered[0].heard.startswith("I have chest pain")
    assert tts.spoken                              # prompts were spoken
    assert session.fsm.cursor >= 1


def test_voice_loop_handles_red_flag_ack():
    tts = RecordingTTS()
    session = HistorySession(session_id="A-VOICE-RF", consent_ref="tok",
                             tts=tts, config=MediaConfig(language="en"))
    # first answer triggers RF-2; loop must speak the alert and acknowledge
    asr = _ScriptedASR(["seene mein dard and saans phool", "ok", "bangalore"])
    events = run_voice_session(session, asr, _ScriptedRecorder(), tts,
                               max_turns=3)
    assert any(e.turn == "ack" for e in events)
    assert session.red_flag_acknowledged is True


# ----------------------------------------------------------------- real TTS

def test_system_tts_synthesizes_wav(tmp_path):
    try:
        import pyttsx3  # noqa: F401
    except Exception as exc:
        pytest.skip(f"pyttsx3 unavailable: {exc}")
    out = tmp_path / "t.wav"
    try:
        SystemTTS().synthesize_to_wav("hello kiosk", str(out))
    except Exception as exc:
        pytest.skip(f"no TTS voice available: {exc}")
    assert out.exists() and out.stat().st_size > 1000


# -------------------------------------------------------------- real ASR

def test_faster_whisper_round_trip(tmp_path):
    try:
        import faster_whisper  # noqa: F401
        import soundfile  # noqa: F401
    except Exception as exc:
        pytest.skip(f"faster-whisper unavailable: {exc}")
    wav = tmp_path / "speech.wav"
    try:
        SystemTTS().synthesize_to_wav(
            "the patient has chest pain and shortness of breath", str(wav))
    except Exception as exc:
        pytest.skip(f"no TTS voice available: {exc}")
    try:
        asr = FasterWhisperASR(model_size="tiny")
        result = asr.transcribe(wav.read_bytes())
    except Exception as exc:
        pytest.skip(f"whisper model unavailable (offline/undownloaded): {exc}")
    text = result.text.lower()
    assert "chest pain" in text and result.conf is not None
