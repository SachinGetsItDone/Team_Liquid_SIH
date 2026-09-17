"""A5 - Deterministic red-flag classifier.

A red flag is ALWAYS a deterministic rule match over captured text/numerals,
never an LLM decision (doc/09 section 2, doc/19 section 0 invariant 4-adjacent).
Every hit carries the matched evidence terms so the escalation is auditable and
can be shown to staff.

Rule provenance:
- RF-1..RF-4 are the four rules DEMO-IMPLEMENTED in the prototype
  (`prototype/module-a-kiosk-demo.html`, `RED_FLAG_RULES` / `RF_TERMS`). Their
  term lists are carried over verbatim (en / hi / Hinglish).
- The remaining production candidates named in the research log (2026-09-16:
  "bleed, pregnancy, infant-IMNCI, breathing-failure, collapse, self-harm,
  fever-neuro, VTE-proxy") are declared here as INACTIVE placeholders with no
  terms, so they cannot fire and cannot fabricate a match. They are activated
  only after the dual-physician sign-off gate, at which point their terms and
  thresholds are added from the signed clinical specification.

`clinician_signed` is False for the demo rules: the demo list is explicitly
"final rules clinician-validated" work that has not happened yet (doc/09
section 10, research log). Set `require_clinician_signoff=True` to run only
signed rules; the default (False) runs the demo list so the pipeline is
exercisable, and every hit reports its sign-off status.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .contracts import RedFlagHit


@dataclass(frozen=True)
class RedFlagRule:
    id: str
    title_en: str
    title_hi: str
    kind: str                       # "and" | "any" | "severity"
    groups: tuple                   # which term groups must match
    terms: dict                     # group -> tuple of match terms
    active: bool = True
    clinician_signed: bool = False
    note: str = ""


# Term lists copied from the prototype demo (`RF_TERMS`), including Hinglish.
_TERMS = {
    "headache": ("headache", "sir dard", "sar dard", "sir mein dard",
                 "sir me dard", "सिर दर्द", "सिर में दर्द", "माथा दर्द"),
    "sudden": ("sudden", "suddenly", "achanak", "ekdum", "अचानक", "एकदम"),
    "chest": ("chest pain", "pain in chest", "pain in my chest",
              "chest discomfort", "chest hurts", "seene mein dard",
              "seene me dard", "seene dard", "seene pe dard", "chati mein dard",
              "chati dard", "chati me dard", "सीने में दर्द", "छाती में दर्द",
              "सीने दर्द"),
    "breath": ("breathless", "shortness of breath", "difficulty breathing",
               "saans lene", "saans phool", "saans ki takleef",
               "saans lentakleef", "hawa phool", "dum phool", "सांस लेने में",
               "सांस फूल", "सांस की", "साँस फूल"),
    "stroke": ("one side", "ek taraf", "एक तरफ़", "एक तरफ", "falij", "फालिज",
               "paralysis", "पक्षाघात", "slurred", "lisdar", "लिसडर",
               "face droop", "munh teda", "मुंह टेढ़ा", "आधा शरीर"),
    "concern": ("sweating", "sweat", "pasina", "पसीना", "fainting", "behosh",
                "बेहोश", "syncope", "vomiting", "उल्टी", "ulti", "मतली",
                "nausea", "चक्कर", "chakkar"),
}

DEMO_RULES = (
    RedFlagRule("RF-1", "Sudden, very severe (thunderclap) headache",
                "अचानक बहुत तेज़ सिरदर्द", "and", ("headache", "sudden"), _TERMS),
    RedFlagRule("RF-2", "Chest pain together with breathlessness",
                "छाती में दर्द के साथ सांस फूलना", "and", ("chest", "breath"),
                _TERMS),
    RedFlagRule("RF-3", "Sudden one-sided weakness, slurred speech or face drooping",
                "अचानक एक तरफ़ कमज़ोरी, लिसडर बोलना या चेहरा टेढ़ा होना", "any",
                ("stroke",), _TERMS),
    RedFlagRule("RF-4", "Pain 8/10 or worse, with sweating, fainting or vomiting",
                "दर्द 8/10 या ज़्यादा — पसीने, बेहोशी या उल्टी के साथ",
                "severity", ("concern",), _TERMS),
)

# Named production candidates with no signed clinical specification yet.
PENDING_RULES = (
    RedFlagRule("RF-5", "Active bleeding", "सक्रिय रक्तस्राव", "pending", (),
                {}, active=False, note="pending dual-physician sign-off"),
    RedFlagRule("RF-6", "Pregnancy-related emergency", "गर्भावस्था संबंधी आपातकाल",
                "pending", (), {}, active=False, note="pending dual-physician sign-off"),
    RedFlagRule("RF-7", "Infant / IMNCI danger signs", "शिशु खतरे के संकेत",
                "pending", (), {}, active=False, note="pending dual-physician sign-off"),
    RedFlagRule("RF-8", "Respiratory failure signs", "श्वसन विफलता के संकेत",
                "pending", (), {}, active=False, note="pending dual-physician sign-off"),
    RedFlagRule("RF-9", "Collapse / unresponsive", "बेहोशी / प्रतिक्रियाहीन",
                "pending", (), {}, active=False, note="pending dual-physician sign-off"),
    RedFlagRule("RF-10", "Self-harm risk", "स्वयं को हानि की आशंका", "pending", (),
                {}, active=False, note="pending dual-physician sign-off"),
    RedFlagRule("RF-11", "Fever with neurological signs", "बुखार के साथ तंत्रिका संकेत",
                "pending", (), {}, active=False, note="pending dual-physician sign-off"),
    RedFlagRule("RF-12", "VTE risk proxy", "थ्रोम्बोसिस जोखिम", "pending", (),
                {}, active=False, note="pending dual-physician sign-off"),
)

ALL_RULES = DEMO_RULES + PENDING_RULES


def _severity_number(severity: object) -> float | None:
    """Accept 8, 8.0, '8', '8/10' -> 8.0; anything else -> None."""
    if severity is None:
        return None
    if isinstance(severity, (int, float)):
        return float(severity)
    m = re.search(r"\d+(?:\.\d+)?", str(severity))
    return float(m.group()) if m else None


class RedFlagEngine:
    """Deterministic rule evaluation over a text corpus + structured severity."""

    def __init__(self, rules: tuple = ALL_RULES,
                 require_clinician_signoff: bool = False,
                 severity_threshold: float = 8.0):
        self.rules = rules
        self.require_clinician_signoff = require_clinician_signoff
        self.severity_threshold = severity_threshold

    def active_rules(self) -> tuple:
        out = []
        for r in self.rules:
            if not r.active:
                continue
            if self.require_clinician_signoff and not r.clinician_signed:
                continue
            out.append(r)
        return tuple(out)

    def evaluate(self, corpus: str, severity: object = None) -> list[RedFlagHit]:
        text = (corpus or "").lower()
        sev = _severity_number(severity)
        hits: list[RedFlagHit] = []
        for rule in self.active_rules():
            matched: list[str] = []
            fired = False
            if rule.kind == "and":
                per_group: list[list[str]] = []
                for group in rule.groups:
                    found = [t for t in rule.terms.get(group, ()) if t in text]
                    per_group.append(found)
                if per_group and all(per_group):
                    for found in per_group:
                        matched.extend(found)
                    fired = True
            elif rule.kind == "any":
                found = [t for group in rule.groups
                         for t in rule.terms.get(group, ()) if t in text]
                if found:
                    matched.extend(found)
                    fired = True
            elif rule.kind == "severity":
                found = [t for group in rule.groups
                         for t in rule.terms.get(group, ()) if t in text]
                if sev is not None and sev >= self.severity_threshold and found:
                    matched.extend(found)
                    matched.append(f"severity {sev:g}/10")
                    fired = True
            if fired:
                hits.append(RedFlagHit(rule=rule.id, title=rule.title_en,
                                       matched=matched,
                                       signed=rule.clinician_signed))
        return hits
