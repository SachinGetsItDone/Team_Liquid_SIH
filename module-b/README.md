# MediKiosk Module B — Document Digitization (CPU-only implementation)

Implements doc/17 (candidate plan): components B1-B9 as a runnable Python package.

- **Primary OCR:** RapidOCR (PP-OCR models, ONNX Runtime CPU) — Apache-2.0
- **Fallback OCR:** Tesseract 5 `hin+eng` — Apache-2.0 (auto-detected; skipped if binary absent)
- **Cross-engine per-field voting** for a free confidence signal
- **Structurer:** deterministic rules engine (default) + pluggable llama.cpp/Qwen3 adapter (B4)
- **Confidence gate:** per-field verify-default with bbox grounding (B5)
- **FHIR emitter:** NRCeS-ABDM-style DocumentBundle (Composition + DocumentReference +
  MedicationRequest / Observation / Condition), structural validation via `fhir.resources` (B6)
- **Eval harness:** field-level CER, catastrophic rate, p50/p95 latency, peak RSS (B9)

## Layout

```
medib/            the package (intake, router, engines, voting, structurer,
                  confidence, fhir_emitter, pipeline, eval_harness, cli)
tests/            unit tests (voting, confidence, structurer, FHIR, smoke)
tools/            synthetic-page generator (dev-only; NOT a substitute for M0 real scans)
```

## Install / run

```
pip install rapidocr onnxruntime pillow fhir.resources pytest
python -m medib.cli <image-or-dir> --out out/            # full pipeline run
python -m medib.cli tools/pages/ --out out/ --review      # + physician-review payload
python -m medib.eval_harness tools/pages/ --gt tools/pages/gt.json
pytest tests/ -q
```

Optional: set `MEDIB_LLM_URL=http://127.0.0.1:8080/v1` to route structuring through a
llama.cpp `llama-server` (Qwen3) instead of the deterministic rules engine.

## Honest status (what is real vs stubbed)

| Component | Status |
|---|---|
| B1 intake + DPDP consent gate | Real (consent artefact required before extraction) |
| B2 router | Real (deterministic heuristics; thresholds to be re-set from M0 data) |
| B3 engines + fallback + voting | Real for RapidOCR; Tesseract wrapper real but binary not installed on dev machine |
| B4 structurer | Rules engine real; LLM adapter real-but-untested (needs llama-server) |
| B5 confidence gate | Real |
| B6 FHIR emitter | Real (R4-structural validation via fhir.resources R4B models; full NRCeS profile validation is M3 via HAPI) |
| B7 physician review | JSON payload emitted (UI is M3) |
| B8 ABDM sync | Not implemented (M4 — sandbox milestone path) |
| B9 eval harness | Real (synthetic pages only on this machine; **real consented OPD scans remain the M0 gate** — synthetic scores do not generalize, per doc/13 §2.3) |

Engine thresholds in `medib/config.py` are *placeholders* pending M0 measured distributions
(doc/17 §7.1). Nothing here overrides the team-ratification status of doc/17.
