"""Offline Module A session runner.

Drives a history session from a scripted list of answers (no audio, no network)
and writes the emitted HistoryBundle plus read-back, red flags and confirmation
requests. Used for deterministic tests and for a kiosk demo when no audio
hardware is available.

    python -m media.cli --demo --out out/
    python -m media.cli --script script.json --out out/
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .adapters import RecordingTTS
from .config import MediaConfig
from .session import HistorySession

# Grounded in the shared demo case (Ramesh, 54, Hinglish, chest pain) used by
# the prototype and Module C fixtures. Simulated, and disclosed as such.
DEMO_SCRIPT = [
    {"text": "Seene mein dard ho raha hai, saans phool rahi hai"},
    {"text": "seene mein dard"},
    {"text": "beech mein, chati ke beech"},
    {"text": "2 din pehle, achanak shuru hua"},
    {"text": "bhaari bhaari, pressure jaisa"},
    {"text": "left arm tak jaata hai"},
    {"text": "saans phool rahi hai, pasina bhi aa raha hai"},
    {"text": "10-20 minute mein aata jata hai"},
    {"text": "seedhi chadhne pe badh jata hai"},
    {"text": "8/10"},
    {"text": "no"},
    {"text": "BP ki dawa 5 saal se, kidney stone 2019 mein"},
    {"text": "Amlodipine 5 mg OD, Atorvastatin 10 mg"},
    {"text": "no allergies"},
    {"text": "father ko heart attack 58 saal"},
    {"text": "yes"},
    {"text": "no"},
    {"text": "yes"},
    {"text": "no"},
    {"text": "no"},
    {"text": "no"},
    {"text": "gas lagta hai"},
    {"text": "papa ki tarah dar lagta hai"},
    {"text": "aaj ECG karana hai"},
    {"text": "yes"},
]


def run_script(script: list[dict], *, session_id: str, consent_ref: str,
               patient_ref: str = "Patient/ABHA-UNKNOWN", language: str = "rom",
               config: MediaConfig | None = None,
               stage_guard=None) -> dict:
    cfg = config or MediaConfig(language=language)
    tts = RecordingTTS()
    session = HistorySession(session_id=session_id, consent_ref=consent_ref,
                             patient_ref=patient_ref, config=cfg,
                             language=language, tts=tts,
                             stage_guard=stage_guard)
    events: list[dict] = []
    for item in script:
        if session.pending_ack:
            session.acknowledge_red_flag()
            events.append({"event": "red_flag_ack"})
        turn = session.current_turn()
        if turn is None:
            break
        result = session.respond(item.get("text", ""),
                                 by=item.get("by", "patient"),
                                 voice=item.get("voice", True))
        events.append({
            "turn": result.turn.id if result.turn else None,
            "pending_ack": result.pending_ack,
            "red_flags": [h.rule for h in result.red_flag_hits],
        })
    bundle = session.finalize()
    return {
        "bundle": bundle,
        "readback": session.readback_lines(),
        "red_flags": [h.to_dict() for h in session.red_flag_hits],
        "confirmations": session.confirmation_requests(),
        "events": events,
        "prompts_spoken": [p[0] for p in tts.spoken],
    }


def run_voice(*, session_id: str, consent_ref: str,
              patient_ref: str = "Patient/ABHA-UNKNOWN", language: str = "hi",
              asr_model: str = "base", mic_device: int | None = None,
              max_turns: int | None = None, config: MediaConfig | None = None,
              on_event=None) -> dict:
    """Live spoken interview: mic -> offline ASR -> deterministic FSM -> TTS."""
    from .adapters import make_asr, make_tts
    from .speech import MicrophoneRecorder
    from .voice import run_voice_session

    cfg = config or MediaConfig(language=language, asr_engine="faster-whisper",
                                asr_model=asr_model, tts_engine="system",
                                mic_device=mic_device)
    asr = make_asr(cfg)
    if asr is None:
        raise RuntimeError("no ASR engine configured")
    tts = make_tts(cfg)
    recorder = MicrophoneRecorder(device=cfg.mic_device,
                                  energy_threshold=cfg.mic_energy_threshold)
    session = HistorySession(session_id=session_id, consent_ref=consent_ref,
                             patient_ref=patient_ref, config=cfg,
                             language=language, tts=tts)
    events = run_voice_session(session, asr, recorder, tts,
                               max_turns=max_turns, on_event=on_event)
    return {
        "bundle": session.finalize(),
        "readback": session.readback_lines(),
        "red_flags": [h.to_dict() for h in session.red_flag_hits],
        "confirmations": session.confirmation_requests(),
        "events": [e.__dict__ for e in events],
        "prompts_spoken": [p[0] for p in getattr(tts, "spoken", [])],
    }


def _write(out_dir: Path, result: dict) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "history_bundle.json").write_text(
        json.dumps(result["bundle"], indent=2, ensure_ascii=False),
        encoding="utf-8")
    (out_dir / "readback.json").write_text(
        json.dumps(result["readback"], indent=2, ensure_ascii=False),
        encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="media", description="Module A session runner")
    parser.add_argument("--demo", action="store_true", help="run the built-in demo script")
    parser.add_argument("--script", type=Path, help="JSON list of {text,by,voice}")
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument("--session-id", default="A-DEMO-0001")
    parser.add_argument("--consent-ref", default="opaque-token-module-d")
    parser.add_argument("--language", default="rom")
    parser.add_argument("--voice", action="store_true",
                        help="live spoken interview (mic + offline ASR + TTS)")
    parser.add_argument("--asr-model", default="base", help="tiny|base|small")
    parser.add_argument("--mic", type=int, default=None, help="input device index")
    parser.add_argument("--max-turns", type=int, default=None)
    args = parser.parse_args(argv)

    if args.voice:
        def _event(ev):
            print(f"  [{ev.turn}] heard={ev.heard!r} flags={ev.red_flags}")
        result = run_voice(session_id=args.session_id,
                           consent_ref=args.consent_ref, language=args.language,
                           asr_model=args.asr_model, mic_device=args.mic,
                           max_turns=args.max_turns, on_event=_event)
    else:
        if args.script:
            script = json.loads(args.script.read_text(encoding="utf-8"))
        else:
            script = DEMO_SCRIPT
        result = run_script(script, session_id=args.session_id,
                            consent_ref=args.consent_ref, language=args.language)
    _write(args.out, result)
    print(json.dumps({"red_flags": result["red_flags"],
                      "readback_lines": len(result["readback"]),
                      "out": str(args.out)}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
