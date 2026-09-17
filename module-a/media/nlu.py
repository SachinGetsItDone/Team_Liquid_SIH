"""A3/NLU - turn-answer interpretation, pluggable.

Two adapters, one interface:
- RuleBasedExtractor: deterministic, offline, always available (the floor).
- LlamaCppExtractor: llama.cpp `llama-server` (Qwen3), temperature 0,
  constrained JSON, a refusal value (`unknown`) instead of a guess, and NO
  authority framing in the prompt (doc/09 section 2: authority framing
  collapses abstention and invites confident fabrication).

Whatever the adapter, the *state machine* remains authoritative about what is
asked; the extractor only turns one answer into one slot value.
"""
from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass
from typing import Protocol

from .fsm import Turn

_FILLERS = ("umm", "uh", "matlab", "means", "you know", "i think that",
            "actually", "basically", "अरे", "मतलब", "हाँ तो", "तो")

_YES = {"yes", "y", "haan", "han", "ha", "ji", "ji haan", "हाँ", "हां",
        "जी", "जी हाँ", "sahi", "सही", "bilkul", "बिलकुल"}
_NO = {"no", "n", "nahin", "nahi", "na", "नहीं", "नही", "ना", "galat",
       "गलत", "kabhi nahi"}

# NOTE: "do" (Hindi 2) is deliberately absent - it collides with the English
# verb and would fabricate a severity of 2. Ambiguous words are not parsed.
_NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
              "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
              "ek": 1, "teen": 3, "char": 4, "paanch": 5, "panch": 5,
              "chhe": 6, "che": 6, "saat": 7, "aath": 8, "ath": 8, "nau": 9,
              "das": 10, "दस": 10}


@dataclass
class Extraction:
    value: str = ""
    conf: float | None = None
    unknown: bool = False
    normalized: bool = False

    @property
    def usable(self) -> bool:
        return (not self.unknown) and bool(self.value)


def clinical_excerpt(text: str, max_chars: int = 280) -> str:
    """Keep only the clinically meaningful content of an utterance (verbatim).

    This is a *filter*, not a generator: it never adds a word the patient did
    not say. Leading 'no'/'नहीं' is never stripped (meaning-flip guard)."""
    raw = (text or "").strip()
    if not raw:
        return ""
    cleaned = raw
    for filler in _FILLERS:
        cleaned = re.sub(rf"\b{re.escape(filler)}\b", " ", cleaned,
                         flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    # tidy comma runs left behind by filler removal ("I have, , fever")
    parts = [p.strip(" ,;.") for p in cleaned.split(",")]
    cleaned = ", ".join(p for p in parts if p)
    # leading negation is never stripped (meaning-flip guard); fillers do not
    # include no/नहीं, so "no allergies" survives verbatim.
    return cleaned[:max_chars].strip()


class SlotExtractor(Protocol):
    name: str

    def extract(self, turn: Turn, utterance: str) -> Extraction: ...


class RuleBasedExtractor:
    """Deterministic, offline. Verbatim for free text; parsed for numeric/yes-no."""

    name = "rules"

    def __init__(self, max_excerpt_chars: int = 280):
        self.max_excerpt_chars = max_excerpt_chars

    def extract(self, turn: Turn, utterance: str) -> Extraction:
        text = (utterance or "").strip()
        if turn.kind == "severity":
            return self._severity(text)
        if turn.kind in ("yesno", "choice"):
            return self._yesno(text)
        if turn.kind == "readback":
            return self._yesno(text)
        value = clinical_excerpt(text, self.max_excerpt_chars)
        if not value:
            return Extraction(unknown=True)
        return Extraction(value=value, conf=None)      # verbatim: no inferred confidence

    @staticmethod
    def _severity(text: str) -> Extraction:
        low = text.lower()
        m = re.search(r"(\d+(?:\.\d+)?)\s*(?:/|out of|में से)?\s*10", low)
        if not m:
            m = re.search(r"\b(\d+(?:\.\d+)?)\b", low)
        score = None
        if m:
            score = float(m.group(1))
        else:
            # earliest matching number word wins, so "aath out of ten" -> 8
            best: tuple[int, int] | None = None
            for word, val in _NUM_WORDS.items():
                wm = re.search(rf"\b{re.escape(word)}\b", low)
                if wm and (best is None or wm.start() < best[0]):
                    best = (wm.start(), val)
            if best is not None:
                score = float(best[1])
        if score is None or not (0 <= score <= 10):
            return Extraction(unknown=True)
        return Extraction(value=f"{score:g}/10", conf=0.9, normalized=True)

    @staticmethod
    def _yesno(text: str) -> Extraction:
        low = re.sub(r"[.!?]", "", (text or "").strip().lower())
        if not low:
            return Extraction(unknown=True)
        neg = {"no", "nahi", "nahin", "na", "नहीं", "नही", "ना"}
        pos = {"yes", "haan", "han", "ha", "ji", "हाँ", "हां", "सही", "sahi",
               "bilkul", "y"}
        tokens = set(re.findall(r"[\w\u0900-\u097F]+", low))
        if tokens & neg or low in _NO:
            return Extraction(value="no", conf=0.95, normalized=True)
        if tokens & pos or low in _YES:
            return Extraction(value="yes", conf=0.95, normalized=True)
        return Extraction(value=clinical_excerpt(text), conf=None)


class LlamaCppExtractor:
    """llama.cpp llama-server adapter (Qwen3). No authority framing."""

    name = "llamacpp"

    PROMPT = (
        "You extract one structured value from a patient's answer in a medical "
        "history interview. Use ONLY what the patient said. If the answer does "
        "not contain the requested information, you MUST return "
        "{{\"known\": false}}. Never guess, never add a value the patient did "
        "not state.\n"
        "Requested field: {field}\n"
        "Question asked: {question}\n"
        "Patient answer: {answer}\n"
        "Return JSON: {{\"known\": true|false, \"value\": \"...\"}}"
    )

    SCHEMA = {
        "type": "object",
        "properties": {"known": {"type": "boolean"},
                       "value": {"type": "string"}},
        "required": ["known"],
    }

    def __init__(self, base_url: str, model: str = "qwen3", transport=None,
                 timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._transport = transport or self._http_transport
        self.timeout = timeout

    def extract(self, turn: Turn, utterance: str) -> Extraction:
        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [{"role": "user", "content": self.PROMPT.format(
                field=turn.slot or turn.id,
                question=turn.prompt_en,
                answer=(utterance or "").strip(),
            )}],
            "response_format": {"type": "json_schema",
                                "json_schema": {"name": "slot",
                                                "schema": self.SCHEMA}},
        }
        content = self._transport(payload)
        if not content.get("known") or not str(content.get("value", "")).strip():
            return Extraction(unknown=True)
        return Extraction(value=str(content["value"]).strip(), conf=None,
                          normalized=False)

    def _http_transport(self, payload: dict) -> dict:
        req = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            data = json.load(r)
        return json.loads(data["choices"][0]["message"]["content"])


def make_extractor(cfg) -> SlotExtractor:
    if getattr(cfg, "nlu_url", None):
        return LlamaCppExtractor(cfg.nlu_url, getattr(cfg, "nlu_model", "qwen3"))
    return RuleBasedExtractor(getattr(cfg, "max_excerpt_chars", 280))
