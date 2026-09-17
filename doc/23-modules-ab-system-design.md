# 23 — Modules A + B Integrated System Design

> **Status:** Design draft for team ratification (2026-09-16). Research/design only — **no code**.
> **Scope:** the *integrated* system formed by Module A (conversational history capture,
> voice + touch) and Module B (physical-document digitization) running on one kiosk and one
> hospital edge node.
> **What this doc is not:** it does not replace `doc/09` (Module A design), `doc/17`/`doc/20`
> (Module B plan + production design), or `doc/19` (production blueprint). It is the missing
> layer between them: **the shared runtime, the A↔B session lifecycle, the scheduling that keeps
> them from starving each other, the joint output contracts, and the joint failure behaviour.**
> Where a detail is owned by another doc, it is cited, not repeated.
> **Read with:** `doc/01`, `doc/08`, `doc/09`, `doc/13`–`doc/17`, `doc/19`, `doc/20`,
> `doc/02`+`doc/03` (clinical field model), `doc/04` (note formats), `decisions/06`, `research/07`.

---

## 0. The integration problem in one paragraph

Module A and Module B were designed separately, each against a **~4–8 GB CPU-only kiosk**. Both
want the same scarce resource — the CPU/RAM of a single kiosk — and both want it *at the patient's
turn*. A is **interactive** (a 2–5 min conversation, latency-critical, must never stutter); B is
**bursty batch** (a handful of pages, 2–5 s/page, can wait). They also share one inference runtime
(llama.cpp/Qwen3), one consent token (Module D), one canon (`HistoryBundle`), and one write path to
Module C. This doc designs that sharing so that the *combined* system still honors all seven
production invariants (`doc/19 §0`) — in particular **never block care** and **never fabricate**.

**Central design decision of this document:** a **single-slot, priority-preemptive scheduler** owns
the kiosk's heavy stages, with **A always preempting B**, a **model-residency policy** for the
shared LLM runtime, and an explicit **compute-placement matrix** (kiosk vs edge) that degrades
gracefully on the smallest hardware.

---

## 1. Step 1 — Scope

### 1.1 Users and contexts

| Actor | Context | Needs |
|---|---|---|
| Patient (or proxy/attendant) | Standing at a public-OPD kiosk, 2–5 min of doctor time, may be first-time / elderly / low-literacy / Hindi-Hinglish speaking | Speaks naturally, touches a screen, gets a spoken read-back; never made to wait on a machine |
| Physician | 2–5 min consult at the desk | One honest, provenance-carrying summary that shows what was captured, what is uncertain, and what is missing |
| Nurse/attendant (queue-time) | Staffing the queue | Escalation acknowledgement for red flags; can hand a patient to the kiosk |
| Kiosk operator | Device upkeep only | Device health; **no PHI browsing** |

### 1.2 Functional requirements

**Module A (history capture) — `A-FR`:**
- **A-FR1** Capture an open free narrative before structured questions.
- **A-FR2** Run a deterministic dialogue FSM through: complaint → SOCRATES/HPI (non-pain adaptation) →
  red-flag screening → PMH/surgical → medications → allergies → family/social → focused ROS → ICE →
  read-back. Dashavidha = optional second layer.
- **A-FR3** Voice + touch are co-equal for every important answer; every prompt has audio and visual form.
- **A-FR4** Deterministic red-flag classifier (never an LLM); hit → priority escalation, not routine queue.
- **A-FR5** Every slot carries a state (`captured` / `needs_review` / `not_answered` / `not_elicited`)
  and provenance (`by` patient/proxy, `voice` true/false).
- **A-FR6** Spoken read-back in the patient's language; confirmation captured but **never clears a
  machine verify-flag** (invariant 4).
- **A-FR7** Emit `medikiosk-history-bundle/1` (already consumed by `module-c/medic/contracts.py`).
- **A-FR8** Offline by default; queue handoff when the LAN is down.

**Module B (document digitization) — `B-FR`:**
- **B-FR1** Accept scanner/camera pages; deskew, illumination-normalize, DPI-normalize.
- **B-FR2** Route each page (`printed` / `handwritten` / `lab-table`) and pick a lane.
- **B-FR3** OCR with a primary + independent fallback + cross-engine per-field voting.
- **B-FR4** Structure OCR text → meds/doses, lab values, diagnoses, dates; never invent a field.
- **B-FR5** Per-field confidence gate + bbox grounding; low-confidence/handwritten → `verify`, not guess.
- **B-FR6** Emit a DocumentBundle (raw scan → DocumentReference; meds → MedicationRequest; labs →
  Observation; dx → Condition), NRCeS-shaped, structurally validated.
- **B-FR7** Emit the physician review payload; corrections round-trip into the bundle + attester.
- **B-FR8** Offline; queue ABDM sync (owned by Module D / B8; out of scope here).

