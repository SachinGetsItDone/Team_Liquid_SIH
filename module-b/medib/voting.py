"""B3 - Cross-engine per-field voting (agreement = free confidence signal,
doc/13 addendum; disagreement -> verify flag. NOT bagging: heterogeneous
members, no resampling)."""
from __future__ import annotations

from dataclasses import dataclass

from .engines import EngineResult, TextBox


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


@dataclass
class Vote:
    text: str
    bbox: tuple[int, int, int, int]
    conf: float
    agree: bool
    engines: list[str]
    bonus: float = 0.15                   # cfg.vote_bonus_agree (was hardcoded)
    penalty: float = 0.25                 # cfg.vote_penalty_disagree (was hardcoded)

    @property
    def voted_conf(self) -> float:
        delta = self.bonus if self.agree else -self.penalty
        return round(min(1.0, self.conf + delta), 4)


def field_vote(primary: EngineResult, fallback: EngineResult | None,
               cfg=None) -> list[Vote]:
    """Vote PRIMARY lines against the best-matching fallback line (IoU + text sim).

    agree=True when a fallback line overlaps the primary bbox AND normalizes to the
    same text (numeric-insensitive match: OCR digit noise like 1O/10 tolerated only
    via the exact-normalized path; anything else counts as disagreement -> verify).

    `cfg` supplies the agreement bonus / disagreement penalty and the minimum IoU
    to consider two lines matched; defaults preserve prior behaviour."""
    bonus = getattr(cfg, "vote_bonus_agree", 0.15) if cfg else 0.15
    penalty = getattr(cfg, "vote_penalty_disagree", 0.25) if cfg else 0.25
    iou_min = getattr(cfg, "vote_iou_min", 0.30) if cfg else 0.30
    votes: list[Vote] = []
    flines: list[TextBox] = fallback.lines if fallback and fallback.ok else []
    for pline in primary.lines:
        agree, engines = False, [primary.engine]
        best = None
        best_iou = 0.0
        for fline in flines:
            iou = _iou(pline.bbox, fline.bbox)
            if iou > best_iou:
                best_iou, best = iou, fline
        if best is not None and best_iou >= iou_min:
            engines.append(fallback.engine)
            agree = _norm(pline.text) == _norm(best.text)
        votes.append(Vote(pline.text, pline.bbox, round(pline.conf, 4), agree,
                          engines, bonus=bonus, penalty=penalty))
    return votes


def _iou(a: tuple, b: tuple) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix = max(0, min(ax2, bx2) - max(ax1, bx1))
    iy = max(0, min(ay2, by2) - max(ay1, by1))
    inter = ix * iy
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0
