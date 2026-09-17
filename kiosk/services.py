"""Orchestration: wire kiosk capture to the real Module B and Module C packages.

The kiosk adds no clinical logic here. It:
  * builds a real HistoryBundle from captured answers (history_builder),
  * validates it with `medic.contracts.load_history` (the contract authority),
  * feeds Module B output through `medic.contracts.load_documents`,
  * calls `medic.merger.merge` -> `renderer` -> `fhir_emitter` -> `eval_harness`,
  * enforces the attestation gate in the application (doc/21 section C-B).

Reference ranges are deliberately treated as UNSIGNED in production: Module C
will not label a lab abnormal against the placeholder demo table (doc/21 C-C).
When a clinician-signed, cited table exists, set it via `RANGES_SIGNED`.
"""
from __future__ import annotations

import base64
import binascii
from pathlib import Path

from . import config_loader as cfg
from . import documents as docs
from . import speech as speech_svc
from .history_builder import build_history
from .store import STORE, new_session_id, now_iso

# The production posture: no reference-range flagging from an unsigned table.
RANGES_SIGNED = False


class ServiceError(Exception):
    def __init__(self, message: str, status: int = 400, detail=None):
        super().__init__(message)
        self.status = status
        self.detail = detail


# --------------------------------------------------------------------- config

def public_config() -> dict:
    app = cfg.app_config()
    from medic.fhir_emitter import NRCES_PROFILE
    from medib.intake import ITEMIZED_NOTICE

    return {
        "app": app["app"],
        "brand": app["brand"],
        "languages": app["languages"],
        "default_language": app["default_language"],
        "respondent_roles": app["respondent_roles"],
        "proxy_relations": app["proxy_relations"],
        "visit_types": app["visit_types"],
        "limits": app["limits"],
        "versions": {
            **app["versions"],
            "nrces_profile": NRCES_PROFILE,
            "red_flag_rule_set": cfg.red_flags()["rule_set_version"],
        },
        "disclosures": {
            "ranges_signed": RANGES_SIGNED,
            "ranges_note": (
                "Reference ranges are an unsigned placeholder; the kiosk does "
                "not label lab values abnormal. Values from the patient's own "
                "report are shown verbatim for the physician."
            ),
            "llm_in_path": False,
            "deterministic": True,
            "consent_notice": ITEMIZED_NOTICE,
        },
        "speech": speech_svc.capabilities(),
    }


def transcribe_audio(session_id: str, audio_b64: str) -> dict:
    """Transcribe browser-captured audio with the real Module A ASR.

    Audio is transient: it is decoded in memory, transcribed, and dropped. It
    is never written to the session store (Module A audio policy)."""
    record = get_session(session_id)
    limit = cfg.app_config()["limits"].get("max_audio_bytes", 6 * 1024 * 1024)
    try:
        audio = base64.b64decode(audio_b64 or "", validate=True)
    except (binascii.Error, ValueError):
        raise ServiceError("audio is not valid base64", 422)
    if not audio:
        raise ServiceError("no audio supplied", 422)
    if len(audio) > limit:
        raise ServiceError("audio exceeds the size limit", 413)
    try:
        result = speech_svc.transcribe(audio, record.get("language", "en"))
    except RuntimeError as exc:
        raise ServiceError(f"speech recognition unavailable: {exc}", 503)
    except ValueError as exc:
        raise ServiceError(str(exc), 422)
    return result


def synthesize_speech(text: str, lang: str) -> bytes:
    limit = cfg.app_config()["limits"].get("max_tts_chars", 600)
    if not text or not text.strip():
        raise ServiceError("no text supplied", 422)
    if len(text) > limit:
        raise ServiceError(f"text exceeds {limit} characters", 413)
    try:
        return speech_svc.synthesize(text, lang)
    except RuntimeError as exc:
        raise ServiceError(f"speech synthesis unavailable: {exc}", 503)
    except ValueError as exc:
        raise ServiceError(str(exc), 422)


def interview_schema() -> dict:
    """Full capture schema. Option lists are resolved per complaint server-side
    so the client never needs to know the complaint->option rules."""
    itv = cfg.interview()
    ros = cfg.ros()
    turns = {}
    for tid, turn in itv["turns"].items():
        if turn.get("kind") == "safety":
            turns[tid] = {k: v for k, v in turn.items() if k != "options"}
            continue
        t = {k: v for k, v in turn.items() if k not in ("options_by_complaint",)}
        t["options"] = turn.get("options", [])
        turns[tid] = t
    return {
        "schema": itv["schema"],
        "sections": itv["sections"],
        "turns": turns,
        "complaints": itv["complaints"],
        "general_complaint": itv["general_complaint"],
        "body_regions": itv["body_regions"],
        "yes_no_options": itv["yes_no_options"],
        "ros_sets": ros["sets"],
    }