**Joint requirements — `J-FR`:**
- **J-FR1** One `session_id` spans the whole encounter: A interview → B scans → merge → C. A and B
  results land in **one canon**; no module renders from raw transcripts or raw scans (`doc/19 §5`).
- **J-FR2** A failing must not stop B and B failing must not stop A; neither may produce a fabricated
  field as a fallback.
- **J-FR3** The two shared resources — CPU/RAM and the shared LLM runtime — are arbitrated by one
  scheduler with a defined priority and watchdog.
- **J-FR4** One consent gate (Module D token) governs both A capture and B scanning.

### 1.3 Non-functional requirements (hard constraints — do not design around)

| # | Constraint | Source |
|---|---|---|
| N1 | **Offline-first.** No runtime network dependency on any clinical path. | `doc/09 §1`, `doc/19 §3` |
| N2 | **CPU/iGPU only, ~4–8 GB kiosk RAM, no dGPU.** | `doc/09 §1` (grounded 2026-09-11) |
| N3 | **India data residency.** No PHI leaves India; no third-party cloud on a PHI path. | `doc/16 §1` |
| N4 | **Never run ASR + OCR + LLM concurrently** on a kiosk CPU. | `doc/09 §6`, `doc/17 §4` |
| N5 | **Never diagnose / never fabricate / never silently resolve / never let a machine clear uncertainty.** | `doc/19 §0` |
| N6 | **Never block care on a failure** — degrade to a safe usable fallback. | `doc/19 §0` |
| N7 | **Session completion ≥ 80%** and **p95 page-processing within the dwell budget**. | `doc/19 §8`, `doc/17 §5` |

### 1.4 Out of scope for this document

Module C rendering/emission, Module D consent/ABDM specifics, diagnosis/treatment logic, the SIH demo
script, 22-language breadth (v1 = Hindi + English + Hinglish), billing/EHR functions.

### 1.5 Assumptions and open decisions

| # | Decision | Options | Recommendation | Owner | Status |
|---|---|---|---|---|---|
| AB-D1 | Deployment topology | thin kiosk + edge node vs standalone kiosk | **thin kiosk + edge node** (`doc/19` D1) | Eng + hospital IT | Inherited, unratified |
| AB-D2 | Which heavy stages are kiosk-resident | all-resident vs **minimal-resident + edge offload** | **minimal resident** (§4.4): VAD, small ASR, FSM, red flags, TTS, OCR, deterministic structurer. LLM structurer = optional/edge | Eng | **OPEN — decide before build** |
| AB-D3 | B scheduling relative to A | strictly after session vs queue-time vs interleaved | **queue-time/after-read-back, preemptible by A** (§3.5) | Eng + clinical | **OPEN** |
| AB-D4 | Shared LLM residency | always resident vs load-on-demand vs edge-only | **load-on-demand with eviction** (§4.3) | Eng | **OPEN** |
| AB-D5 | Kiosk RAM target | 4 GB vs 8 GB | **8 GB for a combined A+B kiosk**; 4 GB is touch+basic-OCR only (§4.4) | Eng + procurement | **OPEN — blocks procurement** |
| AB-D6 | A and B on the same physical device? | yes (this doc) vs separate kiosks | **same device** — the PS is one patient-facing platform | Product | Assumed |

---

## 2. Step 2 — Back-of-envelope (validate scale fitness)

Numbers are **estimates for sizing**, not vendor guarantees; per-module measured figures are cited.
Anything not measured is marked `est`.

### 2.1 Load

| Quantity | Value | Basis |
|---|---|---|
| OPD registrations/day (design peak) | 10,000 | `doc/01` |
| OPD hours/day | 10 | assumption |
| Arrival rate | ~1,000/h ≈ **0.28 patients/s** | derived |
| Session length (A interview) | **2.5 min** | `doc/09 §6` |
| Sessions per kiosk per day | **~240** | `doc/09 §6` (before breaks/cleaning/abandonment) |
| Kiosks for 4,000/day | **~17** | `doc/09 §6` |
| Kiosks for 10,000/day | **~42** | `doc/09 §6` |
| Pages per session (B) | ~2–4 `est` | design assumption |
| Kiosk CPU stages per session | A: VAD (continuous), ASR (~N s), NLU (~N×0.3 s), TTS (~N×2 s); B: ~2–4 × (OCR + structure) | derived |

### 2.2 Latency budgets

