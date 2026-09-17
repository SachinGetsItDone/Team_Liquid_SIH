# Module C Implementation Plan — What & How (2026-09-11)

> **Status:** candidate implementation plan for team ratification. **A reference
> implementation now exists** (`module-c/` package: C1-C7 runnable, 22 tests
> passing; module-b integration via run_summary OR FHIR bundle). A demo
> prototype exists (`prototype/module-c-kiosk-demo.html`, 53/53 core checks +
> headless-browser click-through, both demo cases). Builds on doc/15 (Module C
> research, completed 2026-09-11), doc/04 (store-once/render-many), doc/09 §2
> (slot-state honesty contract), and the 2026-09-11 /last30days validation pass
> (research log: arXiv:2608.31016 omission blindness; r/healthIT scribe-AI
> failure modes).

## 1. What was implemented (component list)

| # | Component | Responsibility | Status |
|---|---|---|---|
| C1 | **Contract layer** (`contracts.py`) | DEFINES the v1 `HistoryBundle` schema (closes doc/07's open question) and accepts Module B as either a medib run_summary OR a FHIR DocumentBundle (bundle path defaults verify — Module B's verify-default posture) | Real |
| C2 | **Merger** (`merger.py`) | Store-once canon: medication reconciliation (patient-stated vs document-derived; unit-tolerant dose comparison; real conflicts → needs_review with both values, never silently resolved), cross-document dedupe, abnormal-lab compilation, severity-ordered alert list (A red flags → B verify → abnormal), honest timeline (no invented dates) | Real |
| C3 | **Renderer** (`renderer.py`) | SOAP (doc/04 mapping), OLD CARTS re-organization, bilingual patient read-back — deterministic templates, NO LLM; every rendered line carries canon field-id provenance | Real |
| C4 | **OPConsultRecord emitter** (`fhir_emitter.py`) | NRCeS-shaped FHIR R4 document bundle: type SNOMED 371530004, section slices, attester slot; physician-at-consult sections deliberately NOT pre-generated | Real (structural validation via fhir.resources) |
| C5 | **Attestation + edit round-trip** | `physician_attest` (professional mode → status final) + `apply_physician_edit` (correction into the canon, verify cleared) | Real (payload-level) |
| C6 | **Eval harness** (`eval_harness.py`) | Per-view field recall + **omission check** (explicit absence testing per arXiv:2608.31016) + no-fabrication (provenance integrity) + determinism | Real (deterministic subset of the doc/15 §8b protocol) |
| C7 | **CLI** (`cli.py`) | End-to-end run with on-disk artefacts (soap.json, readback en/hi, oldcarts, opconsultrecord.json, eval.json) | Real |

## 2. Key design decisions (with evidence)

1. **Deterministic renderer, no LLM in v1.** Why: doc/15 §2 — pre-visit AI
   summaries are established prior art but hallucination measurement is
   contested (35% lexical vs 9% inference-aware, arXiv:2604.14829); reasoning
   modes hurt note fidelity (arXiv:2605.24902); /last30days validation
   (2026-09-11) — r/healthIT: scribe notes "came out generic, kept getting
   terminology wrong, providers still had to rewrite half of it anyway";
   omission blindness means even LLM judges miss dropped content
   (arXiv:2608.31016). A template renderer with per-line provenance is
   provably no-fabrication and is the honest SIH posture vs competitors'
   cloud-LLM summaries. An LLM narrative-polish lane can be added later
   (llama.cpp/Qwen3 shared runtime) behind the same eval harness.
2. **HistoryBundle v1 contract defined** (schema string
   `medikiosk-history-bundle/1`): Module A's slot-state honesty (captured /
   needs_review / not_answered / not_elicited), per-slot provenance (patient vs
   proxy respondent; voice vs touch), red flags, session/consent refs. Doc/09
   §4 requirement 13 satisfied; enforcement lives in one loader.
3. **Store once, render many** (doc/04 key insight): SOAP, OLD CARTS, both
   read-back languages, and the FHIR bundle all render from the same canon —
   the eval harness proves field parity across views.
4. **Med reconciliation never resolves conflicts silently**: dose conflicts
   keep both values and flag needs_review; unit-absent sides compare
   numerically ("10 mg" vs "10" equivalent; "10 mg" vs "20 mg" not).
5. **OPConsultRecord sections emitted only where data exists**;
   PhysicalExamination / InvestigationAdvice / Procedure / FollowUp / Referral
   are physician-at-consult and NOT pre-generated — the "locked Assessment &
   Plan" demo concept made structural.
6. **Bilingual = deterministic label dictionary, values verbatim.** Bhashini
   stays blocked-risk (doc/09); IndicTrans2 is the product-track offline lane.

## 3. Constraint → enforcement map

| Constraint | Where enforced | Evidence |
|---|---|---|
| CPU-only kiosk, no dGPU | No model runs at all in v1 — pure deterministic code | doc/09 §1 hardware grounding |
| Offline-first / India residency | Zero network calls anywhere in medic | doc/09 §5, doc/16 §1 |
| Never diagnoses | A/P locked physician-only; renderer cannot emit them; no diagnosis inference anywhere | PS safety framing, doc/15 §1 |
| No fabrication | Every rendered line carries canon field ids; eval harness fails on unresolvable provenance | arXiv:2608.31016 (omission blindness) |
| DPDP posture | Consent/session refs carried through; document-derived data inherits Module B's verify/retention decisions; no new data collection | doc/13 §4 |
| ABDM output contract | OPConsultRecord shape (type/sections/attester); structural R4 validation green; full NRCeS profile validation = M3 via HAPI | doc/15 §3, §7b |
| NRCeS code honesty | Only doc/15-verified codes asserted as verified; HPI/ROS section code intentionally omitted rather than invented (open question logged) | doc/07 |

## 4. Open items (team decisions / later milestones)

1. **Reference ranges are placeholder demo values** — clinician validation and
   LOINC/NRCeS binding pending (same posture as medib thresholds pre-M0).
2. **Section codes beyond the verified set** (medical_history, family_history
   LOINC rows) are provisional pending M3 HAPI profile validation.
3. **Which ABDM artifact carries the pre-visit summary** remains the open
   NRCeS-facing question (doc/07) — the emitter targets OPConsultRecord shape
   but HealthDocumentRecord is the alternative; NRCeS confirmation needed.
4. LLM narrative lane (phase 2, gated behind the eval harness).
5. Dashavidha layer (v2, matches demo scope cut).
