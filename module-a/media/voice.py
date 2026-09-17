"""Real voice interview loop: speak the prompt, listen, record the answer.

This is the glue that turns Module A from a scripted runner into an actual
spoken interaction. It uses injected adapters so it is testable without audio:
- `tts` speaks the current prompt (and the read-back),
- `recorder` captures one utterance,
- `asr` transcribes it (run inside the session, so the kiosk scheduler's A_ASR
  lease applies).

Nothing here interprets clinical content; the deterministic extractor and rules
still own that, unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class VoiceTurn:
    turn: str
    prompt: str
    heard: str
    conf: float | None
    red_flags: list[str] = field(default_factory=list)
    pending_ack: bool = False


def run_voice_session(session, asr, recorder, tts, *, speak: bool = True,
                      max_turns: int | None = None, on_event=None) -> list[VoiceTurn]:
    """Drive one live spoken interview on an already-constructed HistorySession."""
    session.asr = asr
    events: list[VoiceTurn] = []
    turns = 0
    while True:
        turn = session.current_turn()
        if turn is None:
            break
        if max_turns is not None and turns >= max_turns:
            break

        if session.pending_ack:
            alert = ("Safety alert: a red flag was detected. Please inform the "
                     "staff at the desk now.")
            if speak:
                tts.speak(alert)
            audio = recorder.record(max_seconds=6.0)
            ack = asr.transcribe(audio)
            session.acknowledge_red_flag()
            ev = VoiceTurn("ack", alert, getattr(ack, "text", ""),
                           getattr(ack, "conf", None),
                           [h.rule for h in session.red_flag_hits])
            events.append(ev)
            if on_event:
                on_event(ev)
            continue

        prompt = session.prompt_text()
        if turn.kind == "readback":
            lines = session.readback_lines()
            prompt = ". ".join(lines) + ". " + prompt
        if speak:
            tts.speak(prompt)

        audio = recorder.record()
        result = session.respond("", audio=audio, voice=True)
        heard = getattr(session, "last_transcript", "")
        ev = VoiceTurn(
            turn=turn.id, prompt=prompt, heard=heard,
            conf=None, red_flags=[h.rule for h in result.red_flag_hits],
            pending_ack=result.pending_ack,
        )
        events.append(ev)
        if on_event:
            on_event(ev)
        turns += 1
    return events


def voice_profile(language: str = "hi") -> dict:
    """Preset for a real kiosk voice session."""
    return {
        "asr_engine": "faster-whisper",
        "asr_model": "base",
        "tts_engine": "system",
        "language": language,
    }