| Path | Budget | Why |
|---|---|---|
| A turn-around (patient speaks → next prompt) | **≤ 1.5 s p95** target `est` | Conversational; above ~2 s the interview feels broken |
| A ASR segment finalization | ≤ 2 s per segment `est` | Segmented, not double-talk |
| A red-flag decision | **< 50 ms** | Deterministic rules, must be instantaneous |
| B page processing | **p95 ≤ 5 s/page** | `doc/19 §8` budget; measured 3.2 s p95 on a dev laptop (`research/05`, 2026-09-11) |
| B queue-time ceiling | ~30 s/page `est` | `doc/17 §5` dwell budget when B must not block |
| C render + emit | milliseconds | deterministic; never the bottleneck (`doc/19 §9`) |

**The binding latency truth:** A is on the critical path of the patient conversation; B is not.
That asymmetry is the whole reason B is preemptible.

### 2.3 Memory budget (the binding constraint)

Resident + peak figures from the module docs; these **cannot all be resident at once** (N4).

| Stage | Footprint | Source |
|---|---|---|
| OS + shell (Tauri) + FastAPI + SQLCipher | ~1.5–2.0 GB | `doc/09 §5`, `doc/17 §4` |
| VAD (Silero) | ~2 MB, resident | `doc/09 §5` |
| ASR — whisper.cpp small Q5/Q8 | ~0.8–1.5 GB, during speech | `doc/09 §5` |
| NLU — Qwen3-1.7B Q4 via llama.cpp | ~1.5–2.5 GB, on demand | `doc/09 §5` |
| OCR — RapidOCR PP-OCRv5-mobile (ONNX) | ~0.5–1 GB session; **2.2 GB peak** (maintainer, Xeon) | `doc/17 §2/§4` |
| Structurer — Qwen3 shares the NLU runtime | 0 (shared) or ~1.5–2.5 GB if separate load | `doc/17 §4` |
| TTS — sherpa-onnx voice | ~100–300 MB/voice | `doc/09 §5` |

**Derived verdict:**
- **4 GB kiosk:** resident (~2 GB) + one heavy stage (~1.5–2.5 GB) is already borderline. A full
  ASR→NLU→OCR sequence is impossible without eviction; **LLM structuring must be off-device or
  replaced by the deterministic rules engine**; OCR + ASR is the practical ceiling. → **4 GB = touch-first,
  OCR-only fallback profile.**
- **8 GB kiosk (recommended for a combined device):** resident + one heavy stage comfortably;
  serial A and B with a watchdog between stages; LLM structurer admissible only when A is idle.
- **Edge node (16–32 GB):** hosts LLM structurer for B, HAPI validation, and any batch re-runs.

### 2.4 Storage and sync

| Tier | Contents | Per-session size `est` | Retention |
|---|---|---|---|
| Kiosk T1 (SQLCipher) | session canon, transcript excerpts, unsynced queue | 5–20 KB JSON | deleted on sync + session end |
| Kiosk T1 transient | raw scan pages (if not persisted) | 2–4 pages × 1–3 MB ≈ **2–12 MB** | deleted on session end / attestation |
| Kiosk ring buffer | raw audio | 2.5 min × 16 kHz × 16-bit ≈ **~4.8 MB** | deleted after transcription (unless consented) |
| Edge T2 (PostgreSQL/HAPI) | validated FHIR, audit log | KB-scale per session | per hospital policy + DPDP |
| Vendor T4 | aggregates only, **no PHI** | KB | 13 months (`doc/19 §5`) |

Fleet-wise: 240 sessions/kiosk/day × ~12 MB transient ≈ **~3 GB/kiosk/day** of transient scan data,
continuously reclaimed. The design never accumulates raw scans kiosk-side beyond a session.

### 2.5 Capacity verdict

The topology is **fit for purpose with the thin-kiosk + edge shape (AB-D1)**, provided:
1. Heavy stages are **serial** (N4) and B is **preemptible** (AB-D3);
2. A combined A+B kiosk is **8 GB** (AB-D5), or 4 GB with LLM structuring offloaded (AB-D2);
3. OCR stays kiosk-resident because offline-first (N1) forbids depending on the edge for a clinical path.

---

## 3. Step 3 — High-level design

### 3.1 Topology (inherits `doc/19 §3`, specialised for A+B)

