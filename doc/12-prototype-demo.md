# MediKiosk video-submission prototype (all four modules, 2026-09-17)

> **Status:** built and verified 2026-09-17. This is the **single-file walkthrough for the SIH
> video submission**: one continuous patient visit through Module D (consent/ABHA), A (voice+touch
> history + red flags), B (Indian paper digitisation), and C (merge, read-back, physician
> hand-off). It is UX + flow; the clinical content mirrors the production contracts in
> `kiosk/config/*.json` and the Module B/C output shapes.

## Files

| File | Purpose |
|---|---|
| `prototype/medikiosk-prototype.html` | The artifact. One self-contained file, zero network, no build step at run time. Open directly, or serve it for microphone access. |
| `prototype/medikiosk-src/` | Editable sources: `sep11-additions.css`, `languages.js`, `content.js`, `body.js`, `app.js`. Do not hand-edit the built HTML. (`style.css` is superseded — see below.) |
| `prototype/build-prototype.py` | Assembler → `medikiosk-prototype.html`. Run after any source edit. |
| `prototype/serve-prototype.py` | Loopback server + opens the browser (browsers block mic on `file://`). |
| `prototype/verify-prototype.py` | Headless click-through over loopback with stubbed speech/recognition. Screenshots → `prototype/screenshots/p1..p11*.png`. |

## Visual system (2026-09-17, user directive)

The prototype renders the **exact Sep-11 Module A visual system**: `build-prototype.py` extracts the
stylesheet from `archive/SEP11/module-a-kiosk-demo.html` at build time (comments stripped — a visual
no-op) and appends only `medikiosk-src/sep11-additions.css` (speaker picker, paper hand-over,
extraction tables, physician view, consent agreement, hotspot selection, RTL). Same tokens
(`--teal`/`--ink`/…), same components (dark presenter bar, gradient header, progress rail,
conversation log, question cards, chips, scale, body map, safety overlay, read-back, handoff sheet).
The old `medikiosk-src/style.css` is no longer used. The banned words stay at **0 occurrences** in
the shipped file (the archive's one badge string is neutralised and its presenter-bar class names
are renamed at build time).

## Behaviour

- **22 scheduled languages + English** are offered on the opening screen. The choice drives both
  the recogniser and the spoken voice. UI label packs exist for 14 languages; the rest fall back to
  English labels while still speaking in the selected language.
- **Voice output is automatic; the visit waits for the person.** The kiosk speaks the greeting on
  open and every question after that, and opens the recogniser automatically. It never advances on
  a timer: Module A moves on only when the patient speaks, taps an answer, or presses Continue/Skip.
  Chromium blocks audio until a first gesture, so the page retries and shows a one-time pill only
  if sound is still blocked; consent + language selection satisfy that.
- **Module A is captured live, not prepared.** No answer is pre-selected and nothing is recorded
  until the person gives it (verified: "Module A starts empty", "waits for the person").
- **Module B waits for the papers.** The upload step is a real file hand-over; only after the pages
  are supplied does the kiosk read them. Modules B–D then show the fixed Indian case.
- **Speaker voice is selectable.** The header has a **Speaker** picker listing every installed
  voice (natural/Google voices marked ★) plus a **Test** button; the pick is remembered. The default
  is scored, not "first match", so a Natural/Neural or Google voice is preferred over the legacy
  offline ones. Edge exposes the highest-quality `… Online (Natural)` voices.
- **Body map** is a hand-authored, gradient-shaded human figure (front/back) with transparent
  hotspot overlays — not a stick figure. The step waits for a real tap.
- **Papers** (Sharma Clinic prescription, Sanjeevani Diagnostics labs, R.K. Heart Centre ECG, a
  handwritten Hindi slip) are rendered on-page and read with a sweep, then extracted with per-line
  provenance and confidence; handwriting is flagged "doctor will check".
- **Merge / read-back / hand-off / physician** show medicine reconciliation with both values kept,
  severity-ordered alerts, the bilingual read-back, an OPConsultRecord-style FHIR view, a locked
  A/P, and the consent reference + ABHA hand-off.

## Honest limits

Voice quality depends on the voices installed on the presenter's machine; recogniser accuracy is
the vendor's and needs the network; the clinical content is fixed to one walk-in case; and the
reference ranges remain the placeholder set (`doc/21` C-C).

