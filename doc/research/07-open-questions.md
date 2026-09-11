# Open Questions & TODO Backlog

**How to use:** keep this current. When a question is answered, move it to the research log with the answer. Cross-session - anyone can add.

---

## Research / Domain Questions

- [ ] **CCRAS Prakriti Assessment Scale (PAS)** - get the actual standardized questionnaire items for Prakriti assessment (the modern reference for Module A's AYUSH battery).
  - *Update (2026-09-01):* modern PAS questionnaires typically score ~15-20 items per Vata/Pitta/Kapha
    domain on a Likert scale; final Prakriti = highest-scoring dosha (often a blend). Exact official
    CCRAS item set still needs sourcing — do not fabricate the items from memory.
- [ ] Build example touchscreen question flows for EACH of the 10 Dashavidha parameters.
- [ ] Compile red-flag detection rules as a concrete rule set (thunderclap headache, acute chest pain + dyspnoea, stroke symptoms, etc.). *See proposed triage-classifier design in `08-technical-foundations.md` §4.*
- [ ] Map the SOCRATES 8 fields + Dashavidha 10 params into a single unified clinical ontology schema (JSON/FHIR). *Proposed shape: a `HistoryBundle` FHIR/JSON resource — `08-technical-foundations.md` §5.*
  - [ ] **Hinglish + medical-vocabulary ASR corpus** — curate/generate code-mixed Hindi-English OPD
    audio; candidate novelty contribution, see `08-technical-foundations.md` §1.
- [ ] Study competing repo `rohit-h11/medikiosk-sih-26047` - what to adopt vs differentiate. (Blocked: github.com not fetachable in this env - try `gh` CLI or WebFetch from other domains.)

## Technical / Module Questions

- [ ] ABDM sandbox docs - Module D compliance (FHIR APIs, consent flow).
- [ ] ClinOCR-Bench per-subset numbers (Handwriting vs Normal).
- [ ] SCRIBE full paper - entity/numeral error rates for Hindi.
- [ ] SamaVaani full paper - real WER numbers for the 8-system clinical audit.
- [~] IndicConformer vs IndicWhisper head-to-head on noisy conditions (no published result yet).
  - *Note (2026-09-01):* the ~30pt noise WER cliff (see `ocr_asr_rnd.md`) suggests the physical
    acoustics fix may dominate engine choice — worth testing the booth/mic first, then models.
  - *Update (2026-09-01, partial answer):* verified sherpa-onnx ships NO out-of-the-box streaming
    Hindi model; pragmatic v1 = segmented multilingual Whisper-ONNX (sherpa-onnx) or faster-whisper
    INT8 + ufal/SimulStreaming LocalAgreement policy. IndicConformer/IndicWhisper ONNX = phase-2.
    Also verified piper TTS moved to GPL-3.0; use sherpa-onnx TTS with hi_IN voices (Apache) instead.
- [ ] Synthetic code-mixed Hindi-English OPD dialogue - potential novelty contribution.
- [ ] Dashboard for low-literacy UX - audio prompt + icon design specs.
- [ ] Audio booth hardware specs (given ~30pt WER cliff from noise).

---
