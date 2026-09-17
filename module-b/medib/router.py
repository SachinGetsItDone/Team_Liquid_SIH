"""B2 - Page router: printed / handwritten / lab-table classification.

Deterministic heuristics from OCR line statistics. Thresholds are placeholders
to be re-set from M0 measured distributions (doc/17 section 7.1)."""
from __future__ import annotations

from .engines import EngineResult

HANDWRITING_MARKERS = ("rx", "prescription", "dr.", "doctor", "चिकित्सक")
TABLE_MARKERS = ("test", "result", "value", "reference", "range", "parameter", "जांच")


def classify(result: EngineResult, cfg) -> dict:
    """Return {"page_type": ..., "signals": {...}} for the router decision."""
    lines = result.lines
    if not lines:
        return {"page_type": "empty", "signals": {}}
    low_cut = getattr(cfg, "low_conf_cutoff", 0.60)
    ratio_above = getattr(cfg, "handwriting_low_conf_ratio_above", 0.5)
    tol = getattr(cfg, "col_alignment_tol", 25)
    confs = [b.conf for b in lines]
    avg_conf = sum(confs) / len(confs)
    low_conf_ratio = sum(1 for c in confs if c < low_cut) / len(confs)
    text = result.full_text().lower()

    handwriting_signals = sum(1 for m in HANDWRITING_MARKERS if m in text)
    table_signals = sum(1 for m in TABLE_MARKERS if m in text)
    # column alignment: fraction of lines whose x1 sits on a few distinct columns
    x1s = sorted(b.bbox[0] for b in lines)
    col_buckets = _bucket(x1s, tol=tol)
    col_alignment = len(col_buckets) / max(1, len(x1s))          # lower = more columnar

    signals = {
        "avg_line_conf": round(avg_conf, 3),
        "low_conf_ratio": round(low_conf_ratio, 3),
        "handwriting_markers": handwriting_signals,
        "table_markers": table_signals,
        "col_alignment": round(col_alignment, 3),
        "n_lines": len(lines),
    }

    # NOTE: the config value is a *columnar-score* threshold. col_alignment is
    # high when lines are spread across many distinct x1 columns (prose) and low
    # when they collapse onto a few (a table), so the comparison is inverted.
    if table_signals >= 2 and col_alignment < (1.0 - cfg.table_if_col_alignment_score_above):
        page_type = "lab_table"
    elif avg_conf < cfg.handwriting_if_avg_line_conf_below or (
            handwriting_signals >= 1 and low_conf_ratio > ratio_above):
        page_type = "handwritten"
    else:
        page_type = "printed"
    return {"page_type": page_type, "signals": signals}


def _bucket(values: list[int], tol: int) -> list[int]:
    buckets: list[int] = []
    for v in values:
        if not buckets or v - buckets[-1] > tol:
            buckets.append(v)
    return buckets