```
        ┌──────────────────────── KIOSK (thin) ────────────────────────┐
        │  touchscreen + directional mic + scanner/camera              │
        │  AR M/i3-class, **8 GB** (AB-D5), no dGPU                      │
        │                                                               │
        │   ┌─ Single-slot scheduler (§3.4) ─────────────────────────┐  │
        │   │  priority: A-voice > A-nlu > A-tts > B-ocr > B-struct   │  │
        │   └─────────────────────────────────────────────────────────┘  │
        │      │                     │                    │             │
        │   A pipeline            B pipeline          C-lite            │
        │   VAD→ASR→NLU→FSM      intake→router→      deterministic      │
        │   →red flags→TTS       OCR→vote→struct    render (ms)        │
        │   →HistoryBundle       →DocumentBundle                        │
        │      │                     │                                  │
        │   SQLCipher canon + transient store + outbox                  │
        └──────────────────────────┬────────────────────────────────────┘
                                   │ LAN (Zone A – no internet)
        ┌──────────────────────────▼──────────────── EDGE NODE ────────┐
        │  CPU inference tier (16–32 GB) + HAPI FHIR + PostgreSQL       │
        │  - LLM structurer for B (when kiosk is RAM-bound)             │
        │  - NRCeS profile validation (ndhm.in package)                 │
        │  - ABDM sync / queue drain (Module D, B8)                     │
        │  - central logs/metrics/backup (no PHI in vendor zone)        │
        └──────────────────────────┬────────────────────────────────────┘
                                   │ LAN (Zone B – firewalled, outbound-only)
                          Hospital HIS / ABDM gateway (HIP)
```

**Why this shape:** A must run alone when the LAN drops (so ASR, FSM, red flags are local);
B must also produce a result offline (so OCR is local); the heavy, non-real-time and Java-bound work
(LLM structuring, profile validation, ABDM) lives on the edge and degrades without blocking.

### 3.2 End-to-end session flow

```
Module D ──opaque token {session_id, consent_ref, purposes, lang, retention}──► kiosk
   │
   ├─(1) Consent gate: no extraction before a valid consent artefact (A and B share this gate)
   │
   ├─(2) A: free narrative → segmented ASR → NLU slot-fill → FSM picks next prompt
   │        └── red-flag rules run on every final segment (deterministic, <50 ms)
   │            └─ hit → escalate + staff ack gate + priority mode; capture continues (decided)
   │
   ├─(3) A: full interview → HistoryBundle v1 (slots + states + provenance + red flags)
   │
   ├─(4) A: spoken read-back → confirmation captured (does NOT clear verify-flags)
   │
   ├─(5) B: scanner/camera pages enqueued (queue-time or after read-back, preemptible)
   │        intake → route → OCR(primary/fallback) → voting → structure → confidence gate
   │        → DocumentBundle + review payload (verify-default on handwriting/low-conf)
   │
   ├─(6) MERGE: HistoryBundle + DocumentBundle → one canon (Module C merger)
   │        meds reconciled (patient-stated vs document-derived), conflicts keep BOTH + needs_review
   │
   ├─(7) Physician review/attest (B7 + C5): corrections round-trip; only attestation clears verify
   │
   └─(8) Outbox → edge → HIS/ABDM (Module D/B8)   +   transient data purged per retention rule
```

Steps (2)–(4) are A on the critical path. Step (5) is B, off the critical path. Steps (6)–(8) are
shared downstream.

### 3.3 Component map (A and B) with build status

| ID | Component | Doc owner | Status |
|---|---|---|---|
| A1 | VAD + audio front-end (Silero + WebRTC APM) | `doc/09 §5` | To build |
| A2 | ASR adapter (whisper.cpp baseline; pluggable bake-off) | `doc/09 §5` | To build |
| A3 | Dialogue FSM (`pytransitions`) | `doc/09 §4` | To build |
| A4 | Slot schema (SOCRATES + Dashavidha v2; `not_elicited` first-class) | `doc/09 §2` | Spec'd |
| A5 | Red-flag classifier (deterministic, 12 rules designed) | `doc/09 §2`, research log 2026-09-16 | Rules designed |
| A6 | HistoryBundle producer | this doc §4.5 + `contracts.py` | To build |
| A7 | Local TTS (`sherpa-onnx`, per-voice licence) | `doc/09 §5` | To build |
| A8 | Store + resume (SQLCipher WAL) | `doc/09 §5` | To build |
| B1 | Intake + DPDP consent gate | `doc/20 §B-*` | **Built** (real) |
| B2 | Page router | `doc/20` | **Built** (thresholds placeholder) |
| B3 | Engines + fallback + voting | `doc/20 §B-B` | **Built** (Tesseract binary not installed on dev) |
| B4 | Structurer (rules real; LLM adapter untested) | `doc/20` | Partly built |
| B5 | Confidence gate (bbox grounding) | `doc/20` | **Built** |
| B6 | FHIR emitter | `doc/20 §B-C/B-D` | **Built** (structural validation only; profile validation M3) |
| B7 | Physician review payload | `doc/20 §B-E` | Payload built; UI M3 |
| B8 | ABDM sync | Module D | Not implemented |
| B9 | Eval harness | `doc/20 §B-A` | **Built** (page-CER only — field-CER is M0 work) |
| J1 | **Single-slot scheduler** | this doc §3.4 | **New — to build** |
| J2 | **Shared LLM runtime manager** | this doc §4.3 | **New — to build** |
| J3 | **Merge/canon** | Module C (`medic/merger.py`) | **Built** |

