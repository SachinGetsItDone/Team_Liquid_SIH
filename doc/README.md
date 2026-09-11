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
| [12-prototype-demo.md](12-prototype-demo.md) | Module A interactive demo prototype: how to run, demo scripts, what's real vs simulated, verification | Built & verified (2026-09-11) |
| [13-module-b-deep-dive.md](13-module-b-deep-dive.md) | Module B deep-dive: verified ABDM/NRCeS output contract, MIRAGE accuracy ceilings, engine-by-engine license/footprint/Indic fit, what's appropriate vs not | Research output (2026-09-11) |
| [14-module-b-cpu-research.md](14-module-b-cpu-research.md) | Module B CPU-only model research: paper-level comparison table (CPU latency/RAM/license/maintenance), Indic-accuracy evidence, flagged unverified candidates, deciding benchmark | Research output (2026-09-11) |
| [05-research-log.md](research/05-research-log.md) | Ever-growing research log, activities, findings, findings dates | Live |
| [06-decisions-log.md](decisions/06-decisions-log.md) | Architecture and design decisions with rationale | Live |
| [07-open-questions.md](research/07-open-questions.md) | Open questions and TODO backlog | Live |

## Project Snapshot (auto-refresh when it changes)

- **Problem:** No patient-facing platform captures structured medical history (voice+touch) and digitizes physical documents before consultation, pushing a physician-ready summary to HIS via ABDM/FHIR.
- **Scale constraint:** OPDs register 4,000-10,000 patients/day; 2-5 min doctor consultation time.
- **Proposed solution (tentative):** "MediKiosk" - 4 modules (A: conversational history, B: document digitization, C: summary generation, D: consent/ABDM).
- **Status:** Research phase. Solution approach NOT yet confirmed (per team instruction).

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
- `prototype/module-a-kiosk-demo.html` - **runnable Module A demo prototype** (see doc 12)