def options_for(turn_id: str, complaint_id: str) -> list[dict]:
    itv = cfg.interview()
    turn = itv["turns"].get(turn_id)
    if turn is None:
        raise ServiceError(f"unknown turn {turn_id!r}", 404)
    by_c = turn.get("options_by_complaint")
    if by_c:
        return by_c.get(complaint_id) or turn.get("options", [])
    return turn.get("options", [])


# -------------------------------------------------------------------- sessions

def create_session(payload: dict) -> dict:
    languages = {l["code"] for l in cfg.app_config()["languages"]}
    lang = payload.get("language") or cfg.app_config()["default_language"]
    if lang not in languages:
        raise ServiceError(f"unsupported language {lang!r}", 422)
    respondent = payload.get("respondent") or {"role": "patient"}
    if respondent.get("role") not in ("patient", "proxy"):
        raise ServiceError("respondent.role must be 'patient' or 'proxy'", 422)
    if respondent.get("role") == "proxy" and not respondent.get("relation"):
        raise ServiceError("a proxy respondent must state their relation", 422)

    acknowledged = bool(payload.get("notice_acknowledged"))
    if not acknowledged:
        raise ServiceError("the itemised notice must be acknowledged before a session starts", 422)

    sid = new_session_id()
    consent_ref = f"kiosk-consent:{sid}"
    record = STORE.create(
        sid,
        language=lang,
        respondent=respondent,
        visit=payload.get("visit") or {"type": "new", "prior_date": None},
        patient_ref=payload.get("patient_ref") or "Patient/ABHA-UNKNOWN",
        consent_ref=consent_ref,
        notice_acknowledged_at=now_iso(),
    )
    STORE.append_audit(record, actor=respondent.get("role", "patient"),
                       action="session.created",
                       detail=f"language={lang} notice acknowledged")
    STORE.save(record)
    return record


def get_session(session_id: str) -> dict:
    record = STORE.get(session_id)
    if record is None:
        raise ServiceError(f"unknown session {session_id!r}", 404)
    return record


def save_answers(session_id: str, answers: dict) -> dict:
    if not isinstance(answers, dict):
        raise ServiceError("answers must be an object")
    record = get_session(session_id)
    limit = cfg.app_config()["limits"]["max_answer_chars"]
    record["answers"] = _check_size(answers, limit)
    STORE.append_audit(record, actor="kiosk", action="answers.saved",
                       detail=f"turns={len(record['answers'])}")
    return STORE.save(record)


def _check_size(answers: dict, limit: int) -> dict:
    for key, val in answers.items():
        if isinstance(val, dict):
            text = val.get("text") or ""
            if isinstance(text, str) and len(text) > limit:
                raise ServiceError(f"answer {key!r} exceeds {limit} characters", 413)
    return answers


def preview_red_flags(session_id: str) -> dict:
    """Server-side, deterministic red-flag preview on current answers.

    The UI calls this to render the safety step; it never runs the rules."""
    record = get_session(session_id)
    bundle = build_history(record)
    return {"red_flags": bundle.get("red_flags", []),
            "rule_set_version": cfg.red_flags()["rule_set_version"]}


def finalize_history(session_id: str) -> dict:
    """Build + validate the HistoryBundle (contract enforcement in one place)."""
    record = get_session(session_id)
    bundle = build_history(record)
    try:
        from medic.contracts import load_history
        load_history(bundle)  # authoritative validation
    except BuildError:
        raise
    except Exception as exc:  # ContractError and friends
        raise ServiceError(f"history bundle failed validation: {exc}", 422)
    record["history"] = bundle
    record["status"] = "history_ready"
    STORE.append_audit(record, actor="kiosk", action="history.finalized",
                       detail=f"red_flags={len(bundle['red_flags'])}")
    STORE.save(record)
    return bundle


# ------------------------------------------------------------------- documents

