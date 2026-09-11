# Module A Demo Prototype — Interactive HTML (SIH presentation)

> **Status:** built and verified 2026-09-11 by opencode session `module-1-2`.
> This is the **demo-grade prototype** for the SIH presentation — UX and flow logic only.
> The real offline ASR/NLU architecture is a separate track (see `09-module-a-design.md`).

## Files

| File | Purpose |
|---|---|
| `prototype/module-a-kiosk-demo.html` | The prototype. Single file, ~277 KB, zero network dependencies. Runs by double-click, **but voice input requires serving it on localhost — use `serve-demo.bat`**. |
| `prototype/serve-demo.bat` | **Presenter entry point.** Double-click → starts a zero-dependency local server (`serve-demo.mjs`) on `http://127.0.0.1:8000` (loopback only) and opens the demo in the default browser. Keep the window open while presenting. |
| `prototype/verify-demo.mjs` | Logic verification: 63 checks (turn sequence, red-flag rules in en/hi/Hinglish, dose extraction, slot states, full reducer runs, voice-excerpt regressions). Run: `node verify-demo.mjs` |
| `prototype/screenshots/*.png` | Pre-captured screenshots of the 5 key screens (headless Edge) |

## What it demonstrates (aligned to confirmed scope only)

1. **Confirmed v1 languages**: English / हिन्दी / Hinglish (Roman) — selectable on the welcome screen. Every prompt shows primary language + Devanagari secondary. **Voice input uses the browser `SpeechRecognition`/`webkitSpeechRecognition` API** (`hi-IN` for Hindi/Hinglish, `en-IN` for English) with live interim feedback and text fallback; **voice output uses the browser `speechSynthesis`** and always speaks the Devanagari line for Hindi/Hinglish (a Roman string through a Hindi voice is unintelligible). Both are demo aids, not the product ASR/TTS stack (doc 09 §5).
2. **Confirmed interview sequence** (doc 09 §1): free narrative → chief complaint → SOCRATES (all 8, adapted for pain) → **red-flag screening as a separate visible step** → PMH → medications → allergies → family → social → focused ROS (4 items adapted to the detected complaint) → ICE → patient read-back.
3. **Touch as first-class fallback**: every question is answerable by large touch chips *or* text; every question has a skip ("I will tell the doctor") that is recorded honestly as `not_answered`.
4. **Deterministic safety layer, styled as a system component**: 4 demo rules (RF-1 thunderclap headache, RF-2 chest pain + breathlessness, RF-3 stroke signs, RF-4 severity ≥8 + concerning association). All 4 rules are *shown* on the screen with pass/fail status and the exact matched words as evidence. A hit triggers a full-screen red escalation (not a chat bubble): stay-at-kiosk instruction, "triage desk notified (simulated)", and a **staff-acknowledgment step** before the interview continues in priority mode. The alert copy explicitly says the rule fired, not an AI opinion.
5. **Slot-state honesty (doc 09 §2)**: every field carries `captured` / `needs_review` / `not_answered` / `not_elicited`; "Not sure" answers are badged "Needs review"; stopped-early runs show explicit not-elicited fields. Dose numbers entered by voice get a one-time touch confirmation (fixed safety rule, stated on screen).
6. **Patient read-back**: structured bilingual summary with Change buttons per field (loops back into the interview, then returns), plus a confirm step.
7. **Physician handoff screen**: a doctor-side view of the structured history — SOCRATES table, pertinent ROS negatives kept, urgent-flag banner, provenance per field (voice vs touch, original spoken words kept), data-quality counts, and a **locked "Assessment & plan — physician only"** section stating the kiosk never diagnoses. Queue states: `QUEUED: PRIORITY TRIAGE` vs `QUEUED: ROUTINE OPD`.
8. **Offline-first posture**: the page runs from the local file with no network; header chip says "On-device · offline-first". No cloud-AI animations anywhere.

## Demo scripts (welcome screen)

- **Guided demo 1 — chest pain (red-flag path)**: Ramesh, 54, Hinglish. Recommended 90-second run.
- **Guided demo 2 — knee pain (routine path)**: Sunita, 42. Shows the "Not sure → needs review" path and a green safety-check pass.
- **Free exploration**: answer anything by typing; the safety rules still run on everything typed (typing a chest-pain + breathlessness narrative triggers RF-2 at the safety step).

## Presenter aids (not part of the product)

- Top bar (styled as presenter-only): **Restart**, **Skip step** (fills the scripted answer), **Jump to summary**, elapsed timer.
- Deep links via URL hash for rehearsing/landing directly on a screen:
  `#shot=welcome` · `#shot=interview&turn=socrates.severity&script=redflag&lang=rom` · `#shot=safety&script=redflag` · `#shot=safety&script=routine` · `#shot=readback&script=redflag` · `#shot=handoff&script=routine` (also `lang=en|hi|rom`, `turn=` any turn id).
- Each input shows a "Fill example answer (demo script)" button with the scripted line (badged "demo script").

## Deliberate simplifications (all disclosed in-UI)