### 3.4 Kiosk runtime and concurrency model — single-slot scheduler

**Problem.** A and B are two pipelines sharing one CPU, one RAM budget, and one LLM process. Naive
threading violates N4 (co-run ASR + OCR + LLM) and N6 (OOM kills the session).

**Design.** The kiosk runs a **single-slot scheduler**: exactly **one heavy stage is resident at a
time**, guarded by a memory watchdog. Stages request a lease; the scheduler grants by priority and
evicts/defers lower-priority work.

```
Lease priorities (high → low):
  1. A_REDFLAG      (deterministic, always granted, <50 ms, never queued)
  2. A_ASR          (during speech; preempts everything except red flags)
  3. A_NLU          (after a segment; preempts B)
  4. A_TTS          (prompt playback; short)
  5. B_OCR          (batch; yields to any A stage)
  6. B_STRUCTURE    (batch; yields; may be offloaded to edge)
  7. SYNC_DRAIN     (background; yields to all of the above)
```

Rules:
- **A always preempts B.** A preempted B page is checkpointed at a page boundary (B is page-atomic,
  §4.2), never mid-field, so preemption cannot half-extract a document.
- **Red flags are not a lease** — a cheap synchronous rule pass that can always run.
- **Watchdog ladder** on allocation failure: primary engine → fallback engine → manual/touch-entry
  flag (A) or verify-default with no extraction (B). Never a fabricated field, never a dead kiosk.
- **Model eviction:** the shared LLM (§4.3) is unloaded when neither A_NLU nor B_STRUCTURE holds a
  lease for a grace period.
- **Throughput rule:** B work that cannot fit between A sessions is carried to the queue-time / edge
  window; it is never forced onto A's critical path.

### 3.5 Scheduling state machine (kiosk)

```
IDLE ──start(consent ok)──► A_NARRATIVE ──► A_STRUCTURED (loop) ──► A_READBACK
  ▲                              │                                     │
  │                              │ red-flag hit                        │ readback done
  │                              ▼                                     ▼
  │                          ESCALATE ──ack──► A_STRUCTURED       B_QUEUED
  │                                                                    │
  │                                            ┌── A stage requested ──┤
  │                                            ▼                       ▼
  │                                        (preempt B)            B_OCR/B_STRUCT
  │                                            │                       │
  └──────────── session end / purge ◄──────────┴───── MERGE_READY ◄────┘
```

| State | Resident stage | What can preempt |
|---|---|---|
| `A_NARRATIVE` | ASR (during speech) | red-flag rule pass only |
| `A_STRUCTURED` | NLU / FSM | ASR when patient speaks |
| `A_READBACK` | TTS | ASR (patient may correct) |
| `ESCALATE` | none (UI + notification) | — |
| `B_OCR` / `B_STRUCT` | OCR / structurer | **any A stage** |
| `SYNC_DRAIN` | outbox flusher | any A or B stage |
| `MERGE_READY` | — (Module C, ms) | — |

---

## 4. Step 4 — Deep dives

### 4.1 A pipeline (interactive, latency-critical)

The A design is owned by `doc/09 §4`. The integration-relevant points:

- **Audio front-end (A1):** VAD resident (~2 MB); ring buffer **transient**; raw audio deleted after
  transcription unless Module D's consent explicitly permits retention (`doc/09` req 11).
- **ASR (A2):** segmented near-real-time, small quantized model; pluggable adapter so the bake-off
  (`doc/09 §10`) can swap engines without touching the FSM. Medical-vocabulary bias for drug names,
  anatomy, complaint lexicon (`doc/08 §1`).
- **NLU (A3/A4):** `llama.cpp` + Qwen3-1.7B Q4, **constrained JSON to the slot schema**, `temperature 0`,
  a refusal value (`unknown`) instead of a guess, and `not_elicited` as a first-class state — this is
  what makes fabrication *structurally* impossible for unasked fields (`doc/09 §2`, arXiv:2608.26167).
- **Red flags (A5):** deterministic rules only, versioned, clinician-signed, evidence-tagged
  (`doc/09 §2`, research log 2026-09-16: 12 production candidates). Never an LLM decision. Runs on
  every final segment **outside** the scheduler queue.
- **Read-back (A-FR6):** spoken in the patient language; confirmation is recorded as provenance but
  **does not clear a machine verify-flag** (invariant 4).
- **Output (A6):** `medikiosk-history-bundle/1` exactly as parsed by `module-c/medic/contracts.py`
  (see Appendix A).

**A's failure ladder:** ASR timeout/OOM → smaller model → touch-entry questions; NLU timeout →
deterministic slot parser + re-ask; TTS failure → pre-recorded bilingual prompts + on-screen text.
Every rung is a safe, usable fallback (N6).

### 4.2 B pipeline (batch, preemptible)

