"""Encounter orchestrator: A -> B -> merge -> emit, under one scheduler.

Ties the existing packages together without owning any module logic:
- `media` captures the interview (A) and emits a HistoryBundle;
- `medib` digitizes paper (B) and emits a run summary / DocumentBundle;
- `medic` merges both into the canon, renders views and emits the physician
  bundle.

All heavy A stages and every B page run through the single-slot scheduler. A
stage that cannot be admitted degrades to its safe deterministic floor rather
than failing the encounter (doc/23 section 4.7).
"""
from __future__ import annotations

import time
from contextlib import nullcontext
from dataclasses import dataclass, field

from . import paths  # noqa: F401  (puts module-a/b/c on sys.path)
from .config import KioskConfig
from .scheduler import MemoryBudgetExceeded, SingleSlotScheduler, Stage

_STAGE_BY_NAME = {"A_ASR": Stage.A_ASR, "A_NLU": Stage.A_NLU,
                  "A_TTS": Stage.A_TTS}


class _StageSlot:
    """Scheduler lease that degrades instead of failing an encounter.

    On MemoryBudgetExceeded the stage is skipped and recorded; the caller's
    deterministic floor still runs, so the patient is never blocked and nothing
    is fabricated (doc/19 invariants 2 and 7)."""

    def __init__(self, scheduler, stage, ram_mb, degradations, name):
        self.scheduler = scheduler
        self.stage = stage
        self.ram_mb = ram_mb
        self.degradations = degradations
        self.name = name
        self.lease = None

    def __enter__(self):
        try:
            self.lease = self.scheduler.acquire(self.stage, ram_mb=self.ram_mb)
        except MemoryBudgetExceeded:
            if self.name not in self.degradations:
                self.degradations.append(self.name)
            self.lease = None
        return self

    def __exit__(self, *exc):
        if self.lease is not None:
            self.lease.release()


@dataclass
class EncounterResult:
    history_bundle: dict
    document_summary: dict
    case: object
    readback: dict
    soap: dict
    opconsultrecord: dict
    stages: dict
    degradations: list[str] = field(default_factory=list)
    timings: dict = field(default_factory=dict)


