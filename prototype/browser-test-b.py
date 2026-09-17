"""Browser click-through test for module-b-kiosk-demo.html (headless Chromium).
Mirrors the presenter path: consent -> select all four papers -> UPLOAD extra
documents (incl. a sensitive-named file) -> scan -> processing auto-advance ->
review -> attest -> handoff. Verifies no console errors, the upload lane, the
sensitive-word name masking, and key bilingual content at every phase."""
from __future__ import annotations

import base64
import struct
import sys
import tempfile
import zlib
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
PAGE = (HERE / "module-b-kiosk-demo.html").resolve().as_uri()
SHOTS = HERE / "screenshots"
SHOTS.mkdir(exist_ok=True)


def write_photo_png(path: Path, seed: int = 0) -> None:
    """Stdlib-only photo-like PNG: white page, grey header band, dark text bars."""
    W, H = 450, 600
    white = (255, 255, 255)
    rows = [[white] * W for _ in range(H)]
    for y in range(20, 100):
        for x in range(20, W - 20):
            rows[y][x] = (238, 238, 238)
    y = 140
    for i, wdt in enumerate([250, 310, 215, 290, 175, 300, 260]):
        shade = 28 + (seed * 13 + i * 7) % 20
        for yy in range(y, min(y + 17, H - 10)):
            for x in range(30, min(30 + wdt, W - 10)):
                rows[yy][x] = (shade, shade, shade)
        y += 45
    raw = b"".join(b"\x00" + b"".join(bytes(px) for px in row) for row in rows)

    def chunk(typ: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def make_upload_files(tmp: Path) -> list[Path]:
    png1 = tmp / "photo-rx.png"
    write_photo_png(png1, seed=1)
    png2 = tmp / "shit-scan.png"  # sensitive name: must be masked in the UI
    write_photo_png(png2, seed=2)
    pdf1 = tmp / "advice-note.pdf"
    pdf1.write_bytes(b"%PDF-1.4\n%%EOF\n")
    broken = tmp / "broken.png"  # zero bytes: undecodable, must be excluded
    broken.write_bytes(b"")
    return [png1, png2, pdf1, broken]


def thumb_brightness(page) -> list[int]:
    return page.evaluate("""() => {
      const out = [];
      document.querySelectorAll('[data-upload] img').forEach((img) => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let s = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) { s += px[i] + px[i+1] + px[i+2]; n += 3; }
        out.push(Math.round(s / n));
      });
      return out;
    }""")

errors: list[str] = []


def main() -> int:
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        uploads = make_upload_files(tmp)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
                    if m.type == "error" else None)

            page.goto(PAGE)
            page.wait_for_selector("text=Before we scan your papers", timeout=10_000)
            page.wait_for_selector("text=काग़ज़ स्कैन करने से पहले", timeout=5_000)
            print("PASS  welcome screen renders bilingual DPDP consent")
            page.screenshot(path=str(SHOTS / "b1-welcome.png"))

            # language toggle
            page.click("text=हिन्दी")
            page.wait_for_selector("text=हाँ, मेरे काग़ज़ स्कैन करें", timeout=5_000)
            print("PASS  Hindi toggle switches consent CTA")
            page.click("text=English")

            # consent -> scan
            page.click("text=Yes, scan my papers")
            page.wait_for_selector("text=Place your papers on the scanner", timeout=5_000)
            page.wait_for_selector("text=Or upload your own papers", timeout=5_000)
            page.wait_for_selector("text=Drag & drop photos or PDFs here", timeout=5_000)
            print("PASS  scan screen lists demo documents + upload dropzone")
            page.screenshot(path=str(SHOTS / "b2-scan.png"))

            # upload lane: 2 photos + 1 pdf + 1 undecodable file (one has a sensitive name)
            page.set_input_files(
                "input[type=file][accept='image/*,.pdf,application/pdf']",
                [str(f) for f in uploads],
            )
            page.wait_for_selector("[data-upload='u1']", timeout=5_000)
            page.wait_for_selector("text=photo-rx.png", timeout=5_000)
            page.wait_for_selector("text=s•••-scan.png", timeout=5_000)
            assert "shit-scan" not in page.content(), "sensitive file name leaked into the DOM"
            page.wait_for_selector("text=advice-note.pdf", timeout=5_000)
            print("PASS  uploaded files listed with thumbnails; sensitive name masked")

            # undecodable file is flagged and excluded (never gets fabricated results)
            page.wait_for_selector("text=unreadable file", timeout=10_000)
            print("PASS  broken upload flagged unreadable + excluded from scan")

            # thumbnails show the real photo content (not black boxes)
            page.wait_for_timeout(500)
            means = thumb_brightness(page)
            assert len(means) == 2 and all(m > 100 for m in means), f"thumbnails look wrong: {means}"
            print(f"PASS  upload thumbnails render the photo content (brightness {means})")

            # printed/handwritten toggle on the first upload
            page.click("[data-modebtn='u1:handwritten']")
            page.wait_for_function(
                "document.querySelector(\"[data-mode='u1']\").textContent.includes('handwritten')",
                timeout=5_000,
            )
            print("PASS  per-upload printed/handwritten toggle works")

            # remove the third upload
            page.click("[data-remove='u3']")
            page.wait_for_selector("[data-upload='u3']", state="detached", timeout=5_000)
            assert "advice-note.pdf" not in page.content()
            print("PASS  uploaded document can be removed")
            page.screenshot(path=str(SHOTS / "b2b-uploads.png"))

            # select all four demo docs + keep the two uploads -> mixed session
            for label in ["Prescription (printed, English)", "Prescription (printed, Hindi)",
                          "Lab report (printed)", "Prescription (handwritten)"]:
                page.click(f"text={label}")
            page.click("text=Scan selected papers")
            page.wait_for_selector("text=Reading your papers", timeout=5_000)
            page.wait_for_selector("text=engines differ", timeout=5_000)
            page.wait_for_selector("text=Uploaded: photo-rx.png", timeout=5_000)
            page.wait_for_selector("text=OCR simulated (uploaded page)", timeout=5_000)
            assert "broken.png" not in page.content(), "excluded broken file reached the pipeline"
            print("PASS  processing screen shows engine ladder + voting + uploaded pages")
            page.screenshot(path=str(SHOTS / "b3-processing.png"))

            # auto-advance to review
            page.wait_for_selector("text=What we read from your papers", timeout=15_000)
            page.wait_for_selector("text=doctor will check", timeout=5_000)
            page.wait_for_selector("text=Telmisartan", timeout=5_000)
            print("PASS  review screen shows extracted fields (incl. uploaded rx) with verify badges")
            page.screenshot(path=str(SHOTS / "b4-review.png"))

            # deny a wrongly-read medicine (patient: "not on my paper")
            page.click("[data-deny='u1|medication:0']")
            page.wait_for_selector("text=removed by patient", timeout=5_000)
            page.wait_for_selector("text=Medicines (6)", timeout=5_000)
            print("PASS  patient can deny a wrong medicine (removed from list + bundle path)")

            # correct a lab value (patient types what the paper actually says)
            page.click("[data-correct='u2|lab:0']")
            page.fill("[data-edit-b]", "11.9")
            page.click("[data-save]")
            page.wait_for_selector("text=patient-corrected", timeout=5_000)
            page.wait_for_selector("text=11.9 g/dL", timeout=5_000)
            print("PASS  patient can correct a field (value + provenance shown)")
            page.screenshot(path=str(SHOTS / "b4b-review-fixed.png"))

            # continue -> attest/handoff
            page.click("text=Looks right — continue")
            page.wait_for_selector("text=Physician review", timeout=5_000)
            page.wait_for_selector("text=Flagged fields", timeout=5_000)
            page.wait_for_selector("text=FHIR DocumentBundle", timeout=5_000)
            page.wait_for_selector("text=professional", timeout=5_000)
            page.wait_for_selector("text=uploaded pages: 2 (OCR simulated)", timeout=5_000)
            page.wait_for_selector("text=patient corrections: 1", timeout=5_000)
            page.wait_for_selector("text=removed by patient: 1", timeout=5_000)
            page.wait_for_selector("text=11.9 g/dL", timeout=5_000)
            page.wait_for_selector("text=Patient corrections (1)", timeout=5_000)
            page.wait_for_selector("text=6 entries", timeout=5_000)
            # visible-text occurrences only (page.content() also serializes <script> source)
            n = page.evaluate("""() => {
              let c = 0;
              const walker = document.createTreeWalker(document.querySelector('#root'), NodeFilter.SHOW_TEXT);
              let n;
              while ((n = walker.nextNode())) { if (n.nodeValue.includes('Telmisartan')) c++; }
              return c;
            }""")
            assert n == 1, f"denied medicine should appear only in the removals listing, found {n}x"
            print("PASS  handoff shows corrected value + removals listing, denied item out of bundle")
            page.screenshot(path=str(SHOTS / "b5-handoff.png"))

            # restart works (upload lane reset)
            page.click("text=Restart demo")
            page.wait_for_selector("text=Before we scan your papers", timeout=5_000)
            print("PASS  restart returns to welcome")

            browser.close()

    if errors:
        print("\nCONSOLE/PAGE ERRORS:")
        for e in errors[:10]:
            print("  " + e[:300])
        return 1
    print("\nBROWSER CLICK-THROUGH: ALL PASSED, zero console errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
