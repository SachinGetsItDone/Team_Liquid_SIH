"""Red-flag rule-spec round-trip + clinician sign-off gate."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from media.redflags import ALL_RULES, RedFlagEngine
from media.rules import (RuleSpecError, load_rules, merge_rules,
                         rules_from_spec, rules_to_spec, save_spec,
                         write_template)

_SPEC = Path(__file__).resolve().parents[1] / "media" / "redflags.spec.json"


def test_round_trip_preserves_rules():
    spec = rules_to_spec(ALL_RULES)
    back = rules_from_spec(spec)
    assert [r.id for r in back] == [r.id for r in ALL_RULES]
    chest = next(r for r in back if r.id == "RF-2")
    assert "seene mein dard" in chest.terms["chest"]
    assert chest.active and not chest.clinician_signed


def test_shipped_spec_loads_and_candidates_are_inactive():
    rules = load_rules(_SPEC)
    assert len(rules) == 12
    by_id = {r.id: r for r in rules}
    assert [r.id for r in rules if r.active] == ["RF-1", "RF-2", "RF-3", "RF-4"]
    for rid in ("RF-5", "RF-12"):
        assert by_id[rid].active is False
        assert by_id[rid].terms == {}


def test_clinician_can_activate_a_candidate_without_code():
    spec = json.loads(_SPEC.read_text(encoding="utf-8"))["rules"]
    for raw in spec:
        if raw["id"] == "RF-5":
            raw.update({"kind": "any", "active": True,
                        "clinician_signed": True,
                        "groups": ["bleed"],
                        "terms": {"bleed": ["bleeding", "khoon", "रक्तस्राव"]},
                        "note": "signed by Dr X"})
    rules = merge_rules(ALL_RULES, spec)
    signed_only = RedFlagEngine(rules=rules, require_clinician_signoff=True)
    hits = signed_only.evaluate("patient has bleeding and khoon")
    assert [h.rule for h in hits] == ["RF-5"]
    assert hits[0].signed is True
    # unsigned demo rules are excluded when sign-off is required
    assert "RF-2" not in {h.rule for h in signed_only.evaluate(
        "seene mein dard saans phool")}


def test_spec_rejects_signed_active_rule_without_terms():
    with pytest.raises(RuleSpecError):
        rules_from_spec([{"id": "RF-X", "kind": "any", "active": True,
                          "clinician_signed": True, "terms": {}}])


def test_spec_rejects_missing_id():
    with pytest.raises(RuleSpecError):
        rules_from_spec([{"kind": "any"}])


def test_save_and_reload_spec(tmp_path):
    path = save_spec(ALL_RULES, tmp_path / "spec.json", meta={"status": "test"})
    loaded = load_rules(path)
    assert [r.id for r in loaded] == [r.id for r in ALL_RULES]
    with pytest.raises(FileNotFoundError):
        load_rules(tmp_path / "nope.json")


def test_write_template_marks_unsigned(tmp_path):
    path = write_template(tmp_path / "t.json")
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert doc["meta"]["status"].startswith("TEMPLATE")
    assert all(r["clinician_signed"] is False for r in doc["rules"])
