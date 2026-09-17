"""Demo fixtures - the shared SIH demo case (consistent with the Module A
guided demo 1 "Ramesh, 54, Hinglish, chest pain" and the Module B demo
session documents). Disclosed as simulated everywhere they are used.

The HistoryBundle below is a REAL instance of the v1 contract (contracts.py):
a Module A session that hit RF-2 (chest pain + breathlessness) with voice
provenance on the symptom slots. The DocumentSide is a REAL medib
run_summary-shaped session (4 docs: printed EN Rx, printed HI Rx, printed
lab report, handwritten Rx) with verify states from the measured reference
run (research log 2026-09-11)."""
from __future__ import annotations

from .contracts import load_documents, load_history

DEMO_HISTORY = {
    "schema": "medikiosk-history-bundle/1",
    "session_id": "A2309111433",
    "consent_ref": "opaque-token-module-d",
    "patient_ref": "Patient/ABHA-DEMO",
    "language": "rom",
    "respondent": {"role": "patient", "relation": None},
    "visit": {"type": "new", "prior_date": None},
    "complaint": {
        "term": "chest pain",
        "free_text": "seedi seene mein dard hai, arma gire jab hota hai"
                     " (clinical excerpt kept)",
        "by": "patient", "voice": True, "conf": 0.91,
    },
    "socrates": {
        "site": {"state": "captured", "value": "middle of the chest",
                 "by": "patient", "voice": True, "conf": 0.93},
        "onset": {"state": "captured", "value": "2 days ago, sudden",
                  "by": "patient", "voice": True, "conf": 0.9},
        "character": {"state": "captured", "value": "heavy pressure",
                      "by": "patient", "voice": True, "conf": 0.89},
        "radiation": {"state": "captured", "value": "left arm",
                      "by": "patient", "voice": True, "conf": 0.88},
        "associations": {"state": "captured",
                         "value": "breathlessness, sweating",
                         "by": "patient", "voice": True, "conf": 0.92},
        "timing": {"state": "captured", "value": "comes and goes, 10-20 minutes",
                   "by": "patient", "voice": True, "conf": 0.85},
        "exacerbating": {"state": "captured", "value": "walking uphill",
                         "by": "patient", "voice": False, "conf": None},
        "severity": {"state": "captured", "value": "8/10",
                     "by": "patient", "voice": False, "conf": None},
    },
    "pmh": [{"text": "high BP for 5 years", "by": "patient"},
            {"text": "kidney stone (2019)", "by": "patient"}],
    "medications": [
        {"name": "Amlodipine", "dose": "5 mg", "frequency": "OD", "by": "patient"},
        {"name": "Atorvastatin", "dose": "10 mg", "frequency": "", "by": "patient"},
    ],
    "allergies": [{"text": "no allergies", "by": "patient"}],
    "family": [{"text": "father - heart attack at 58", "by": "patient"}],
    "social": [{"text": "smokes 10 bidis/day", "by": "patient"},
               {"text": "works as a driver", "by": "patient"}],
    "ros": [
        {"system": "cardio", "symptom": "breathlessness", "state": "captured",
         "positive": True, "by": "patient"},
        {"system": "resp", "symptom": "cough", "state": "captured",
         "positive": True, "by": "patient"},
        {"system": "gi", "symptom": "vomiting", "state": "captured",
         "positive": False, "by": "patient"},
        {"system": "neuro", "symptom": "fainting", "state": "captured",
         "positive": False, "by": "patient"},
    ],
    "ice": {
        "ideas": {"state": "captured", "value": "thinks it is gas",
                  "by": "patient", "voice": True, "conf": 0.8},
        "concerns": {"state": "captured", "value": "worried like his father",
                     "by": "patient", "voice": True, "conf": 0.82},
        "expectations": {"state": "needs_review", "value": "wants ECG today",
                         "by": "patient", "voice": False, "conf": None},
    },
    "red_flags": [
        {"rule": "RF-2", "title": "chest pain + breathlessness",
         "matched": ["chest pain", "breathlessness"]},
    ],
}

# medib run_summary-shaped session (the Module B demo documents), with the
# verify states the measured reference run produced: printed docs high-conf,
# handwritten page fully verify-flagged.
DEMO_DOCUMENTS = {
    "session_id": "B2309111502",
    "bundle": "out/bundle.json",
    "persist_raw": False,
    "pages": [
        {
            "image": "print_en_rx.png",
            "structured": {
                "medications": [
                    {"name": "Amoxicillin", "dose": "500mg", "frequency": "BD",
                     "duration": "5 days", "_src_conf": 0.99},
                    {"name": "Paracetamol", "dose": "650mg", "frequency": "TDS",
                     "duration": "3 days", "_src_conf": 0.99},
                    {"name": "Ascoril", "dose": "5ml", "frequency": "TDS",
                     "duration": "7 days", "_src_conf": 0.97},
                ],
                "labs": [], "diagnoses": [
                    {"text": "Acute bronchitis", "_src_conf": 1.0},
                ],
            },
            "verify": {"verify_all": False, "fields": []},
        },
        {
            "image": "print_hi_rx.png",
            "structured": {
                "medications": [
                    {"name": "Paracetamol", "dose": "650", "frequency": "TDS",
                     "duration": "", "_src_conf": 0.96},
                ],
                "labs": [], "diagnoses": [
                    {"text": "fever and cough", "_src_conf": 0.95},
                ],
            },
            "verify": {"verify_all": False, "fields": []},
        },
        {
            "image": "print_en_lab.png",
            "structured": {
                "medications": [],
                "labs": [
                    {"name": "Hemoglobin", "value": "10.2", "unit": "g/dL",
                     "_src_conf": 0.99},
                    {"name": "TSH", "value": "4.1", "unit": "mIU/L",
                     "_src_conf": 0.96},
                    {"name": "Fasting Glucose", "value": "112", "unit": "mg/dL",
                     "_src_conf": 0.99},
                    {"name": "HbA1c", "value": "6.8", "unit": "%",
                     "_src_conf": 0.91},
                ],
                "diagnoses": [],
            },
            "verify": {"verify_all": False, "fields": []},
        },
        {
            "image": "handwritten_rx.png",
            "structured": {
                "medications": [
                    {"name": "Atorvastatin", "dose": "10", "frequency": "",
                     "duration": "", "_src_conf": 0.61, "_verify": True},
                    {"name": "Metformin", "dose": "500", "frequency": "BD",
                     "duration": "", "_src_conf": 0.52, "_verify": True},
                ],
                "labs": [], "diagnoses": [
                    {"text": "NIDDM", "_src_conf": 0.38, "_verify": True},
                ],
            },
            "verify": {"verify_all": True,
                       "fields": [{"field": "medication:1", "verify": True,
                                   "reason": "handwriting: verify-default"}]},
        },
    ],
}


def demo_case():
    """Returns (HistoryBundle, DocumentSide) for the shared demo case."""
    return load_history(DEMO_HISTORY), load_documents(DEMO_DOCUMENTS)
