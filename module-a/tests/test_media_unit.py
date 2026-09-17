"""Unit tests for the deterministic Module A layers (no audio, no network)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from media.contracts import (HISTORY_SCHEMA, HistoryDraft, Slot,
                             validate_bundle)
from media.fsm import HistoryFSM, is_pain_complaint
from media.nlu import Extraction, LlamaCppExtractor, RuleBasedExtractor, \
    clinical_excerpt
from media.redflags import RedFlagEngine
from media.fsm import Turn


# ------------------------------------------------------------------- contract

def test_slot_rejects_captured_empty_and_bad_state():
    with pytest.raises(ValueError):
        Slot(key="site", state="captured", value="")
    with pytest.raises(ValueError):
        Slot(key="site", state="banana", value="x")
    with pytest.raises(ValueError):
        Slot(key="site", state="captured", value="x", conf=1.5)


def test_draft_emits_all_slots():
    draft = HistoryDraft(session_id="A1", consent_ref="tok")
    bundle = draft.to_bundle()
    assert bundle["schema"] == HISTORY_SCHEMA
    assert set(bundle["socrates"]) == {"site", "onset", "character", "radiation",
                                       "associations", "timing", "exacerbating",
                                       "severity"}
    assert set(bundle["ice"]) == {"ideas", "concerns", "expectations"}
    # default state is not_elicited, never captured
    assert bundle["socrates"]["site"]["state"] == "not_elicited"
    assert validate_bundle(bundle) == []


def test_validate_bundle_flags_bad_schema_and_missing_slot():
    bad = {"schema": "nope/1", "session_id": "a", "consent_ref": "b",
           "patient_ref": "c", "socrates": {}, "ice": {}}
    problems = validate_bundle(bad)
    assert any("schema" in p for p in problems)
    assert any("socrates missing site" in p for p in problems)


def test_draft_requires_session_and_consent():
    with pytest.raises(ValueError):
        HistoryDraft(session_id="", consent_ref="x").to_bundle()


# ------------------------------------------------------------------ red flags

def _engine(**kw):
    return RedFlagEngine(**kw)


def test_rf2_chest_and_breath():
    hits = _engine().evaluate("seene mein dard, saans phool rahi hai")
    assert [h.rule for h in hits] == ["RF-2"]
    assert "chest" not in hits[0].matched  # matched terms, not group names
    assert any("seene" in m for m in hits[0].matched)


def test_rf1_needs_both_headache_and_sudden():
    assert _engine().evaluate("sir dard hai") == []
    hits = _engine().evaluate("achanak sir dard bahut tez")
    assert [h.rule for h in hits] == ["RF-1"]


def test_rf3_any_stroke_term():
    hits = _engine().evaluate("achanak ek taraf kamzori aur lisdar bolna")
    assert [h.rule for h in hits] == ["RF-3"]


def test_rf4_needs_severity_and_concern():
    assert _engine().evaluate("pasina aa raha hai", severity="5/10") == []
    hits = _engine().evaluate("pasina aa raha hai", severity="8/10")
    assert [h.rule for h in hits] == ["RF-4"]
    assert any("severity" in m for m in hits[0].matched)


def test_unsigned_rules_can_be_gated_off():
    signed_only = _engine(require_clinician_signoff=True)
    assert signed_only.active_rules() == ()
    assert signed_only.evaluate("seene mein dard saans phool", severity="9/10") == []


def test_pending_rules_never_fire():
    # placeholder rules have no terms and are inactive -> no fabrication risk
    for rule in _engine().rules:
        if not rule.active:
            assert rule.terms == {}


# ------------------------------------------------------------------------ NLU

def test_clinical_excerpt_strips_fillers_but_keeps_leading_negation():
    assert clinical_excerpt("umm matlab I have, you know, fever") == "I have, fever"
    assert clinical_excerpt("no allergies").startswith("no")


def test_rule_extractor_severity():
    ext = RuleBasedExtractor().extract(
        Turn("hpi.severity", "hpi", "severity", "", "", slot="severity"), "8/10")
    assert ext.usable and ext.value == "8/10" and ext.conf == 0.9


def test_rule_extractor_severity_word():
    ext = RuleBasedExtractor().extract(
        Turn("hpi.severity", "hpi", "severity", "", "", slot="severity"),
        "aath out of ten")
    assert ext.value == "8/10"


def test_rule_extractor_yes_no_hinglish():
    turn = Turn("social.smoke", "history", "yesno", "", "")
    assert RuleBasedExtractor().extract(turn, "haan").value == "yes"
    assert RuleBasedExtractor().extract(turn, "nahi").value == "no"
    assert RuleBasedExtractor().extract(turn, "kabhi nahi").value == "no"


def test_rule_extractor_free_text_is_verbatim():
    turn = Turn("pmh", "history", "free_text", "", "")
    ext = RuleBasedExtractor().extract(turn, "BP ki dawa 5 saal se")
    assert ext.value == "BP ki dawa 5 saal se"
    assert ext.conf is None                     # verbatim: no inferred confidence


def test_rule_extractor_unknown_when_empty():
    turn = Turn("pmh", "history", "free_text", "", "")
    assert RuleBasedExtractor().extract(turn, "   ").unknown


def test_llamacpp_adapter_does_not_guess():
    def fake(payload):
        assert payload["temperature"] == 0
        assert "known" in payload["messages"][0]["content"]
        return {"known": False}
    ext = LlamaCppExtractor("http://x", transport=fake).extract(
        Turn("pmh", "history", "free_text", "", ""), "nothing useful")
    assert ext.unknown and not ext.usable

    def fake2(payload):
        return {"known": True, "value": "5 years"}
    ext2 = LlamaCppExtractor("http://x", transport=fake2).extract(
        Turn("pmh", "history", "free_text", "", ""), "5 saal")
    assert ext2.value == "5 years" and not ext2.unknown


# ------------------------------------------------------------------------ FSM

def test_fsm_pain_and_nonpain_sequences_same_slots():
    pain = HistoryFSM("seene mein dard")
    nonpain = HistoryFSM("khansi")
    assert pain.cursor == 0 and pain.current().id == "narrative"
    pain_slots = [t.slot for t in pain.turns if t.section == "hpi"]
    nonpain_slots = [t.slot for t in nonpain.turns if t.section == "hpi"]
    assert pain_slots == nonpain_slots == ["site", "onset", "character",
                                           "radiation", "associations", "timing",
                                           "exacerbating", "severity"]


def test_fsm_walks_to_done():
    fsm = HistoryFSM("chest pain")
    n = len(fsm.turns)
    for _ in range(n):
        fsm.advance()
    assert fsm.done and fsm.current() is None


def test_is_pain_complaint():
    assert is_pain_complaint("seene mein dard")
    assert is_pain_complaint("chest pain")
    assert not is_pain_complaint("khansi aur bukhar")
