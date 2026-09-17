# Module B Implementation Plan — What & How (2026-09-11)

> **Status:** candidate implementation plan for team ratification. **A reference
> implementation now exists** (`module-b/` package: B1-B7+B9 runnable, 23 tests passing;
> B8 ABDM sync is M4). Measured numbers from the reference run are in the research log
> 2026-09-11 (night) — synthetic pages, dev CPU, not kiosk-class.
> Builds on the
> user-directed engine decision (decisions/06, 2026-09-11: Primary PP-OCRv5-mobile via
> RapidOCR/ONNX CPU; Fallback Tesseract 5 hin+eng) and the router architecture (doc/08 §2,
> pending candidate decision). Every constraint mapping cites its evidence base:
> doc/13 (deep-dive), doc/14 (CPU research), doc/16 (regulatory), doc/09 (Module A runtime).
> Pipeline diagram: `doc/diagrams/module-b-cpu-pipeline.excalidraw`.

## 1. What to implement (component list)

| # | Component | Responsibility |
|---|---|---|
| B1 | **Intake service** | Scanner/camera capture, deskew, illumination fix, DPI normalization; DPDP itemized notice + consent before scan; transient-session storage policy |
| B2 | **Page router** | Lightweight classifier (rules + small model): printed / handwritten / lab-table; routes page to lane |
| B3 | **OCR engine layer** | Primary: RapidOCR PP-OCRv5-mobile multilingual (onnxruntime-cpu, OpenVINO A/B). Fallback: Tesseract 5 hin+eng. Cross-engine per-field voting for confidence |
| B4 | **Structurer** | llama.cpp + Qwen3 (shared Module A runtime): OCR text + fields → structured JSON (meds/doses, lab values, diagnoses, dates); medspaCy for med-name normalization; SNOMED/CDCI coding |
| B5 | **Confidence gate** | Per-field thresholds; low-conf/handwriting → "unreadable → verify" flag; every value carries source bbox (RAPTOR+ grounding rule, doc/13) |
| B6 | **FHIR emitter** | NRCeS ABDM profiles: raw scan → DocumentReference (inline base64) in HealthDocumentRecord; meds → MedicationRequest; labs → Observation; dx → Condition; DocumentBundle; HAPI FHIR validation |
| B7 | **Physician review UI** | Verify-flagged fields + bboxes; confirm/edit = FHIR `attester` slot (professional mode) |
| B8 | **ABDM sync** | Offline queue → care-context linking under hospital HIP keys (doc/16 §2 posture); sandbox-first |
| B9 | **Eval harness** | The gating asset: field-level CER + catastrophic-rate + p50/p95 latency + peak RSS on the local eval set (doc/14 §5 protocol) |

## 2. Constraint → enforcement map (how it "comes under all constraints")

| Constraint | Where enforced | Evidence |
|---|---|---|
| CPU-only, 12–16GB RAM | B3 = classical lane only: 1.75 s/page, 2.2GB peak (Xeon, maintainer figures); B4 shares Module A's llama.cpp runtime — no second inference stack. VLM lane excluded from v1 | doc/14 §2, §4 |
| Kiosk-tier scheduling | Never run OCR + ASR + NLU concurrently (doc/09 §6 rule adapted): OCR runs after Module A's interview completes or in queue-time slot; hard memory watchdog → fallback engine → manual-entry mode | doc/09 §6 |
| Offline-first | All models local; zero network calls in B1–B7; B8 queues and syncs when link returns | doc/13 §5 |
| No non-Indian cloud | No external OCR/translation APIs; Bhashini stays blocked-risk (not fallback) | doc/09 §5, doc/16 |
| DPDP 2023 | Itemized notice (what is extracted, purpose) in 22 languages before scan (doc/13 §4); transient scan unless physician attests; breach: 72h detailed report runbook; session-resume + walk-away purge policy | doc/13 §4 |
| ABDM | NRCeS FHIR emission (B6) validated by HAPI; hospital = HIP, kiosk = certified software inside hospital stack (HFR → HIP registration; linking under hospital keys); ABDM Sandbox milestone path | doc/13 §1, doc/16 §2 |
| India data residency | Local-first by construction; HDM Policy Clause 26 now citable | doc/16 §1 |
| Low-maintenance | Apache-2.0/MIT stack (below); one shared LLM runtime; deterministic rules where possible; no GPU drivers, no cloud creds to rotate | doc/14 §3 |
| Patient safety / accuracy ceiling | Verify-default for handwriting (MIRAGE: zero-shot VLMs 2–7.6% F1; best fine-tuned 82% med-names-only, authors say "not deployable"); physician attestation; bbox grounding | doc/13 §2 |
| Licensing | PP-OCRv5/RapidOCR/Tesseract/docling-models = Apache-2.0; Qwen3 = Apache-2.0; SNOMED = free in-India affiliate license (MLDS registration + sublicense + usage reporting) | doc/14 §3, doc/16 §3 |
| SaMD posture | Module B intended-use = "digitizes and structures patient-carried documents for physician review" (Inform-clinical-management band); NO triage/diagnosis claims in Module B UI or copy | doc/16 §4 |

