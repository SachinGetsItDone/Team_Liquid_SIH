# MediKiosk - SIH 2026 Problem Statement #47

## What This Project Is

**Smart India Hackathon 2026** — building **MediKiosk**, an AI-powered clinical history software platform for Indian public hospital OPDs. The problem statement is in `Problem__statement_47.txt`.

The core claim: there is no purpose-built, patient-facing platform that lets patients record comprehensive medical history through voice + touchscreen AND digitize physical documents, generating a structured physician-ready summary pushed to the hospital HIS via ABDM/FHIR — all before consultation.

**Key constraint:** OPDs register 4,000-10,000 patients/day with 2-5 min doctor consultation time. The kiosk must work for first-time, non-tech-savvy, often low-literacy patients with zero training.

## The Four Modules

### Module A — Conversational Multimodal History Engine
- Voice + touch adaptive clinical history interview
- SOCRATES framework for HPI (onset, character, radiation, aggravating/relieving)
- AYUSH mode: Dashavidha Pariksha (Prakriti, Vikriti, Agni, Koshtha, etc.)
- Red-flag detection → priority triage alert
- **Architecture decision: slot-filling DM owns state, LLM owns phrasing** (see research below)

### Module B — Medical Document Digitization & Intelligence
- OCR pipeline for printed + handwritten prescriptions, lab reports, discharge summaries
- Intelligent extraction: diagnoses, medications, lab values, procedures
- Chronological ordering, abnormal-value highlighting
- **Architecture decision: VLM-first with classical OCR fallback + disagreement detection**

### Module C — Structured History Summary Generator
- Synthesizes Module A (conversation) + Module B (documents) into physician-ready summary
- Standard format: Chief complaint → HPI → Past med/surg → Drug & allergy → Family → Personal → ROS
- Editable by physician (draft, never autonomous diagnosis)
- Bilingual: patient audio in local language, physician summary in English/Hindi

### Module D — Consent, Privacy & ABDM Integration
- ABHA ID authentication, DPDP Act 2023 compliance
- ABDM consent framework, FHIR APIs
- Session data cleared after submission

## ASR Research Findings

### IndicWhisper IS Whisper (not a competing architecture)
- **Vistaar (arXiv:2305.15386)** — INTERSPEECH 2023 — the paper you need: AI4Bharat fine-tuned Whisper on 10.7K hours across 12 languages → IndicWhisper. Lowest WER on 39/59 Indian benchmarks, avg 4.1 WER reduction vs 3 public + 2 commercial systems.
- **Write the comparison as "base model + Indian fine-tuning data"**, not Indic-vs-Whisper.

### AI4Bharat's active repos (as of Aug 2026)
- `AI4Bharat/IndicConformerASR` (83★, updated Aug 25 2026) — Conformer-based ASR
- `AI4Bharat/IndicWav2Vec` (120★, Aug 27) — Wav2Vec2-based
- `AI4Bharat/IndicVoices` (Aug 29) — 7,348 hours, 16,237 speakers, 145 districts, 22 languages
- `AI4Bharat/FERMAT` — VLM benchmarking on handwritten math (HMER)
- `AI4Bharat/IndicDLP` — document layout parsing
- No Whisper-named repo in active set. Bet has shifted to Conformer/wav2vec.

### Noise is the real enemy (~30 WER points)
- **arXiv:2512.16401** (v5, May 2026): IndicWav2Vec **11.59% WER clean Hindi → 41.71% WER on Gram Vaani telephony** (rural Hindi helpline). ~30pt absolute collapse from channel/environment alone.
- **arXiv:2606.18659** (June 2026): "Responsible ASR" — zero-shot foundation ASR on narrow-band Hindi/Indian-accented English is "suboptimal across the board," fine-tuning gives uneven gains.
- **Implication for MediKiosk:** directional mic, booth, real OPD audio collection plan matters more than model choice.

### Encoder choice: FastConformer vs Whisper depends on distribution
- **arXiv:2606.09317** (June 2026): Frozen FastConformer beats Whisper **out-of-domain** (>90% macro accuracy on FLEURS/Kathbath). Fine-tuned Whisper wins **in-domain**.
- **Practical:** ship IndicConformer at launch, fine-tune Whisper once you have OPD recordings.
- Hardest confusions: Hindi-Urdu (relevant if deployment site has Urdu-speaking patients).

