"""Module A session orchestrator.

Drives one history interview: deterministic FSM picks the turn, an extractor
turns the answer into a slot, deterministic red-flag rules run on every answer,
and the result is emitted as `medikiosk-history-bundle/1`.

Integration hooks:
- `stage_guard(stage_name)` lets the kiosk scheduler wrap ASR/NLU/TTS work in a
  single-slot lease (kiosk/scheduler.py) without this module knowing about it.
- red flags are evaluated *outside* any scheduler lease (doc/23: a cheap
  synchronous rule pass, never queued).
"""
from __future__ import annotations

import re
from contextlib import nullcontext
from dataclasses import dataclass, field

from .adapters import RecordingTTS, TTS
from .config import MediaConfig
from .contracts import HistoryDraft, RedFlagHit
from .fsm import HistoryFSM, Turn, is_pain_complaint
from .nlu import RuleBasedExtractor, SlotExtractor, clinical_excerpt
from .redflags import RedFlagEngine

_LABELS = {
    "complaint": "Main problem",
    "site": "Where", "onset": "When it started", "character": "What it feels like",
    "radiation": "Spreads to", "associations": "Other symptoms",
    "timing": "Pattern", "exacerbating": "Worse/better with", "severity": "Severity",
    "ice.ideas": "Patient's idea", "ice.concerns": "Patient's worry",
    "ice.expectations": "Patient expects",
}

_MED_RE = re.compile(
    r"(?P<name>[A-Za-z][A-Za-z\-]{2,}(?:\s+[A-Za-z][A-Za-z\-]{2,})?)\s*"
    r"(?P<dose>\d+(?:\.\d+)?\s*(?:mg|mcg|ml|gm|g))?\s*"
    r"(?P<freq>\b(?:OD|BD|TDS|QID|HS|SOS)\b)?",
    re.IGNORECASE,
)


@dataclass
class TurnResult:
    turn: Turn | None
    extraction_unknown: bool
    red_flag_hits: list[RedFlagHit] = field(default_factory=list)
    pending_ack: bool = False
    next_turn: Turn | None = None


def _label(key: str) -> str:
    return _LABELS.get(key, key)


def _parse_stated_meds(text: str) -> list[dict]:
    """Light deterministic parse of patient-stated medicines.

    A name without a dose keeps an empty dose - it is never invented."""
    out: list[dict] = []
    for chunk in re.split(r"[,;]|\band\b", text or ""):
        chunk = chunk.strip()
        if not chunk:
            continue
        m = _MED_RE.search(chunk)
        if not m:
            continue
        out.append({"name": m.group("name").strip(),
                    "dose": (m.group("dose") or "").strip(),
                    "frequency": (m.group("freq") or "").strip().upper()})
    return out