---

# Module A Demo Prototype — Interactive HTML (SIH presentation)

> **Status:** built and verified 2026-09-11 by opencode session `module-1-2`.
> This is the **demo-grade prototype** for the SIH presentation — UX and flow logic only.
> The real offline ASR/NLU architecture is a separate track (see `09-module-a-design.md`).

---

# Module C Demo Prototype — Summary Generation (SIH presentation)

> **Status:** built and verified 2026-09-11 (late, follow-up session). Same
> single-file, offline, bilingual pattern as the A/B prototypes. The
> merge/render/FHIR logic is the **real Module C reference implementation
> ported to JS** (module-c/medic); the two input streams are demo fixtures
> shaped exactly like the real contracts (HistoryBundle v1 + medib
> run_summary). **The renderer is deterministic — no LLM writes any line of
> the summary** (design decision, doc/18 §2.1).

## Files

| File | Purpose |
|---|---|
| `prototype/module-c-kiosk-demo.html` | The prototype. Single file, ~222 KB, zero network. Double-click to run (no voice features, so no server needed). |
| `prototype/parts/module-c-core.js` + `parts/module-c-app.js` | Editable source parts. Rebuild after edits: `python prototype/build-module-c-demo.py` (assembler reuses Module A's style block + inlined React/ReactDOM/htm verbatim). |
| `prototype/build-module-c-demo.py` | Assembler. Do not hand-edit the built HTML. |
| `prototype/verify-demo-c.mjs` | Core verification: **53 checks** (contract enforcement, med reconciliation incl. dedupe + unit-tolerant dose equivalence, abnormal labs, severity-ordered alerts, SOAP/read-back provenance, OPConsultRecord shape, attestation, determinism). Run: `node verify-demo-c.mjs` |
| `prototype/browser-test-c.py` | Headless-Chromium click-through (Playwright): case picker → merge → bilingual read-back → handoff, BOTH demo cases, zero console errors. Screenshots → `prototype/screenshots/c1–c2*.png` |

## Flow (what it demonstrates)

1. **Case picker** (welcome): "the interview is done, the papers are scanned" —
   pick a finished session. Two cases: **Ramesh, 54** (chest pain, RF-2 red
   flag, 4 scanned documents → PRIORITY TRIAGE) and **Sunita, 42** (knee pain,
   no papers → ROUTINE OPD, interview-only canon).
2. **Merge screen**: Module A stream + Module B stream joining into ONE canon —
   medication reconciliation with visible provenance (`patient + document`),
   cross-document dedupe, abnormal labs with (placeholder) reference ranges,
   severity-ordered alert list (red flag → verify → abnormal), queue pill.
3. **Read-back** (patient): bilingual field list with provenance tags
   (voice/proxy/needs-review); language toggle switches labels (values verbatim,
   same canon field ids — store once, render many).
4. **Handoff** (physician, `hoSheet` style): one-page SOAP with per-line
   source field-ids, **locked physician-only A/P**, honesty block for
   not-answered slots, alerts, FHIR OPConsultRecord summary (resource counts,
   SNOMED 371530004, sections, attester slot, DPDP transient note), attested,
   queue pill, session token "(Module D, simulated)".

## What is real vs simulated (disclosed in-UI)

| Real (ported from `module-c/medic`) | Simulated (labeled) |
|---|---|
| HistoryBundle v1 contract validation | The two input fixtures (shaped exactly like the real contracts) |
| Med reconciliation + dedupe + dose-conflict flagging | Reference ranges (demo placeholders pending clinician validation) |
| Abnormal-lab compilation, severity-ordered alerts | ABDM push (Module D, "simulated" token) |
| SOAP / OLD CARTS / bilingual read-back renderers | |
| OPConsultRecord bundle + attestation | |

## Verification (2026-09-11 late)

- `node verify-demo-c.mjs` — **53/53 pass** on the shipped file (one JS falsy
  bug found and fixed during verification: `order[sev] || 3` turned the
  red-flag rank 0 into 3 — `hasOwnProperty` check added).
- `python browser-test-c.py` — both cases click-through with **zero
  console/page errors**; 10 screenshots captured (c1-*, c2-*).
- Reference implementation: `pytest module-c/tests/ -q` — **22/22 pass**;
  `python -m medic.cli --out out/` — FHIR bundle VALID, eval: determinism True,
  fabrications 0, min field recall 1.0.

---

## Module B Demo Prototype — Document Digitization (SIH presentation)

> **Status:** built and verified 2026-09-11 (night, follow-up session); **reworked
> 2026-09-12 with an upload lane + sensitive-word filter** (user directive);
> **chrome realigned to Module A** (user directive — the demo had invented
> `demoBar`/`head` classes that don't exist in the shared stylesheet, so the top
> bar + header rendered unstyled; the B app now uses A's `.demobar`/`.dbBtn` +
> `.hdr`/`.hdrInner`/`.brandMark`/`.brandTxt`/`.hdrChip` chrome). Same
> single-file, offline, bilingual pattern as the Module A prototype — same design
> system, same React inlined build, same honesty-labeling conventions. The
> deterministic pipeline logic is the **real Module B reference implementation
> ported to JS** (module-b/medib); only the OCR engine itself is simulated, with
> confidences taken from the measured reference run.

## Files

| File | Purpose |
|---|---|
| `prototype/module-b-kiosk-demo.html` | The prototype. Single file, ~231 KB, zero network. Double-click to run (no voice features, so no server needed). Uploads work over `file://`. |
| `prototype/parts/module-b-core.js` + `parts/module-b-app.js` | Editable source parts. Rebuild after edits: `python prototype/build-module-b-demo.py` (assembler reuses Module A's style block + inlined React/ReactDOM/htm verbatim). |
| `prototype/build-module-b-demo.py` | Assembler. Do not hand-edit the built HTML. |
| `prototype/verify-demo-b.mjs` | Core verification: **73 checks** (fixtures match measured confidences; router, voting, gate, structurer, FHIR, attestation, session merge, **upload lane, sensitive-word filter, patient correction loop** — all ported-behavior assertions). Run: `node verify-demo-b.mjs` |
| `prototype/browser-test-b.py` | Headless-Chromium click-through (Playwright): consent → scan → **upload 2 photos + 1 PDF + 1 undecodable file (incl. a sensitive-named file)** → processing → review (**deny a wrong med, correct a lab**) → handoff → restart, zero console errors. Screenshots → `prototype/screenshots/b1–b5 + b2b-uploads + b4b-review-fixed.png` |

## Flow (what it demonstrates)

1. **DPDP itemized consent** (welcome): purpose, what is collected / not collected, rights,
   transient-retention default — all bilingual, matching `medib.intake.ITEMIZED_NOTICE`
   (doc/13 §4). Decline path is honest: papers go straight to the doctor.
2. **Scan screen**: four demo papers (printed Rx EN, printed Rx HI, lab report, handwritten
   Rx) selectable as a session; printed/handwritten pills — **plus the upload lane**:
   drag & drop photos/PDFs, file picker, camera capture (touch kiosk), real thumbnails,
   per-upload printed/handwritten demo toggle, remove. Uploads mix freely with fixtures.
3. **Processing screen**: primary engine (PP-OCRv5 mobile · CPU) per page, Tesseract
   cross-check, per-line voting states (agree ✓ / differ ✗), watchdog ladder labeled;
   uploaded pages carry an honest "OCR simulated (uploaded page)" pill + thumbnail.
4. **Review screen** (patient): extracted meds/labs/diagnoses with per-field
   "read clearly" vs "doctor will check" badges — verify-default is the visible design.
   **Patient correction loop:** every field has Correct (inline editor) and Remove
   ("not on my paper", with Undo); denied fields leave the lists and the FHIR bundle;
   corrected fields keep their verify flag and carry patient-corrected provenance, which
   the doctor sees on the handoff. Uploaded pages are shown as images next to the
   extraction so the patient can compare against the paper.
5. **Handoff screen** (physician, same `hoSheet` style as Module A): flagged fields with
   bboxes + reasons (MIRAGE note), **patient corrections + removals listed for
   confirmation against the paper**, FHIR DocumentBundle summary (resource counts, NRCeS
   profile, sections, attester slot, DPDP raw-scan transient/kept state), attest completed,
   queue pill, session token "(Module D, simulated)", uploaded-pages count.
6. **Language toggle**: English / हिन्दी throughout; every screen primary + secondary line,
   same `bi()`/`pickLangText` conventions as Module A.
7. **Sensitive-word filter** (demo display policy): lines containing listed offensive words
   (EN + romanized HI) are dropped before voting/structuring/display — counted per doc and
   session, disclosed as notes; uploaded file names are masked ("s•••-scan.png").

## What is real vs simulated (disclosed in-UI)

| Real (ported from `module-b/medib`) | Simulated (labeled) |
|---|---|
| Router heuristics + thresholds | OCR engine output (confidences mirror the 2026-09-11 measured run: EN 0.97–1.0, HI 0.94–0.96, handwriting <0.65) |
| Cross-engine voting (IoU + normalized text) | Tesseract lines (fixture) |
| Confidence gate + verify-default + reasons | **OCR text of uploaded pages** (thumbnails/names/routing real; reads rotate rx/lab/note variants + handwritten toggle) |
| Rules structurer (meds/labs/dx, anti-noise guards) | Sensitive-word list is demo-scale (product: extensible, reviewable) |
| FHIR DocumentBundle + attester + sections (NRCeS shape) | ABDM push (M4, "Module D, simulated" token) |
| Session orchestration + multi-doc merge (fixtures + uploads) | |
| Sensitive-word drop/mask enforcement (counted, disclosed) | |
| Patient deny/correct + session rebuild (corrected values + notes reach the bundle) | |
| Upload image-quality signals (undecodable → excluded; dark photo → retake warning) | |

## Verification (2026-09-12)

- `node verify-demo-b.mjs` — **73/73 pass** on the shipped file (56 prior + 17
  patient-correction-loop checks: stable keys, correct/deny/undo round-trip, bundle
  rebuild with corrected values + notes, valueString fallback instead of NaN,
  rebuild idempotence).
- `python browser-test-b.py` — full click-through passes with **zero console/page errors**:
  uploads 2 photos + 1 PDF + 1 undecodable file (sensitive name masked, DOM-leak assert),
  broken file flagged unreadable and excluded, thumbnail brightness asserted (no black
  boxes), mode toggle, remove, mixed session end-to-end, **review deny + correct with
  editor**, handoff corrections/removals listing with denied item provably out of the
  bundle (visible-text count, not `page.content()` — that also serializes `<script>`
  source); screenshots b1–b5 refreshed + b2b-uploads + b4b-review-fixed added.
  Hindi spot-check of the upload lane clean.

---

## Module A prototype (original)

## Files

| File | Purpose |
|---|---|
| `prototype/module-a-kiosk-demo.html` | The prototype. Single file, ~277 KB, zero network dependencies. Runs by double-click, **but voice input requires serving it on localhost — use `serve-demo.bat`**. |
| `prototype/serve-demo.bat` | **Presenter entry point.** Double-click → starts a zero-dependency local server (`serve-demo.mjs`) on `http://127.0.0.1:8000` (loopback only) and opens the demo in the default browser. Keep the window open while presenting. |
| `prototype/verify-demo.mjs` | Logic verification: 99 checks (turn sequence, red-flag rules in en/hi/Hinglish, dose extraction, slot states, full reducer runs, voice-excerpt regressions, **body-map mapping, repeat-visit delta, proxy provenance**). Run: `node verify-demo.mjs` |
| `prototype/browser-test-a.py` | **Voice browser test** (headless Chromium + stubs): welcome voice self-check panel, kiosk auto-speak + header mute toggle, mic→clinical-excerpt wiring, file:// mic-block instruction. Screenshots → `prototype/screenshots/a1–a3*.png` |
| `prototype/screenshots/*.png` | Pre-captured screenshots of the key screens (headless Chrome): 1–5 original + **6-bodymap, 7-repeat-delta, a1–a3 voice** |

## What it demonstrates (aligned to confirmed scope only)

1. **Confirmed v1 languages**: English / हिन्दी / Hinglish (Roman) — selectable on the welcome screen. Every prompt shows primary language + Devanagari secondary. **Voice input uses the browser `SpeechRecognition`/`webkitSpeechRecognition` API** (`hi-IN` for Hindi/Hinglish, `en-IN` for English) with live interim feedback and text fallback; **voice output uses the browser `speechSynthesis`** and always speaks the Devanagari line for Hindi/Hinglish (a Roman string through a Hindi voice is unintelligible). **Kiosk auto-speak (2026-09-12):** after Start, every question is read aloud automatically (the Start tap is the user gesture that unlocks synthesis); a 🔊/🔇 header toggle mutes it; starting the mic cancels the playing prompt so recognition never hears the kiosk's own voice. Both are demo aids, not the product ASR/TTS stack (doc 09 §5).
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
- **Guided demo 3 — repeat visit + attendant (innovation demo)**: Ramesh returns with his son. Body-map start, stable history carried from 15 Aug with one tap per line, medicines changed (Amlodipine → Metoprolol), severity 6 → 3, breathlessness resolved. Read-back and handoff open with the what-changed table; all attendant-spoken answers tagged, severity flagged for doctor confirmation. Routine queue.
- **Free exploration**: answer anything by typing; the safety rules still run on everything typed (typing a chest-pain + breathlessness narrative triggers RF-2 at the safety step).

## Innovation features in the demo (design: `doc/15-innovation-features.md`)

9. **Body-map touch entry**: every interview now opens with a tap-where-it-hurts front/back figure (8 regions → existing complaint vocabulary). A tap records the region + pointed-to narrative, so the CC step becomes a one-tap confirm. Bilingual legend buttons double as precise targets.
10. **Repeat-visit delta summaries**: welcome visit-type selector; repeat visits load the prior-visit baseline (simulated fixture, disclosed in-UI) and render carry-confirm cards for stable sections. Read-back + handoff open with the "What changed since …" table + unchanged count.
11. **Attendant/proxy mode**: welcome respondent selector (patient / family member + relation). Every slot carries `by` provenance; log, read-back, and handoff tag attendant-spoken answers; proxy-spoken severity/worry/expectation auto-mark `needs_review` via a reducer-level guardrail; handoff shows a proxy banner with the confirm-with-patient list.

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
| Repeat-visit baseline is a canned fixture, not an ABDM fetch | Welcome-screen note + honesty box: product pulls the ABHA-linked record via Module D/HIS; only the fetch is stubbed — carry/delta/provenance machinery is real |
| Attendant relation list (son/daughter/wife/husband/other) is a demo shortlist | Relation picker on the welcome screen; product would confirm against registration data |
| Session token / triage notification / nurse ack are simulated | "(simulated in this demo)" labels |
| Dashavidha AYUSH layer not in this demo | Welcome-screen note: configurable second layer per confirmed design |

## Running the voice features (presenter checklist)

0. **Voice self-check panel (welcome screen, 2026-09-12):** before starting, the welcome screen shows a self-check that reports — with a ✓/⚠/✗ per row — the page origin (file:// = mic blocked), the recognition engine, the TTS voice count, the **exact Hindi and English voice names** the browser will use, and the mic permission state (via `navigator.permissions`), each with the concrete fix when wrong. A 🔊 **Test sound** button plays a sample in the selected language. If "sound does not work" on the presenter machine, this panel says which of the four possible causes it is — no silent failures. Same panel logic guards the interview: the Speak button on every input starts the mic.
1. **Microphone (input) — the #1 gotcha:** browsers (Chrome/Edge) **cannot grant microphone permission to `file://` pages**, so voice input silently-fails if the HTML is double-clicked. The mic button now detects `file://` *before* attempting recognition and prints the serve-demo.bat instruction instead of a doomed attempt. **Always run `prototype/serve-demo.bat`** (starts `http://127.0.0.1:8000` and opens the browser), then tap Speak and **Allow** the microphone prompt. Hindi/Hinglish use the `hi-IN` recognizer; English uses `en-IN`. If the mic is blocked despite localhost: address-bar tune icon → Microphone → Allow, and Windows Settings → Privacy & security → Microphone → ON (the in-app error message walks through both). Note: Chromium's speech *recognition* uses the vendor's online speech service — the demo page itself stays fully offline, but the mic feature needs internet in Chrome/Edge.
2. **Hindi playback (output):** the machine needs a Hindi voice. Windows: Settings → Time & Language → Speech → Manage voices → **Add voices → हिन्दी (Hindi)** (installs e.g. Microsoft Swara/Madhur). Chrome additionally exposes the online "Google हिन्दी" voice. If no Hindi voice exists, the Listen button and the self-check panel say so and show text — verified behavior on a machine with 23 voices and zero Hindi ones (2026-09-11).
3. **Stored speech is excerpted:** spoken answers pass through `clinicalExcerpt` (Roman + Devanagari filler stripping, clinical-sentence keep-filter, 280-char cap, never strips a leading "no") — the full raw conversation is never retained, matching the user directive.

## Inlined third-party code

React 18.3.1 UMD, ReactDOM 18.3.1 UMD (Meta, MIT), htm 3.1.1 UMD (developit, MIT) — embedded so the file works with zero network. No other dependencies. Verified: no fetch/XHR/network calls at runtime.

## Architecture notes for whoever builds the real thing

The demo's core (`/*MK-CORE-BEGIN*/ … /*MK-CORE-END*/` block inside the HTML) is a plain-JS module — deterministic turn list, reducer, rule engine — with no DOM dependencies. It is intentionally shaped like the confirmed architecture (doc 09 §4): the **state machine owns what to ask**; the "NLU" in the demo is only complaint-term matching, which stands in for the constrained local extractor. `verify-demo.mjs` extracts this block *from the shipped HTML* and runs it in Node, so the tested logic is exactly what the judges see.

## Verification (2026-09-11)

- `node verify-demo.mjs` — **99/99 checks pass** on the shipped file (sequence, bilingual rule matching incl. Devanagari input, dose extraction, slot states, two full reducer runs, free-exploration run, read-back content, **voice-excerpt regressions**, **body-map mapping + turn order (§10), repeat-visit carry + delta (§11), proxy provenance + guardrail (§12)** — 36 checks added 2026-09-11 night).
- Headless-Edge DOM checks (`domcheck.sh` in the build workspace) — **57/57 pass** across 12 screen states, incl. zero runtime errors (page has a built-in error banner that stays absent). Re-checked 2026-09-11 evening after the voice-I/O rework: **0 rendered error banners across 7 deep-linked states** (welcome, interview en/hi/rom, safety, readback, handoff) with fresh `--user-data-dir` per launch (fragment-drop gotcha, see research log).
- One render bug was found and fixed during verification (React error #31 — a component reading positional args instead of props; crashed all interview screens).
- Headless-Edge voice inventory check: this machine exposes 23 TTS voices, **zero `hi-IN`** — the honest no-Hindi-voice path is the *expected* path here until the Hindi voice pack is installed (see presenter checklist).

## Verification (2026-09-12 — voice UX session)

Follow-up session fixed the "sound not working, neither input nor output" report from the previous session's unfinished diagnosis. Root causes found: none in code — the app's speech paths were correct; failures were environmental (file:// origin, missing OS voices, mic permission) and invisible to the user. Fixes:

- **Welcome voice self-check panel** (origin / engines / Hindi + English voice names / mic permission, ✓/⚠/✗ with fixes, Test-sound button).
- **Kiosk auto-speak**: each question is read aloud after Start; 🔊/🔇 header toggle; mic start cancels the playing prompt (prevents self-hearing).
- **file:// pre-flight**: the mic button explains the serve-demo.bat fix instead of a doomed recognition attempt.
- `python browser-test-a.py` — **8/8 PASS, zero console errors** (stubbed synthesis + recognition, deterministic): self-check rows render; auto-speak fires per question with the right Devanagari text + hi-IN + chosen Hindi voice; mute silences; unmute resumes; mic transcript → excerpt → textarea → submit advances; file:// shows the instruction without starting recognition.
- Regression: `node verify-demo.mjs` 99/99, `verify-demo-b.mjs` 73/73, `verify-demo-c.mjs` 53/53, `browser-test-b.py` + `browser-test-c.py` all-pass — no changes to MK-CORE logic.

## Build provenance

Assembled from parts in `C:\Users\sharm\AppData\Local\Temp\opencode\mkdemo\` (head CSS, core JS, UI JS, `assemble.js`). The temp workspace may be deleted; the shipped HTML is the artifact that matters.

---

*Session `module-1-2`, 2026-09-11. Decisions from this session are logged in `decisions/06-decisions-log.md`.*
