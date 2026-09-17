# Module B Deep-Dive - What Fits MediKiosk (Research Findings)

> **Purpose:** second-pass research for Module B (Medical Document Digitization & Intelligence),
> 2026-09-11. Goes one level below `05-research-log.md`'s Module B entry: machine-verified ABDM
> output contract, per-engine license/footprint/Indic facts, accuracy ceilings from full-paper
> reads, and a constraint-fit synthesis. **This is research output with fit findings - NOT a
> ratified architecture decision.** The pending decision lives in `decisions/06-decisions-log.md`
> ("Document AI for Module B: VLM-first vs classical OCR vs router"). All facts sourced; every
> fetch was live on 2026-09-11.
>
> **Constraints this must fit (from PS + doc/09 hardware profile):** 4-6GB VRAM / 12-16GB RAM
> edge device, offline-first, Hindi/English + regional languages, handwritten + printed Indic
> documents, DPDP 2023 / ABDM, low-maintenance shared kiosk, India data residency (citation still
> pending - see doc/07).

---

## 1. The ABDM output contract (machine-verified from NRCeS profile JSONs)

Fetched and parsed the canonical StructureDefinition JSONs from the
[FHIR IG for ABDM v6.5.0](https://nrces.in/ndhm/fhir/r4/index.html) (NRCeS, MoHFW/C-DAC; FHIR R4).
What Module B must actually emit:

**Every Composition-based record** (HealthDocumentRecord, PrescriptionRecord,
DischargeSummaryRecord, DiagnosticReportRecord, OPConsultRecord) requires:
- `status`, `type` (with coding - profile short-text says "Code defined by SNOMED"),
  `subject.reference`, `date`, `author.reference`, `title` - all mandatory (min 1..1)
- `attester` is mustSupport (mode required when present: personal | professional | legal | official).
  **This is the FHIR-native slot for the physician verify/edit step** - the ABDM contract itself
  anticipates a human attestation, which aligns with the elicit-never-diagnose posture.
- `section.entry` mandatory - sections point at the underlying resources.

**HealthDocumentRecord** (the named profile for our use case - "unstructured historical health
records ... uploaded by the patients"): its sections contain references to documents, i.e., the
raw patient-carried scan rides as `DocumentReference` entries (inline base64 `attachment.data`
is MUST-SUPPORT 1..1 per the DocumentReference profile) inside a HealthDocumentRecord
Composition. So "scan + structured extract" has a first-class emission shape: raw image as
DocumentReference + extracted meds/labs/diagnoses as MedicationRequest/Observation/Condition,
all bundled (DocumentBundle profile) under the Composition.

**MedicationRequest** mandatory: `status`, `intent`, `medication[x]`, `subject`, `authoredOn`,
`requester`, `dosageInstruction`; `reasonCode`/`reasonReference` mustSupport.
`medication[x]` is bound (example strength) to the NRCeS
[ndhm-medicine-codes](https://nrces.in/ndhm/fhir/r4/ValueSet/ndhm-medicine-codes) value set,
whose description reads: "Clinical Drugs from SNOMED CT International Edition, Clinical Drugs and
Branded Medicines (Real Clinical Drugs) from **Common Drug Codes for India (National Extension)**"
(a.k.a. CDCI - the India-specific drug code extension; a third-party browsable mirror exists at
cdci.ohc.network). Note: example-strength binding means the value set illustrates expected codes,
it does not hard-mandate them - but mapping extracted trade names to SNOMED/CDCI is the
interoperability payoff.

**Observation** (lab values): `status`, `code` mandatory; `value[x]`, `hasMember` mustSupport.
`code` is example-bound to HL7 observation-codes (NRCeS lab-specific bindings live in the
DiagnosticReportLab profile - not parsed this pass; flagged in doc/07).

**Implication for Module B:** the structurer's output schema is not a design free-choice - it is
published, versioned, and machine-consumable. Any candidate pipeline should be validated against
these profiles (HAPI FHIR, Apache-2.0, active - pushed 2026-09-10 - is the standard
server/validator).

---

## 2. Accuracy ceilings - the numbers that shape the verify-UX

### 2.1 MIRAGE full paper (arXiv:2410.09729v2, read in full)

Indian-prescription extraction, 743,118 simulated records from 1,133 doctors across 52
specialties (sponsored by Medyug Technology; IIT Bombay co-author; 100-record public subset on
HuggingFace: `chaithanyakota/100-handwritten-medical-records`). The numbers that matter:

| Setting | Result |
|---|---|
| Zero-shot LLaVA 1.6 on their dataset | **F1 2.00%** |
| Zero-shot Gemini 1.5 Pro | **F1 5.53%** |
| Zero-shot GPT-4o | **F1 7.57%** |
| Fine-tuned LLaVA 1.6 (Mistral 7B + CLIP, LoRA r128) | med names+dosages **F1 79.8%** |
| Fine-tuned Idefics2 (SigLIP + Mistral 7B) | med names+dosages **F1 82%** (1 epoch) |
| Extracting ALL fields (vitals, dx, tests, meds) - fine-tuned | Qwen-VL F1 7%; LLaVA average **F1 ~40%** (med names 49%) |
| Rare medications | accuracy collapses as med frequency drops |
| Authors' own verdict | "our accuracy is **in no way deployable** and should not be deployed" |

Read-out for Module B:
1. **Off-the-shelf frontier VLMs are useless on Indian doctor handwriting** (2-7.6% F1). Any
   claim that "GPT/Gemini can read prescriptions" is refuted by this source.
2. Even the best published fine-tuned result (82%) covers **medication names + dosages only**,
   on a *simulated* corpus (real doctors writing simulated prescriptions - cleaner than real OPD
   archives). Full-field extraction is at ~40%.
3. Fine-tuning matters (2% -> 80%+) and the winning recipe was a 7B-class model with a strong
   vision encoder (Idefics2/SigLIP at 980x980 beat CLIP) - encoder quality, not LLM size, was
   the differentiator.
4. **Therefore the "unreadable - verify" path is the DEFAULT for handwriting, not the exception.**
   The confidence-gating + physician-attestation design (doc/08 §2 + the NRCeS `attester` slot)
   is not cautious gold-plating; it is what the evidence demands.

### 2.2 ClinOCR-Bench (arXiv:2607.03650, abstract + repo read)

Public, PHI-free clinical OCR benchmark: 384 scanned images, 6 subsets (Normal, Handwriting,
Poor Quality, Rotation, Tables, Mix-artifacts), 16 templates, template-aware train/test split,
MIT license, on HuggingFace (`ClinOCR-Bench/ClinOCR-Bench`). Two caveats discovered this pass:
- The **Handwriting subset is rendered with handwriting fonts** - synthetic, not real clinician
  handwriting. So even the public clinical benchmark does not test the hardest real artifact.
- Per-subset baseline numbers are in the PDF, not the README - still un-pulled (doc/07 item,
  now annotated).
- US-clinical-doc origin (lab reports, referrals, forms); not Indic.

### 2.3 Carried from the prior pass (ocr_asr_rnd.md, not re-verified today)

RAPTOR+ (arXiv:2605.25956): 96.1% reading vs 60.6% strict-grounding - the evidence behind the
"every extracted value ships with a bounding box" rule. DISCO (arXiv:2603.23511): OCR pipelines
stronger on handwriting + long docs; VLMs win on multilingual + visually rich layouts - the
router hypothesis. RealDocBench (arXiv:2606.07401): page-level OCR similarity scores correlate
poorly with field-level accuracy - evaluate at field level.

---

## 3. Engine-by-engine fit (all facts fetched 2026-09-11)

### 3.1 Classical OCR lane (printed prescriptions, lab tables)

| Engine | License | Footprint / deployment | Indic support | Maintenance | Fit notes |
|---|---|---|---|---|---|
| **PaddleOCR** ([repo](https://github.com/PaddlePaddle/PaddleOCR), 89.3K stars) | Apache-2.0 (repo badge) | Hardware badge: **CPU, GPU, XPU, NPU**; 5.2x CPU speedup via OpenVINO; `PaddleOCR.js` runs PP-OCRv5 **in the browser** | PP-OCRv5 multilingual rec model: **2M params**, supports **Devanagari, Tamil, Telugu**, Cyrillic, Arabic; 109 languages; PP-OCRv6 unified model covers 50 langs (zh/en/ja + Latin) | Pushed 2026-07-22; very active | Strongest printed-doc candidate for a CPU-first kiosk; tiny rec models embed easily |
| **RapidOCR** ([repo](https://github.com/RapidAI/RapidOCR)) | Apache-2.0 | **ONNX Runtime** packaging of PaddleOCR models - offline deployment without the PaddlePaddle framework; runs onnxruntime-cpu / openvino / tensorrt / mnn | Same as PaddleOCR multilingual models (via converted models) | Active | The engineering path for running PP-OCR models as plain ONNX on the kiosk |
| **Tesseract** (76.4K stars, pushed today) | Apache-2.0 | CPU-only, mature | Full Indic traineddata in tessdata: **asm, ben, guj, hin, kan, mal, nep, ori, pan, san, sin, tam, tel, urd** (verified from repo contents) | Active | Reliable floor for printed text; known weak on handwriting and complex layout |
| **docTR** (6.3K stars) | Apache-2.0 | TensorFlow/PyTorch + ONNX export | Latin-centric | Active (pushed 2026-09-01) | Alternative; less Indic coverage than Paddle |
| **EasyOCR** (30.0K stars) | Apache-2.0 | PyTorch | 80+ langs incl. Indic scripts | **Slowing** (last push 2025-12-05) | Usable but maintenance risk vs Paddle |
| **OCRmyPDF** (34.7K stars) | MPL-2.0 | PDF OCR-layer tool (wraps Tesseract) | Via Tesseract | Active | PDF ingestion convenience; MPL-2.0 is file-level copyleft - fine for unmodified use |

### 3.2 Document-VLM lane (handwriting, messy layout, tables)

| Model | Weights license (verified) | Size | Deployment | Indic | Fit notes |
|---|---|---|---|---|---|
| **PaddleOCR-VL-1.6 / 1.5** ([HF](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6)) | **Apache-2.0** (HF model card tag, both versions) | **0.9B** (NaViT-style dynamic-res encoder + ERNIE-4.5-0.3B LM) | Paddle stack; "edge/cloud deployment" claimed; JSON/Markdown structured output | **109-111 languages incl. Hindi (Devanagari)**, Arabic, Thai, etc. | Standout fit: sub-1B fits the 4-6GB VRAM profile with headroom (bf16 ~1.8GB weights; quantized less - arithmetic, untested on kiosk); 96.3% on OmniDocBench v1.6; PP-DocLayoutV3 explicitly targets **skew, warping, scanning, illumination, screen photography** - the exact kiosk document-camera failure modes. Caveat: OmniDocBench is general-doc (zh/en-centric); **Indic medical-handwriting performance unverified - must be tested on a local eval set** |
| **DeepSeek-OCR** ([repo](https://github.com/deepseek-ai/DeepSeek-OCR), [HF](https://huggingface.co/deepseek-ai/DeepSeek-OCR), 2.4M HF downloads) | **MIT** | 3B-class MoE (per model card family) | Reference path is **CUDA + vLLM** (A100-class in README); officially supported in upstream vLLM; no official CPU path; community quantized ports exist (unverified) | Multilingual claims; Indic not itemized in README | Strong accuracy lineage ("Contexts Optical Compression"); successor **DeepSeek-OCR-2** (repo Apache-2.0, 3.4K stars, pushed 2026-02) exists. VRAM fit on the kiosk profile depends on quantization - untested |
| **GraniteDocling-258M** ([HF](https://huggingface.co/ibm-granite/granite-docling-258M)) | Apache-2.0 | **258M** | docling pipeline (MIT code); CPU-friendly | General | Cleanest license stack (MIT+Apache) and smallest VLM; likely the weakest on hard handwriting |
| **surya / marker (Datalab)** ([surya](https://github.com/VikParuchuri/surya), [marker](https://github.com/VikParuchuri/marker)) | Code **Apache-2.0**; **weights OpenRAIL-M (modified AI Pubs)** - "free for research, personal use, and **startups under $5M funding/revenue**"; broader commercial needs Datalab pricing | surya: layout + OCR + reading order + tables, 90+ languages | vLLM (NVIDIA GPU) or **llama.cpp (CPU/Apple Silicon)** auto-server | Multilingual (91-language benchmark, 87.2%) | Technically excellent and CPU-viable via llama.cpp; the **weights-license commercial clause is a procurement risk** for a hospital product - fine for SIH, needs a decision before commercialization |
| docling (66.3K stars, MIT) | code MIT; model licenses vary (GraniteDocling is Apache-2.0) | pipeline | CPU-friendly | n/a | Framework/pipeline option rather than a model |
| **MedGemma 4B/27B** ([repo](https://github.com/Google-Health/medgemma), [HF](https://huggingface.co/google/MedGemma-4B-it)) | **Gated, Google Health AI Developer Foundations terms** (HF `license: other`); GitHub Apache-2.0 covers code only | 4B multimodal (SigLIP); 27B **text-only** | Gemma 3 variants for **clinical image comprehension: chest X-rays, dermatology, ophthalmology, histopathology** | **Not a document-OCR tool**: no OCR/document/handwriting benchmark in its card; image domain is clinical photos, not paper documents. Likely judge question ("why not Google's medical model?") - answer: wrong domain, gated non-OSS license, 4B size for no documented doc-parsing edge. Phase-2 nuance: its SigLIP encoder is the family MIRAGE found best for handwriting, but only after fine-tuning on 743K prescription images (HAI-DF terms would need legal review first). Imaging-film interpretation (its actual domain) is out of Module B scope and diagnosis-adjacent |
| **Excluded** | MinerU: custom license (GitHub NOASSERTION); GOT-OCR2.0: **no license file**; nougat/donut: stale, academic-doc focus | | | | Do not build on these without legal review |

### 3.3 Structuring / clinical-NLP lane

- **Local-LLM structured-JSON pattern** (community evidence, 30-day window): LENA2 PR#44
  ("OCR container [Tesseract default; PaddleOCR/docTR multi-column] -> Ollama structured-JSON
  extraction") and geradoc PR#51 (compared Tesseract/OCRmyPDF/PaddleOCR/docTR/Google Vision/
  Textract for a privacy-first local pipeline; picked PaddleOCR as primary experiment).
  Synergy: the ratified-pending Module A runtime already plans llama.cpp + Qwen3 - the same
  runtime class can host the structurer; no second inference stack.
- **medspaCy** (MIT, 676 stars, active) / **scispaCy** (Apache-2.0, 2.0K stars) - clinical NLP
  for med-name normalization and section detection on OCR output. **Apache cTAKES**
  (Apache-2.0) is aging (136 stars) - legacy option.
- **Med coding target:** SNOMED CT Intl clinical drugs + **CDCI (Common Drug Codes for India,
  National Extension)** per the ndhm-medicine-codes value set (§1). India's SNOMED membership
  via NRCeS makes in-country use possible; commercial-product terms unverified (doc/07).

### 3.4 Indic-specific assets (thin - this is the gap)

- **IndicDLP** ([repo](https://github.com/AI4Bharat/IndicDLP)) is a **dataset**, not an engine
  (correction to ocr_asr_rnd.md's one-liner): ICDAR 2025 oral, Best Student Paper runner-up;
  119,806 high-res document images across **11 Indic languages + English** (Assamese, Bengali,
  Gujarati, Hindi, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu), multi-domain,
  for **layout parsing** research. Usable as a layout-model training/eval base and as evidence
  in the submission; it does not read handwriting.
- AI4Bharat/Indic-OCR: dormant since 2022, no license.
- **No public real-Indic-medical-handwriting corpus exists** (MIRAGE is simulated; its 100-record
  public subset is the only public Indian prescription-handwriting sample found). The consenting
  local eval set (real OPD scans, DPDP-clean) is therefore the gating asset for ANY engine
  choice - this is the single most important build-before-buy item.

---

## 4. Compliance fit for the scan flow (DPDP 2023 + Rules 2025)

From the EY compliance guide + PIB notification (research log 2026-09-11):

- **Kiosk paper scanning is squarely in scope**: DPDP applies to personal data "collected online
  or collected offline and later digitized."
- **Notice**: must be itemized (data collected, purpose, rights channels, DPO contact) and
  available in English or any of the **22 Eighth Schedule languages** - matches the audio-guided,
  local-language consent design. Itemized-list requirement means "we scan your documents" is not
  enough; enumerate what is extracted (meds, labs, diagnoses) and the purpose (this consultation).
- **Breach**: notify Board + affected principals without delay; detailed report within **72h**.
- **Timeline**: Rules notified **14 Nov 2025** (corrected 2026-09-16 from the earlier 13 Nov
  value; see research log 2026-09-16); phased; full compliance by **13 May 2027** - i.e., a
  2026-27 pilot ships under live obligations, not a grace period.
- **Open legal reads** (doc/07): Data Fiduciary vs Processor posture for the kiosk operator; the
  retention question (persist scan to ABDM Health Locker vs transient session - changes storage
  obligations); India-residency citation (ABDM HDM Policy clause unfetched).
  - *Update (2026-09-16, doc/22 §D-A/§D-F):* **posture RESOLVED** — hospital = Data Fiduciary +
    HIP, MediKiosk = Data Processor (via DPA); India-residency is HDM Policy (Apr-2022 rev.)
    **Clause 26**. Retention: transient-by-default, per-purpose clocks. Remaining legal read =
    the DPDP "compatible purpose" question + Fourth Schedule scope (doc/22 D-K-15).

---

## 5. What is appropriate - constraint-fit synthesis (findings, not a decision)

**Supported by the evidence assembled:**

1. **The router architecture (already the pending candidate decision) is what the evidence
   supports.** Printed docs dominate volume and are a solved CPU problem (PaddleOCR 2M-param
   multilingual rec models, Apache-2.0; RapidOCR ONNX packaging; Tesseract's complete Indic
   traineddata set as floor). Handwriting/tables are NOT solved (MIRAGE §2.1) and need the VLM
   lane + gating. DISCO (prior pass) independently lands on the same split.
2. **The VLM lane should be small and Apache/MIT-licensed.** PaddleOCR-VL-0.9B is the standout
   fit on paper: Apache-2.0 weights (verified), sub-1B fits the 4-6GB profile with headroom,
   claims Hindi/Devanagari + 109-111 languages, structured JSON output, and its layout front-end
   explicitly targets kiosk-camera artifacts (skew/illumination/screen-photo). DeepSeek-OCR (MIT)
   is the accuracy-stronger, deployment-heavier alternative. GraniteDocling-258M is the
   minimal-footprint fallback. **None of these is validated on real Indic OPD handwriting -
   that validation, on a local eval set, is the gate.**
3. **Confidence gating + physician attestation is the core safety feature, not a nicety.**
   Zero-shot frontier VLMs score 2-7.6% F1 on Indian handwriting; the best fine-tuned result is
   82% on a simulated corpus for med-names only, and its authors say "not deployable." The NRCeS
   profile's own `attester` element is the contract-level home for the physician verify step.
   Every extracted value needs a bounding box (RAPTOR+ grounding rule) and low-confidence fields
   default to "unreadable - verify."
   *Terminology note (2026-09-11, team discussion):* combining Tesseract + PaddleOCR + a VLM on
   the same image is a **cross-engine voting/agreement ensemble, NOT bagging** - there is no
   bootstrap resample or retraining, and members are heterogeneous. Its value is the free
   per-field confidence signal (engines agree -> high confidence; disagree -> verify flag), not
   variance reduction - voting cannot fix correlated errors, and MIRAGE shows engines fail
   together on hard handwriting. Kiosk-budget shape: classical OCR on CPU + one small VLM on GPU
   as a 2-member cross-check, full voting reserved for the router-selected hard minority.
4. **Emit the published contract.** Structured output maps to NRCeS ABDM profiles:
   raw scan -> DocumentReference (inline base64) inside HealthDocumentRecord; meds ->
   MedicationRequest (SNOMED/CDCI-coded); labs -> Observation; diagnoses -> Condition; all in a
   DocumentBundle. Validate with HAPI FHIR (Apache-2.0, active). This is machine-verified, not
   inferred from blog posts.
5. **One runtime, two lanes.** The Module A stack decision (llama.cpp on the kiosk) extends to
   Module B: classical OCR via ONNX (RapidOCR path) + the doc-VLM/structurer served from the
   same llama.cpp-class runtime where possible (surya already ships llama.cpp serving; PaddleOCR-VL
   would need its own stack - a real integration cost to weigh). PaddleOCR.js (browser) is a
   curiosity for the Tauri/web prototype direction but not the production lane.

**What is NOT appropriate (with reasons):**

- **Cloud OCR/doc-AI APIs as the primary lane** - breaks offline-first; per-page pricing is
  material at public-hospital volume (Google Document AI Custom Extractor is $30/1K pages; at
  even 1 page x 4,000 patients/day that is ~120K pages/month ≈ $3,600/month for extraction
  alone - arithmetic from public pricing, assumption labeled); residency unverified. AWS
  HealthLake / Google Document AI remain useful as architecture references, not deployment.
- **surya/marker weights** for a commercial hospital product without resolving the OpenRAIL-M
  commercial clause (fine under $5M revenue - a licensing decision to make consciously, not by
  accident).
- **MinerU (custom license), GOT-OCR2.0 (no license)** - excluded pending legal review.
- **Any claim of >90% handwriting accuracy** - the published Indian ceiling is 82% on a
  simulated corpus, med-names only. Judges can check this; so can patients' safety.
- **Autonomous extraction without physician verify** - contradicted by every accuracy source and
  by the attester slot in the ABDM profile itself.

**Cheapest de-risking sequence the evidence points to (for the team to consider):**
1. Build the local eval set first (consented real OPD scans, Hindi+English, mixed print/hand,
   with field-level ground truth; seed with MIRAGE's public 100-record subset + ClinOCR-Bench
   subsets for method validation).
2. Benchmark on it: Tesseract vs PaddleOCR(PP-OCRv5 multilingual) vs RapidOCR for printed;
   PaddleOCR-VL-0.9B vs DeepSeek-OCR(-quantized) vs GraniteDocling for handwriting - at field
   level (RealDocBench lesson: page-similarity scores mislead).
3. Pick the router thresholds from measured per-field confidence, not vendor benchmarks.
4. Validate FHIR emission against the NRCeS profiles in the ABDM sandbox.

---

## 6. Source register (all fetched 2026-09-11)

- NRCeS FHIR IG for ABDM v6.5.0 - StructureDefinition JSONs: HealthDocumentRecord,
  PrescriptionRecord, DischargeSummaryRecord, MedicationRequest, Observation; ValueSet
  ndhm-medicine-codes. nrces.in/ndhm/fhir/r4/
- MIRAGE full text: arxiv.org/html/2410.09729v2 (tables 1-3, discussion quotes).
- ClinOCR-Bench: arxiv.org/abs/2607.03650 (abstract) + github.com/ClinOCR-Bench/ClinOCR-Bench
  (README: subsets, fonts, template split, MIT, HF dataset).
- GitHub READMEs (via API): PaddlePaddle/PaddleOCR (PP-OCRv6/PP-OCRv5 multilingual 2M-param,
  109-111 langs, OpenVINO CPU, PaddleOCR.js, PaddleOCR-VL-0.9B), VikParuchuri/surya +
  marker (Apache code / OpenRAIL-M weights, $5M clause, vllm+llama.cpp), deepseek-ai/DeepSeek-OCR
  (CUDA/vLLM reference; DeepSeek-OCR-2 exists), docling-project/docling (MIT, GraniteDocling),
  AI4Bharat/IndicDLP (dataset, ICDAR 2025), RapidAI/RapidOCR (Apache-2.0, ONNX), JaidedAI/EasyOCR.
- HuggingFace model API (license tags): PaddlePaddle/PaddleOCR-VL-1.6 + 1.5 (apache-2.0),
  deepseek-ai/DeepSeek-OCR (mit), ibm-granite/granite-docling-258M (apache-2.0).
- GitHub API: deepseek-ai/DeepSeek-OCR-2 (Apache-2.0, 3.4K stars); tesseract-ocr/tessdata
  contents (Indic traineddata inventory); license/stars/push for 21 repos (research log entry).
- Prior-pass figures carried unchanged: RAPTOR+, DISCO, RealDocBench, GDP.pdf, Baichuan-M4
  (ocr_asr_rnd.md, 2026-09-01 pass).

*Fit findings prepared for team ratification. Decision row to update: `decisions/06-decisions-log.md`
"Document AI for Module B".*