class HistorySession:
    def __init__(self, session_id: str, consent_ref: str,
                 patient_ref: str = "Patient/ABHA-UNKNOWN",
                 config: MediaConfig | None = None,
                 language: str | None = None,
                 respondent: dict | None = None,
                 visit: dict | None = None,
                 extractor: SlotExtractor | None = None,
                 tts: TTS | None = None,
                 redflags: RedFlagEngine | None = None,
                 stage_guard=None):
        self.cfg = config or MediaConfig()
        self.draft = HistoryDraft(
            session_id=session_id, consent_ref=consent_ref,
            patient_ref=patient_ref,
            language=language or self.cfg.language,
            respondent=respondent or {"role": "patient", "relation": None},
            visit=visit or {"type": "new", "prior_date": None},
        )
        self.extractor = extractor or RuleBasedExtractor(self.cfg.max_excerpt_chars)
        self.tts = tts or RecordingTTS()
        self.redflags = redflags or RedFlagEngine(
            require_clinician_signoff=self.cfg.require_clinician_signoff)
        self._stage_guard = stage_guard or (lambda _stage: nullcontext())

        self.fsm = HistoryFSM(complaint_term="", is_pain=False)
        self.red_flag_hits: list[RedFlagHit] = []
        self.red_flag_acknowledged = False
        self.pending_ack = False
        self.readback_confirmed: bool | None = None
        self.asr = None                 # set by the caller for respond(audio=...)
        self.last_transcript: str = ""  # what ASR heard on the last audio turn
        self._corpus: list[str] = []
        self._severity: str | None = None
        self.confirmations: list[dict] = []

    # ------------------------------------------------------------- prompting
    def current_turn(self) -> Turn | None:
        return self.fsm.current()

    def prompt_text(self, lang: str | None = None) -> str:
        turn = self.fsm.current()
        if turn is None:
            return ""
        return turn.prompt_hi if (lang or self.cfg.language) in ("hi", "rom") \
            else turn.prompt_en

    def speak_current(self, lang: str | None = None) -> str:
        text = self.prompt_text(lang)
        with self._stage_guard("A_TTS"):
            self.tts.speak(text, lang or self.cfg.language)
        return text

    # ------------------------------------------------------------- answering
    def respond(self, utterance: str, *, by: str = "patient", voice: bool = True,
                conf: float | None = None,
                audio: bytes | None = None) -> TurnResult:
        turn = self.fsm.current()
        if turn is None:
            return TurnResult(turn=None, extraction_unknown=True)

        if audio is not None:
            with self._stage_guard("A_ASR"):
                asr = getattr(self, "asr", None)
                if asr is None:
                    raise RuntimeError("respond(audio=...) needs an ASR adapter")
                asr_result = asr.transcribe(audio)
            utterance = asr_result.text
            self.last_transcript = utterance
            if conf is None:
                conf = asr_result.conf

        if turn.kind == "readback":
            return self._handle_readback(utterance)

        with self._stage_guard("A_NLU"):
            ext = self.extractor.extract(turn, utterance)
        if conf is not None:
            ext.conf = conf

        self._record(turn, ext, by=by, voice=voice)
        if turn.slot == "complaint":
            self._apply_complaint(ext.value)
        if turn.slot == "severity" and ext.usable:
            self._severity = ext.value

        self._corpus.append(ext.value or utterance or "")
        self._refresh_red_flags()

        if self.red_flag_hits and not self.red_flag_acknowledged:
            self.pending_ack = True
            return TurnResult(turn=turn, extraction_unknown=ext.unknown,
                              red_flag_hits=list(self.red_flag_hits),
                              pending_ack=True, next_turn=self.fsm.current())

        self.fsm.advance()
        return TurnResult(turn=turn, extraction_unknown=ext.unknown,
                          red_flag_hits=list(self.red_flag_hits),
                          pending_ack=False, next_turn=self.fsm.current())

    def acknowledge_red_flag(self) -> Turn | None:
        self.red_flag_acknowledged = True
        self.pending_ack = False
        return self.fsm.advance()

    # ----------------------------------------------------------------- steps
    def _handle_readback(self, utterance: str) -> TurnResult:
        ext = self.extractor.extract(Turn("readback", "readback", "readback",
                                          "", ""), utterance)
        # Confirmation is provenance only; it NEVER clears a verify-flag
        # (invariant 4). Only clinician attestation can.
        self.readback_confirmed = (ext.value == "yes")
        self.fsm.advance()
        return TurnResult(turn=self.fsm.current(), extraction_unknown=ext.unknown,
                          red_flag_hits=list(self.red_flag_hits),
                          pending_ack=False, next_turn=None)

    def _record(self, turn: Turn, ext, *, by: str, voice: bool) -> None:
        value = ext.value if ext.usable else ""
        state = "captured"
        if not ext.usable:
            state = "not_answered"
        elif ext.conf is not None and ext.conf < self.cfg.slot_conf_threshold:
            state = "needs_review"

        tid = turn.id
        if tid == "complaint":
            self.draft.complaint = {"term": value, "free_text": value, "by": by,
                                    "voice": voice, "conf": ext.conf}
        elif tid.startswith("hpi."):
            self.draft.set_slot(turn.slot or tid.split(".", 1)[1], value,
                                by=by, voice=voice, conf=ext.conf, state=state)
        elif tid == "pmh":
            if value:
                self.draft.add_entry("pmh", {"text": value, "by": by})
        elif tid == "medications":
            for med in _parse_stated_meds(value):
                self.draft.add_entry("medications", {**med, "by": by})
        elif tid == "allergies":
            if value:
                self.draft.add_entry("allergies", {"text": value, "by": by})
        elif tid == "family":
            if value:
                self.draft.add_entry("family", {"text": value, "by": by})
        elif tid.startswith("social."):
            if value:
                topic = tid.split(".", 1)[1]
                self.draft.add_entry("social", {"topic": topic, "text": value,
                                                "by": by})
        elif tid.startswith("ros."):
            system = tid.split(".", 1)[1]
            self.draft.add_entry("ros", {
                "system": system, "symptom": system, "state": "captured",
                "positive": ext.value == "yes", "by": by})
        elif tid.startswith("ice."):
            self.draft.set_slot(f"ice.{tid.split('.', 1)[1]}", value, by=by,
                                voice=voice, conf=ext.conf, state=state)

        if turn.critical and (ext.conf is None or ext.conf < self.cfg.slot_conf_threshold):
            self.confirmations.append({
                "key": tid, "value": value,
                "reason": "critical slot: confirm before trusting"})

    def _apply_complaint(self, value: str) -> None:
        """Rebuild the sequence now that the complaint is known (pain vs not).

        The narrative + complaint turns are identical in both variants, so the
        rebuild preserves position: point the cursor at the complaint turn and
        let the normal advance land on the first HPI turn."""
        if not value:
            return
        complaint_index = next((i for i, t in enumerate(self.fsm.turns)
                                if t.id == "complaint"), None)
        if complaint_index is None:
            return
        self.fsm = HistoryFSM(complaint_term=value,
                              is_pain=is_pain_complaint(value))
        self.fsm.cursor = complaint_index

    def _refresh_red_flags(self) -> None:
        corpus = " ".join(self._corpus)
        self.red_flag_hits = self.redflags.evaluate(corpus, self._severity)

    # --------------------------------------------------------------- outputs
    def readback_lines(self) -> list[str]:
        lines: list[str] = []
        complaint = (self.draft.complaint or {}).get("term")
        if complaint:
            lines.append(f"{_label('complaint')}: {complaint}")
        for key, slot in self.draft.socrates.items():
            if slot.state in ("captured", "needs_review") and slot.value:
                lines.append(f"{_label(key)}: {slot.value}")
        for m in self.draft.medications:
            dose = f" {m['dose']}" if m.get("dose") else ""
            lines.append(f"Medicine: {m['name']}{dose}")
        for a in self.draft.allergies:
            lines.append(f"Allergy: {a['text']}")
        for key, slot in self.draft.ice.items():
            if slot.value:
                lines.append(f"{_label('ice.' + key)}: {slot.value}")
        return lines

    def confirmation_requests(self) -> list[dict]:
        return list(self.confirmations)

    def finalize(self) -> dict:
        self.draft.set_red_flags(self.red_flag_hits)
        problems = self.draft.validate()
        if problems:
            raise ValueError(f"history bundle invalid: {problems}")
        return self.draft.to_bundle()
