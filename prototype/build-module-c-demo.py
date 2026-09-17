"""Assemble prototype/module-c-kiosk-demo.html from module-a's style + inlined libs
plus the Module C parts. Rebuild any time a part changes:
    python prototype/build-module-c-demo.py
"""
from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).parent
PARTS = HERE / "parts"
OUT = HERE / "module-c-kiosk-demo.html"
SRC = HERE / "module-a-kiosk-demo.html"

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MediKiosk — Module C Summary Generation Kiosk (SIH demo)</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230E6E66'/%3E%3Cpath d='M32 14v36M14 32h36' stroke='white' stroke-width='9' stroke-linecap='round'/%3E%3C/svg%3E" />
<!--
  MediKiosk Module C — interactive SIH demo prototype (single file, runs offline).

  HOW TO RUN: open this file in any modern browser (double-click). No server, no internet.

  WHAT THIS IS: the summary-generation flow — pick a finished session (Module A
  interview + Module B scanned papers), watch the two streams merge into ONE
  canonical case summary (medication reconciliation with provenance, abnormal-lab
  compilation, severity-ordered alerts), the bilingual patient read-back, and the
  physician handoff: one-page SOAP summary with per-line provenance, locked
  physician-only Assessment & Plan, and the NRCeS/ABDM OPConsultRecord FHIR bundle
  with the attestation slot.

  HONESTY LABELS: the two input streams are demo fixtures shaped exactly like the
  real contracts (HistoryBundle v1 + medib run_summary). The merge, render and
  FHIR-emission logic is the real pipeline ported from module-c/medic. The renderer
  is DETERMINISTIC by design — no LLM generates any line of the summary.

  INLINED LIBRARIES (all MIT-licensed, embedded so the file works with zero network):
    - React 18.3.1 UMD production build  (facebook/react, MIT)
    - ReactDOM 18.3.1 UMD production build (facebook/react, MIT)
    - htm 3.1.1 UMD (developit/htm, MIT)
  Style block and library builds are shared verbatim with module-a-kiosk-demo.html.
  Core logic lives in the MC-CORE block (DOM-free, tested by verify-demo-c.mjs).
  See doc/12-prototype-demo.md in the project repo.

  BUILT BY: prototype/build-module-c-demo.py — edit parts/module-c-core.js or
  parts/module-c-app.js, then re-run the builder. Do not hand-edit the built file.
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

    core = (PARTS / "module-c-core.js").read_text(encoding="utf-8")
    app = (PARTS / "module-c-app.js").read_text(encoding="utf-8")

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
