"""Session-level Module A tests: full scripted interview + integration hooks."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from media.cli import DEMO_SCRIPT, run_script
from media.config import MediaConfig
from media.contracts import validate_bundle
from media.session import HistorySession


def _run():
    return run_script(DEMO_SCRIPT, session_id="A-TEST-1", consent_ref="tok-1",
                      language="rom")


def test_scripted_session_emits_valid_bundle():
    result = _run()
    bundle = result["bundle"]
    assert validate_bundle(bundle) == []
    assert bundle["session_id"] == "A-TEST-1"
    assert bundle["consent_ref"] == "tok-1"
    assert bundle["complaint"]["term"]


def test_scripted_session_round_trips_through_module_c_contract():
    try:
        from medic.contracts import load_history
    except Exception as exc:                       # pragma: no cover
        import pytest
        pytest.skip(f"medic not importable: {exc}")
    result = _run()
    parsed = load_history(result["bundle"])
    assert parsed.session_id == "A-TEST-1"
    assert parsed.socrates["severity"].value == "8/10"
    assert parsed.red_flags and parsed.red_flags[0]["rule"] in ("RF-2", "RF-4")


def test_scripted_session_flags_rf2_and_rf4():
    rules = {h["rule"] for h in _run()["red_flags"]}
    assert "RF-2" in rules
    assert "RF-4" in rules


def test_severity_and_site_captured_with_provenance():
    bundle = _run()["bundle"]
    assert bundle["socrates"]["severity"]["value"] == "8/10"
    assert bundle["socrates"]["severity"]["by"] == "patient"
    assert bundle["socrates"]["site"]["value"]


def test_medications_parsed_without_inventing_dose():
    meds = _run()["bundle"]["medications"]
    names = {m["name"].lower() for m in meds}
    assert "amlodipine" in names
    amlo = next(m for m in meds if m["name"].lower() == "amlodipine")
    assert amlo["dose"] == "5 mg" and amlo["frequency"] == "OD"


def test_critical_slots_request_confirmation():
    keys = {c["key"] for c in _run()["confirmations"]}
    assert "medications" in keys
    assert "allergies" in keys


def test_pending_ack_gate():
    session = HistorySession(session_id="A-ACK", consent_ref="tok")
    result = session.respond("seene mein dard aur saans phool rahi hai")
    assert result.pending_ack
    assert session.pending_ack
    # the FSM did not advance past the narrative while unacknowledged
    assert session.current_turn().id == "narrative"
    session.acknowledge_red_flag()
    assert not session.pending_ack
    assert session.current_turn().id == "complaint"


def test_readback_confirmation_never_clears_verify_flag():
    session = HistorySession(session_id="A-RB", consent_ref="tok")
    session.draft.set_slot("onset", "long ago", state="needs_review")
    # walk straight to readback by driving the whole script is overkill here:
    for turn in session.fsm.turns:
        if turn.kind == "readback":
            session.fsm.cursor = session.fsm.turns.index(turn)
            break
    session.respond("yes")
    assert session.readback_confirmed is True
    assert session.draft.socrates["onset"].state == "needs_review"


def test_non_pain_complaint_switches_hpi_prompts():
    session = HistorySession(session_id="A-NP", consent_ref="tok")
    session.respond("khansi aur bukhar 3 din se")     # narrative
    session.respond("khansi")                          # complaint
    assert session.fsm.is_pain is False
    assert session.current_turn().id == "hpi.site"


def test_no_authority_framing_in_llm_prompt():
    from media.nlu import LlamaCppExtractor
    prompt = LlamaCppExtractor.PROMPT.lower()
    assert "must return" in prompt and "never guess" in prompt
    for word in ("urgent", "emergency", "diagnos", "as a doctor"):
        assert word not in prompt
