"""A1/A2/A7 - Pluggable audio + speech adapters.

Real model weights are NOT bundled here. The deterministic/offline defaults and
the scripted test double work with no dependency; the real-model classes are
thin adapters that refuse to run until their model paths are configured, rather
than silently degrading to something that guesses.

Raw audio policy: `AudioRingBuffer` is transient by design and is purged after
transcription unless Module D's consent explicitly permits retention
(doc/09 requirement 11).
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Callable, Protocol

_TIMESTAMP = re.compile(r"^\[[0-9:.\s\->]+\]\s*")


@dataclass
class ASRResult:
    text: str
    conf: float | None = None


class VAD(Protocol):
    name: str

    def is_speech(self, frame: bytes) -> bool: ...


class EnergyVAD:
    """Deterministic offline VAD: frame energy over a byte-scaled threshold.

    A production deployment must measure this against Silero VAD on real OPD
    audio (doc/09 section 5-6); this adapter exists so the skeleton is runnable
    and the interface is exercised offline.
    """

    name = "energy"

    def __init__(self, threshold: int = 500):
        self.threshold = threshold

    def is_speech(self, frame: bytes) -> bool:
        if not frame:
            return False
        # frames are 16-bit little-endian PCM: mean absolute sample value
        samples = memoryview(frame).cast("h") if len(frame) % 2 == 0 else None
        if not samples:
            return any(abs(b - 128) > self.threshold for b in frame)
        return sum(abs(s) for s in samples) / len(samples) > self.threshold


class ASR(Protocol):
    name: str

    def transcribe(self, audio: bytes) -> ASRResult: ...


class ScriptedASR:
    """Test/demo ASR: returns pre-supplied transcripts in order (offline)."""

    name = "scripted"

    def __init__(self, transcripts: list[ASRResult | str]):
        self._queue = [t if isinstance(t, ASRResult) else ASRResult(str(t))
                       for t in transcripts]

    def push(self, transcript: ASRResult | str) -> None:
        self._queue.append(transcript if isinstance(transcript, ASRResult)
                           else ASRResult(str(transcript)))

    def transcribe(self, audio: bytes) -> ASRResult:
        if not self._queue:
            return ASRResult("", conf=None)
        return self._queue.pop(0)


def _default_runner(argv: list[str], stdin: bytes | None = None) -> str:
    """Run a command, return stdout, raise on failure with the captured stderr."""
    try:
        proc = subprocess.run(argv, input=stdin, capture_output=True)
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"speech binary not found: {argv[0]!r}. Install it and set the "
            f"command in MediaConfig (no model/weights are bundled).") from exc
    if proc.returncode != 0:
        raise RuntimeError(
            f"{argv[0]} exited {proc.returncode}: "
            f"{proc.stderr.decode(errors='replace').strip()[:400]}")
    return proc.stdout.decode(errors="replace")


def _default_text_parser(stdout: str) -> str:
    """whisper.cpp -otxt style: drop timestamped lines, join the rest."""
    parts = []
    for line in (stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        parts.append(_TIMESTAMP.sub("", line))
    return " ".join(parts).strip()


class SubprocessASR:
    """Real runtime path: run an external ASR binary and parse its stdout.

    No weights are bundled; the command and model path are deployment config.
    Example (whisper.cpp):
        ("whisper-cli", "-m", "{model}", "-f", "{wav}", "-otxt", "-l", "{lang}")
    """

    name = "subprocess"

    def __init__(self, argv_template, model_path: str | None = None,
                 language: str = "hi", runner: Callable | None = None,
                 parser: Callable[[str], str] | None = None):
        self.argv_template = tuple(argv_template)
        self.model_path = model_path
        self.language = language
        self._runner = runner or _default_runner
        self._parser = parser or _default_text_parser

    def transcribe(self, audio: bytes) -> ASRResult:
        fd, wav = tempfile.mkstemp(suffix=".wav")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(audio)
            argv = [a.format(wav=wav, model=self.model_path or "",
                             lang=self.language) for a in self.argv_template]
            stdout = self._runner(argv)
            return ASRResult(text=self._parser(stdout), conf=None)
        finally:
            try:
                os.unlink(wav)
            except OSError:
                pass


class WhisperCppASR(SubprocessASR):
    """whisper.cpp binding via its CLI. Refuses to run without a model path."""

    name = "whisper.cpp"
    DEFAULT_ARGV = ("whisper-cli", "-m", "{model}", "-f", "{wav}", "-otxt",
                    "-nt", "-l", "{lang}")

    def __init__(self, model_path: str | None = None, language: str = "hi",
                 runner: Callable | None = None):
        super().__init__(self.DEFAULT_ARGV, model_path=model_path,
                         language=language, runner=runner)

    def transcribe(self, audio: bytes) -> ASRResult:
        if not self.model_path:
            raise RuntimeError(
                "WhisperCppASR: no model_path configured. Bundle the quantized "
                "whisper.cpp model in the deployment image (doc/09 section 5); "
                "refusing to run rather than guess.")
        return super().transcribe(audio)


class TTS(Protocol):
    name: str

    def speak(self, text: str, lang: str = "hi") -> None: ...


@dataclass
class RecordingTTS:
    """Test/demo TTS: records prompts instead of synthesising (offline)."""
    name: str = "recording"
    spoken: list[tuple[str, str]] = field(default_factory=list)

    def speak(self, text: str, lang: str = "hi") -> None:
        self.spoken.append((text, lang))


class SubprocessTTS:
    """Real runtime path: run an external TTS binary, text on stdin.

    No voices are bundled; the command and voice path are deployment config.
    Example (sherpa-onnx / piper-style):
        ("sherpa-onnx-offline-tts", "--vits-model={voice}", "--output-filename={out}")
    """

    name = "subprocess"

    def __init__(self, argv_template, voice_path: str | None = None,
                 output_path: str | None = None, runner: Callable | None = None):
        self.argv_template = tuple(argv_template)
        self.voice_path = voice_path
        self.output_path = output_path
        self._runner = runner or _default_runner
        self.spoken: list[tuple[str, str]] = []

    def speak(self, text: str, lang: str = "hi") -> None:
        argv = [a.format(text=text, lang=lang, out=self.output_path or "-",
                         voice=self.voice_path or "") for a in self.argv_template]
        self._runner(argv, stdin=(text or "").encode("utf-8"))
        self.spoken.append((text, lang))


class SherpaTTS(SubprocessTTS):
    """sherpa-onnx TTS binding with a per-voice-licensed Hindi voice."""

    name = "sherpa-onnx"
    DEFAULT_ARGV = ("sherpa-onnx-offline-tts", "--vits-model={voice}",
                    "--output-filename={out}")

    def __init__(self, voice_path: str | None = None,
                 output_path: str | None = None, runner: Callable | None = None):
        super().__init__(self.DEFAULT_ARGV, voice_path=voice_path,
                         output_path=output_path, runner=runner)

    def speak(self, text: str, lang: str = "hi") -> None:
        if not self.voice_path:
            raise RuntimeError(
                "SherpaTTS: no voice_path configured. The Hindi voice model is "
                "licensed separately and is not bundled (doc/09 section 5).")
        super().speak(text, lang)


# --------------------------------------------------------------- factories

def make_asr(cfg):
    """Return the configured ASR adapter, or None (deterministic/touch only).

    Precedence: external command > in-process faster-whisper > whisper.cpp CLI.
    """
    command = getattr(cfg, "asr_command", None)
    if command:
        return SubprocessASR(command, model_path=getattr(cfg, "asr_model_path", None),
                             language=getattr(cfg, "language", "hi"))
    if getattr(cfg, "asr_engine", None) == "faster-whisper":
        from .speech import FasterWhisperASR
        lang = getattr(cfg, "language", "hi")
        return FasterWhisperASR(model_size=getattr(cfg, "asr_model", "base"),
                                language=None if lang in ("rom", "auto") else lang)
    if getattr(cfg, "asr_model_path", None):
        return WhisperCppASR(getattr(cfg, "asr_model_path"),
                             language=getattr(cfg, "language", "hi"))
    return None


def make_tts(cfg):
    """Return the configured TTS adapter, else the offline recording double.

    Precedence: external command > in-process OS voice > sherpa-onnx CLI.
    """
    command = getattr(cfg, "tts_command", None)
    if command:
        return SubprocessTTS(command, voice_path=getattr(cfg, "tts_voice_path", None))
    if getattr(cfg, "tts_engine", None) == "system":
        from .speech import SystemTTS
        return SystemTTS()
    if getattr(cfg, "tts_voice_path", None):
        return SherpaTTS(getattr(cfg, "tts_voice_path"))
    return RecordingTTS()


class AudioRingBuffer:
    """Transient encrypted ring buffer stand-in; purge() is the erasure action."""

    def __init__(self, capacity_bytes: int = 8 * 1024 * 1024):
        self.capacity = capacity_bytes
        self._chunks: list[bytes] = []
        self._size = 0
        self.purged = False

    def append(self, chunk: bytes) -> None:
        self._chunks.append(chunk)
        self._size += len(chunk)
        while self._size > self.capacity and self._chunks:
            self._size -= len(self._chunks.pop(0))

    def snapshot(self) -> bytes:
        return b"".join(self._chunks)

    def purge(self) -> None:
        self._chunks.clear()
        self._size = 0
        self.purged = True

    def __len__(self) -> int:
        return self._size
