"""B5 - Confidence gate. Verify-default: low-confidence or handwriting fields are
flagged for physician review, never silently guessed (doc/13 section 2.1,
doc/17 section 2 safety row)."""
from __future__ import annotations

from dataclasses import dataclass

from .config import EngineConfig
from .voting import Vote


@dataclass
class Field:
    key: str                              # e.g. "med:0:name", "lab:1:value"
    text: str
    bbox: tuple[int, int, int, int]
    conf: float
    verified_needed: bool
    reason: str

    def to_review(self) -> dict:
        return {
            "field": self.key, "value": self.text, "confidence": round(self.conf, 3),
            "verify": self.verified_needed, "reason": self.reason,
            "bbox": list(self.bbox),
        }


def gate_votes(votes: list[Vote], cfg: EngineConfig, page_is_handwritten: bool) -> list[Field]:
    fields: list[Field] = []
    for i, v in enumerate(votes):
        conf = v.voted_conf
        need, reason = False, ""
        if page_is_handwritten:
            need, reason = True, "handwriting: verify-default (MIRAGE ceiling)"
        elif conf < cfg.field_conf_threshold:
            need = True
            reason = f"confidence {conf:.2f} < {cfg.field_conf_threshold}"
        elif not v.agree:
            need, reason = True, "engines disagree"
        fields.append(Field(f"line:{i}", v.text, v.bbox, conf, need, reason))
    return fields


def gate_structured(structured: dict, cfg: EngineConfig, page_is_handwritten: bool) -> dict:
    """Attach verify flags to structured fields (each carries source_line index +
    bbox inherited from the vote layer)."""
    out = {"verify_all": page_is_handwritten, "fields": []}
    for section in ("medications", "labs", "diagnoses"):
        for i, item in enumerate(structured.get(section, [])):
            src = item.get("_src_conf", 0.0)
            need = page_is_handwritten or src < cfg.field_conf_threshold
            out["fields"].append({
                "field": f"{section[:-1]}:{i}", "value": item,
                "verify": need,
                "reason": ("handwriting: verify-default" if page_is_handwritten
                           else f"source confidence {src:.2f}"),
                "bbox": item.get("_src_bbox"),
            })
    return out
