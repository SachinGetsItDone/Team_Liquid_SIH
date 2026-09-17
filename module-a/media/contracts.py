"""A6 - Output contract: HistoryBundle v1 (`medikiosk-history-bundle/1`).

This is the producer side of the contract that Module C defines and enforces in
`module-c/medic/contracts.py`. Emitting exactly this shape is what lets the
downstream merger, renderer and emitter read a Module A session without any
adapter.

Honesty rules encoded here (doc/09 section 2, doc/19 section 0):
- every slot has a state; the default is `not_elicited`, so a field that was
  never asked can never be rendered as if it were;
- every slot carries provenance (`by` patient/proxy, `voice`, `conf`);
- `captured` requires a non-empty value (validated);
- red flags are records of a deterministic rule match, with the matched terms.

The dataclasses deliberately mirror `medic.contracts.Slot` / `HistoryBundle`
field-for-field so a round-trip through `load_history` is lossless.
"""
from __future__ import annotations

from dataclasses import dataclass, field

HISTORY_SCHEMA = "medikiosk-history-bundle/1"

SLOT_STATES = ("captured", "needs_review", "not_answered", "not_elicited")

SOCRATES_FIELDS = ("site", "onset", "character", "radiation", "associations",
                   "timing", "exacerbating", "severity")

ICE_FIELDS = ("ideas", "concerns", "expectations")


class ContractError(ValueError):
    """Raised when a produced bundle violates the v1 contract."""


@dataclass
class Slot:
    """One elicited clinical slot with the honesty + provenance contract."""
    key: str
    state: str = "not_elicited"
    value: str = ""
    by: str = "patient"                 # patient | proxy
    voice: bool = False
    conf: float | None = None

    def __post_init__(self) -> None:
        if self.state not in SLOT_STATES:
            raise ContractError(f"slot {self.key!r}: unknown state {self.state!r}")
        if self.state == "captured" and not self.value:
            raise ContractError(f"slot {self.key!r}: captured but empty value")
        if self.conf is not None and not (0.0 <= float(self.conf) <= 1.0):
            raise ContractError(f"slot {self.key!r}: conf out of range {self.conf!r}")

    def to_dict(self) -> dict:
        d = {"state": self.state, "value": self.value, "by": self.by,
             "voice": self.voice}
        if self.conf is not None:
            d["conf"] = self.conf
        return d


@dataclass
class RedFlagHit:
    """A deterministic red-flag rule match (never an LLM decision)."""
    rule: str
    title: str
    matched: list[str] = field(default_factory=list)
    signed: bool = False

    def to_dict(self) -> dict:
        return {"rule": self.rule, "title": self.title,
                "matched": list(self.matched)}


@dataclass
class HistoryDraft:
    """Accumulates a session and emits the v1 HistoryBundle dict."""

    session_id: str
    consent_ref: str
    patient_ref: str = "Patient/ABHA-UNKNOWN"
    language: str = "en"
    respondent: dict = field(default_factory=lambda: {"role": "patient",
                                                      "relation": None})
    visit: dict = field(default_factory=lambda: {"type": "new",
                                                 "prior_date": None})
    complaint: dict = field(default_factory=dict)
    socrates: dict[str, Slot] = field(default_factory=dict)
    pmh: list[dict] = field(default_factory=list)
    medications: list[dict] = field(default_factory=list)
    allergies: list[dict] = field(default_factory=list)
    family: list[dict] = field(default_factory=list)
    social: list[dict] = field(default_factory=list)
    ros: list[dict] = field(default_factory=list)
    ice: dict[str, Slot] = field(default_factory=dict)
    red_flags: list[RedFlagHit] = field(default_factory=list)
    dashavidha: dict | None = None

    def __post_init__(self) -> None:
        for key in SOCRATES_FIELDS:
            self.socrates.setdefault(key, Slot(key=key))
        for key in ICE_FIELDS:
            self.ice.setdefault(key, Slot(key=f"ice.{key}"))

    # --------------------------------------------------------------- mutators
    def set_slot(self, key: str, value: str, *, by: str = "patient",
                 voice: bool = False, conf: float | None = None,
                 state: str = "captured") -> Slot:
        slot = Slot(key=key, state=state, value=value, by=by, voice=voice,
                    conf=conf)
        if key in self.ice or key.startswith("ice."):
            bare = key.split(".", 1)[1]
            self.ice[bare] = Slot(key=key, state=state, value=value, by=by,
                                  voice=voice, conf=conf)
            return self.ice[bare]
        if key in SOCRATES_FIELDS:
            self.socrates[key] = slot
            return slot
        raise ContractError(f"unknown slot key {key!r}")

    def mark_not_answered(self, key: str) -> None:
        self.set_slot(key, "", state="not_answered")

    def add_entry(self, bucket: str, entry: dict) -> None:
        if bucket not in ("pmh", "medications", "allergies", "family",
                          "social", "ros"):
            raise ContractError(f"unknown bucket {bucket!r}")
        getattr(self, bucket).append(entry)

    def set_red_flags(self, hits: list[RedFlagHit]) -> None:
        self.red_flags = list(hits)

    # ---------------------------------------------------------------- emitters
    def to_bundle(self) -> dict:
        """Emit the v1 HistoryBundle dict (all 8 SOCRATES + 3 ICE slots present)."""
        if not self.session_id or not self.consent_ref:
            raise ContractError("session_id and consent_ref are required")
        bundle = {
            "schema": HISTORY_SCHEMA,
            "session_id": self.session_id,
            "consent_ref": self.consent_ref,
            "patient_ref": self.patient_ref,
            "language": self.language,
            "respondent": dict(self.respondent),
            "visit": dict(self.visit),
            "complaint": dict(self.complaint),
            "socrates": {k: self.socrates[k].to_dict() for k in SOCRATES_FIELDS},
            "pmh": list(self.pmh),
            "medications": list(self.medications),
            "allergies": list(self.allergies),
            "family": list(self.family),
            "social": list(self.social),
            "ros": list(self.ros),
            "ice": {k: self.ice[k].to_dict() for k in ICE_FIELDS},
            "red_flags": [h.to_dict() for h in self.red_flags],
        }
        if self.dashavidha is not None:
            bundle["dashavidha"] = self.dashavidha
        return bundle

    def validate(self) -> list[str]:
        """Return a list of contract violations (empty = valid)."""
        problems: list[str] = []
        if not self.session_id:
            problems.append("session_id missing")
        if not self.consent_ref:
            problems.append("consent_ref missing")
        for key in SOCRATES_FIELDS:
            if key not in self.socrates:
                problems.append(f"socrates missing {key}")
        for slot in list(self.socrates.values()) + list(self.ice.values()):
            if slot.state not in SLOT_STATES:
                problems.append(f"{slot.key}: bad state {slot.state}")
            if slot.state == "captured" and not slot.value:
                problems.append(f"{slot.key}: captured but empty")
        return problems


def validate_bundle(bundle: dict) -> list[str]:
    """Validate an already-serialized bundle dict against the v1 contract."""
    problems: list[str] = []
    if bundle.get("schema") != HISTORY_SCHEMA:
        problems.append(f"bad schema {bundle.get('schema')!r}")
    for req in ("session_id", "consent_ref", "patient_ref"):
        if not bundle.get(req):
            problems.append(f"missing {req}")
    socrates = bundle.get("socrates") or {}
    for key in SOCRATES_FIELDS:
        if key not in socrates:
            problems.append(f"socrates missing {key}")
    ice = bundle.get("ice") or {}
    for key in ICE_FIELDS:
        if key not in ice:
            problems.append(f"ice missing {key}")
    return problems
