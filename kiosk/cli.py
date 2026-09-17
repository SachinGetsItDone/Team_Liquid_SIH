"""End-to-end kiosk encounter runner (A + B + merge + emit).

    python -m kiosk.cli --demo --out out/            # real OCR on bundled pages
    python -m kiosk.cli --demo --voice               # real mic + ASR + TTS for A
    python -m kiosk.cli --images scans/*.png --out out/
    python -m kiosk.cli --demo --fixtures --out out/ # simulated docs (no OCR deps)
    python -m kiosk.cli --demo --profile 4gb --out out/

By default the encounter is REAL: Module A is spoken when `--voice` is set,
otherwise it follows the scripted demo case; Module B runs the real OCR engine
on the bundled page images. `--fixtures` opts back into the fully simulated
document path, and `--voice` opts into the fully spoken interview.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import paths  # noqa: F401  (puts module-a/b/c on sys.path)
from .config import KioskConfig
from .orchestrator import Encounter

_ROOT = Path(__file__).resolve().parents[1]
_BUNDLED_PAGES = sorted((_ROOT / "module-b" / "tools" / "pages").glob("*.png"))


def _media_config(args):
    from media.config import MediaConfig
    return MediaConfig(
        language=args.language,
        asr_engine="faster-whisper" if args.voice else None,
        asr_model=args.asr_model,
        tts_engine="system" if args.voice else None,
        mic_device=args.mic,
    )


def _document_inputs(args):
    from media.cli import DEMO_SCRIPT  # noqa: F401  (import sanity)
    if args.fixtures:
        from medic.fixtures import DEMO_DOCUMENTS
        return None, None, DEMO_DOCUMENTS, False
    if args.images:
        from medib.intake import ConsentArtefact
        return ([Path(p) for p in args.images],
                ConsentArtefact(patient_ack=True), None, True)
    if not _BUNDLED_PAGES:
        raise SystemExit(
            "no bundled page images found; pass --images or use --fixtures")
    from medib.intake import ConsentArtefact
    return (list(_BUNDLED_PAGES), ConsentArtefact(patient_ack=True), None, True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kiosk", description="MediKiosk A+B encounter")
    parser.add_argument("--demo", action="store_true", help="run the demo case")
    parser.add_argument("--images", nargs="*", default=None,
                        help="scan image paths for the real Module B pipeline")
    parser.add_argument("--fixtures", action="store_true",
                        help="use simulated Module B documents (no OCR needed)")
    parser.add_argument("--voice", action="store_true",
                        help="real spoken interview (mic + offline ASR + TTS)")
    parser.add_argument("--asr-model", default="base",
                        help="faster-whisper model size: tiny|base|small")
    parser.add_argument("--mic", type=int, default=None, help="input device index")
    parser.add_argument("--max-turns", type=int, default=None)
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument("--profile", choices=("8gb", "4gb"), default="8gb")
    parser.add_argument("--session-id", default="A-DEMO-0001")
    parser.add_argument("--consent-ref", default="opaque-token-module-d")
    parser.add_argument("--language", default="en")
    args = parser.parse_args(argv)

    from media.cli import DEMO_SCRIPT

    kcfg = KioskConfig.four_gb() if args.profile == "4gb" else KioskConfig.eight_gb()

    def _event(ev):
        print(f"  [A] {ev.turn}: heard={ev.heard!r} flags={ev.red_flags}")

    enc = Encounter(kiosk_cfg=kcfg, media_cfg=_media_config(args))
    image_paths, consent, documents, real_docs = _document_inputs(args)

    result = enc.run(session_id=args.session_id, consent_ref=args.consent_ref,
                     script=None if args.voice else DEMO_SCRIPT,
                     language=args.language, image_paths=image_paths,
                     consent=consent, documents=documents, voice=args.voice,
                     max_turns=args.max_turns,
                     on_event=_event if args.voice else None)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "opconsultrecord.json").write_text(
        json.dumps(result.opconsultrecord, indent=2, ensure_ascii=False), encoding="utf-8")
    (args.out / "history_bundle.json").write_text(
        json.dumps(result.history_bundle, indent=2, ensure_ascii=False), encoding="utf-8")
    summary = {
        "profile": enc.kiosk.profile,
        "voice": args.voice,
        "real_documents": real_docs,
        "counts": result.case.counts(),
        "alerts": [{"severity": a.severity, "text": a.text} for a in result.case.alerts],
        "degradations": result.degradations,
        "timings_s": result.timings,
        "scheduler": result.stages,
    }
    (args.out / "encounter_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"profile": summary["profile"], "voice": summary["voice"],
                      "real_documents": summary["real_documents"],
                      "counts": summary["counts"],
                      "degradations": summary["degradations"],
                      "out": str(args.out)}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
