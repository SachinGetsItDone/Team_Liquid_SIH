#
 Technical Foundations for MediKiosk (Knowledge Contribution)

> **Status: REFERENCE / UNCONFIRMED.** This doc adds engineering knowledge to inform the
> architecture decisions currently under research (see `decisions/06-decisions-log.md`).
> Nothing here is a ratified decision — treat it as a survey of options and trade-offs
> for the team to weigh. Dates/benchmarks marked *(verify)* should be checked before relying on them.

## 1. Automated Speech Recognition (Module A) — Engine Landscape

MediKiosk needs **streaming, multilingual, noise-robust, medical-vocabulary-aware** ASR.
English + Hindi + major regional languages, plus heavy **code-mixed Hindi-English (Hinglish)**,
which is the realistic patient register in North-Indian OPDs.

| Engine | Origin | Notes for our use |
|--------|--------|-------------------|
| **IndicConformer** | AI4Bharat (IIT-M) | Conformer-transducer, ~13k hrs Indic speech, 40+ languages, open weights + fine-tuned variants. Strong low-resource coverage. Good default base to fine-tune on OPD/medical audio. |
| **Bhashini API** | Govt of India (NLTM) | Federated access to Indic ASR/TTS/MT without self-hosting. Convenient, but **latency + metering** and reliance on network are concerns for a kiosk. Good for fallback/AYUSH-language breadth. |
| **Whisper (family)** | OpenAI | Strong general accuracy, but heavier compute + latency, and weaker out-of-the-box on code-mixed Indic without fine-tuning. Fine-tuning on medical/Hinglish shifts it toward the heavy end. |
| **IndicWav2Vec / XLSR** | (root, AI4Bharat) | Older, generally less accurate than modern conformers; viable only as a cheap baseline. |

**Key architecture judgements (our problem):**
- **Streaming preferred over batch.** SOCRATES is a dialogue; interim transcripts keep the
  conversation responsive. Conformer-transducer architectures stream naturally — a point for IndicConformer.
- **Noise is the real enemy.** Existing docs note a ~30pt WER cliff from noise. The lever is
  mostly **physical** (directed/noise-cancelling mic, acoustic booth) before model choice.
- **Code-mixing is a differentiator** — standard ASR tuned on pure Hindi/English transfers
  poorly to Hinglish. If we fine-tune, curate a code-mixed OPD corpus (see open question on
  synthetic dialogue — it is also a potential *novelty contribution*).
- **Deployment posture:** consider **offline-first** (kiosk edge device runs ASR) with Bhashini
  as a fallback for languages we don't ship — rural/state-hospital connectivity is unreliable,
  and ABDM also demands network later in the flow.
- **Medical terms:** add a decoder vocabulary/allowed-words bias for drug names, anatomy, and
  complaint lexicon; this materially cuts substitution errors on rare clinical tokens.

## 2. Document Intelligence (Module B) — OCR vs VLM vs Router

Inputs: **handwritten** prescriptions, **printed** prescriptions, lab reports (tabular), discharge
summaries — all multilingual, chronologically disordered. Two extraction tasks: (1) **reading**
text, (2) **structuring** into medications / diagnoses / lab values / dates.

| Approach | Strength | Weakness for us |
|----------|----------|-----------------|
| **Classical OCR (PaddleOCR / Tesseract / TrOCR)** | Cheap, fast, proven for **printed** text; PaddleOCR good multilingual Indic coverage; TrOCR strong recognition | Handwritten still hard; layout/reading-order of messy prescriptions breaks naive pipelines; tabular lab extraction needs a separate layout model |
| **VLM-first (multimodal LLM reads the whole image)** | Handles layout, context, semi-handwriting, and **extraction-to-structured-JSON in one step**; handles reading order implicitly | Cost + latency per page; risk of *hallucinated* fields (a patient-safety concern) |
| **Router (recommended hybrid)** | Cheap classifier picks the pipeline: printed → fast OCR; messy/handwritten/lab-table → VLM; both → structured output + confidence | Questionalbe **confidence gating**: low-confidence → escalate to human/physician, never guess |

**Judgements:**
- **A router is the pragmatic default**: printed documents dominate volume, and OCR is far
  cheaper per page than a VLM. Reserve the VLM for the genuinely hard 15-25% (handwriting, tables).