### Clinical ASR: real-world audit
- **SamaVaani (arXiv:2606.26901)**, June 2026: Audits 8 systems (IndicWhisper, WhisperLargeV3, Sarvam, GoogleS2T, Gemma3n, OmniLingual, Vaani, Gemini) on **real psychiatric interviews** in Kannada, Hindi, Indian English. Wide variance. Some do well on Indian English, **break down on regional speech**. Systematic speaker-role and gender gaps.
- **arXiv:2512.10967**: "ASR Under the Stethoscope" — weak handling of code-mixed and vernacular speech.
- **Caveat:** Neither abstract publishes WER numbers — cite direction, not magnitudes.

### Code-mixed Hindi-English: a gap, not a solved problem
- 162 hits on arXiv for code-switched ASR. **No dedicated Hindi-English CS ASR benchmark exists.** Mandarin-English (SEAME) dominates.
- Closest: **CS-FLEURS (arXiv:2509.14161)** — 113 CS pairs, 52 languages, Hindi is one of four anchors (60 Hindi-X pairs).
- Techniques that transfer:
  - **arXiv:2606.19381**: Code-Mixing-Index-guided synthetic TTS moves fine-tuned Whisper-large from 12.1%/17.8% → **8.9%/14.2% MER**.
  - **arXiv:2310.07423**: Fuses both language adapters via latent frame-level binary sequences → **>=10% absolute CER reduction** on Hindi-English.
- **Contribution opportunity:** synthetic code-mixed Hindi-English OPD dialogue is a cheap, credible novelty claim.

### Evaluation: stop using global WER
- **SCRIBE (arXiv:2605.20712)**: Replaces single WER with **lexical, punctuation, numeral, domain-entity error rates** via sandhi-tolerant alignment. Open-weight rich-transcription models for Hindi, Malayalam, Kannada.
- **arXiv:2605.19069**: WER **exaggerates code-switching gaps ~3x** by punishing valid transliterations.
- **arXiv:2608.19936** (Aug 2026): Top open-source ASR models emit verbatim reference spans even when audio is contradictory → inflated benchmark scores.
- **For MediKiosk:** drug-name errors and dosage-numeral errors are catastrophic, filler-word errors are free. Report entity and numeral error rates.

## OCR Research Findings

### Handwritten prescription OCR: ceiling is ~82%, not 99%
- **MIRAGE (arXiv:2410.09729)**: Qwen-VL, LLaVA-1.6, Idefics2 fine-tuned on **743,118 annotated images from 1,133 Indian doctors** → **82% accuracy on medication names and dosages**. This is the main Indian-prescription result.
- **arXiv:2412.18199**: Mask R-CNN + TrOCR → CER 1.4% on Pakistani prescriptions. But this is segmented medicine lines + drug-database matching, NOT end-to-end field extraction. Don't compare directly with MIRAGE.
- **arXiv:2604.16504** (April 2026): 17 VLMs on hard real-world medical forms → best ~85% accuracy, weighted F1 ~90%. Gemini 3.1 best overall (WER 0.50, CER 0.31). GPT 5.4 lowest hallucination (6%). **A WER of 0.50 = half the words wrong.**

### ClinOCR-Bench: purpose-built benchmark (July 2026)
- **arXiv:2607.03650**: 384 scanned clinical images, six subsets: **Normal, Handwriting, Poor Quality, Rotation, Tables, Mix-artifacts**. PHI-free, template-aware split. Public: `github.com/ClinOCR-Bench/ClinOCR-Bench`.
- Per-subset Handwriting-vs-Normal numbers are in the full paper, not the abstract. Get them.

### Reading accuracy vs evidence grounding: catastrophic gap
- **RAPTOR+ (arXiv:2605.25956)**: 223 colorectal referral forms.
  - Fine-tuned Qwen3-VL-8B: **96.1% reading / 60.6% Strict Safety**
  - Zero-shot Gemini 2.5 Flash: **92.6% reading / 1.2% Strict Safety**
- **Design rule for Module B:** every extracted value must ship with a bounding box. Anything without visual grounding = unverified, not a fact.
- Separate-OCR pipelines abandoned because "vulnerable to handwriting, layout variation, and loss of visual evidence linkage."

### VLMs vs classical OCR: depends on the axis
- VLMs generally beat classical on messy clinical scans (arXiv:2511.13523, arXiv:2508.16674).
- But **DISCO (arXiv:2603.23511)**: OCR pipelines stronger on handwriting + long docs; VLMs win on multilingual + visually rich layouts.
- **Indian prescriptions are both → router architecture:** VLM-first, classical-OCR fallback, disagreement detection.