| Simplification | In-app disclosure |
|---|---|
| Browser speech recognition availability/quality (demo aid, not product ASR) | Tag on every input + welcome honesty box; errors mapped to plain-language causes (permission, no-speech, network, language-unsupported) |
| Browser speech recognition needs the vendor's online speech service | Error message says so explicitly when `network` fires |
| Browser TTS depends on installed OS voices — **many Windows machines have no Hindi voice** | Listen button prints an honest note naming the exact fix (Settings → Time & Language → Speech → Add voices → Hindi); never silently falls back to an English voice reading Devanagari |
| Clinical excerpting is a deterministic keyword/filler filter, not the constrained NLU extractor | voice-tag labels answers "voice (clinical excerpt kept)" |
| Rule list is a demo list, not clinician-validated | Note under the safety screen and welcome box |
| Complaint detection covers 8 common complaints; everything else is free-text capture | "Somewhere else"/free-text fallbacks; handoff notes normalization is not shown |
| Session token / triage notification / nurse ack are simulated | "(simulated in this demo)" labels |
| Dashavidha AYUSH layer not in this demo | Welcome-screen note: configurable second layer per confirmed design |

## Running the voice features (presenter checklist)

1. **Microphone (input) — the #1 gotcha:** browsers (Chrome/Edge) **cannot grant microphone permission to `file://` pages**, so voice input silently-fails if the HTML is double-clicked. **Always run `prototype/serve-demo.bat`** (starts `http://127.0.0.1:8000` and opens the browser), then tap Speak and **Allow** the microphone prompt. Hindi/Hinglish use the `hi-IN` recognizer; English uses `en-IN`. If the mic is blocked despite localhost: address-bar tune icon → Microphone → Allow, and Windows Settings → Privacy & security → Microphone → ON (the in-app error message walks through both). Note: Chromium's speech *recognition* uses the vendor's online speech service — the demo page itself stays fully offline, but the mic feature needs internet in Chrome/Edge.
2. **Hindi playback (output):** the machine needs a Hindi voice. Windows: Settings → Time & Language → Speech → Manage voices → **Add voices → हिन्दी (Hindi)** (installs e.g. Microsoft Swara/Madhur). Chrome additionally exposes the online "Google हिन्दी" voice. If no Hindi voice exists, the Listen button says so and shows text — verified behavior on a machine with 23 voices and zero Hindi ones (2026-09-11).
3. **Stored speech is excerpted:** spoken answers pass through `clinicalExcerpt` (Roman + Devanagari filler stripping, clinical-sentence keep-filter, 280-char cap, never strips a leading "no") — the full raw conversation is never retained, matching the user directive.

## Inlined third-party code

React 18.3.1 UMD, ReactDOM 18.3.1 UMD (Meta, MIT), htm 3.1.1 UMD (developit, MIT) — embedded so the file works with zero network. No other dependencies. Verified: no fetch/XHR/network calls at runtime.

## Architecture notes for whoever builds the real thing

The demo's core (`/*MK-CORE-BEGIN*/ … /*MK-CORE-END*/` block inside the HTML) is a plain-JS module — deterministic turn list, reducer, rule engine — with no DOM dependencies. It is intentionally shaped like the confirmed architecture (doc 09 §4): the **state machine owns what to ask**; the "NLU" in the demo is only complaint-term matching, which stands in for the constrained local extractor. `verify-demo.mjs` extracts this block *from the shipped HTML* and runs it in Node, so the tested logic is exactly what the judges see.

## Verification (2026-09-11)

- `node verify-demo.mjs` — **63/63 checks pass** on the shipped file (sequence, bilingual rule matching incl. Devanagari input, dose extraction, slot states, two full reducer runs, free-exploration run, read-back content, **voice-excerpt regressions** added 2026-09-11 evening: Roman + Devanagari filler stripping, sentence keep-filter, "no" meaning preservation, 280-char cap, excerpted narrative still triggers RF-2 and complaint detection).
- Headless-Edge DOM checks (`domcheck.sh` in the build workspace) — **57/57 pass** across 12 screen states, incl. zero runtime errors (page has a built-in error banner that stays absent). Re-checked 2026-09-11 evening after the voice-I/O rework: **0 rendered error banners across 7 deep-linked states** (welcome, interview en/hi/rom, safety, readback, handoff) with fresh `--user-data-dir` per launch (fragment-drop gotcha, see research log).
- One render bug was found and fixed during verification (React error #31 — a component reading positional args instead of props; crashed all interview screens).
- Headless-Edge voice inventory check: this machine exposes 23 TTS voices, **zero `hi-IN`** — the honest no-Hindi-voice path is the *expected* path here until the Hindi voice pack is installed (see presenter checklist).

## Build provenance

Assembled from parts in `C:\Users\sharm\AppData\Local\Temp\opencode\mkdemo\` (head CSS, core JS, UI JS, `assemble.js`). The temp workspace may be deleted; the shipped HTML is the artifact that matters.

---

*Session `module-1-2`, 2026-09-11. Decisions from this session are logged in `decisions/06-decisions-log.md`.*
