"""C6 - Eval harness: the Module C evaluation protocol (research-closed,
team-adoption pending - doc/15 section 8b).

Established protocol per doc/15 section 8b (MEDIQA-Chat 2023 overview,
verified): ROUGE/BERTScore/BLEURT + medical concept recall + rubric-based
human eval, with an inference-aware hallucination-judge definition
(arXiv:2604.14829). This harness implements the DETERMINISTIC subset that
applies to a template renderer (no free-text generation to ROUGE-score in
v1) and adds the omission check motivated by the 2026-09-11 /last30days
validation: arXiv:2608.31016 "LLM Judges Verify Presence, Not Absence:
Omission Blindness in AI Clinical Notes" - presence-checking judges miss
omitted content, so the harness explicitly checks ABSENCE (every captured
canon field must appear in every view) rather than only presence.

Metrics per rendered view:
- field_recall   : captured canon fields represented / total captured
- omissions      : field ids present in the canon but missing from the view
- fabrications   : rendered lines whose provenance does not resolve to a
                   canon field id (must be 0 for the deterministic renderer)
- determinism    : rendering twice yields identical output
"""
from __future__ import annotations

import json

from .merger import CaseSummary
from .renderer import render_oldcarts, render_readback, render_soap

# Per-view coverage contracts: which canon fields each view MUST carry.
# A view's format defines its own field set (doc/04) - OLD CARTS has no
# "associations" or ICE slots (Onset/Location/Duration/Character/Aggravating/
# Radiation/Temporal/Severity only), so those are out of its contract, not
# omissions. SOAP and the read-backs must carry every captured slot.
VIEW_FIELDS = {
    "soap": None,               # None = all captured slot fields
    "oldcarts": frozenset({"A:site", "A:onset", "A:character", "A:radiation",
                           "A:timing", "A:exacerbating", "A:severity"}),
    "readback-en": None,
    "readback-hi": None,
}


def evaluate(case: CaseSummary) -> dict:
    """Run the full protocol on all four views. Returns the report dict."""
    canon_ids = set(case.field_ids())
    # sections/lists also carry group-level provenance (e.g. A:pmh, A:ros)
    group_ids = {"A:complaint", "A:pmh", "A:allergies", "A:family", "A:social",
                 "A:ros", "B:session"}
    valid_ids = canon_ids | group_ids

    views = {
        "soap": render_soap(case),
        "oldcarts": render_oldcarts(case),
        "readback-en": render_readback(case, "en"),
        "readback-hi": render_readback(case, "hi"),
    }

    report = {"views": {}, "determinism": True, "fabrications": 0,
              "field_recall_min": 1.0}
    for name, view in views.items():
        lines = _all_lines(view)
        rendered_ids = {sid for ln in lines for sid in ln.get("src", [])}
        # recall over the view's coverage contract (slot-level canon fields)
        expected = VIEW_FIELDS.get(name)
        if expected is None:
            slot_ids = {i for i in canon_ids
                        if not i.startswith(("B:med", "B:lab", "B:dx", "A:med"))}
        else:
            slot_ids = set(expected) & {
                i for i in canon_ids
                if not i.startswith(("B:med", "B:lab", "B:dx", "A:med"))}
        represented = slot_ids & rendered_ids
        recall = (len(represented) / len(slot_ids)) if slot_ids else 1.0
        omissions = sorted(slot_ids - rendered_ids)
        # fabrication = a line claiming provenance that does not resolve to a
        # canon field (broken trace). Empty-src lines are renderer furniture
        # (headers, physician-only notices), not clinical claims.
        fabrications = [ln["text"] for ln in lines
                        if ln.get("src") and not set(ln["src"]) & valid_ids]
        report["views"][name] = {
            "n_lines": len(lines),
            "field_recall": round(recall, 4),
            "omissions": omissions,
            "fabrications": fabrications,
        }
        report["fabrications"] += len(fabrications)
        report["field_recall_min"] = min(report["field_recall_min"], round(recall, 4))

    # determinism: identical inputs must yield identical outputs
    report["determinism"] = (
        json.dumps(views["soap"], sort_keys=True) ==
        json.dumps(render_soap(case), sort_keys=True) and
        json.dumps(views["readback-hi"], sort_keys=True) ==
        json.dumps(render_readback(case, "hi"), sort_keys=True)
    )
    return report


def _all_lines(view: dict) -> list[dict]:
    """Flatten any view shape into its rendered lines (with src)."""
    lines: list[dict] = []
    if "lines" in view:
        lines += view["lines"]
    if "sections" in view:
        for sec_lines in view["sections"].values():
            lines += sec_lines
    for key in ("S", "O", "A", "P", "gaps"):
        if key in view:
            lines += view[key]
    return lines


def format_report(report: dict) -> str:
    lines = [
        f"Module C eval - determinism: {report['determinism']}, "
        f"fabrications: {report['fabrications']}, min field recall: {report['field_recall_min']}",
    ]
    for name, v in report["views"].items():
        lines.append(f"  {name:12s} lines={v['n_lines']:3d} "
                     f"recall={v['field_recall']:.2f} "
                     f"omissions={len(v['omissions'])} "
                     f"fabrications={len(v['fabrications'])}")
        for fid in v["omissions"][:5]:
            lines.append(f"      omitted: {fid}")
    return "\n".join(lines)
