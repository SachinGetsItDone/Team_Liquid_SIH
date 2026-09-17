"""B1 - Intake: image load, light preprocessing, DPDP consent gate.

Consent artefact is REQUIRED before any extraction runs (DPDP itemized-notice
requirement, doc/13 section 4; doc/17 section 2 constraint map)."""
from __future__ import annotations

import datetime as _dt
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path

from PIL import Image, ImageOps


class ConsentMissingError(RuntimeError):
    """Raised when extraction is attempted without a recorded DPDP consent artefact."""


ITEMIZED_NOTICE = {
    "purpose": "Digitize your paper records for this consultation only",
    "data_collected": [
        "Photograph/scan of documents you bring",
        "Medicines, doses, lab values, diagnoses read from them",
    ],
    "not_collected": ["Raw conversation audio", "Aadhaar number", "Any data not on the paper"],
    "rights": "You may decline or stop at any time; ask the help desk for deletion",
    "retention": "Scan is deleted at end of session unless the doctor verifies it into your record",
    "languages": "Available in any of the 22 Eighth Schedule languages on request",
}


@dataclass
class ConsentArtefact:
    patient_ack: bool
    language: str = "en"
    notice_version: str = "dpdp-2026-09"
    timestamp: str = field(default_factory=lambda: _dt.datetime.now().isoformat(timespec="seconds"))

    def validate(self) -> None:
        if not self.patient_ack:
            raise ConsentMissingError("patient did not acknowledge the itemized notice")


@dataclass
class IntakeResult:
    image_path: Path
    image: Image.Image
    deskewed: bool
    consent: ConsentArtefact
    persist_raw: bool = False          # DPDP: transient unless explicitly chosen
    session_id: str = ""

    def meta(self) -> dict:
        return {
            "image": str(self.image_path),
            "deskewed": self.deskewed,
            "consent": asdict(self.consent),
            "persist_raw": self.persist_raw,
        }


def load_page(path: Path | str, consent: ConsentArtefact) -> IntakeResult:
    """Load + normalize one scanned page. Raises ConsentMissingError if not acknowledged."""
    consent.validate()
    path = Path(path)
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    # light normalization: cap very large scans (keeps CPU/latency bounded)
    if max(img.size) > 2200:
        scale = 2200 / max(img.size)
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    return IntakeResult(
        image_path=path,
        image=img,
        deskewed=False,               # full deskew is an M1 item; EXIF orientation handled
        consent=consent,
        session_id=_dt.datetime.now().strftime("%Y%m%d%H%M%S"),
    )


def session_manifest(pages: list[IntakeResult], out_dir: Path) -> Path:
    """Write the per-session manifest (what was scanned, consent, retention mode)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "notice": ITEMIZED_NOTICE,
        "pages": [p.meta() for p in pages],
        "persist_raw_default": pages[0].persist_raw if pages else False,
    }
    path = out_dir / "session_manifest.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return path