### Small models work for extraction
- **arXiv:2605.09440**: 0.2B BERT key-conditioned QA → F1 0.839 exact-match / 0.893 boundary-tolerant. Beats fine-tuned Qwen3-0.6B on exact match.
- **MedStruct-S (arXiv:2605.03103)**: Encoder-only wins on key-conditioned QA at matched size.
- **arXiv:2306.06823** (ICDAR 2023): Weak supervision + medicine LM → >2.5x improvement on inscrutable handwritten prescriptions. Drug-name LM does more than bigger OCR.

### Evaluation pitfalls
- **RealDocBench (arXiv:2606.07401)**: Markdown/OCR similarity scores **correlate poorly with field-level accuracy**. Medical sub-domain "persistently hard."
- **GDP.pdf (arXiv:2607.11192)**: 17 frontier multimodal models on professional PDFs — **best passes 30.7%**, worst 2%. Failures: misaligned tables, misread charts, skipped footnotes.
- **Baichuan-M4 (arXiv:2606.08982)**: "Clinical-grade" system still reports **3.3% hallucination rate**.

## Dialogue Architecture Research Findings

### The principle: LLM never owns the state
Every recent clinical dialogue system constrains the LLM. Something external holds state:
- **Slot schema**: MediTOD (arXiv:2410.14204) — task-oriented dataset with comprehensive annotations
- **Decision tree**: Note2Chat (arXiv:2601.21551) — +16.9 F1, +21.0 top-1 accuracy over GPT-4o
- **Knowledge graph**: arXiv:2602.01995 — "instead of the parametric knowledge of a model"
- **Information-gain policy**: MedClarify (arXiv:2602.17308) — ~27 percentage-point error reduction
- **Guardrail contract**: g-AMIE (arXiv:2507.15743)
- **Concept-supplying DM**: MEDCOD (arXiv:2111.09381) — DM owns *what* to ask, LLM owns *how* to ask it. **This is Module A in one sentence.**

Free-running LLM agents appear almost exclusively in education/simulation (MedSimAI, arXiv:2503.05793), NOT in systems producing clinical records.

### g-AMIE + AMIE trial: the architecture to build on
- **g-AMIE (arXiv:2507.15743)**: "performs history taking within guardrails, abstaining from individualized medical advice." Outperformed NPs, PAs, and physicians under identical guardrails across 60 scenarios.
- **arXiv:2603.08448** (March 2026): 100-patient prospective trial, human supervisors watched all encounters, **zero interventions needed**. Differential contained final diagnosis in **90% of cases (75% top-3)**. But physicians beat it on practicality (p=0.003) and cost (p=0.004). **Cite both — first proves architecture, second stops overclaiming.**

### Strongest argument against pure LLM: right diagnosis, wrong questions
- **MedConsultBench (arXiv:2601.12661)**: 19 models, "high diagnostic accuracy often masks significant deficiencies in information-gathering efficiency and medication safety." Tracks sub-turn fact elicitation via Atomic Information Units across 22 metrics.
- **arXiv:2504.00061**: 420 generated histories — completeness **97.58% (GPT-4o-mini) vs 77.11% (GPT-4o)**, weak consistency (alpha=0.562). Completeness does not scale with model size.
- **For MediKiosk:** deliverable IS the history, not the diagnosis. A system that guesses correctly while under-eliciting produces exactly the under-documented record you're fixing.

### The fabrication paper: authority prompts collapse abstention
- **arXiv:2608.26167** (July 2026, De & Pavuluri): Pain predictable from acoustics (AUC 0.622) but at chance from transcripts (AUC 0.489) — ASR strips the acoustic cue.
  - Cooperative prompting: 6/7 models abstained on nearly all transcripts
  - **Authority-framed prompts: abstention swung from 0.18 to 1.00** across equivalent phrasings
  - **Confident fabrication: 0.53 (Gemini 2.5 Flash), 0.76 (Llama 3.1 8B)**
- A kiosk saying "you are a clinical intake assistant and the physician needs a severity score" IS an authority frame.
- **Design fix:** slot with explicit `not_elicited` state makes fabrication structurally impossible for that field.

### Downstream error amplification
- **arXiv:2608.22872** (Aug 2026): ASR errors compound downstream — entity-graph linking widened clean-to-high-WER F1 gap by **36-67%**, entity corruption causing **87-96%** of degradations.
- **Design fix:** slot-level confidence scores + patient-facing audio confirmation step.

## Architecture Summary (Research-Grounded)

