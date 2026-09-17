"""Builds a real `medikiosk-history-bundle/1` from the kiosk's captured answers.

This is the kiosk's implementation of the Module A output contract that
`medic.contracts.load_history` validates. Two deliberate properties:

1. All clinical content (questions, option labels, red-flag terms) comes from
   config; this module only maps codes to text and provenance.
2. Red-flag evaluation is SERVER-SIDE and deterministic. The UI never decides
   safety; it renders whatever this module returns, with matched evidence.

Nothing here diagnoses. It transcribes what the patient/attendant selected or
said, attaches provenance (patient vs proxy, touch vs voice) and slot state
(captured / needs_review / not_answered / not_elicited).
"""
from __future__ import annotations

import re

from . import config_loader as cfg

DOSE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(mg|ml|mcg|μg|ug|gm|g|units?|iu|%)\b", re.I)
FREQ_TOKENS = {
    "od": "OD", "o.d": "OD", "once": "OD", "daily": "OD", "roz": "OD",
    "bd": "BD", "b.d": "BD", "twice": "BD",
    "tds": "TDS", "t.d.s": "TDS", "thrice": "TDS",
    "qid": "QID", "hs": "HS", "sos": "SOS", "prn": "SOS",
}

# Subjective fields a proxy must never assert as if the patient said them
# (demo-verified guardrail, doc/12): severity, worry, expectation.
PROXY_REVIEW_FIELDS = {"ice.worry", "ice.expect", "socrates.severity"}


class BuildError(ValueError):
    pass


def _opt_label(option: dict, lang: str) -> str:
    return option.get(lang) or option.get("en") or option.get("v", "")


def _turn(turn_id: str) -> dict:
    t = cfg.interview()["turns"].get(turn_id)
    if t is None:
        raise BuildError(f"unknown turn {turn_id!r}")
    return t


def _options_for(turn: dict, complaint_id: str) -> list[dict]:
    by_c = turn.get("options_by_complaint")
    if by_c:
        return by_c.get(complaint_id, turn.get("options", []))
    return turn.get("options", [])


def _find_option(turn: dict, complaint_id: str, value: str) -> dict | None:
    for o in _options_for(turn, complaint_id):
        if o.get("v") == value:
            return o
    return None


def _slot(state: str, value: str, by: str, voice: bool = False,
          conf: float | None = None) -> dict:
    return {"state": state, "value": value, "by": by, "voice": voice, "conf": conf}


# ---------------------------------------------------------------- medications

def parse_medication(text: str) -> dict:
    """'Amlodipine 5 mg — once daily' -> {name, dose, frequency}.

    Deterministic and conservative: whatever cannot be parsed stays in the
    name so the clinician sees the original text rather than a guess."""
    raw = (text or "").strip()
    if not raw:
        return {"name": "", "dose": "", "frequency": ""}
    dose = ""
    m = DOSE_RE.search(raw)
    if m:
        dose = f"{m.group(1)} {m.group(2).lower()}"
    freq = ""
    for tok in re.split(r"[\s,;/\-—]+", raw.lower()):
        tok = tok.strip("().")
        if tok in FREQ_TOKENS:
            freq = FREQ_TOKENS[tok]
            break
    name = raw
    if m:
        name = (raw[:m.start()] + " " + raw[m.end():])
    for tok, _ in FREQ_TOKENS.items():
        name = re.sub(rf"(?i)\b{re.escape(tok)}\b", " ", name)
    name = re.sub(r"\s+", " ", name).strip(" ,;/-—–.")
    return {"name": name or raw, "dose": dose, "frequency": freq}


# ------------------------------------------------------------------ red flags

def _rule_matches(rule: dict, corpus: str, severity: int | None,
                  terms: dict) -> tuple[bool, list[str]]:
    def found(group: str) -> list[str]:
        return [t for t in terms.get(group, []) if t in corpus]

    kind = rule.get("kind")
    groups = rule.get("groups", [])
    if kind == "and":
        evidence: list[str] = []
        for g in groups:
            f = found(g)
            if not f:
                return False, []
            evidence += f
        return True, evidence
    if kind == "any":
        f = found(groups[0]) if groups else []
        return bool(f), f
    if kind == "severity":
        sev_ok = severity is not None and severity >= 8
        f = found(groups[0]) if groups else []
        return (sev_ok and bool(f)), f
    return False, []


