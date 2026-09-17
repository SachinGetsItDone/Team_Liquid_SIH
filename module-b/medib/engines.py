"""B3 - OCR engine layer: RapidOCR (primary), Tesseract (fallback), results model.

Watchdog ladder per doc/17 section 4: primary -> fallback -> manual-entry flag.
A page never blocks a patient."""
from __future__ import annotations

import shutil
import time
from dataclasses import dataclass, field


@dataclass
class TextBox:
    text: str
    bbox: tuple[int, int, int, int]      # x1, y1, x2, y2 - grounding (RAPTOR+ rule)
    conf: float


@dataclass
class EngineResult:
    engine: str                            # "rapidocr" | "tesseract" | "manual"
    lines: list[TextBox] = field(default_factory=list)
    elapsed_s: float = 0.0
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and bool(self.lines)

    def full_text(self) -> str:
        return "\n".join(b.text for b in self.lines)


class RapidOCREngine:
    """Primary: RapidOCR (PP-OCR models via ONNX Runtime CPU). Apache-2.0.

    lang selects the PP-OCRv5 mobile REC model per script (doc/14 pick:
    Devanagari-capable multilingual lane). Script-tag -> LangRec mapping;
    PP-OCR script models also read Latin+digits (verified on synthetic pages).
    """

    name = "rapidocr"
    _inst = None

    LANG_MAP = {"hi": "DEVANAGARI", "en": "LATIN", "ta": "TA", "te": "TE",
                "multi": "DEVANAGARI"}

    def __init__(self, lang: str = "hi"):
        from rapidocr import RapidOCR, LangRec, ModelType, OCRVersion
        lang_rec = getattr(LangRec, self.LANG_MAP.get(lang, "DEVANAGARI"))
        self._ocr = RapidOCR(params={
            "Rec.lang_type": lang_rec,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
            "Rec.model_type": ModelType.MOBILE,
        })

    @classmethod
    def instance(cls, lang: str = "hi"):
        if cls._inst is None:
            cls._inst = cls(lang)
        return cls._inst

    def run(self, image) -> EngineResult:
        t0 = time.perf_counter()
        try:
            out = self._ocr(np_img(image))
            # RapidOCR >= 3.x returns RapidOCROutput (txts/scores/boxes)
            txts = getattr(out, "txts", None)
            scores = getattr(out, "scores", None)
            boxes = getattr(out, "boxes", None)
            txts = list(txts) if txts is not None else []
            scores = list(scores) if scores is not None else []
            boxes = list(boxes) if boxes is not None else []
        except Exception as e:                 # noqa: BLE001 - engine must never crash the page
            return EngineResult(self.name, error=f"rapidocr failure: {e}",
                                elapsed_s=time.perf_counter() - t0)
        lines = []
        for i, txt in enumerate(txts):
            box = boxes[i] if i < len(boxes) else None
            if box is None:
                continue
            x1, y1 = box[0][0], box[0][1]
            x2, y2 = box[2][0], box[2][1]
            conf = float(scores[i]) if i < len(scores) else 0.0
            lines.append(TextBox(str(txt), (int(x1), int(y1), int(x2), int(y2)), conf))
        return EngineResult(self.name, lines=lines, elapsed_s=time.perf_counter() - t0)


class TesseractEngine:
    """Fallback: fully independent codebase (pytesseract + system binary)."""

    name = "tesseract"

    def __init__(self, langs: str = "hin+eng"):
        self.langs = langs

    @staticmethod
    def available() -> bool:
        return shutil.which("tesseract") is not None

    def run(self, image) -> EngineResult:
        t0 = time.perf_counter()
        if not self.available():
            return EngineResult(self.name, error="tesseract binary not installed",
                                elapsed_s=time.perf_counter() - t0)
        try:
            import pytesseract
            data = pytesseract.image_to_data(image, lang=self.langs,
                                             output_type=pytesseract.Output.DICT)
        except Exception as e:                  # noqa: BLE001
            return EngineResult(self.name, error=f"tesseract failure: {e}",
                                elapsed_s=time.perf_counter() - t0)
        lines: list[TextBox] = []
        n = len(data["text"])
        for i in range(n):
            txt = (data["text"][i] or "").strip()
            conf = float(data["conf"][i] or -1)
            if txt and conf >= 0:
                x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
                lines.append(TextBox(txt, (x, y, x + w, y + h), conf / 100.0))
        return EngineResult(self.name, lines=lines, elapsed_s=time.perf_counter() - t0)


class ManualEntryResult(EngineResult):
    """Terminal rung of the watchdog ladder: flag page for assisted manual entry."""

    def __init__(self):
        super().__init__("manual", error="both engines failed - manual entry required")


def np_img(image):
    import numpy as np
    return np.asarray(image)


def run_with_fallback(image, primary: RapidOCREngine, fallback: TesseractEngine | None):
    """Primary first; on failure/empty -> fallback; else manual flag. Returns (result, ladder)."""
    ladder = []
    res = primary.run(image)
    ladder.append(res.engine)
    if res.ok:
        return res, ladder
    if fallback is not None and fallback.available():
        fres = fallback.run(image)
        ladder.append(fres.engine)
        if fres.ok:
            return fres, ladder
    ladder.append("manual")
    return ManualEntryResult(), ladder