## 3. Model comparison under constraints (settled + rejected)

**Settled (decisions/06, 2026-09-11):**

| Role | Model | Why it passes every constraint |
|---|---|---|
| Primary OCR | **PP-OCRv5-mobile multilingual** (mobile det + 2M-param Devanagari rec) via RapidOCR/ONNX | Only lane with maintainer-published CPU latency+RAM (1.75 s, 2.2GB); Apache-2.0; 109 langs incl. Devanagari/Tamil/Telugu; offline; tiny footprint. Open risk: CPU tables are zh/en variants → M0 benchmark closes it |
| Fallback OCR | **Tesseract 5 hin+eng** | CPU-native; independently replicated Hindi accuracy (93%, ICON-2024); fully independent codebase covers all three primary failure modes (Paddle env fragility, Hindi-accuracy miss, RapidOCR det bottleneck); Apache-2.0; full Indic traineddata |
| Structurer | **llama.cpp + Qwen3** (Module A runtime, shared) | Apache-2.0; already budgeted in kiosk RAM plan (doc/09 §5); CPU-proven class; no new moving parts |
| Phase-2 VLM (gated) | **PaddleOCR-VL-1.6-GGUF** via llama.cpp | Apache-2.0; official GGUF + merged llama.cpp + accuracy parity (92.80 vs 92.86); only published Devanagari element metrics (edit dist 0.097). **Excluded from v1: zero published CPU latency** — admissible only if M0-benchmark extension shows p95 within dwell-time budget on the hard-page minority |

**Rejected, with constraint violated:**

| Candidate | Violated constraint / disqualifier | Source |
|---|---|---|
| DeepSeek-OCR(-2) | Indic accuracy: median CER 100%, 89% catastrophic repetition on real Devanagari prints; no CPU benchmark | arXiv:2606.29213 (doc/14 §3) |
| surya 2 | Weights OpenRAIL-M — $5M-revenue commercial clause (procurement risk); x86 CPU latency unpublished (only Apple-Silicon table) | doc/14 §2 |
| GraniteDocling-258M | English-only (no Devanagari); CPU reports 15–20 min/doc | doc/14 §2 |
| HunyuanOCR-1.5 | Tencent community license (territorial, AUP) — not clean OSS; no CPU latency | doc/14 §2 |
| dots.ocr / MonkeyOCR / MinerU2.5 / olmOCR / Unlimited-OCR / GLM-OCR | GPU-first, no credible CPU benchmark (hard constraint 1) | doc/14 §3 |
| Cloud OCR (Google Document AI etc.) | Offline + residency + $3,600/month at volume arithmetic | doc/13 §5 |
| Qwen3-VL-8B (local GGUF) | CPU cost 69.4 s/img + 10.8GiB RAM (E-ARMOR) — blows both latency and RAM ceilings | arXiv:2509.03615 (doc/14 §2) |

## 4. How: pipeline + memory budget

Flow (matches diagram): scan → preprocess → route → **primary** (fallback on failure) →
cross-engine voting → confidence gate → verify-default OR structure → FHIR bundle →
physician attest → ABDM sync (offline-queued).

**Memory budget (12–16GB profile, serial scheduling per doc/09 §6):**
- Resident: OS + Tauri/FastAPI + SQLCipher ≈ 1.5–2GB
- OCR stage (B3): RapidOCR onnxruntime session ≈ 0.5–1GB (measured at M0; Peak RAM 2.2GB per maintainer table) — released after page batch
- Structurer stage (B4): Qwen3-1.7B Q4 ≈ 1.5–2.5GB (doc/09 figure) — loaded on demand, shared with Module A sessions
- Headroom: ≥8GB for spikes, scan buffer, queue
- Watchdog ladder: primary → fallback → manual-entry flag (never blocks a patient)