- **Hallucination control is non-negotiable** (medical). Output must carry per-field confidence;
  digits/med names below threshold are flagged "unreadable — verify," not silently guessed.
- **Chronological organization** (month-year parsing of scattered discharge/DC summaries) is a
  separate normalization step upstream of any model — a rules-based date/sequence pass first.
- Outputs map to FHIR `MedicationRequest`, `Observation` (labs), `Condition` (diagnoses),
  `DocumentReference` (source image + provenance).

## 3. ABDM / FHIR & Consent (Module D)

- **ABHA** (14-digit health ID) is the identity anchor. Flow: scan/enter ABHA (or Aadhaar→
  ABHA creation for first-visit), authenticate via ABDM auth, then consent.
- **FHIR R4** is the interoperability contract; HAPI FHIR is the standard open server to model
  against. Key resources: `Patient`, `Encounter`, `Condition`, `MedicationRequest`,
  `DiagnosticReport`, `Observation`, `DocumentReference`, `Consent`.
- **Consent pattern:** ABDM operates a consent-manager split into **HIP** (Health Information
  Provider — e.g. the kiosk/HIS that shares data) and **HIU** (Health Information User — e.g. doctor/
  another system). MediKiosk mints a **consent artefact**; data flows only under it.
- **HIS integration:** via ABDM Gateway (HIE) or a direct FHIR endpoint the HIS exposes.
  Practically: many public HIS are legacy — a **FHIR facade/translation layer** (map kiosk FHIR →
  legacy HIS format) is often the real engineering work, not FHIR itself.
- **DPDP Act 2023:** health data is *sensitive personal data* → explicit consent, purpose
  limitation, data-fiduciary obligations. Kiosk consent must be **ageable and revocable**, in the
  patient's language and — for low-literacy — **audio-guided**.
- **Real-world posture:** assume connectivity is unreliable; queue ABDM sync and retry on
  reconnect. Privacy should work in the autonomous kiosk, not only in the clinic's room.

## 4. Dialogue Architecture (Module A) — the state machine

The open decision is *slot-filling DM owns state* vs *free-running LLM*. Recommended stance:

- **Hybrid is the defensible default.** A **deterministic dialogue manager owns the state**
  machine — the SOCRATES 9-step sequence (doc 02) and Dashavidha flow (doc 03). The **LLM is the NLU**:
  it turns the patient's free narrative into slot values (SOCRATES fields, history items) and
  generates natural re-prompts / clarifications + localized TTS prompts.
- **Why not free-running LLM end-to-end:** state drift, skipped questions, hallucinated slots
  accepted as fact, and nondeterministic medical triage — all safety-hostile.
  Why not pure slot-filling: rigid, unnatural, and poor with free speech.
- **Red-flag triage is a separate classifier on top** (never inline in the interview LLM):
  thunderclap headache, chest pain + dyspnoea, focal neurology, high severity + concerning
  associations (doc 02). If fired → priority-triage path, not routine queue.
- **Safety boundary:** the system *elicits and structures*, it never *diagnoses or recommends
  treatment*. All generated assessment (SOAP "A") is a physician-editable draft (doc 04).

## 5. Output Schema — one canon, many renders (Module C)

Doc 04 already captured the key insight: store the underlying structured fields **once**, render
as SOAP / OLD CARTS / bilingual summary as needed. The unifying representation is a
**clinical ontology in FHIR/JSON** — which is precisely open question "map SOCRATES + Dashavidha
into one schema." Recommended shape: a `HistoryBundle` resource with typed slots from both
frameworks, serialized to whatever note format the HIS consumes.

## 6. Deployment & UX Constraints (cross-cutting)

- **Acoustics beat models:** noise-cancelling / close-talk mic, acoustic booth → biggest single
  WER win (see ~30pt cliff). Cheaper than adding model capacity.
- **Accessible UI:** large touch targets, icon-first, local-language TTS for every prompt (ties
  to low-Sattva UX note in doc 03), zero training, audio+visual redundancy.
- **Resilience:** UPS for power, offline-first with queue-sync for both ASR and ABDM.
- **Scale reality check:** 4k-10k patients/day means the kiosk is a shared, high-throughput
  device — throughput/latency per session and session-resume (patient walks away mid-interview)
  are first-class requirements, not afterthoughts.

---

*Contributed by a Claude session (2026-09-01). Items marked *(verify)* need source confirmation
before being treated as fact. This is input to the decisions log, not a decision.*