def ingest_documents(session_id: str, run_summary: dict | None = None,
                     image_paths: list[Path] | None = None) -> dict:
    record = get_session(session_id)
    if not record.get("consent_ref"):
        raise ServiceError("session has no consent reference; documents refused", 422)
    try:
        if run_summary is not None:
            summary = docs.accept_run_summary(run_summary)
        elif image_paths:
            summary = docs.ingest_images(
                image_paths, consent_ref=record["consent_ref"],
                session_id=session_id, language=record.get("language", "en"),
                persist_raw=False,
            )
        else:
            raise ServiceError("no documents supplied", 422)
    except docs.DocumentError as exc:
        raise ServiceError(str(exc), 422)
    record["documents_raw"] = summary
    record["status"] = "documents_ready"
    pages = summary.get("pages") or []
    STORE.append_audit(record, actor="kiosk", action="documents.ingested",
                       detail=f"pages={len(pages)}")
    STORE.save(record)
    return {"pages": len(pages),
            "pages_needing_verify": summary.get("pages_needing_verify", 0),
            "engines_used": summary.get("engines_used", []),
            "fhir_validation_errors": summary.get("fhir_validation_errors", [])}


# --------------------------------------------------------------------- summary

def _merger_config():
    """Production posture: an unsigned range table must not produce a clinical
    flag (doc/21 C-C). `ranges_are_signed` is derived from `ranges_signed_by`,
    which stays empty until a clinician-signed table is supplied."""
    from medic.config import MergerConfig
    return MergerConfig(
        strict_ranges=True,
        ranges_signed_by=None,
        ranges_version=cfg.app_config()["versions"]["range_set"],
    )


def _apply_edits(case, edits: list[dict]) -> None:
    """Apply stored physician corrections and RE-DERIVE the collections that
    `merge` computes at the end (alerts, timeline). Editing after merge without
    recomputing leaves a stale alert list — the exact bug this guards."""
    from medic.merger import (_build_timeline, _compile_alerts,
                              apply_physician_edit)
    for edit in edits:
        apply_physician_edit(case, edit["fid"], edit["value"])
    if edits:
        case.alerts = []
        case.timeline = []
        _build_timeline(case)
        _compile_alerts(case)


def _build_case(record: dict):
    from medic.contracts import load_documents, load_history
    from medic.merger import merge

    if not record.get("history"):
        raise ServiceError("history not finalized for this session", 409)
    history = load_history(record["history"])
    raw_docs = record.get("documents_raw") or {"pages": []}
    documents = load_documents(raw_docs)
    case = merge(history, documents, _merger_config())
    _apply_edits(case, record.get("edits") or [])
    return case


def generate_summary(session_id: str, persist: bool = True) -> dict:
    from medic import eval_harness, fhir_emitter
    from medic.renderer import render_oldcarts, render_readback, render_soap

    record = get_session(session_id)
    case = _build_case(record)
    app_versions = cfg.app_config()["versions"]

    bundle = fhir_emitter.build_opconsultrecord(case)
    validation_errors = fhir_emitter.validate_bundle(bundle)
    if record.get("attestation"):
        bundle = fhir_emitter.physician_attest(
            bundle, record["attestation"]["practitioner_ref"])

    eval_report = eval_harness.evaluate(case)
    summary = {
        "session": session_id,
        "generated_at": now_iso(),
        "counts": case.counts(),
        "alerts": [a.__dict__ for a in case.alerts],
        "views": {
            "soap": render_soap(case),
            "oldcarts": render_oldcarts(case),
            "readback_en": render_readback(case, "en"),
            "readback_hi": render_readback(case, "hi"),
        },
        "fhir": bundle,
        "fhir_validation_errors": validation_errors,
        "eval": eval_report,
        "meta": {
            "ig_pin": app_versions["ig_pin"],
            "emitter_version": "medic/1",
            "range_set": app_versions["range_set"],
            "range_set_signed": RANGES_SIGNED,
            "history_schema": app_versions["history_schema"],
            "status": (record.get("attestation") or {}).get("status", "preliminary"),
        },
        "attestation": record.get("attestation"),
    }

    if case.alerts:
        unresolved = [a.fid for a in case.alerts if a.severity == "verify"]
        summary["unresolved_verify_fids"] = unresolved
    else:
        summary["unresolved_verify_fids"] = []

    if persist:
        record["summary"] = summary
        record["status"] = "attested" if record.get("attestation") else "summary_ready"
        STORE.append_audit(record, actor="kiosk", action="summary.generated",
                           detail=f"alerts={len(summary['alerts'])}")
        STORE.save(record)
    return summary


