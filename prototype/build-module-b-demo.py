"""Assemble prototype/module-b-kiosk-demo.html from module-a's style + inlined libs
plus the Module B parts. Rebuild any time a part changes:
    python prototype/build-module-b-demo.py
"""
from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).parent
PARTS = HERE / "parts"
OUT = HERE / "module-b-kiosk-demo.html"
SRC = HERE / "module-a-kiosk-demo.html"

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MediKiosk — Module B Document Digitization Kiosk (SIH demo)</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230E6E66'/%3E%3Cpath d='M32 14v36M14 32h36' stroke='white' stroke-width='9' stroke-linecap='round'/%3E%3C/svg%3E" />
<!--
  MediKiosk Module B — interactive SIH demo prototype (single file, runs offline).

  HOW TO RUN: open this file in any modern browser (double-click). No server, no internet.

  WHAT THIS IS: the patient document-digitization flow — DPDP itemized consent, scan or
  UPLOAD your own papers (photos/PDFs, drag-drop or camera), CPU-only OCR lane (primary
  PP-OCRv5 mobile + Tesseract fallback + cross-engine voting), verify-default confidence
  gating, physician attestation, and the NRCeS/ABDM FHIR bundle. Uploaded pages run the
  same pipeline with the OCR step simulated (labelled in-UI); a sensitive-word filter
  ignores offensive lines and masks file names (demo display policy).

  HONESTY LABELS: the OCR engine itself is simulated in-browser with confidences measured
  from the reference implementation run (2026-09-11); everything deterministic (router,
  fallback ladder, voting, confidence gate, structurer, FHIR emission) is the real pipeline
  logic ported from module-b/medib. The product runs the same logic against real engine
  output on the kiosk CPU.

  INLINED LIBRARIES (all MIT-licensed, embedded so the file works with zero network):
    - React 18.3.1 UMD production build  (facebook/react, MIT)
    - ReactDOM 18.3.1 UMD production build (facebook/react, MIT)
    - htm 3.1.1 UMD (developit/htm, MIT)
  Style block and library builds are shared verbatim with module-a-kiosk-demo.html.
  Core logic lives in the MB-CORE block (DOM-free, tested by verify-demo-b.mjs).
  See doc/12-prototype-demo.md in the project repo.

  BUILT BY: prototype/build-module-b-demo.py — edit parts/module-b-core.js or
  parts/module-b-app.js, then re-run the builder. Do not hand-edit the built file.
-->
"""


def extract(pattern: str, src: str, what: str) -> str:
    m = re.search(pattern, src, re.DOTALL)
    if not m:
        raise SystemExit(f"could not extract {what} from module-a demo")
    return m.group(0)


def main() -> None:
    src = SRC.read_text(encoding="utf-8")
    style = extract(r"<style>.*?</style>", src, "style block")
    libs = []
    for signature, what in [
        (r"<script>\s*/\*\*\s*\n\s*\* @license React\s*\n\s*\* react\.production\.min\.js.*?</script>", "React UMD"),
        (r"<script>\s*/\*\*\s*\n\s*\* @license React\s*\n\s*\* react-dom\.production\.min\.js.*?</script>", "ReactDOM UMD"),
        (r"<script>\s*!function\(n,e\)\{\"object\"==typeof exports.*?</script>", "htm UMD"),
    ]:
        libs.append(extract(signature, src, what))

    core = (PARTS / "module-b-core.js").read_text(encoding="utf-8")
    app = (PARTS / "module-b-app.js").read_text(encoding="utf-8")

    html_out = "\n".join([
        HEAD,
        style,
        "</head>\n<body>\n<div id=\"root\"></div>\n",
        "\n".join(libs),
        "<script>\n" + core + "\n</script>",
        "<script>\n" + app + "\n</script>",
        "</body>\n</html>\n",
    ])
    OUT.write_text(html_out, encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT} ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