**DPDP data flow rule:** raw scan held in transient session store; persisted into
DocumentReference only on physician attestation (or explicit patient choice for locker) —
retention decision is the team's, default transient.

## 5. Milestones (each with exit criteria)

| M | Deliverable | Exit criteria (all measured on real kiosk CPU, local eval set) |
|---|---|---|
| **M0** | Local eval set + harness (B9): consented real OPD scans (Hindi+English, print/hand mix, field-level GT); seed with MIRAGE-100 public subset + ClinOCR-Bench subsets | ≥200 pages annotated; harness reports field-CER, catastrophic-rate, p50/p95, peak RSS; DPDP-clean consent flow documented |
| **M1** | Classical lane (B1–B3): RapidOCR primary + Tesseract fallback + voting; OpenVINO vs onnxruntime A/B | Printed-page field-CER meets team-set threshold; p95 page ≤ dwell budget (~30s/page ceiling for queue-time processing); peak RSS ≤ 3GB for OCR stage; fallback trigger tested (fault injection) |
| **M2** | Structuring + coding (B4–B5): Qwen3 JSON extraction, medspaCy normalization, SNOMED/CDCI mapping (MLDS affiliate license done), confidence gate, bboxes | Med-name extraction F1 on eval set reported (vs MIRAGE 82% ceiling context); zero silent-guess policy verified (every low-conf field flagged); structurer latency p95 ≤ budget |
| **M3** | FHIR emission + review UI (B6–B7): NRCeS profiles, HAPI validation passes; physician attest flow | 100% of bundles validate against NRCeS IG; physician edit round-trip updates bundle + attester; usability check with ≥2 clinicians |
| **M4** | ABDM sync (B8) + phase-2 gate: sandbox integration (hospital HFR→HIP milestone path); PaddleOCR-VL-1.6-GGUF Q4/Q8 CPU benchmark on hard-page minority | Care-context linked in sandbox; **decision point:** VLM p95 within dwell budget on hard pages → include in v1 as router lane 2, else defer (default defer) |

**SIH demo note:** prototype remains Module A + simulated Module B token (doc/12 scope) —
this plan is the build plan, not the demo script.

## 6. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| RapidOCR det-stage bottleneck (issue #514: 2–3x slower det) | Medium | M1 A/B (onnxruntime vs OpenVINO); Tesseract fallback; pin RapidOCR version after measuring |
| Paddle/PaddleOCR env fragility (segfault reported in arXiv:2606.29213's env) | Medium | RapidOCR ONNX packaging avoids PaddlePaddle framework entirely; Tesseract independent |
| Handwriting accuracy ceiling (MIRAGE) | Certain (published ceiling) | Verify-default is the design, not a failure mode; physician attest; phase-2 VLM gate |
| Qwen3 structurer hallucination | Medium | Temperature 0 + JSON-schema constrained decoding; every field needs OCR-text evidence span (grounding); reasoning modes OFF (arXiv:2605.24902: reasoning hurts fidelity) |
| Multilingual rec model Hindi accuracy unmeasured | Medium | M0 closes it before M1 hardens; Tesseract floor + voting |
| ABDM sandbox process slower than build | Medium | M4 last; offline queue designed first; sandbox account requested at M0 |
| SNOMED/CDCI mapping coverage gaps (trade names → CDCI) | Medium | medspaCy normalization + unmapped-trade-name → physician free-text path (never block) |
| Kiosk RAM contention with Module A | Medium | Serial scheduler + watchdog (doc/09 §6); measure combined profile at M1 |

## 7. Not decided here (team ratification needed)

1. Router thresholds (printed vs handwriting confidence cut) — set from M0 measured distributions, not guessed.
2. Retention policy (transient vs locker persist) — DPDP posture decision.
3. Phase-2 VLM inclusion — M4 gate, default defer.
4. Whether red-flag escalation copy (Module A) needs regulatory-counsel review given CDSCO "drive clinical management" wording (doc/16 §4 flag).
5. Deployment model confirmation (hospital-HIP default vs kiosk-operator HRP arrangement).
