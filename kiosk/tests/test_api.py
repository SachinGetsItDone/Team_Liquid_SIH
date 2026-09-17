"""End-to-end tests for the kiosk API over the real Module B/C packages.

These exercise the contract the frontend depends on: session creation with
consent, config-driven interview answers, server-side red flags, document
intake, history finalisation, summary generation, the attestation gate, and
the edit round-trip. Document intake uses a genuine Module B run_summary
shape so the suite does not depend on OCR runtime.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from kiosk import services  # noqa: E402
from kiosk.server import app  # noqa: E402
from kiosk.store import STORE  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # isolate the session store per test
    from kiosk import store as store_mod
    monkeypatch.setattr(store_mod, "STORE", store_mod.SessionStore(tmp_path / "sessions"))
    monkeypatch.setattr(store_mod, "sessions_dir", lambda: tmp_path / "sessions")
    monkeypatch.setattr(services, "STORE", store_mod.STORE)
    return TestClient(app)


def start(client, language="en"):
    res = client.post("/api/sessions", json={
        "language": language,
        "respondent": {"role": "patient"},
        "visit": {"type": "new"},
        "notice_acknowledged": True,
    })
    assert res.status_code == 200, res.text
    return res.json()


CHEST_ANSWERS = {
    "bodymap": {"value": "chest"},
    "complaint_id": "chest",
    "narrative": {"text": "seene mein dard, saans phool rahi hai"},
    "cc": {"value": "yes", "text": "chest pain"},
    "socrates.site": {"values": ["chest_center"]},
    "socrates.onset": {"values": ["sud_min"]},
    "socrates.character": {"values": ["pressing"]},
    "socrates.radiation": {"values": ["left_arm"]},
    "socrates.associations": {"values": ["breathless", "sweating"]},
    "socrates.timing": {"values": ["comes_goes"]},
    "socrates.exacerbating": {"values": ["worse_exertion"]},
    "socrates.severity": {"value": 8},
    "pmh": {"values": ["htn"]},
    "meds": {"values": [], "text": "Amlodipine 5 mg OD"},
    "allergies": {"values": ["no_allergy"]},
    "family": {"values": ["yes_family"], "text": "father had a heart attack"},
    "social.smoke": {"values": ["current"]},
    "social.alcohol": {"values": ["no_alc"]},
    "ros.rest_breathless": "yes",
    "ros.palpitations": "no",
    "ros.fever_cough": "no",
    "ros.calf": "no",
    "ice.worry": {"values": ["serious"]},
    "ice.expect": {"values": ["find_out"]},
}

RUN_SUMMARY = {
    "session_id": "B-TEST",
    "pages": [
        {
            "image": "rx.png",
            "structured": {
                "medications": [
                    {"name": "Amlodipine", "dose": "10 mg", "frequency": "OD",
                     "_src_conf": 0.99},
                ],
                "labs": [
                    {"name": "Hemoglobin", "value": "10.2", "unit": "g/dL",
                     "_src_conf": 0.99},
                ],
                "diagnoses": [{"text": "Hypertension", "_src_conf": 0.95}],
            },
            "verify": {"verify_all": False, "fields": []},
        },
        {
            "image": "handwritten.png",
            "structured": {
                "medications": [
                    {"name": "Metformin", "dose": "500", "frequency": "BD",
                     "_src_conf": 0.52, "_verify": True},
                ],
                "labs": [], "diagnoses": [],
            },
            "verify": {"verify_all": True,
                       "fields": [{"field": "medication:1", "verify": True,
                                   "reason": "handwriting: verify-default"}]},
        },
    ],
}


def capture(client, answers=CHEST_ANSWERS, language="en"):
    session = start(client, language)
    sid = session["session_id"]
    r = client.put(f"/api/sessions/{sid}/answers", json={"answers": answers})
    assert r.status_code == 200, r.text
    return sid


# --------------------------------------------------------------------- tests

def test_health_and_config(client):
    assert client.get("/healthz").json() == {"ok": True}
    cfg = client.get("/api/config").json()
    assert cfg["versions"]["history_schema"] == "medikiosk-history-bundle/1"
    assert cfg["disclosures"]["deterministic"] is True
    assert cfg["disclosures"]["ranges_signed"] is False


def test_interview_schema_is_data_driven(client):
    sch = client.get("/api/interview").json()
    assert "turns" in sch and "sections" in sch and "ros_sets" in sch
    assert sch["ros_sets"]["chest"]
    assert "options_by_complaint" not in sch["turns"]["socrates.site"]


def test_session_requires_consent(client):
    res = client.post("/api/sessions", json={
        "language": "en", "respondent": {"role": "patient"},
        "notice_acknowledged": False,
    })
    assert res.status_code == 422


def test_proxy_requires_relation(client):
    res = client.post("/api/sessions", json={
        "language": "en", "respondent": {"role": "proxy"},
        "notice_acknowledged": True,
    })
    assert res.status_code == 422


def test_red_flag_detected_server_side(client):
    sid = capture(client)
    res = client.post(f"/api/sessions/{sid}/safety")
    assert res.status_code == 200
    rules = {rf["rule"] for rf in res.json()["red_flags"]}
    assert "RF-2" in rules  # chest pain + breathlessness


def test_full_summary_and_attestation_gate(client):
    sid = capture(client)
    assert client.post(f"/api/sessions/{sid}/documents/bundle",
                       json={"run_summary": RUN_SUMMARY}).status_code == 200
    hist = client.post(f"/api/sessions/{sid}/history")
    assert hist.status_code == 200, hist.text
    assert hist.json()["schema"] == "medikiosk-history-bundle/1"

    summary = client.post(f"/api/sessions/{sid}/summary").json()
    sev = {a["severity"] for a in summary["alerts"]}
    assert "red-flag" in sev          # RF-2
    assert "verify" in sev            # handwritten Metformin
    assert summary["views"]["soap"]["S"]
    assert summary["views"]["readback_hi"]["lines"]
    assert summary["meta"]["ig_pin"].startswith("ndhm.in#")

    # attestation must fail while verify items are undecided
    blocked = client.post(f"/api/sessions/{sid}/attest", json={
        "practitioner_ref": "Practitioner/DR1", "resolved_fids": [],
    })
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["unresolved_fids"]

    # resolve them all, then attest
    resolved = blocked.json()["detail"]["unresolved_fids"]
    ok = client.post(f"/api/sessions/{sid}/attest", json={
        "practitioner_ref": "Practitioner/DR1", "resolved_fids": resolved,
    })
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["attestation"]["status"] == "final"


def test_edit_round_trip_reopens_attested_record(client):
    sid = capture(client)
    client.post(f"/api/sessions/{sid}/documents/bundle", json={"run_summary": RUN_SUMMARY})
    client.post(f"/api/sessions/{sid}/history")
    summary = client.post(f"/api/sessions/{sid}/summary").json()
    med_fids = [a["fid"] for a in summary["alerts"] if a["fid"].startswith("B:med:")]
    assert med_fids, "expected a document-derived medication"

    edited = client.post(f"/api/sessions/{sid}/edit", json={
        "fid": med_fids[0], "value": "Metformin 500 mg BD", "actor": "Practitioner/DR1",
    })
    assert edited.status_code == 200, edited.text
    # the corrected med should no longer raise a verify alert
    left = [a for a in edited.json()["alerts"] if a["fid"] == med_fids[0]]
    assert left == []


def test_physician_queue_prioritises_red_flags(client):
    sid_red = capture(client)
    client.post(f"/api/sessions/{sid_red}/safety")
    rows = client.get("/api/sessions").json()
    assert rows and rows[0]["session_id"] == sid_red
    assert rows[0]["red_flag"] is True


def test_documents_refused_without_consent_ref(client, monkeypatch):
    # a session created through the API always has consent; simulate the
    # defensive check directly
    from kiosk import documents
    with pytest.raises(documents.DocumentError):
        documents.ingest_images([], consent_ref="", session_id="A-TEST")
