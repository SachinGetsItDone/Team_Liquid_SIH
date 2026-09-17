"""C2 - Merger: HistoryBundle (A) + DocumentSide (B) -> ONE canonical CaseSummary.

Doc/04's core principle: "store the underlying structured fields ONCE and render
them differently per purpose". This module builds that single canon:

- medication reconciliation: patient-stated vs document-derived meds, with
  provenance for both and needs_review on dose conflicts (never silently
  resolved either way)
- abnormal-lab compilation against the (placeholder) reference-range table
- one physician alert list: Module A red flags first, then document verify
  fields, abnormal labs and med conflicts (severity-ordered, deterministic)
- prior-record timeline from documents (date carried only when present on the
  paper - honest "date not on document" otherwise)

Never diagnoses; never invents fields. Every canon item carries a stable
field id (A:<slot> / B:<kind>:<n>) used by the renderer's provenance and the
eval harness's no-fabrication check.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .config import MergerConfig
from .contracts import DocumentSide, HistoryBundle


def _norm_name(name: str) -> str:
    return "".join(c for c in (name or "").lower() if c.isalnum())


def _doses_equivalent(a: str, b: str) -> bool:
    """'10 mg' vs '10' (unit absent on one side, numbers equal) -> equivalent.
    '5 mg' vs '10 mg' -> not equivalent. Non-numeric strings compare
    normalized exactly."""
    def num_unit(s: str):
        import re
        m = re.match(r"\s*(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)", s or "")
        if not m:
            return None
        return float(m.group(1)), m.group(2).lower()
    na, nb = num_unit(a), num_unit(b)
    if na and nb:
        if na[0] != nb[0]:
            return False
        if na[1] and nb[1]:                     # both carry units -> must match
            return na[1] == nb[1]
        return True                             # one side unit-less: tolerant
    return _norm_name(a) == _norm_name(b)


@dataclass
class CanonMed:
    name: str
    dose: str = ""
    frequency: str = ""
    duration: str = ""
    sources: list[str] = field(default_factory=list)   # ["patient", "document"]
    verify: bool = False
    reason: str = ""
    conf: float | None = None
    fid: str = ""

    def label(self) -> str:
        parts = [self.name] + [p for p in (self.dose, self.frequency, self.duration) if p]
        return " ".join(parts)


@dataclass
class CanonLab:
    name: str
    value: str
    unit: str = ""
    abnormal: str = ""              # "" | "low" | "high"
    range_note: str = ""
    verify: bool = False
    conf: float | None = None
    fid: str = ""

    def label(self) -> str:
        s = f"{self.name}: {self.value}"
        if self.unit:
            s += f" {self.unit}"
        return s


@dataclass
class Alert:
    severity: str                   # "red-flag" | "verify" | "abnormal"
    text: str
    detail: str = ""
    fid: str = ""


@dataclass
class CaseSummary:
    """The store-once canon. Renderers (C3) and the emitter (C4) read only this."""
    history: HistoryBundle
    documents: DocumentSide
    meds: list[CanonMed] = field(default_factory=list)
    labs: list[CanonLab] = field(default_factory=list)
    dx: list[dict] = field(default_factory=list)
    alerts: list[Alert] = field(default_factory=list)
    timeline: list[dict] = field(default_factory=list)

    # ---- provenance helpers -------------------------------------------------
    def field_ids(self) -> list[str]:
        ids = [self.history.field_id(s) for s in self.history.captured_slots()]
        ids += [m.fid for m in self.meds]
        ids += [l.fid for l in self.labs]
        ids += [d.get("fid", "") for d in self.dx]
        return [i for i in ids if i]

    def counts(self) -> dict:
        slots = self.history.captured_slots()
        return {
            "socrates_captured": sum(1 for s in slots if s.key in
                                     ("site", "onset", "character", "radiation",
                                      "associations", "timing", "exacerbating", "severity")),
            "needs_review": sum(1 for s in slots if s.state == "needs_review"),
            "not_answered": sum(1 for s in
                                (list(self.history.socrates.values()) +
                                 list(self.history.ice.values()))
                                if s.state == "not_answered"),
            "not_elicited": sum(1 for s in
                                (list(self.history.socrates.values()) +
                                 list(self.history.ice.values()))
                                if s.state == "not_elicited"),
            "meds": len(self.meds),
            "labs": len(self.labs),
            "dx": len(self.dx),
            "alerts": len(self.alerts),
            "red_flags": len(self.history.red_flags),
        }


def merge(history: HistoryBundle, documents: DocumentSide,
          cfg: MergerConfig | None = None) -> CaseSummary:
    """Build the canonical CaseSummary from both input streams."""
    cfg = cfg or MergerConfig()
    case = CaseSummary(history=history, documents=documents)

    _merge_meds(case, cfg)
    _merge_labs(case, cfg)
    _merge_dx(case)
    _build_timeline(case)
    _compile_alerts(case)
    return case


# ------------------------------------------------------------------ medications

def _merge_meds(case: CaseSummary, cfg: MergerConfig) -> None:
    """Reconcile patient-stated meds (A) with document-derived meds (B).

    Match on normalized name. A match merges provenance (patient + document);
    a dose mismatch is flagged needs_review with both values kept - never
    silently resolved either way. The same med on multiple documents merges
    into one entry (documents counted, not duplicated). Document-only meds
    join with their Module B verify state; patient-only meds stay
    (patient-stated)."""
    stated = {(m.get("name") or ""): m for m in history_meds(case)}

    # pass 0: dedupe document meds across pages (same normalized name)
    doc_meds: list = []
    seen_doc: set[str] = set()
    for dm in case.documents.meds:
        key = _norm_name(dm.name)
        if not key:
            continue
        if key in seen_doc:
            # same drug on another paper: keep the higher-confidence read,
            # carry verify if ANY read needed verify (conservative)
            existing = next(m for m in doc_meds if _norm_name(m.name) == key)
            if (dm.conf or 0) > (existing.conf or 0):
                existing.name, existing.dose = dm.name, dm.dose
                existing.frequency, existing.duration = dm.frequency, dm.duration
            existing.verify = existing.verify or dm.verify
            existing.source_doc += f", {dm.source_doc}" if dm.source_doc else ""
            continue
        seen_doc.add(key)
        doc_meds.append(dm)

    # pass 1: document meds drive the merged list (they carry doses/schedules)
    for i, dm in enumerate(doc_meds):
        key = _norm_name(dm.name)
        match_key = next((k for k in stated if _norm_name(k) == key), "")
        sources = ["document"]
        verify, reason = dm.verify, ""
        dose = dm.dose
        if match_key:
            sources.insert(0, "patient")
            sm = stated[match_key]
            stated_dose = (sm.get("dose") or "").strip()
            if cfg.flag_dose_conflicts and stated_dose and dm.dose \
                    and not _doses_equivalent(stated_dose, dm.dose):
                verify = True
                reason = (f"dose differs: patient said {stated_dose}, "
                          f"document says {dm.dose}")
            elif stated_dose and not dm.dose:
                dose = stated_dose
        case.meds.append(CanonMed(
            name=dm.name or (match_key or "unnamed"),
            dose=dose, frequency=dm.frequency, duration=dm.duration,
            sources=sources, verify=verify, reason=reason,
            conf=dm.conf, fid=f"B:med:{i}",
        ))

    # pass 2: patient-stated meds not on any document (kept, patient-stated)
    doc_keys = {_norm_name(dm.name) for dm in case.documents.meds}
    j = 0
    for name, sm in stated.items():
        if _norm_name(name) in doc_keys:
            continue
        case.meds.append(CanonMed(
            name=name, dose=(sm.get("dose") or ""),
            frequency=(sm.get("frequency") or ""),
            sources=["patient"], verify=False,
            conf=None, fid=f"A:med:{j}",
        ))
        j += 1


def history_meds(case: CaseSummary) -> list[dict]:
    return case.history.medications


# ------------------------------------------------------------------------ labs

def _merge_labs(case: CaseSummary, cfg: MergerConfig) -> None:
    strict = getattr(cfg, "strict_ranges", False)
    signed = getattr(cfg, "ranges_are_signed", False)
    version = getattr(cfg, "ranges_version", "")
    for i, lab in enumerate(case.documents.labs):
        if strict and not signed:
            # clinical-safety gate: a reference flag from an unsigned table
            # would be an invented clinical judgement (doc/21 §C-C).
            abnormal, note = "", "range table not clinician-signed - not flagged"
        else:
            abnormal, note = _abnormality(lab.name, lab.value, lab.unit, cfg.ranges)
            if note and version:
                note = f"{note} [{version}]"
        case.labs.append(CanonLab(
            name=lab.name, value=lab.value, unit=lab.unit,
            abnormal=abnormal, range_note=note,
            verify=lab.verify, conf=lab.conf, fid=f"B:lab:{i}",
        ))


def _abnormality(name: str, value: str, unit: str,
                 ranges: dict) -> tuple[str, str]:
    """Deterministic reference-range check. Unknown tests are never marked."""
    try:
        v = float(str(value).strip())
    except (TypeError, ValueError):
        return "", ""
    rng = ranges.get((name or "").strip().lower())
    if not rng:
        return "", ""
    low, high, r_unit = rng
    if r_unit and unit and r_unit.lower() != unit.lower():
        return "", ""                      # unit mismatch: do not judge
    if v < low:
        return "low", f"ref {low}-{high} {r_unit}"
    if v > high:
        return "high", f"ref {low}-{high} {r_unit}"
    return "", f"ref {low}-{high} {r_unit}"


# ------------------------------------------------------------- diagnoses + time

def _merge_dx(case: CaseSummary) -> None:
    for i, dx in enumerate(case.documents.dx):
        case.dx.append({
            "text": dx.text, "verify": dx.verify, "conf": dx.conf,
            "source_doc": dx.source_doc, "fid": f"B:dx:{i}",
        })


def _build_timeline(case: CaseSummary) -> None:
    """Prior-record timeline from documents. Dates only when on the paper -
    Module B's structurer does not invent dates, so absent dates are labeled
    honestly and the mechanism is ready for M2 date extraction."""
    for dx in case.dx:
        case.timeline.append({
            "kind": "diagnosis", "text": dx["text"], "date": None,
            "date_note": "date not on document", "fid": dx["fid"],
        })
    for lab in case.labs:
        case.timeline.append({
            "kind": "lab", "text": lab.label() +
            (f" ({lab.abnormal})" if lab.abnormal else ""),
            "date": None, "date_note": "date not on document", "fid": lab.fid,
        })
    case.timeline.sort(key=lambda e: (e["date"] is not None, e["date"] or ""))


# ---------------------------------------------------------------------- alerts

def _compile_alerts(case: CaseSummary) -> None:
    """One physician alert list, severity-ordered: red flags -> verify -> abnormal."""
    alerts: list[Alert] = []
    for rf in case.history.red_flags:
        matched = ", ".join(rf.get("matched") or [])
        alerts.append(Alert(
            severity="red-flag",
            text=f"{rf.get('rule', 'RF')}: {rf.get('title', 'red-flag rule matched')}",
            detail=f"matched: {matched}" if matched else "",
            fid=f"A:redflag:{rf.get('rule', '')}",
        ))
    for m in case.meds:
        if m.verify:
            detail = m.reason or "from document - physician verifies"
            alerts.append(Alert(severity="verify", text=f"medication: {m.label()}",
                                detail=detail, fid=m.fid))
    for dx in case.dx:
        if dx["verify"]:
            alerts.append(Alert(severity="verify",
                                text=f"diagnosis (from paper): {dx['text']}",
                                detail="document-derived - physician verifies",
                                fid=dx["fid"]))
    for lab in case.labs:
        if lab.abnormal:
            alerts.append(Alert(
                severity="abnormal" if not lab.verify else "verify",
                text=f"{lab.label()} - {lab.abnormal.upper()}",
                detail=lab.range_note, fid=lab.fid))
        elif lab.verify:
            alerts.append(Alert(severity="verify", text=f"lab: {lab.label()}",
                                detail="low-confidence read - physician verifies",
                                fid=lab.fid))
    order = {"red-flag": 0, "verify": 1, "abnormal": 2}
    alerts.sort(key=lambda a: order.get(a.severity, 3))
    case.alerts = alerts


def apply_physician_edit(case: CaseSummary, fid: str, new_value: str) -> bool:
    """C5 support: physician correction round-trip into the canon.

    Edits a canon item in place (med name/dose, lab value) and clears its
    verify flag; returns True when the fid resolved to an editable item."""
    for m in case.meds:
        if m.fid == fid:
            if ":" in new_value and m.sources and "document" in m.sources:
                name, _, rest = new_value.partition(":")
                m.name, m.dose = name.strip(), rest.strip()
            else:
                m.name = new_value
            m.verify = False
            m.reason = "corrected by physician"
            return True
    for lab in case.labs:
        if lab.fid == fid:
            lab.value = new_value
            lab.verify = False
            return True
    return False