The B design is owned by `doc/17`/`doc/20`. Integration-relevant points:

- **Page atomicity.** A page is the unit of work and the unit of preemption: intake → OCR → vote →
  structure → gate for one page completes before yielding. This makes B safely interruptible by A
  and makes the confidence gate always evaluate a complete page (`doc/20`).
- **Routing (B2)** selects the lane; OCR runs before classification in the current implementation
  (`pipeline.py:57–64`) because routing needs OCR stats — an intentional ordering to preserve.
- **Fallback + voting (B3):** RapidOCR primary + Tesseract fallback; cross-engine per-field voting is
  a free confidence signal. The watchdog ladder is `engine_error → low_field_confidence →
  empty_result` (`config.py:17`).
- **Verify-default (B5):** handwriting / low-confidence fields are `verify`, carry a source bbox, and
  never silently clear — the same posture as A's `needs_review`.
- **Known defects to fix before the combined path is trusted** (from the independent audit, research
  log 2026-09-16): (a) `fhir_emitter` reads `any_verify` from the wrong level, so status is always
  `final`; (b) `vote_bonus_agree`/`vote_penalty_disagree` are dead config
  (`voting.py:25` hardcodes them). Both must be fixed and tested before B8/attestation is wired.
- **Structurer (B4):** deterministic rules engine is the **default and the offline floor**; the
  llama.cpp/Qwen3 adapter is optional. On a 4 GB kiosk it is offloaded or disabled (AB-D2).

### 4.3 Shared inference runtime (the riskiest shared dependency)

A_NLU and B_STRUCTURE both want Qwen3 via llama.cpp. This is the single largest source of RAM
contention in the combined system.

**Design — one runtime, one model, one lease:**
- A single `llama-server` process (or in-process `llama.cpp`) hosts **Qwen3-1.7B Q4**; both
  consumers speak the same constrained-JSON interface (`MEDIB_LLM_URL`, `config.py:29`).
- The runtime is **load-on-demand** behind a scheduler lease (`A_NLU` / `B_STRUCTURE`); it is
  evicted after an idle grace period (AB-D4).
- **Serial use only.** A_NLU and B_STRUCTURE never overlap; the LLM is never resident during A_ASR
  or B_OCR (N4).
- **On a 4 GB kiosk:** the LLM is not kiosk-resident at all. A uses the deterministic slot parser
  fallback; B uses the deterministic rules structurer. This is the designed degradation, not a bug.
- **On the edge node:** the LLM structurer can run for B (batch), which is where a larger model or a
  hard page can be escalated without touching A's latency.

**Open risk (`AB-D4`):** the actual combined peak (ASR loaded while LLM evicted/loading) is
**unmeasured**; the M1 combined-profile benchmark (`doc/17 §5`) must measure it on real kiosk CPU.

### 4.4 Compute placement matrix (where each stage runs)

| Stage | 4 GB kiosk | 8 GB kiosk | Edge node | Rationale |
|---|---|---|---|---|
| VAD | kiosk | kiosk | — | Must be resident for A |
| ASR | kiosk (small) | kiosk | — | Offline clinical path (N1) |
| FSM / red flags | kiosk | kiosk | — | Deterministic, tiny, latency-critical |
| TTS | kiosk | kiosk | — | Offline, patient-facing |
| OCR | kiosk | kiosk | optional assist | Offline-first requires local OCR |
| Structurer (rules) | kiosk | kiosk | — | Deterministic, cheap |
| Structurer (LLM) | **no** | optional / edge | **yes** | RAM contention with A_NLU |
| FHIR profile validation | edge | edge | **yes** | HAPI/Java, not real-time |
| ABDM sync | edge | edge | **yes** | Module D owns it |

### 4.5 Contracts and data flow

Three contracts bind A+B together; two already exist as code.

1. **`medikiosk-history-bundle/1`** — A's output, defined and enforced in
   `module-c/medic/contracts.py` (`HISTORY_SCHEMA`, `Slot`, `HistoryBundle`). Slot states
   `captured` / `needs_review` / `not_answered` / `not_elicited`; per-slot provenance `by`/`voice`/`conf`;
   red flags; `session_id`/`consent_ref`/`patient_ref` required. **A6 must emit exactly this.**
2. **Document side (`DocumentSide`)** — B's output, accepted either as a medib `run_summary` dict or
   as a FHIR DocumentBundle (`contracts.py:222`). Fields: `meds`, `labs`, `dx`, each with
   `verify` + `conf` + `source_doc`; `has_raw_scan`; `persist_raw`.
3. **The merge (J3)** — Module C's `merger.py` reconciles A meds vs B meds (unit-tolerant dose
   comparison), flags real conflicts as `needs_review` and **retains both values** (invariant 3),
   dedupes across documents, compiles abnormal labs, and orders the physician alert list
   **red flags → B verify flags → abnormal labs** (`module-c/README.md`). A and B must both keep
   provenance precise enough for this merge to be lossless.

