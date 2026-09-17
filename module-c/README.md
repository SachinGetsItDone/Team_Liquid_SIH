# MediKiosk Module C — Structured History Summary Generator (CPU-only, deterministic v1)

Implements the Module C contract (doc/15 §1): merge Module A's `HistoryBundle` +
Module B's `DocumentBundle` into ONE canonical case summary (store-once, doc/04),
render MANY views from it (SOAP, OLD CARTS, bilingual patient read-back), and emit
the physician-facing NRCeS **OPConsultRecord** document bundle. Never diagnoses —
Assessment & Plan stay physician-only.

- **C1 contracts**: defines the v1 `HistoryBundle` schema (closes doc/07's
  "contract undefined" open question); accepts Module B as run_summary OR FHIR bundle
- **C2 merger**: medication reconciliation (patient-stated vs document-derived,
  unit-tolerant dose comparison, needs_review on real conflicts — never silently
  resolved), cross-document dedupe, abnormal-lab compilation (placeholder ranges),
  severity-ordered physician alert list (A red flags → B verify → abnormal labs),
  honest prior-record timeline (no invented dates)
- **C3 renderer**: deterministic templates, NO LLM in v1 (see decisions log);
  every rendered line carries canon field-id provenance
- **C4 FHIR emitter**: OPConsultRecord-shaped R4 document bundle (type SNOMED
  371530004, NRCeS section slices, attester slot); structural validation via
  `fhir.resources`; full NRCeS profile validation = M3 via HAPI
- **C5 attestation**: physician edit round-trip into the canon + attester
  (professional mode) on the Composition
- **C6 eval harness**: per-view field recall + **omission check**
  (arXiv:2608.31016: judges verify presence, not absence) + no-fabrication
  (provenance integrity) + determinism
- **C7 CLI**: end-to-end run with on-disk artefacts

## Layout

```
medic/            the package (contracts, merger, renderer, fhir_emitter,
                  eval_harness, fixtures, cli)
tests/            22 tests (unit + end-to-end smoke)
```

## Install / run

```
pip install fhir.resources pytest
python -m medic.cli --out out/                 # demo case (Ramesh RF-2)
python -m medic.cli --history hb.json --documents run_summary.json --out out/
python -m medic.cli --out out/ --attest        # + physician attestation demo
pytest tests/ -q
```

## Honest status (what is real vs deferred)

| Component | Status |
|---|---|
| C1 contract layer (both input forms) | Real |
| C2 merger (reconciliation, flags, timeline) | Real |
| C3 renderer (SOAP / OLD CARTS / read-back en+hi) | Real, deterministic — no LLM by design |
| C4 OPConsultRecord emission | Real (structural R4 validation via fhir.resources R4B); **section codes beyond the doc/15-verified set are provisional pending M3 HAPI profile validation** |
| C5 physician attest + edit round-trip | Real (payload-level; UI is the demo prototype) |
| C6 eval harness | Real (deterministic subset of the doc/15 §8b protocol; ROUGE/BERTScore only apply once an LLM-narrative lane exists) |
| Dashavidha layer | Absent in v1 (matches demo scope cut, decisions log 2026-09-11) |
| Reference ranges | Placeholder demo table — clinician validation pending (same posture as medib thresholds) |
| ABDM push | Not implemented (Module D / M4) |

Bilingual rendering is a deterministic label dictionary (values verbatim);
IndicTrans2 is the product-track offline translation lane (doc/15 §5).
