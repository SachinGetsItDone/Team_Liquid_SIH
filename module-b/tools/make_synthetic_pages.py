"""Dev-only: generate synthetic printed pages (en + hi) with ground truth.

NOT a substitute for the M0 real-OPD eval set (doc/13 section 2.3): synthetic
renders overstate quality. Used only to exercise the harness end-to-end."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

EN_PAGES = [
    {
        "file": "print_en_rx.png",
        "full_text": ("Rx\nTab. Amoxicillin 500mg BD x 5 days\nTab. Paracetamol 650mg TDS x 3 days\n"
                      "Diagnosis: Acute bronchitis\nSyrup Ascoril 5ml TDS x 7 days"),
    },
    {
        "file": "print_en_lab.png",
        "full_text": ("Test Report\nHemoglobin : 10.2 g/dL\nTSH : 4.1 mIU/L\n"
                      "Fasting Glucose : 112 mg/dL\nHbA1c : 6.8 %"),
    },
    {
        "file": "print_en_note.png",
        "full_text": ("Patient: 34 yr male\nKnown case of hypertension since 2021\n"
                      "c/o headache x 3 days, better now\nAdvice: review after 1 week"),
    },
]

HI_PAGES = [
    {
        "file": "print_hi_rx.png",
        "full_text": ("निदान: बुखार और खांसी\nटैबलेट पैरासिटामोल 650 एमजी दिन में तीन बार\n"
                      "मरीज: 40 वर्ष पुरुष\nसलाह: एक सप्ताह बाद दोबारा आएं"),
    },
]

FONTS = [
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\calibri.ttf",
]
# Devanagari-capable fonts shipped with Windows (Nirmala is a .ttc collection)
HI_FONTS = [
    r"C:\Windows\Fonts\Nirmala.ttc",
    r"C:\Windows\Fonts\Mangal.ttf",
    r"C:\Windows\Fonts\nirmala.ttf",
]


def _font(size: int, devanagari: bool):
    for cand in (HI_FONTS if devanagari else FONTS):
        try:
            return ImageFont.truetype(cand, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render(page: dict, out_dir: Path) -> None:
    lines = page["full_text"].split("\n")
    img = Image.new("RGB", (1000, 120 + 64 * len(lines)), "white")
    d = ImageDraw.Draw(img)
    devanagari = any("\u0900" <= ch <= "\u097f" for ch in page["full_text"])
    f = _font(34, devanagari)
    y = 50
    for ln in lines:
        d.text((60, y), ln, fill="black", font=f)
        y += 64
    img.save(out_dir / page["file"])


def main() -> None:
    out = Path(__file__).parent / "pages"
    out.mkdir(exist_ok=True)
    gt = {"pages": []}
    for page in EN_PAGES + HI_PAGES:
        render(page, out)
        gt["pages"].append({"image": page["file"], "full_text": page["full_text"]})
    (out / "gt.json").write_text(json.dumps(gt, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(gt['pages'])} pages + gt.json under {out}")


if __name__ == "__main__":
    main()