**Field-identity convention:** every canon field gets a stable id (`A:<slot>` for A,
document-derived ids for B). Every rendered line back-references a canon field id — that is what
makes "never fabricate" *verifiable* (`doc/19 §5`). **`SessionManager.attach(a_bundle, b_bundle)`
must not renumber A ids** when B attaches.

### 4.6 Storage tiers and session lifecycle

Uses `doc/19 §5` tiers. A+B specifics:

- **Audio** lives only in an encrypted ring buffer; deleted after transcription unless consent allows.
- **Raw scans** live in transient T1; persisted into a DocumentReference only on attestation or
  explicit patient choice (`persist_raw_scan_default: False`, `config.py:33`).
- **Canon** is the only thing that survives to the edge, and only after sync.
- **Session end / walk-away purge:** a defined TTL purges transient A+B artefacts; the canon/outbox
  is retained only while unsynced and within the retention clock.
- **Power loss:** both pipelines recover from SQLCipher WAL; a partial A tuple or partial B page is
  never promoted to the canon (`doc/19 §8`).

### 4.7 Failure, degradation ladder, and fault isolation

| Failure | A behaviour | B behaviour | Joint guarantee |
|---|---|---|---|
| LAN down | Fully functional offline | Fully functional offline (OCR local) | Both queue; auto-sync later (N1/N6) |
| ASR OOM / timeout | smaller model → touch-only | — | Interview completes (N7) |
| OCR engine crash | — | fallback engine → verify-default, no extraction | Never a fabricated field (N5/N6) |
| LLM unavailable | deterministic slot parser | deterministic rules structurer | **This is the designed floor — never a dead end** |
| Edge node down | unaffected | kiosk-side OCR/structurer continues | Kiosks keep capturing; backlog drains later |
| Disk full | evict oldest synced transient data; hard stop before corruption | same | No corruption; safe stop |
| Shared LLM contention | A_NLU preempts B_STRUCT | B yields at page boundary | A latency preserved |
| Red flag | escalate + ack gate; capture continues | unaffected | Priority handoff, not a dead end |
| Malformed model output | schema validation rejects → rules fallback | schema validation rejects → verify-default | Reject, never accept garbage |

**Fault-isolation rule:** A and B share the store and the scheduler but **not a transaction**. A B
failure can never roll back or corrupt a captured A slot, and vice-versa; the canon is written by
the merge step only.

### 4.8 Security and consent boundary

- **One gate for both:** the Module D token's `consent_ref` is required before A capture and before
  B extraction (`module-b/medib/intake.py` already enforces the B side). Purposes are **itemised**
  (intake, summary generation, physician handover, ABDM upload) and independently revocable
  (`doc/22 §D-B`).
- **Zone isolation:** kiosks never touch the internet (Zone A); only the edge talks to the ABDM
  gateway (Zone B); the vendor zone (C) is PHI-free (`doc/19 §3`).
- **No PHI in logs/telemetry** — test-enforced (`doc/19 §6`).
- **At rest:** SQLCipher AES-256 on the kiosk; DB/disk encryption on the edge.
- **Threat surfaces specific to A+B:** adversarial text inside a scanned page attempting to steer the
  structurer (poisoned-upload), and model/prompt injection via patient speech. Mitigations: the B
  structurer is deterministic by default with OCR-evidence grounding; A's NLU is constrained-JSON
  with a refusal value and the LLM never owns state (`doc/19 §6`).

### 4.9 Observability (shared, no PHI)

Shared metrics keyed by `session_id` (no PHI in the id, `doc/19 §5`): per-stage latency p50/p95
(A_ASR, A_NLU, A_TTS, B_OCR, B_STRUCT), ASR/OCR confidence distributions, red-flag hit rate,
attestation rate, sync backlog depth, scheduler preemption count, OOM/watchdog trips, resource peaks.
Alerting: kiosk down in OPD hours, sync backlog > threshold, watchdog-trip spike, disk/memory
pressure (`doc/19 §12`).

---

## 5. Step 5 — Wrap-up

### 5.1 Top bottlenecks

1. **Kiosk RAM (single, hard).** A+B+LLM cannot co-reside; the scheduler + compute-placement matrix
   is the mitigation, and **AB-D5 (8 GB)** decides how much of B can be local.
2. **A's Hindi/Hinglish accuracy in OPD noise (R1).** Dominant lever is physical acoustics, not
   model choice (`doc/08 §6`); the bake-off gate is the mitigation.
3. **B's real-page accuracy is unmeasured.** All synthetic; the M0 eval set is the gate; until then
   B thresholds are placeholders and verify-default is the only honest posture.

