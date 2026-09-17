"""B4 - Structurer: OCR text -> meds / labs / diagnoses JSON.

Two adapters (doc/17 section 1, B4):
- RuleBasedStructurer: deterministic regex/heuristics. Default; always available.
- LlamaCppStructurer: llama-server (llama.cpp + Qwen3) OpenAI-compatible endpoint,
  temperature 0, JSON-schema constrained; every field must cite an OCR evidence
  span (grounding) - ungrounded output is dropped, per doc/17 section 6 risk row.
"""
from __future__ import annotations

import json
import re
import urllib.request

from .engines import EngineResult

MED_TOKEN = re.compile(
    r"(?P<name>[A-Za-z][A-Za-z\-]{2,}(?:\s+[A-Za-z][A-Za-z\-]{2,})?)\s*"
    r"(?P<dose>\d+(?:\.\d+)?\s*(?:mg|mcg|ml|gm|g))?\s*"
    r"(?P<freq>\b(?:OD|BD|TDS|QID|HS|SOS|Q\d+h?|once|twice|thrice)\b)?"
    r"(?:\s*(?:x|for)\s*(?P<dur>\d+\s*(?:days?|weeks?|months?)))?",
    re.IGNORECASE,
)
# a hit is a medication only if it carries a schedule signal or a dosage form prefix
DOSAGE_FORMS = ("tab", "tab.", "tablet", "cap", "cap.", "capsule", "syrup", "syp",
                "inj", "injection", "drops", "cream", "ointment")
LAB_VALUE = re.compile(
    r"(?P<name>[A-Za-z][A-Za-z0-9 /%]{0,15}?)\s*[:\-]\s*"
    r"(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mg/dL|g/dL|mmol/L|mIU/L|IU/L|U/L|ng/mL|pg/mL|mg%|%)?",
)
DIAG_HINT = re.compile(
    r"\b(?:diagnosis|impression|dx|c/o|history of|known case of)\b[:\s]*(?P<text>[^\n]+)",
    re.IGNORECASE,
)


class RuleBasedStructurer:
    name = "rules"

    def structure(self, result: EngineResult) -> dict:
        meds, labs, dxs = [], [], []
        for b in result.lines:
            text = b.text
            m = DIAG_HINT.search(text)
            if m:
                dxs.append({"text": m.group("text").strip(), "_src_conf": b.conf})
            low = text.lower()
            has_form = any(low.startswith(f + " ") or f" {f} " in low for f in DOSAGE_FORMS)
            line_meds = 0
            for mm in MED_TOKEN.finditer(text):
                name = _strip_dosage_form(mm.group("name").strip())
                dose, freq, dur = mm.group("dose"), mm.group("freq"), mm.group("dur")
                if not name or name.lower() in _STOP:
                    continue
                # deterministic anti-noise: a med needs a schedule signal or a form prefix
                if not (dose or freq or dur or has_form):
                    continue
                meds.append({
                    "name": name,
                    "dose": dose,
                    "frequency": freq,
                    "duration": dur,
                    "_src_conf": b.conf,
                    "_src_bbox": list(b.bbox),
                })
                line_meds += 1
            if line_meds:
                continue                       # a med line is not a lab line
            for lm in LAB_VALUE.finditer(text):
                labs.append({
                    "name": lm.group("name").strip(" :-"),
                    "value": lm.group("value"),
                    "unit": lm.group("unit"),
                    "_src_conf": b.conf,
                    "_src_bbox": list(b.bbox),
                })
        return {"medications": meds, "labs": labs, "diagnoses": dxs}


def _strip_dosage_form(name: str) -> str:
    """Drop leading dosage-form tokens ('Tab. Amoxicillin' -> 'Amoxicillin')."""
    while True:
        first = name.split(" ", 1)[0].lower().rstrip(".")
        if first in DOSAGE_FORMS:
            name = name.split(" ", 1)[1] if " " in name else ""
            if not name:
                return name
        else:
            return name


_STOP = {"the", "and", "for", "with", "patient", "history", "tablet", "tab", "cap",
         "syrup", "injection", "known", "case", "advice", "follow", "visit", "review",
         "complaint", "fever", "days", "better", "since", "morning", "night"}


class LlamaCppStructurer:
    """llama.cpp llama-server adapter (Qwen3). Requires MEDIB_LLM_URL."""

    name = "llamacpp"
    SCHEMA = {
        "type": "object",
        "properties": {
            "medications": {"type": "array", "items": {"type": "object"}},
            "labs": {"type": "array", "items": {"type": "object"}},
            "diagnoses": {"type": "array", "items": {"type": "object"}},
        },
        "required": ["medications", "labs", "diagnoses"],
    }
    PROMPT = (
        "From the OCR text below, extract medications (name, dose, frequency, duration), "
        "lab results (name, value, unit) and diagnoses. Use ONLY facts present in the text. "
        "Return JSON with keys medications, labs, diagnoses. Each item must include a "
        "\"source\" field quoting the exact OCR line it came from.\n\nOCR TEXT:\n"
    )

    def __init__(self, base_url: str, model: str = "qwen3"):
        self.base_url = base_url.rstrip("/")
        self.model = model

    def structure(self, result: EngineResult) -> dict:
        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "user", "content": self.PROMPT + result.full_text()},
            ],
            "response_format": {"type": "json_schema",
                                "json_schema": {"name": "extraction", "schema": self.SCHEMA}},
        }
        req = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.load(r)
        content = json.loads(data["choices"][0]["message"]["content"])
        content = self._drop_ungrounded(content, result)
        return {"medications": content.get("medications", []),
                "labs": content.get("labs", []),
                "diagnoses": content.get("diagnoses", [])}

    @staticmethod
    def _drop_ungrounded(content: dict, result: EngineResult) -> dict:
        """Grounding: keep only items whose 'source' quote appears in the OCR text."""
        ocr = result.full_text()
        kept = {}
        for key, items in content.items():
            if not isinstance(items, list):
                continue
            keep = []
            for it in items:
                src = (it or {}).get("source", "")
                if src and src.strip() in ocr:
                    keep.append(it)
            kept[key] = keep
        return kept


def make_structurer(cfg):
    if cfg.llm_url:
        return LlamaCppStructurer(cfg.llm_url, cfg.llm_model)
    return RuleBasedStructurer()