def compute_red_flags(corpus: str, severity: int | None) -> list[dict]:
    rf = cfg.red_flags()
    hits = []
    for rule in rf["rules"]:
        matched, evidence = _rule_matches(rule, corpus, severity, rf["terms"])
        if matched:
            hits.append({
                "rule": rule["id"],
                "title": rule.get("en", rule["id"]),
                "title_hi": rule.get("hi", ""),
                "matched": sorted(set(evidence)),
            })
    return hits


# -------------------------------------------------------------- main builder

def build_history(record: dict) -> dict:
    """Map a session record's answers to a v1 HistoryBundle (unvalidated dict;
    `medic.contracts.load_history` is the authority that validates it)."""
    answers: dict = record.get("answers") or {}
    lang: str = record.get("language") or "en"
    respondent: dict = record.get("respondent") or {"role": "patient"}
    by = respondent.get("role", "patient")

    # ---- complaint (from body-map pick or explicit chief complaint) --------
    complaint_id = answers.get("complaint_id") or "general"
    complaints = {c["id"]: c for c in cfg.interview()["complaints"]}
    general = cfg.interview()["general_complaint"]
    comp = complaints.get(complaint_id, general)

    narrative = ((answers.get("narrative") or {}).get("text") or "").strip()
    cc_answer = answers.get("cc") or {}
    complaint_term = cc_answer.get("text") or comp.get("en", "your main problem")
    cc_by = cc_answer.get("by", by)

    # ---- SOCRATES ---------------------------------------------------------
    socrates: dict[str, dict] = {}
    corpus_parts: list[str] = [narrative, comp.get("en", ""), comp.get("rom", ""),
                               comp.get("hi", ""), complaint_term]
    severity: int | None = None
    for field in ("site", "onset", "character", "radiation", "associations",
                  "timing", "exacerbating", "severity"):
        turn = _turn(f"socrates.{field}")
        ans = answers.get(f"socrates.{field}") or {}
        state = ans.get("state") or "not_answered"

        if turn["kind"] == "scale":
            n = ans.get("value")
            if isinstance(n, (int, float)):
                severity = int(n)
                socrates[field] = _slot("captured", f"{severity}/10", by)
            else:
                socrates[field] = _slot("not_answered", "", by)
            continue

        selected = ans.get("values") or ([ans["value"]] if ans.get("value") else [])
        text = (ans.get("text") or "").strip()
        labels: list[str] = []
        for v in selected:
            opt = _find_option(turn, complaint_id, v)
            if opt:
                labels.append(_opt_label(opt, lang))
                corpus_parts.append(_opt_label(opt, "en"))
                if opt.get("rfTerm"):
                    corpus_parts.append(opt["rfTerm"])
        if text:
            labels.append(text)
            corpus_parts.append(text)

        value = " ; ".join(labels)
        turn_key = f"socrates.{field}"
        review = (by == "proxy" and turn_key in PROXY_REVIEW_FIELDS)
        if not value and state != "not_elicited":
            state = "not_answered"
        elif value and state not in ("needs_review",):
            state = "captured"
        if review and value:
            state = "needs_review"
        socrates[field] = _slot(state, value, by, voice=bool(ans.get("voice")))

    # ---- history turns ----------------------------------------------------
    pmh, medications, allergies, family, social = [], [], [], [], []
    history_map = [
        ("pmh", "pmh"), ("meds", "medications"), ("allergies", "allergies"),
        ("family", "family"), ("social.smoke", "social"), ("social.alcohol", "social"),
    ]
    for turn_id, target in history_map:
        turn = _turn(turn_id)
        ans = answers.get(turn_id) or {}
        selected = ans.get("values") or ([ans["value"]] if ans.get("value") else [])
        text = (ans.get("text") or "").strip()
        labels = []
        for v in selected:
            opt = _find_option(turn, complaint_id, v)
            if opt:
                labels.append(_opt_label(opt, lang))
                corpus_parts.append(_opt_label(opt, "en"))
        if text:
            labels.append(text)
            corpus_parts.append(text)
        joined = "; ".join(labels)
        if target == "pmh" and joined and not _is_none(joined):
            pmh.append({"text": joined, "by": by})
        elif target == "medications" and joined and not _is_none(joined):
            if turn_id == "meds" and text:
                parsed = parse_medication(text)
                medications.append({**parsed, "by": by})
            else:
                medications.append({"name": joined, "dose": "", "frequency": "", "by": by})
        elif target == "allergies" and joined:
            allergies.append({"text": joined, "by": by})
        elif target == "family" and joined and not _is_none(joined):
            family.append({"text": joined, "by": by})
        elif target == "social" and joined and not _is_none(joined):
            social.append({"text": joined, "by": by})

    # meds free text companion (name/dose typed alongside a chip)
    meds_text = ((answers.get("meds") or {}).get("text") or "").strip()
    if meds_text and not any(m.get("name") == meds_text for m in medications):
        # already captured above when a chip was chosen; if a bare text was
        # entered with no chip, capture it as a patient-stated medicine
        if not medications:
            parsed = parse_medication(meds_text)
            if parsed["name"]:
                medications.append({**parsed, "by": by})

    # ---- ROS --------------------------------------------------------------
    ros_set = comp.get("rosSet", "general")
    ros_defs = cfg.ros()["sets"].get(ros_set, cfg.ros()["sets"]["general"])
    ros: list[dict] = []
    for item in ros_defs:
        raw = answers.get(item["id"])
        if isinstance(raw, dict):
            raw = raw.get("value")
        if isinstance(raw, list):
            raw = raw[0] if raw else None
        if raw not in ("yes", "no", "not_sure"):
            continue
        val = raw
        positive = val == "yes"
        if positive:
            corpus_parts.append(item.get("symptom", ""))
        ros.append({
            "system": item.get("system", "general"),
            "symptom": item.get("symptom", item["id"]),
            "state": "needs_review" if val == "not_sure" else "captured",
            "positive": positive,
            "by": by,
        })

    # ---- ICE --------------------------------------------------------------
    ice: dict[str, dict] = {}
    ice_map = {"ice.worry": "concerns", "ice.expect": "expectations"}
    for turn_id, key in ice_map.items():
        turn = _turn(turn_id)
        ans = answers.get(turn_id) or {}
        selected = ans.get("values") or ([ans["value"]] if ans.get("value") else [])
        text = (ans.get("text") or "").strip()
        labels = []
        for v in selected:
            opt = _find_option(turn, complaint_id, v)
            if opt:
                labels.append(_opt_label(opt, lang))
        if text:
            labels.append(text)
        value = " ; ".join(labels)
        state = "captured" if value else "not_answered"
        if by == "proxy" and value:
            state = "needs_review"
        ice[key] = _slot(state, value, by, voice=bool(ans.get("voice")))
    ice["ideas"] = _slot("not_elicited", "", by)

    # ---- red flags (server-side, deterministic) ---------------------------
    corpus = " ".join(corpus_parts).lower()
    red_flags = compute_red_flags(corpus, severity)

    return {
        "schema": cfg.app_config()["versions"]["history_schema"],
        "session_id": record["session_id"],
        "consent_ref": record.get("consent_ref") or "",
        "patient_ref": record.get("patient_ref") or "Patient/ABHA-UNKNOWN",
        "language": lang,
        "respondent": respondent,
        "visit": record.get("visit") or {"type": "new", "prior_date": None},
        "complaint": {
            "term": complaint_term,
            "free_text": narrative or complaint_term,
            "by": cc_by,
            "voice": bool(cc_answer.get("voice")),
            "conf": None,
        },
        "socrates": socrates,
        "pmh": pmh,
        "medications": medications,
        "allergies": allergies,
        "family": family,
        "social": social,
        "ros": ros,
        "ice": ice,
        "red_flags": red_flags,
    }


_NONE_MARKERS = ("none", "no_", "never", "no ", "कुछ नहीं", "कोई नहीं")


def _is_none(text: str) -> bool:
    """True when a chosen label expresses absence (so no history row is added)."""
    t = text.strip().lower()
    return t.startswith(("none", "no known", "none that", "never", "no medicines",
                         "no allergy", "no allergies")) or t in {"नहीं", "कुछ नहीं", "कोई नहीं"}