def get_summary(session_id: str) -> dict:
    record = get_session(session_id)
    if not record.get("summary"):
        return generate_summary(session_id)
    # refresh when the canon changed (edits/attestation) but no summary is cached
    return record["summary"]


# ---------------------------------------------------------------- attestation

def attest(session_id: str, practitioner_ref: str, actor: str,
           resolved_fids: list[str] | None = None) -> dict:
    """Application-enforced attestation gate (doc/21 C-B).

    Every verify-severity alert must have been explicitly dispositioned before
    the record can become final. The profile does not enforce this
    (`Composition.attester` is 0..*), so the application does.
    """
    from medic.fhir_emitter import physician_attest as emit_attest

    record = get_session(session_id)
    summary = generate_summary(session_id, persist=False)
    unresolved = summary.get("unresolved_verify_fids", [])
    resolved = set(resolved_fids or [])
    missing = [f for f in unresolved if f not in resolved]
    if missing:
        raise ServiceError(
            "cannot attest: unresolved verify items remain", 409,
            detail={"unresolved_fids": missing},
        )

    bundle = emit_attest(summary["fhir"], practitioner_ref)
    attestation = {
        "status": "final",
        "practitioner_ref": practitioner_ref,
        "attested_at": now_iso(),
        "resolved_fids": sorted(resolved),
    }
    record["attestation"] = attestation
    record["summary"] = None  # rebuild with attested bundle
    STORE.append_audit(record, actor=actor, action="summary.attested",
                       detail=f"practitioner={practitioner_ref}")
    STORE.save(record)

    record = STORE.get(session_id)
    record["status"] = "attested"
    STORE.save(record)
    return generate_summary(session_id)


def apply_edit(session_id: str, fid: str, value: str, actor: str) -> dict:
    """Physician correction round-trip into the canon; re-opens an attested record."""
    record = get_session(session_id)
    if not fid or not isinstance(fid, str):
        raise ServiceError("fid is required")
    if value is None or not str(value).strip():
        raise ServiceError("a non-empty corrected value is required")

    from medic.contracts import load_documents, load_history
    from medic.merger import apply_physician_edit, merge

    if not record.get("history"):
        raise ServiceError("history not finalized for this session", 409)
    case = merge(load_history(record["history"]),
                 load_documents(record.get("documents_raw") or {"pages": []}),
                 _merger_config())
    _apply_edits(case, record.get("edits") or [])
    if not apply_physician_edit(case, fid, str(value)):
        raise ServiceError(f"field {fid!r} is not editable", 422)

    record.setdefault("edits", []).append(
        {"fid": fid, "value": str(value), "actor": actor, "ts": now_iso()})
    if record.get("attestation"):
        record["attestation"]["status"] = "amended"
    record["summary"] = None
    STORE.append_audit(record, actor=actor, action="summary.edited",
                       detail=f"{fid} -> {str(value)[:80]}")
    STORE.save(record)
    return generate_summary(session_id)


# ------------------------------------------------------------------ physician

def physician_queue(limit: int = 100) -> list[dict]:
    """Consult-screen worklist: red-flag sessions first, then by recency."""
    rows = []
    for rec in STORE.list(limit=limit):
        summary = rec.get("summary") or {}
        alerts = summary.get("alerts") or []
        has_red = any(a.get("severity") == "red-flag" for a in alerts)
        if not has_red:
            red_flags = (rec.get("history") or {}).get("red_flags")
            if red_flags is None and rec.get("answers"):
                try:
                    red_flags = build_history(rec).get("red_flags", [])
                except Exception:
                    red_flags = []
            has_red = bool(red_flags)
        rows.append({
            "session_id": rec["session_id"],
            "created_at": rec.get("created_at"),
            "status": rec.get("status"),
            "language": rec.get("language"),
            "respondent": rec.get("respondent"),
            "red_flag": has_red,
            "alerts": len(alerts),
            "has_summary": bool(rec.get("summary")),
            "attested": bool(rec.get("attestation")),
        })
    # stable two-pass: newest first, then red-flag sessions to the top
    rows.sort(key=lambda r: r["created_at"] or "", reverse=True)
    rows.sort(key=lambda r: not r["red_flag"])
    return rows


def erase_session(session_id: str) -> dict:
    record = get_session(session_id)
    docs.discard_uploads(session_id)
    STORE.append_audit(record, actor="patient", action="session.erased",
                       detail="crypto-erasure seam (transient uploads removed)")
    STORE.save(record)
    return {"session_id": session_id, "erased": True}