class Encounter:
    def __init__(self, scheduler: SingleSlotScheduler | None = None,
                 kiosk_cfg: KioskConfig | None = None,
                 media_cfg=None, medib_cfg=None, merger_cfg=None,
                 llm_runtime=None, document_runner=None):
        self.kiosk = kiosk_cfg or KioskConfig()
        self.scheduler = scheduler or SingleSlotScheduler(
            total_ram_mb=self.kiosk.total_ram_mb,
            baseline_mb=self.kiosk.baseline_mb,
            reserve_mb=self.kiosk.reserve_mb,
            stage_ram_mb=self.kiosk.stage_ram_mb,
            timeout_s=self.kiosk.scheduler_timeout_s)
        self.media_cfg = media_cfg
        self.medib_cfg = medib_cfg
        self.merger_cfg = merger_cfg
        self.llm_runtime = llm_runtime
        self.document_runner = document_runner or self._default_document_runner
        self.degradations: list[str] = []
        self.timings: dict[str, float] = {}

    def _timed(self, name: str, fn, *args, **kwargs):
        start = time.perf_counter()
        try:
            return fn(*args, **kwargs)
        finally:
            self.timings[name] = round(time.perf_counter() - start, 4)

    # -------------------------------------------------------------- A stages
    def _stage_guard(self, name: str):
        stage = _STAGE_BY_NAME.get(name)
        if stage is None or self.scheduler is None:
            return nullcontext()
        ram = self.kiosk.stage_ram_mb.get(stage)
        return _StageSlot(self.scheduler, stage, ram, self.degradations, name)

    def capture_history(self, script, session_id: str, consent_ref: str,
                        patient_ref: str = "Patient/ABHA-UNKNOWN",
                        language: str | None = None) -> dict:
        from media.cli import run_script
        from media.config import MediaConfig
        cfg = self.media_cfg or MediaConfig()
        return run_script(script, session_id=session_id, consent_ref=consent_ref,
                          patient_ref=patient_ref,
                          language=language or cfg.language, config=cfg,
                          stage_guard=self._stage_guard)

    def capture_history_voice(self, session_id: str, consent_ref: str,
                              patient_ref: str = "Patient/ABHA-UNKNOWN",
                              language: str | None = None, max_turns: int | None = None,
                              on_event=None) -> dict:
        """Live spoken interview: speak prompts, listen, transcribe, record."""
        from media.adapters import make_asr, make_tts
        from media.config import MediaConfig
        from media.session import HistorySession
        from media.speech import MicrophoneRecorder
        from media.voice import run_voice_session

        cfg = self.media_cfg or MediaConfig()
        asr = make_asr(cfg)
        if asr is None:
            raise RuntimeError(
                "voice mode needs an ASR engine; set MediaConfig.asr_engine="
                "'faster-whisper' (or asr_command / asr_model_path)")
        tts = make_tts(cfg)
        recorder = MicrophoneRecorder(device=cfg.mic_device,
                                      energy_threshold=cfg.mic_energy_threshold)
        session = HistorySession(
            session_id=session_id, consent_ref=consent_ref,
            patient_ref=patient_ref, config=cfg,
            language=language or cfg.language, tts=tts,
            stage_guard=self._stage_guard)
        events = run_voice_session(session, asr, recorder, tts,
                                   max_turns=max_turns, on_event=on_event)
        return {
            "bundle": session.finalize(),
            "readback": session.readback_lines(),
            "red_flags": [h.to_dict() for h in session.red_flag_hits],
            "confirmations": session.confirmation_requests(),
            "events": [e.__dict__ for e in events],
        }

    # -------------------------------------------------------------- B stages
    def _default_document_runner(self, image_paths, consent, cfg) -> dict:
        from medib.config import config_from_env
        from medib.pipeline import run as medib_run
        cfg = cfg or config_from_env()
        b_ram = self.kiosk.stage_ram_mb.get(Stage.B_OCR, 2200)

        def page_guard():
            # one lease per page -> A can preempt B at a page boundary
            return self.scheduler.slot(Stage.B_OCR, ram_mb=b_ram)

        return medib_run(image_paths, consent, cfg=cfg, page_guard=page_guard)

    def capture_documents(self, image_paths=None, consent=None,
                          documents: dict | None = None, cfg=None) -> dict:
        if documents is not None:
            return documents
        if not image_paths or consent is None:
            return {"n_pages": 0, "pages": [], "session_id": ""}
        return self.document_runner(image_paths, consent, cfg or self.medib_cfg)

    # ---------------------------------------------------------------- encounter
    def run(self, *, session_id: str, consent_ref: str, script=None, patient_ref:
            str = "Patient/ABHA-UNKNOWN", language: str | None = None,
            image_paths=None, consent=None, documents: dict | None = None,
            practitioner_ref: str = "Practitioner/EXAMPLE", voice: bool = False,
            max_turns: int | None = None, on_event=None) -> EncounterResult:
        from medic.contracts import load_documents, load_history
        from medic.fhir_emitter import build_opconsultrecord
        from medic.merger import merge
        from medic.renderer import render_readback, render_soap

        if voice:
            history_run = self._timed(
                "A_capture_voice", self.capture_history_voice, session_id,
                consent_ref, patient_ref, language, max_turns, on_event)
        else:
            history_run = self._timed("A_capture", self.capture_history, script,
                                      session_id, consent_ref, patient_ref, language)
        document_summary = self._timed("B_documents", self.capture_documents,
                                       image_paths, consent, documents)

        history = load_history(history_run["bundle"])
        doc_side = load_documents(document_summary)

        def _merge_and_emit():
            case = merge(history, doc_side, self.merger_cfg) if self.merger_cfg \
                else merge(history, doc_side)
            return (
                case,
                render_readback(case, "hi"),
                render_soap(case),
                build_opconsultrecord(case, practitioner_ref=practitioner_ref),
            )

        case, readback, soap, bundle = self._timed("merge_emit", _merge_and_emit)

        return EncounterResult(
            history_bundle=history_run["bundle"],
            document_summary=document_summary,
            case=case,
            readback=readback,
            soap=soap,
            opconsultrecord=bundle,
            stages=self.scheduler.stats(),
            degradations=list(self.degradations),
            timings=dict(self.timings),
        )