### 5.2 What changes at 10x

At hospital-group scale (P-Multi-site, `doc/19 §3`): per-site edge + central PHI-free ops; federated
identity; edge-side batching of B and A_NLU moves the LLM off kiosks entirely; consistent-hashing
for sync shard distribution becomes relevant. None of this changes the kiosk contract.

### 5.3 Risks (A+B specific)

| Risk | Impact | Mitigation |
|---|---|---|
| AB-D5 unresolved (4 GB procured) | Cannot host combined A+B properly | Decide before procurement; 4 GB profile = reduced feature set |
| Shared LLM contention measured worse than designed | A latency regressions | Serial lease + A-preempts-B + deterministic floor; measure at M1 |
| B preemption leaves partial artefacts | Corrupt canon | Page-atomic checkpointing; canon written only by merge |
| Known B defects ship into the combined path | Attestation falsely `final` | Fix `any_verify` + dead `vote_*` before wiring B8/attestation |
| A and B disagree on a medication | Hidden conflict | Merge keeps both + `needs_review` (invariant 3), already implemented in C |
| Offline path silently depends on the edge | Dead kiosk when LAN down | Kiosk-resident OCR + rules structurer; edge is assist-only |

### 5.4 Open decisions and next steps

| # | Decision | Blocking | Owner |
|---|---|---|---|
| AB-D2 | kiosk vs edge placement of LLM structuring | Build | Eng |
| AB-D3 | B queue-time window (before vs after A read-back) | UX + build | Eng + clinical |
| AB-D4 | shared LLM residency policy | Build | Eng |
| AB-D5 | kiosk RAM target (4 vs 8 GB) | **Procurement** | Eng + procurement |
| — | Combined-profile M1 benchmark (ASR+OCR+LLM peak) | AB-D2/D4 depend on it | Eng |
| — | Fix `any_verify` + dead `vote_*` in `module-b` | Combined-path trust | Module B lead |
| — | A6 emits exactly `medikiosk-history-bundle/1` | Merge correctness | Module A lead |
| — | Real-OPD M0 eval set (B thresholds) | B thresholds | Clinical + Eng |
| — | Red-flag rule set clinician sign-off (CDSCO wording) | Regulatory | Clinical + counsel |

---

## Appendix A — Interface reference (grounded in code)

**HistoryBundle v1** (`module-c/medic/contracts.py:53`): schema string
`medikiosk-history-bundle/1`; required `session_id`, `consent_ref`, `patient_ref`; `socrates` must
contain all 8 slots (`site, onset, character, radiation, associations, timing, exacerbating,
severity`); each slot `{state, value, by, voice, conf}` with `state ∈
{captured, needs_review, not_answered, not_elicited}`; `ice` slots `ideas/concerns/expectations`;
plus `medications`, `allergies`, `family`, `social`, `ros`, `red_flags`, optional `dashavidha`,
`respondent`, `visit`.

**DocumentBundle / DocumentSide** (`contracts.py:207`): `meds[{name, dose, frequency, duration,
verify, conf, source_doc}]`, `labs[{name, value, unit, verify, conf, source_doc}]`,
`dx[{text, verify, conf, source_doc}]`, `has_raw_scan`, `persist_raw`, `bundle_id`. Accepted forms:
medib `run_summary` dict or FHIR `Bundle` (`contracts.py:222`).

**Medib run summary** (`module-b/medib/pipeline.py:128`): `n_pages`, `pages[]`
(`PageResult.to_dict`: `image, page_type, router_signals, engine, watchdog_ladder, n_lines,
engine_elapsed_s, structured, verify, review_fields, session_id, any_verify, ocr_text`),
`manifest`, `bundle`, `fhir_validation_errors`, `engines_used`, `pages_needing_verify`.

**Config touchpoints:** `module-b/medib/config.py` (`handwriting_if_avg_line_conf_below`,
`table_if_col_alignment_score_above`, `field_conf_threshold`, `persist_raw_scan_default`,
`llm_url`); all thresholds are placeholders pending M0.

---

## Appendix B — Traceability (what this doc adds vs what it cites)

| Topic | Owned by | This doc adds |
|---|---|---|
| A pipeline internals | `doc/09` | Its place in the shared scheduler + contract emission |
| B pipeline internals | `doc/17`, `doc/20` | Page-atomic preemption + compute placement |
| Topology, invariants, tiers | `doc/19` | The A+B-specific runtime/scheduler between them |
| Consent/ABDM | `doc/22` | The shared consent gate at the A+B entry point |
| Canon rendering | `doc/18`, `doc/21` | The A→B→C merge handoff |
| Scheduler, shared LLM manager, placement matrix, joint failure ladder | **new here** | §§3.4–4.7 |
