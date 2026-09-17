# MediKiosk — production kiosk frontend + runtime

The patient-facing kiosk and the physician consult screen, plus the thin
server that wires them to the **real** Module B (`medib`) and Module C
(`medic`) packages. Implements the topology in `doc/19` (thin kiosk + edge
node) and the Module C production design in `doc/21`.

## What this is (and is not)

- **Real pipelines, no mocks.** Document upload runs the actual Module B OCR +
  structurer + confidence gate; the summary is built by the actual Module C
  merger/renderer/FHIR emitter/eval harness. Nothing is stubbed in the
  frontend.
- **No hardcoded clinical content.** Questions, options, labels, red-flag
  rules and ROS sets are served from `kiosk/config/*.json`. The UI renders
  whatever the server sends; a clinician can change capture without touching
  code.
- **Safety logic is server-side.** Red flags are computed on the server
  (`history_builder.compute_red_flags`) and returned to the UI with matched
  evidence. The browser never evaluates a clinical rule.
- **Deterministic, offline-first.** No outbound network calls; no LLM in the
  path. The server imports the in-repo packages directly.
- **Voice in and out (real Module A).** The browser captures the mic; the
  kiosk CPU transcribes with offline faster-whisper (`media.speech`), and the
  OS voice reads questions/read-back aloud. Audio is transient and never
  stored. Degrades to touch/text when speech is unavailable.
- **Honest posture.** Reference ranges are unsigned, so the kiosk does **not**
  flag lab values (doc/21 C-C). Assessment & Plan are structurally absent from
  machine output. Application-enforced attestation gate.

## Run

```bash
# from the repository root — single entry point for the whole project
python run.py                 # start the kiosk web app (opens the browser)
python run.py --check         # environment + capability report
python run.py --demo          # headless A+B+C encounter -> out/
python run.py --demo --voice  # spoken interview (mic + offline ASR + TTS)

# or run the server directly
python -m kiosk.server
# then open http://127.0.0.1:8080          (patient kiosk)
#            http://127.0.0.1:8080/physician (physician view)
```

Dependencies used by the runtime (all already present in the dev image):
`fastapi`, `uvicorn`, `fhir.resources`, `rapidocr`, `onnxruntime`, `pillow`.
Module B's Tesseract fallback is optional; PDF intake needs optional
`pypdfium2`.

## Architecture

```
kiosk/
  server.py            FastAPI app: static UI + JSON API
  services.py          orchestration over the real medib/medic packages
  speech.py            real Module A voice: faster-whisper ASR + OS TTS
  history_builder.py   answers -> medikiosk-history-bundle/1 + red flags
  documents.py         real Module B intake (base64 upload -> medib.run)
  store.py             atomic file-backed session store (SQLCipher seam)
  config_loader.py     validated, cached config loading
  paths.py             repo layout + import bootstrap
  config/              app.json, interview.json, red_flags.json, ros.json
  web/                 index.html, physician.html, css/, js/
  tests/               API tests + headless-browser smoke
```

### API (all JSON)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config` | brand, languages, versions, limits, consent notice |
| GET | `/api/interview` | full capture schema (sections, turns, ROS sets) |
| GET | `/api/interview/options/{turn}?complaint=` | complaint-specific options |
| POST | `/api/sessions` | start a session (consent acknowledgement required) |
| GET | `/api/sessions` | physician worklist (red flags first) |
| GET | `/api/sessions/{id}` | session record |
| PUT | `/api/sessions/{id}/answers` | save/autosave answers |
| POST | `/api/sessions/{id}/safety` | server-side red-flag preview |
| POST | `/api/sessions/{id}/history` | build + validate the HistoryBundle |
| POST | `/api/sessions/{id}/documents` | base64 images → real Module B |
| POST | `/api/sessions/{id}/documents/bundle` | accept a Module B run_summary |
| POST | `/api/sessions/{id}/asr` | transcribe browser-captured WAV (Module A) |
| POST/GET | `/api/sessions/{id}/summary` | real Module C summary |
| POST | `/api/sessions/{id}/attest` | application-enforced attestation |
| POST | `/api/sessions/{id}/edit` | physician correction round-trip |
| POST | `/api/sessions/{id}/erase` | crypto-erasure seam |
| GET | `/api/speech` | ASR/TTS capability probe |
| POST | `/api/speech/tts` | synthesize text to WAV (Module A) |

Speech is configured in `config/app.json > speech` (`asr_model` tiny/base/small,
`tts_rate`, `auto_speak_default`). ASR needs `faster_whisper` plus a cached
model (e.g. `Systran/faster-whisper-tiny`); TTS needs `pyttsx3`. When missing,
`/api/speech` reports unavailable and the UI shows touch/type only.

## Invariants enforced here

- Consent acknowledged before a session starts; documents refused without a
  consent reference.
- Never diagnose: A/P locked; never pre-generate physician-at-consult sections.
- Never fabricate: every rendered line carries canon field provenance.
- Never silently resolve: conflicts keep both values + `needs_review`.
- Never let a machine clear uncertainty: patient confirmation does not clear a
  verify flag; only clinician attestation does.
- Attestation gate: every verify item must be dispositioned before `final`.

## Tests

```bash
python -m pytest kiosk/tests/ -q          # API + contract tests
python kiosk/tests/browser_smoke.py       # headless browser: kiosk + physician
```

## Honest status / next

- **Voice is wired (Module A).** The browser captures the mic, the kiosk CPU
  transcribes with offline faster-whisper, and questions/read-back are spoken
  via the OS voice; everything degrades to touch/type if the stack is absent.
  Remaining: Hindi/Hinglish **accuracy on real OPD audio is unvalidated**
  (doc/09 §10, M0 bake-off); a **Hindi TTS voice is not installed** on this
  host (the OS voice reads Hindi poorly), so browser `speechSynthesis` with a
  hi-IN voice is the fallback. The recorded WAV lane is the tested path; a
  streaming/partial-transcript lane is future work.
- **Consent** is the kiosk-transient notice + acknowledgement; the full ABDM
  consent-artefact lifecycle is Module D (doc/22).
- **Auth/RBAC** is not in this build; the physician screen has a configurable
  practitioner identity, not a login. Production requires hospital SSO.
- **Storage** is atomic JSON; production uses SQLCipher on the kiosk
  (`store.py` is the seam).
- **Reference ranges** need a clinician-signed, cited table (doc/21 C-C)
  before lab flagging can be enabled.
