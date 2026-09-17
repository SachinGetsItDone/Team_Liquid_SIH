# MediKiosk - Shared Knowledge Base

This is the **shared knowledge database** for all Claude Code sessions working on SIH 2026 Problem Statement #47 in this project folder. Any session that opens this project should start by reading this index.

## How to Use This Knowledge Base

- **Every session:** Read `doc/README.md` first (this file), then the docs relevant to your current task.
- **Everything here is shared state** - if you discover, decide, or change something, update the relevant doc so future sessions inherit it.
- **Do not** recreate knowledge that already lives here - read first, then build.

## Index (Read in this order)

| Doc | Purpose | Status |
|-----|---------|--------|
| [01-problem-statement.md](01-problem-statement.md) | The full SIH 2026 Problem Statement #47 distilled | Core |
| [02-clinical-socrates.md](02-clinical-socrates.md) | SOCRATES history-taking framework - all 8 fields + non-pain adaptation | Core |
| [03-clinical-dashavidha.md](03-clinical-dashavidha.md) | Dashavidha Pariksha - all 10 Ayurvedic parameters + assessment | Core |
| [04-clinical-note-formats.md](04-clinical-note-formats.md) | SOAP / OLD CARTS / OPQRST output schema reference | Core |
| [08-technical-foundations.md](08-technical-foundations.md) | Technical ref: ASR, document AI, ABDM/FHIR, dialogue architecture, deployment | Ref |
| [09-module-a-design.md](09-module-a-design.md) | Module A design from the 2026-09-09 Codex sessions: scope, architecture, verified stack, candidate survey, failure policy | Candidate (unratified) |
| [10-positioning-evidence.md](10-positioning-evidence.md) | Judge-facing positioning pack: sourced evidence brief, competitor scan, differentiator, SDG/theme case, feasibility & impact (PS SIH26047 verified: Ministry of Ayush/AIIA, Smart Automation) | Research output (2026-09-11) |
| [11-sih-idea-submission.md](11-sih-idea-submission.md) | SIH idea-portal draft: the 10 must-have fields (problem, evidence, theme, SDG, gap, innovation, MVP, impact, scalability, stakeholders) | Draft (2026-09-11) |
| [12-prototype-demo.md](12-prototype-demo.md) | Demo prototypes: Module A interactive interview demo AND Module B document-digitization demo (run, scripts, real-vs-simulated, verification) | Built & verified (2026-09-11) |
| [13-module-b-deep-dive.md](13-module-b-deep-dive.md) | Module B deep-dive: verified ABDM/NRCeS output contract, MIRAGE accuracy ceilings, engine-by-engine license/footprint/Indic fit, what's appropriate vs not | Research output (2026-09-11) |
| [14-module-b-cpu-research.md](14-module-b-cpu-research.md) | Module B CPU-only model research: paper-level comparison table (CPU latency/RAM/license/maintenance), Indic-accuracy evidence, flagged unverified candidates, deciding benchmark | Research output (2026-09-11) |
| [15-module-c-research.md](15-module-c-research.md) | Module C (summary generation) research: pre-consultation-summary prior art, SOAP-generation literature, NRCeS/FHIR/DPDP standards, OSS tools with license/maintenance | Research output (2026-09-11) |
| [16-module-b-regulatory-addendum.md](16-module-b-regulatory-addendum.md) | Module B regulatory addendum: ABDM HDM residency clause (citable), HIP posture (hospital=HIP), SNOMED-India free affiliate licensing, CDSCO SaMD flag on red-flag triage | Research output (2026-09-11) |
| [17-module-b-implementation-plan.md](17-module-b-implementation-plan.md) | Module B implementation plan: components B1-B9, constraint-enforcement map, settled vs rejected model matrix, memory budget, milestones M0-M4 with exit criteria, risk register | Candidate plan (2026-09-11, pending ratification) — reference implementation in `module-b/` (23 tests passing) |
| [18-module-c-implementation-plan.md](18-module-c-implementation-plan.md) | Module C implementation plan: components C1-C7, key design decisions (deterministic renderer, HistoryBundle v1 contract), constraint map, open items | Candidate plan (2026-09-11, pending ratification) — reference implementation in `module-c/` (22 tests passing) + demo prototype |
| [19-production-blueprint.md](19-production-blueprint.md) | **Production blueprint:** invariants, the 3 gates (engineering/clinical/regulatory), deployment topology (thin kiosk + hospital edge node), module production specs, data architecture, DPDP/ABDM compliance, clinical safety, resilience, capacity, interoperability, QA + clinical validation, delivery plan P0-P5, risk register, definition of done | Draft for ratification (2026-09-16) — supersedes the demo/SIH framing; decisions D1-D8 pending sign-off |
| [20-module-b-production-design.md](20-module-b-production-design.md) | **Module B production design (gap closure):** M0 eval-set methodology + runnable execution plan (B-A), engine decision/deferral + #514 measurement protocol (B-B), B8 ABDM sync design incl. queue/idempotency/erasure/validation (B-C), CLCI/LOINC + CDCI/SNOMED bindings (B-D), physician review + audit trail (B-E), model vendoring/licences/upload policy/multi-doc semantics (B-F), plus Appendix A mapping every `config.py` threshold to a derivation | Design (2026-09-16) — every item DECIDED or explicitly DEFERRED; numeric thresholds BLOCKED-M0. **Independent audit 2026-09-16: PASS-WITH-ISSUES** (dead `vote_*` config + field-vs-page-CER; see research log) |
| [21-module-c-production-design.md](21-module-c-production-design.md) | **Module C production design (gap closure):** emission artifact C-A (two-artifact OPConsultRecord + HealthDocumentRecord pinned to ndhm.in#6.5.0; INPS deferred), attestation lifecycle C-B, reference-range governance C-C, canon↔IG section map C-D, AYUSH/Dashavidha C-E, bilingual lane C-F, executable eval protocol MCFP-1 C-G, phase-2 LLM gate C-H, reconciliation edge cases C-I, canon v2 + repeat-visit/DPDP C-J, plus the KB-updates appendix | Design (2026-09-16) — every item DECIDED or explicitly DEFERRED with owner; no code |
| [22-module-d-production-design.md](22-module-d-production-design.md) | **Module D production design (gap closure):** actors + Data Fiduciary/Processor + deployment model, consent lifecycle (request→grant→active→partial→revoke→expire), HIP/HIU flows + Scan & Register entry, offline queue/sync, Fidelius crypto + key lifecycle, counsel-usable DPDP clause mapping, emission/attestation ownership, ABDM sandbox certification roadmap, ops/audit/threat model, components D1–D12, and a 16-item external-confirmation tracker | Design (2026-09-16) — every item DECIDED or explicitly DEFERRED; no code |
| [23-modules-ab-system-design.md](23-modules-ab-system-design.md) | **Modules A+B integrated system design:** scope + back-of-envelope, three-tier topology, the A↔B session lifecycle, the **single-slot scheduler** (J1) and **shared LLM runtime** (J2), compute-placement matrix (kiosk vs edge), joint contracts (HistoryBundle + DocumentSide + merge), joint failure/degradation ladder, and the A+B-specific open decisions AB-D2..D5 | Design (2026-09-16) — reference implementation in `module-a/media/` + `kiosk/` (122 tests repo-wide) |
| [30-cpu-ai-optimization.md](30-cpu-ai-optimization.md) | **CPU AI optimization playbook:** governing physics (bandwidth-bound decode vs compute-bound prefill), model-level (quantization/distillation/pruning/architecture), runtime (ORT/OpenVINO/llama.cpp), hardware/OS (threads/NUMA/thermal), serving (tiered inference), task-specific OCR/ASR/LLM guidance, decision ordering + CPU benchmark methodology + pitfalls, all evidence-tiered | Reference (2026-09-16) — general methodology, not a project decision |
| [31-system-design-foundations.md](31-system-design-foundations.md) | **System design theory, patterns & methodologies:** fallacies/CAP-PACELC/consistency, queueing + capacity laws (Little/Amdahl/USL), replication/sharding/caching, messaging/resilience/sagas/outbox, architecture styles, security/observability/privacy, ATAM/ADD/C4/arc42/ADR/DDD/MLOps, anti-pattern catalog | Reference (2026-09-16) — general methodology, not a project decision |
| [32-edge-ai-architecture.md](32-edge-ai-architecture.md) | **Edge/on-device AI architecture + MLOps methodology:** deployment topologies + serving patterns, OTA/version planes, offline-first/outbox/CRDT, ML eval sets + bake-off + registry + drift/HITL/shadow-canary, constrained-resource engineering + capacity/load-shedding, quality-attribute scenarios + lightweight ATAM + measurable exit criteria | Reference (2026-09-16) — general methodology, not a project decision |
| [15-innovation-features.md](15-innovation-features.md) | Innovation designs built into the demo: repeat-visit delta summaries, attendant/proxy mode with provenance, body-map touch entry — prior-art check, judge lines, product-track notes | Designed + demo-implemented (2026-09-11) |
| [05-research-log.md](research/05-research-log.md) | Ever-growing research log, activities, findings, findings dates | Live |
| [06-decisions-log.md](decisions/06-decisions-log.md) | Architecture and design decisions with rationale | Live |
| [07-open-questions.md](research/07-open-questions.md) | Open questions and TODO backlog | Live |

## Project Snapshot (auto-refresh when it changes)

- **Problem:** No patient-facing platform captures structured medical history (voice+touch) and digitizes physical documents before consultation, pushing a physician-ready summary to HIS via ABDM/FHIR.
- **Scale constraint:** OPDs register 4,000-10,000 patients/day; 2-5 min doctor consultation time.
- **Proposed solution (tentative):** "MediKiosk" - 4 modules (A: conversational history, B: document digitization, C: summary generation, D: consent/ABDM).
- **Status:** Research phase (solution approach not yet formally ratified), but **production work has started** on Modules A+B: `module-a/` (`media`) and the `kiosk/` integration layer exist as runnable code with tests (doc/23). Module C (`medic`) and Module B (`medib`) reference implementations already existed. Numeric thresholds, red-flag rules and reference ranges remain placeholders pending M0/clinical sign-off.

## Working Agreement for Sessions

1. Keep knowledge in this folder - not scattered across the conversation.
2. Append dated entries to `research/05-research-log.md` when you do research.
3. Log every architectural decision in `decisions/06-decisions-log.md` with a "why".
4. Cycle unresolved questions through `research/07-open-questions.md`.
5. Update this README's index when you add a new doc.

## Source Files (in project root)

- `Problem__statement_47.txt` - official problem statement text
- `solution.pdf` / `solution.txt` - draft solution write-up (NOT yet confirmed)
- `ocr_asr_rnd.md` - prior OCR/ASR research (unconfirmed framing)
- `Research_SOCRATES.pdf` - PDF export of the clinical-domain research (2026-09-01)
- `prototype/medikiosk-prototype.html` - **video-submission walkthrough of all four modules** (single self-contained file; sources in `prototype/medikiosk-src/`, build with `python prototype/build-prototype.py`; verify with `python prototype/verify-prototype.py`) (see doc 12)
- `archive/SEP11/module-a-kiosk-demo.html` - Sep-12 Module A demo, SUPERSEDED by the Sep-17 video walkthrough above (see doc 12)
- `archive/SEP11/module-b-kiosk-demo.html` - Sep-11 Module B demo, SUPERSEDED (see doc 12)
- `archive/SEP11/module-c-kiosk-demo.html` - Sep-11 Module C demo, SUPERSEDED (see doc 12)
- `module-a/` - **Module A implementation** (`media` package: FSM, deterministic red-flag engine, NLU adapters, Speech adapters, HistoryBundle emitter) — offline scripted runner `python -m media.cli --demo`; signed red-flag spec `module-a/media/redflags.spec.json`
- `module-b/` - Module B reference implementation (`medib` package)
- `module-c/` - Module C reference implementation (`medic` package)
- `kiosk/` - **production kiosk frontend + runtime**: FastAPI server (`server.py`, `services.py`) serving the patient kiosk and physician consult screen (`web/`), driving the real `medib`/`medic` pipelines, config-driven capture (`config/*.json`), server-side red flags, application-enforced attestation (see `kiosk/README.md`); signed reference-range table `module-c/medic/ranges.example.json`
- `kiosk/` - **A+B integration runtime + kiosk app** (`kiosk` package: single-slot scheduler J1, shared LLM runtime J2, Encounter orchestrator, plus a parallel-session web/API layer) — end-to-end runner `python -m kiosk.cli --demo [--voice] [--fixtures] [--profile 4gb]` (real OCR by default; `--voice` = real mic + offline ASR + TTS); benchmark `python -m kiosk.benchmark`; API/web server `python -m kiosk.server`
- `conftest.py` / `pytest.ini` - repo-wide test path setup + importlib collection (run all suites with `pytest`)
- `doc/module-a-pipeline.excalidraw` - **Module A full pipeline diagram** (opened in Excalidraw; 8 sections: session entry, interview sequence, capture pipeline, safety layer, storage/output, failure policy, safety rules, verified stack) + `module-a-pipeline.png` preview
- `doc/diagrams/` - per-module diagrams, one per module, same visual language (open in Excalidraw; PNG preview next to each): `module-a-interview` (9-step interview + capture + safety), `module-b-digitization` (B1-B9 pipeline + router + verify-default), `module-c-summary` (merger + renderer + attestation lifecycle), `module-d-consent` (D1-D12 consent/ABDM/audit); older overviews `medikiosk-modules-onepage`, `medikiosk-pipeline`, `module-b-cpu-pipeline` (2026-09-11)
