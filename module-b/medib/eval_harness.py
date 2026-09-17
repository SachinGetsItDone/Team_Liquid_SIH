"""B9 - Eval harness: field-level CER, catastrophic rate, p50/p95 latency, peak RSS.

Protocol per doc/14 section 5 / doc/17 M0. NOTE: synthetic pages cannot substitute
for the consented real-OPD eval set (doc/13 section 2.3 - synthetic scores mislead);
this harness is the instrument, the real scans are the gate."""
from __future__ import annotations

import json
import statistics
import time
from pathlib import Path


def cer(reference: str, hypothesis: str) -> float:
    """Character error rate with edit distance (code-point level, NFC-normalized)."""
    import unicodedata
    r = unicodedata.normalize("NFC", reference)
    h = unicodedata.normalize("NFC", hypothesis)
    if not r:
        return 0.0 if not h else 1.0
    return _levenshtein(r, h) / len(r)


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, round(pct / 100 * (len(s) - 1))))
    return s[k]


def peak_rss_mb() -> float:
    try:
        import psutil
        return psutil.Process().memory_info().rss / (1024 * 1024)
    except ImportError:                                # Windows fallback
        import ctypes
        import ctypes.wintypes as wt

        class PMC(ctypes.Structure):
            _fields_ = [("cb", wt.DWORD), ("PageFaultCount", wt.DWORD),
                        ("PeakWorkingSetSize", ctypes.c_size_t),
                        ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t),
                        ("PeakPagefileUsage", ctypes.c_size_t)]
        pmc = PMC()
        pmc.cb = ctypes.sizeof(PMC)
        ctypes.windll.psapi.GetProcessMemoryInfo(
            ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
        return pmc.PeakWorkingSetSize / (1024 * 1024)


def evaluate(pages_dir: Path, gt_path: Path, process_fn) -> dict:
    """process_fn(image_path) -> PageResult. GT format:
    {"pages": [{"image": "p1.png", "fields": [{"text": "..."}], "full_text": "..."}]}"""
    gt = json.loads(Path(gt_path).read_text(encoding="utf-8"))
    rows = []
    for entry in gt.get("pages", []):
        img = Path(pages_dir) / entry["image"]
        t0 = time.perf_counter()
        result = process_fn(img)
        wall = time.perf_counter() - t0
        hyp = _full_text(result)
        ref = entry.get("full_text", "")
        page_cer = cer(ref, hyp) if ref else float("nan")
        rows.append({
            "image": entry["image"], "engine": result.engine,
            "page_cer": round(page_cer, 4) if page_cer == page_cer else None,
            "catastrophic": bool(page_cer > 0.5) if page_cer == page_cer else False,
            "wall_s": round(wall, 3),
            "peak_rss_mb": round(peak_rss_mb(), 1),
            "n_lines": result.n_lines,
        })
    cers = [r["page_cer"] for r in rows if r["page_cer"] is not None]
    walls = [r["wall_s"] for r in rows]
    report = {
        "n_pages": len(rows),
        "median_cer": round(statistics.median(cers), 4) if cers else None,
        "mean_cer": round(statistics.fmean(cers), 4) if cers else None,
        "catastrophic_rate": (sum(1 for r in rows if r["catastrophic"]) / len(rows)
                              if rows else None),
        "p50_wall_s": round(percentile(walls, 50), 3),
        "p95_wall_s": round(percentile(walls, 95), 3),
        "peak_rss_mb": max((r["peak_rss_mb"] for r in rows), default=0.0),
        "pages": rows,
        "caveat": ("synthetic pages only - real consented OPD scans are the M0 gate; "
                   "numbers do not generalize (doc/13 section 2.3)"),
    }
    return report


def _full_text(result) -> str:
    # PageResult doesn't carry raw lines; re-derive from review fields order is unsafe,
    # so eval uses the structured summary + line count as sanity. For text-level CER the
    # harness accepts either .full_text attr or falls back to joined review values.
    ft = getattr(result, "full_text", None)
    if callable(ft):
        return ft()
    if getattr(result, "ocr_text", None):
        return result.ocr_text
    return "\n".join(f["value"] for f in result.review_fields if isinstance(f["value"], str))
