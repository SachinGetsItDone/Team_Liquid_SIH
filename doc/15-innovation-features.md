# Innovation Features — Design (Repeat Visits, Proxy Mode, Body Map)

> **Status:** designed 2026-09-11, implemented in `prototype/module-a-kiosk-demo.html` the same day.
> Covers the three candidates the team picked for the submission: the two top picks from
> `doc/research/07-open-questions.md` (repeat-visit delta summaries, attendant/proxy mode) plus
> body-map touch entry. All three are checked against the prior-art scan in doc 10 §2 —
> none of the surveyed products (Phreesia, Yolo/Clinics On Cloud, Augnito/EkaScribe/Sunoh,
> Fabric/Buoy/K Health, NirogStreet) does any of them in a pre-consultation kiosk context.
> The "explicitly OUT" guardrails (no diagnosis, no acuity reordering, no hardware gimmicks)
> are respected throughout.

## 1. Repeat-visit delta summaries

**Problem it attacks (PS's own words):** "repeated questioning across visits" is a named harm.
Public-OPD patients are quasi-re-registered every visit, so even return patients start from zero.

**Design:**
- Welcome screen asks visit type: **first visit / repeat visit**. Repeat path loads the
  patient's prior-visit baseline (product: ABHA-linked record via Module D/HIS pull;
  demo: canned `PRIOR_VISITS` fixture).
- Today's problem (narrative → CC → SOCRATES → ROS → ICE) is always asked fresh — symptoms
  change visit to visit. The **stable sections** (past illness, medicines, allergies, family,
  tobacco, alcohol) are NOT re-asked: each renders a carry-confirm card —
  *"Last time (15 Aug) you told us: High blood pressure. Still the same?"* →
  **Same as last time** copies the baseline slot forward (tagged `carriedFrom`),
  **Something changed** opens the normal input for that field.
- `computeDelta(baseline, answers)` compares the baseline against today's answers and the
  read-back + physician handoff open with a **"What changed since 15 Aug"** table
  (from → to per field) plus a one-line count of confirmed-unchanged fields.
- Safety invariants: carried slots are verbatim copies, never re-inferred; anything the
  baseline lacks is elicited normally; the safety rules run on today's full corpus.

**Demo 3 script (repeat + attendant combined):** Ramesh, 54, returns 11 Sep with his son.
Baseline 15 Aug: chest pain severity 6/10, breathless at rest, Amlodipine 5 mg.
Today: severity 3/10, breathlessness gone, medicines changed to Metoprolol 25 mg.
Delta table shows all three changes; PMH/family/social carried with one tap each.

## 2. Attendant / proxy mode with provenance tags

**Problem it attacks:** Indian OPD reality — elderly patients arrive with family who answer
for them. Every intake product surveyed assumes a single self-reporting respondent.

**Design:**
- Welcome screen asks **who will answer: the patient, or a family member (attendant)**,
  with a relation picker (son / daughter / wife / husband / other).
- Every stored slot carries `by: "patient" | "proxy"`. Conversation log, read-back rows,
  and handoff rows show the provenance ("answered by attendant (son)").
- **Deterministic guardrail:** subjective answers from a proxy (pain severity, main worry,
  expectation) are auto-marked `needs_review` with the note "answered by attendant —
  confirm with patient" — applied in the reducer, so no input path can bypass it.
  Objective/factual answers (medicines, history) keep `captured` with the proxy tag.
- Handoff shows a proxy banner counting attendant-reported answers so the physician knows
  exactly what to re-confirm. The kiosk never treats attendant speech as patient speech.

## 3. Body-map touch entry (zero-literacy conversation starter)

**Problem it attacks:** the PS population includes non-literate, non-English, first-time
patients for whom even a spoken interview is intimidating. A tap-where-it-hurts picture
needs zero reading, zero speaking, zero language.

**Design:**
- New opening turn `bodymap`, before the narrative: **"Show us where it hurts — tap the
  picture"** with a front/back SVG figure and 9 tappable regions
  (head, chest, abdomen, left/right arm, left/right leg incl. knee, back), each labeled
  in English + Hindi + Hinglish.
- A tap stores the region, auto-records the narrative as "Pointed to the chest on the
  body picture", and sets the chief complaint (region → complaint map) so the CC step
  becomes a one-tap confirm. The rest of the interview proceeds unchanged; severity is
  still captured on the 0–10 scale.
- Region → complaint map: head→headache, chest→chest, abdomen→stomach pain, knee/leg→knee,
  back→back pain, arm→general (free-text site). Regions reuse the existing 8-complaint
  vocabulary, so safety rules and ROS sets apply with no special-casing.
- Scope guard: the map captures *site only* — character, onset, severity etc. are still
  elicited. It is a starter, not a shortcut.

## Judge-facing framing (one line each)

1. *"First visits build the record; return visits only ask what changed — the PS's
   'repeated questioning' harm, fixed."*
2. *"When the son answers for his father, the summary says so — every answer tagged by
   who spoke, subjective ones flagged for the doctor to confirm."*
3. *"A patient who cannot read or speak can still start: tap where it hurts."*

## Product-track notes (not in the demo)

- Baseline fetch/push is a Module C/D contract: HistoryBundle versioned per visit, ABHA-linked.
- Carry-confirm UX needs a clinician-approved stable-field list (medicines arguably
  re-ask, not carry — the demo carries them behind an explicit confirm, which is the
  conservative middle ground).
- Body-map region set should be validated with low-literacy users (comprehension test);
  region granularity (knee vs whole leg) follows from that, not from this doc.

---

*Designed 2026-09-11. Prototype: `prototype/module-a-kiosk-demo.html` (demos 1–3, welcome
selectors, carry cards, delta tables, proxy badges, body-map turn). Verification:
`prototype/verify-demo.mjs` §§10–12.*
