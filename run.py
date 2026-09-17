#!/usr/bin/env python
"""MediKiosk — single entry point to run the whole project.

    python run.py                     # start the kiosk web app (patient + physician)
    python run.py --check             # environment + capability report, then exit
    python run.py --demo              # headless end-to-end A+B+C encounter -> out/
    python run.py --demo --voice      # same, with a real spoken interview
    python run.py --host 0.0.0.0 --port 8080 --no-browser

What it wires together:
    Module A  conversational history capture (module-a/media)
    Module B  document digitisation           (module-b/medib)
    Module C  summary generation              (module-c/medic)
    Kiosk     patient + physician web UI, API, speech lane (kiosk/)

Everything runs offline. No network calls, no cloud services.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

BANNER = "MediKiosk - SIH 2026 Problem Statement #47"


# --------------------------------------------------------------------- check

_MODULE_PATHS = {
    "Module A (history capture)": REPO_ROOT / "module-a" / "media",
    "Module B (document digitisation)": REPO_ROOT / "module-b" / "medib",
    "Module C (summary generation)": REPO_ROOT / "module-c" / "medic",
    "Kiosk (UI + runtime)": REPO_ROOT / "kiosk",
}

_OPTIONAL_DEPS = [
    ("fastapi", "web API"),
    ("uvicorn", "web server"),
    ("fhir.resources", "FHIR structural validation"),
    ("rapidocr", "Module B primary OCR"),
    ("onnxruntime", "OCR runtime"),
    ("PIL", "image intake"),
    ("numpy", "audio/numeric"),
    ("soundfile", "audio WAV I/O"),
    ("faster_whisper", "Module A offline ASR"),
    ("pyttsx3", "Module A OS TTS"),
    ("sounddevice", "Module A microphone (server-side CLI only)"),
    ("pypdfium2", "PDF document intake (optional)"),
]


def _has(mod: str) -> bool:
    try:
        return importlib.util.find_spec(mod) is not None
    except Exception:
        return False


def _check() -> int:
    print(f"\n{BANNER}\n" + "=" * len(BANNER))
    print(f"python       : {sys.version.split()[0]}")
    print(f"repo root    : {REPO_ROOT}\n")

    print("modules")
    for label, path in _MODULE_PATHS.items():
        print(f"  [{'x' if path.exists() else ' '}] {label}  ({path.relative_to(REPO_ROOT)})")

    print("\ndependencies")
    missing_required = []
    for mod, why in _OPTIONAL_DEPS:
        ok = _has(mod)
        print(f"  [{'x' if ok else ' '}] {mod:<14} {why}")
        if not ok and mod in ("fastapi", "uvicorn"):
            missing_required.append(mod)

    print("\nspeech lane")
    try:
        sys.path.insert(0, str(REPO_ROOT / "module-a"))
        sys.path.insert(0, str(REPO_ROOT / "module-b"))
        sys.path.insert(0, str(REPO_ROOT / "module-c"))
        from kiosk import speech  # noqa: E402
        caps = speech.capabilities()
        print(f"  ASR : {'available' if caps['asr']['available'] else 'unavailable'}"
              f"  (engine={caps['asr']['engine']}, model={caps['asr']['model']}"
              + (f", error={caps['asr']['error']}" if caps["asr"].get("error") else "") + ")")
        print(f"  TTS : {'available' if caps['tts']['available'] else 'unavailable'}"
              f"  (engine={caps['tts']['engine']})")
    except Exception as exc:  # pragma: no cover - diagnostic only
        print(f"  could not probe speech: {type(exc).__name__}: {exc}")

    print("\nrun")
    print("  python run.py                 start the kiosk web app")
    print("  python run.py --demo          headless A+B+C encounter")
    print()
    if missing_required:
        print(f"ERROR: missing required dependency/dependencies: {', '.join(missing_required)}")
        return 1
    return 0


# -------------------------------------------------------------------- server

def _serve(args: argparse.Namespace) -> int:
    try:
        import uvicorn
    except ImportError:
        print("uvicorn is not installed. Install it with: pip install uvicorn", file=sys.stderr)
        return 2

    url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '::') else args.host}:{args.port}"
    print(f"\n{BANNER}")
    print(f"  patient kiosk    : {url}/")
    print(f"  physician screen : {url}/physician")
    print("  press Ctrl+C to stop\n")

    if not args.no_browser:
        def _open():
            time.sleep(1.5)
            try:
                webbrowser.open(url)
            except Exception:
                pass
        threading.Thread(target=_open, daemon=True).start()

    os.chdir(REPO_ROOT)  # so "kiosk.server:app" resolves regardless of launch cwd
    uvicorn.run("kiosk.server:app", host=args.host, port=args.port,
                reload=args.reload, log_level="info")
    return 0


# ---------------------------------------------------------------------- demo

def _demo(args: argparse.Namespace) -> int:
    from kiosk.cli import main as kiosk_main

    argv: list[str] = ["--out", str(args.out), "--language", args.language,
                       "--profile", args.profile, "--asr-model", args.asr_model]
    if args.voice:
        argv.append("--voice")
    if args.fixtures:
        argv.append("--fixtures")
    if args.images:
        argv += ["--images", *args.images]
    if not args.images and not args.fixtures:
        argv.append("--demo")
    if args.mic is not None:
        argv += ["--mic", str(args.mic)]
    if args.max_turns is not None:
        argv += ["--max-turns", str(args.max_turns)]
    return kiosk_main(argv)


# ---------------------------------------------------------------------- main

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="run.py",
        description="Run MediKiosk: the patient/physician kiosk web app, or a headless encounter.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="examples:\n"
               "  python run.py\n"
               "  python run.py --check\n"
               "  python run.py --demo\n"
               "  python run.py --demo --voice --asr-model tiny\n"
               "  python run.py --demo --images scans/*.png --out out/\n",
    )
    p.add_argument("--check", action="store_true",
                   help="print an environment/capability report and exit")
    p.add_argument("--demo", action="store_true",
                   help="run the headless end-to-end A+B+C encounter (no web UI)")
    # server options
    p.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1)")
    p.add_argument("--port", type=int, default=8080, help="bind port (default 8080)")
    p.add_argument("--no-browser", action="store_true", help="do not open a browser")
    p.add_argument("--reload", action="store_true", help="uvicorn autoreload (development)")
    # demo options
    p.add_argument("--voice", action="store_true", help="spoken interview (mic + ASR + TTS)")
    p.add_argument("--fixtures", action="store_true",
                   help="use simulated Module B documents (no OCR)")
    p.add_argument("--images", nargs="*", default=None,
                   help="scan image paths for the real Module B pipeline")
    p.add_argument("--asr-model", default="tiny", help="faster-whisper model: tiny|base|small")
    p.add_argument("--mic", type=int, default=None, help="input device index")
    p.add_argument("--max-turns", type=int, default=None, help="cap interview turns")
    p.add_argument("--profile", choices=("8gb", "4gb"), default="8gb",
                   help="kiosk resource profile")
    p.add_argument("--language", default="en", help="session language: en|hi|rom")
    p.add_argument("--out", type=Path, default=Path("out"), help="output directory for --demo")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.check:
        return _check()
    if args.demo:
        return _demo(args)
    return _serve(args)


if __name__ == "__main__":
    raise SystemExit(main())
