# MediKiosk - SIH 2026 Problem Statement #47

## Read this first
This project has a **shared knowledge base** in the `doc/` folder that all Claude sessions use to stay in sync.

**Start every session by reading `doc/README.md`** - it indexes the whole knowledge base (problem statement, clinical frameworks, research log, decisions log, open questions).

## How the knowledge base works
- `doc/` is shared persistent state across sessions. **Read before building; update after you discover or decide something.**
- Append dated findings to `doc/research/05-research-log.md`.
- Log every architectural decision (with a "why") in `doc/decisions/06-decisions-log.md`.
- Cycle unresolved items through `doc/research/07-open-questions.md`.
- When you add a new doc, add a row to the index table in `doc/README.md`.

## Current project status
- **Phase:** Research. The solution approach is NOT yet confirmed (per team instruction - see `doc/decisions/06-decisions-log.md`).
- The analysis in `ocr_asr_rnd.md` and `solution.txt` is prior exploratory work and is treated as *unconfirmed* until the team ratifies it.

## Quick reference
- **Problem:** No patient-facing platform captures structured medical history (voice+touch) and digitizes physical documents before consultation, producing a physician-ready summary integrated with HIS/ABDM. OPDs run 4,000-10,000 patients/day at 2-5 min/doctor.
- **Proposed solution (tentative):** "MediKiosk" - Modules A (conversational history), B (document digitization), C (summary generation), D (consent/ABDM).
- **Clinical domain docs:** SOCRATES (`doc/02-clinical-socrates.md`), Dashavidha Pariksha (`doc/03-clinical-dashavidha.md`), note formats (`doc/04-clinical-note-formats.md`).
- **Source files:** `Problem__statement_47.txt`, `Research_SOCRATES.pdf`.