```
Module A: Slot-filling DM (owns state) + LLM (owns phrasing in patient's language)
  └─ SOCRATES HPI + Dashavidha Pariksha slots
  └─ Explicit not_elicited states (anti-fabrication)
  └─ Low ASR confidence → escalate to human (TRIDENT pattern)

Module B: VLM-first → classical OCR fallback → disagreement detection
  └─ Every value ships with bounding box (RAPTOR+ grounding contract)
  └─ Medicine-name LM for drug extraction (ICDAR 2023 weak supervision)
  └─ 0.2B BERT for key-conditioned QA on OCR output

Module C: Summary generator synthesizing A + B
  └─ Draft only — physician edits/confirms
  └─ Bilingual output

Module D: ABDM/FHIR/DPDP compliance
```

## Open Questions / TODO

1. **ABDM sandbox docs** — Module D compliance research (no arXiv literature, go to ABDM docs directly)
2. **ClinOCR-Bench per-subset numbers** — get Handwriting vs Normal results from the paper/repo
3. **SCRIBE full paper** — get entity/numeral error rates for Hindi
4. **SamaVaani full paper** — get actual WER numbers for the 8-system audit
5. **IndicConformer vs IndicWhisper on noisy conditions** — no head-to-head published yet
6. **Synthetic code-mixed Hindi-English OPD dialogue** — potential novelty contribution
7. **DPDP Act 2023 + ABDM consent framework** — compliance architecture
8. **Audio booth hardware specs** — given 30pt WER cliff from noise
9. **ayurvedic mode dashavidha pariksha slot schema** — needs domain expert input

## Key Papers Quick Reference

| Paper | arXiv ID | Key Finding |
|-------|----------|-------------|
| Vistaar / IndicWhisper | 2305.15386 | Whisper fine-tuned on 10.7K hours, 39/59 benchmarks best |
| Reality Gap | 2512.16401 | 11.59% → 41.71% WER clean→telephony |
| Responsible ASR | 2606.18659 | Narrow-band Hindi "suboptimal across the board" |
| LID comparison | 2606.09317 | FastConformer wins OOD, Whisper wins ID |
| SamaVaani | 2606.26901 | 8-system clinical audit, gender/role gaps |
| ASR Under Stethoscope | 2512.10967 | Weak on code-mixed/vernacular |
| CS-FLEURS | 2509.14161 | 113 CS pairs, 52 languages, Hindi anchor |
| CS synthetic TTS | 2606.19381 | MER 12.1→8.9% via CMIX-guided TTS |
| CS adapter fusion | 2310.07423 | >=10% CER reduction on Hindi-English |
| SCRIBE | 2605.20712 | Rich transcription error rates for Hindi |
| WER exaggeration | 2605.19069 | WER overstates CS gaps ~3x |
| Benchmark gaming | 2608.19936 | Models emit verbatim refs when audio contradicts |
| MIRAGE | 2410.09729 | 82% on Indian prescription med names/dosages |
| TrOCR prescription | 2412.18199 | CER 1.4% on segmented medicine lines |
| Medical form VLMs | 2604.16504 | 17 VLMs, best ~85% accuracy on hard forms |
| ClinOCR-Bench | 2607.03650 | 6-subset clinical OCR benchmark with Handwriting |
| RAPTOR+ | 2605.25956 | 96.1% reading vs 60.6% grounding |
| BERT extraction | 2605.09440 | 0.2B beats 0.6B on exact-match extraction |
| Weak supervision Rx | 2306.06823 | >2.5x improvement via weak labels + drug LM |
| RealDocBench | 2606.07401 | OCR similarity score decorrelated from field accuracy |
| GDP.pdf | 2607.11192 | Best model passes 30.7% on professional PDFs |
| Baichuan-M4 | 2606.08982 | "Clinical-grade" still 3.3% hallucination |
| MediTOD | 2410.14204 | Slot-based clinical dialogue dataset |
| Note2Chat | 2601.21551 | Decision tree + LLM, +16.9 F1 over GPT-4o |
| MedClarify | 2602.17308 | Info-gain policy, ~27pp error reduction |
| g-AMIE | 2507.15743 | Guardrailed history taking, beats NPs/PAs/MDs |
| AMIE trial | 2603.08448 | 100-patient real trial, 90% differential, zero interventions |
| MedConsultBench | 2601.12661 | 19 models: high accuracy masks info-gathering failures |
| History completeness | 2504.00061 | 97.58% vs 77.11% across model sizes |
| Fabrication audit | 2608.26167 | Authority prompts → fabrication 0.53-0.76 |
| Error amplification | 2608.22872 | ASR errors compound 36-67% downstream |

## Research Sources

- Raw research file: `~/Documents/Last30Days/indicwhisper-bhashini-indic-asr-and-handwritten-prescription-ocr-for-clinical-intake-raw-v3.md`
- WebSearch supplements appended to same file (arXiv API, GitHub API)
- Problem statement: `Problem__statement_47.txt`
