"""Adapter tests: subprocess ASR/TTS runtime path, VAD, ring buffer, audio turn."""
from __future__ import annotations

import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from media.adapters import (ASRResult, AudioRingBuffer, EnergyVAD,
                            ScriptedASR, SherpaTTS, SubprocessASR,
                            SubprocessTTS, WhisperCppASR, make_asr, make_tts)
from media.config import MediaConfig
from media.session import HistorySession


def _pcm(*samples: int) -> bytes:
    return struct.pack("<" + "h" * len(samples), *samples)


# ------------------------------------------------------------------ subprocess

def test_subprocess_asr_runs_command_and_parses_stdout():
    seen = {}

    def fake_runner(argv, stdin=None):
        seen["argv"] = argv
        assert Path(argv[argv.index("-f") + 1]).exists()   # temp wav written
        return "[00:00.000 --> 00:02.000]  seene mein dard\n[00:02.000] saans phool"

    asr = SubprocessASR(("whisper-cli", "-m", "{model}", "-f", "{wav}", "-l", "{lang}"),
                        model_path="m.bin", language="hi", runner=fake_runner)
    result = asr.transcribe(b"RIFFfakewav")
    assert result.text == "seene mein dard saans phool"
    assert seen["argv"][0] == "whisper-cli"
    assert "m.bin" in seen["argv"] and "hi" in seen["argv"]


def test_subprocess_asr_missing_binary_is_honest():
    asr = SubprocessASR(("definitely-not-a-real-binary-xyz", "{wav}"))
    with pytest.raises(RuntimeError) as exc:
        asr.transcribe(b"x")
    assert "not found" in str(exc.value)


def test_whispercpp_requires_model_path():
    with pytest.raises(RuntimeError):
        WhisperCppASR(model_path=None).transcribe(b"x")


def test_whispercpp_delegates_with_fake_runner():
    asr = WhisperCppASR(model_path="m.bin", language="hi",
                        runner=lambda argv, stdin=None: "khansi")
    assert asr.transcribe(b"x").text == "khansi"


def test_subprocess_tts_sends_text_on_stdin():
    seen = {}

    def fake_runner(argv, stdin=None):
        seen["argv"], seen["stdin"] = argv, stdin
        return ""

    tts = SubprocessTTS(("tts-bin", "--voice={voice}", "--out={out}"),
                        voice_path="v.onnx", output_path="o.wav", runner=fake_runner)
    tts.speak("नमस्ते", "hi")
    assert seen["stdin"] == "नमस्ते".encode("utf-8")
    assert any("v.onnx" in a for a in seen["argv"])
    assert any("o.wav" in a for a in seen["argv"])
    assert tts.spoken == [("नमस्ते", "hi")]


def test_sherpa_requires_voice_path():
    with pytest.raises(RuntimeError):
        SherpaTTS(voice_path=None).speak("hi")


def test_factories_pick_configured_adapter():
    assert make_asr(MediaConfig()) is None
    assert isinstance(make_asr(MediaConfig(asr_command=("bin", "{wav}"))),
                      SubprocessASR)
    assert isinstance(make_asr(MediaConfig(asr_model_path="m.bin")), WhisperCppASR)
    assert isinstance(make_tts(MediaConfig()), object)          # RecordingTTS
    assert isinstance(make_tts(MediaConfig(tts_command=("bin", "{text}"))),
                      SubprocessTTS)


# ------------------------------------------------------------------------ VAD

def test_energy_vad_separates_speech_from_silence():
    vad = EnergyVAD(threshold=500)
    assert vad.is_speech(_pcm(5000, 5200, 4800, 5100)) is True
    assert vad.is_speech(_pcm(10, -20, 5, 0)) is False


def test_audio_ring_buffer_purges():
    buf = AudioRingBuffer(capacity_bytes=8)
    buf.append(b"12345")
    buf.append(b"6789")
    assert len(buf) <= 9
    buf.purge()
    assert len(buf) == 0 and buf.purged and buf.snapshot() == b""


# ----------------------------------------------------------------- audio turn

def test_session_can_consume_audio_via_asr():
    session = HistorySession(session_id="A-AUDIO", consent_ref="tok")
    session.asr = ScriptedASR([ASRResult("seene mein dard aur saans phool")])
    result = session.respond("", audio=b"fake-wav-bytes")
    assert result.pending_ack                         # RF-2 from spoken narrative
    assert session.fsm.phase == "narrative"
