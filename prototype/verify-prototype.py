"""Headless click-through of the assembled MediKiosk prototype.

Walks the whole guided visit: 23 languages on the opening screen, consent,
the voice-driven interview, the body picture, the safety screen, paper
digitisation, the merged summary, read-back, hand-off and the physician view.
The browser voice engine and recogniser are stubbed so the run is deterministic
and fast; the test still asserts that the app actually calls them.
Fails on any console or page error. Saves screenshots to prototype/screenshots.

Run:  python prototype/verify-prototype.py
"""

import base64
import functools
import http.server
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

# 1x1 PNG, used to exercise the paper hand-over step
PNG_1PX = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

ROOT = Path(__file__).resolve().parent
FILE = ROOT / "medikiosk-prototype.html"
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(exist_ok=True)

STUB = r"""
(() => {
  window.__spoken = [];
  window.__listened = 0;
  const voices = [
    { name: "Microsoft Swara", lang: "hi-IN", default: false, localService: true },
    { name: "Microsoft Ravi", lang: "en-IN", default: true, localService: true },
    { name: "Google US English", lang: "en-US", default: false, localService: false },
  ];
  class FakeUtterance {
    constructor(text) { this.text = text; this.lang = "en-US"; this.rate = 1; this.pitch = 1; this.volume = 1; }
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
  let speaking = false;
  const synth = {
    getVoices: () => voices,
    speak(u) {
      window.__spoken.push(u.text);
      speaking = true;
      setTimeout(() => { speaking = false; u.onend && u.onend({}); }, 25);
    },
    cancel() { speaking = false; },
    pause() {}, resume() {},
    get speaking() { return speaking; },
    get pending() { return false; },
    onvoiceschanged: null,
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  class FakeRecognition {
    constructor() { this.lang = "en-IN"; this.continuous = false; this.interimResults = true; }
    start() {
      window.__listened += 1;
      const self = this;
      setTimeout(() => {
        if (self.onresult) {
          self.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "yes that is correct" }], { isFinal: true })] });
        }
        if (self.onend) self.onend({});
      }, 40);
    }
    stop() { if (this.onend) this.onend({}); }
    abort() {}
  }
  Object.defineProperty(window, "SpeechRecognition", { value: FakeRecognition, configurable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeRecognition, configurable: true });
})();
"""

errors = []
checks = []


def check(name, ok, detail=""):
    checks.append((name, bool(ok), detail))
    print(("  PASS  " if ok else "  FAIL  ") + name + (("  - " + detail) if detail else ""))


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


def main():
    # Serve over loopback, like the presenter setup: file:// pages cannot use
    # the microphone, so the honest test path is http://127.0.0.1.
    server = socketserver.TCPServer(("127.0.0.1", 0), QuietHandler, bind_and_activate=False)
    server.allow_reuse_address = True
    server.server_bind()
    server.server_activate()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/medikiosk-prototype.html" % server.server_address[1]
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # First: a clean page with NO stubs. This is the real browser path, where
        # the voice list arrives asynchronously and may start empty.
        raw = browser.new_page(viewport={"width": 1440, "height": 980})
        raw_errors = []
        raw.on("pageerror", lambda e: raw_errors.append(str(e)))
        raw.on("console", lambda m: raw_errors.append("console." + m.type + ": " + m.text) if m.type == "error" else None)
        raw.goto(base)
        try:
            raw.wait_for_selector(".langRow", timeout=8000)
        except Exception:
            pass
        n_raw = raw.locator(".langTile").count()
        check("boots with no stubs — real browser renders the opening screen", n_raw == 23,
              "%d languages" % n_raw)
        check("no boot errors with the real voice stack", not raw_errors, "; ".join(raw_errors[:3]))
        raw.close()

        page = browser.new_page(viewport={"width": 1440, "height": 980})
        page.add_init_script(STUB)
        page.on("console", lambda m: errors.append("console." + m.type + ": " + m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))

        page.goto(base)
        page.wait_for_selector(".langRow", timeout=15000)
        time.sleep(0.5)

        n = page.locator(".langTile").count()
        check("22 scheduled languages + English shown", n == 23, "found %d" % n)
        sampled = ["हिन्दी", "বাংলা", "தமிழ்", "తెలుగు", "ಕನ್ನಡ", "മലയാളം", "ਪੰਜਾਬੀ", "ଓଡ଼ିଆ",
                   "ગુજરાતી", "اردو", "অসমীয়া", "संस्कृतम्", "मराठी", "سنڌي", "ᱥᱟᱱᱛᱟᱲᱤ"]
        missing = [s for s in sampled if page.locator(".langTile .lMain", has_text=s).count() == 0]
        check("native scripts render for sampled languages", not missing, ", ".join(missing))
        check("voice output fired on open (auto-speak)", len(page.evaluate("window.__spoken")) >= 1,
              "%d utterances" % len(page.evaluate("window.__spoken")))
        check("speaker voice picker lists installed voices",
              page.locator("select.hdrChip option").count() >= 3,
              "%d options" % page.locator("select.hdrChip option").count())
        check("best voice is chosen by default",
              bool(page.evaluate("localStorage.getItem('mk.voice')")))
        check("archived header renders (brand, read-aloud, module chips)",
              page.locator(".hdr .brandMark").count() == 1
              and "Read-aloud" in page.inner_text(".hdr")
              and page.locator(".hdrChips .hdrChip").count() >= 4)
        check("presenter control bar renders",
              "PRESENTER CONTROLS" in page.inner_text("body"))
        page.screenshot(path=str(SHOTS / "p1-welcome.png"))

        # language selection speaks in that language
        page.locator(".langTile", has_text="हिन्दी").first.click()
        time.sleep(0.3)
        check("language switch speaks the new greeting",
              any("स्वागत" in t for t in page.evaluate("window.__spoken")))
        check("consent notice follows the chosen language",
              "डॉक्टर से मिलने से पहले" in page.inner_text("body"))
        page.locator(".langTile", has_text="English").first.click()
        time.sleep(0.3)

        check("consent required before start", page.locator("#begin-btn").is_disabled())
        page.locator("input[type=checkbox]").check()
        check("start enabled after consent", not page.locator("#begin-btn").is_disabled())
        page.screenshot(path=str(SHOTS / "p2-consent.png"))
        page.locator("#begin-btn").click()

        # body map
        page.wait_for_selector(".anatomyImg", timeout=10000)
        check("progress rail renders interview steps", page.locator(".railItem").count() == 8)
        check("conversation log renders beside the question card",
              page.locator(".stage .logCol .log").count() == 1
              and page.locator(".stage .logCol .card").count() == 1)
        regions = page.locator(".anatomyHot").count()
        check("body picture has tappable regions", regions >= 7, "%d regions" % regions)
        src = page.locator(".anatomyImg").first.get_attribute("src") or ""
        check("body is the provided anatomy photo, embedded",
              src.startswith("data:image/png;base64,") and len(src) > 20000,
              "%d chars" % len(src))
        check("Module A starts empty — nothing pre-selected", page.locator(".anatomyHot.sel").count() == 0)
        page.screenshot(path=str(SHOTS / "p3-bodymap.png"))
        # it must not move on by itself: wait well past any timer
        time.sleep(4.0)
        check("waits for the person — no auto-advance", page.locator(".anatomyImg").count() == 1)
        page.locator('.anatomyHot[data-region="chest"]').first.click()
        page.wait_for_selector(".stepTag", timeout=8000)
        time.sleep(0.4)
        check("tapping the body advances the interview", "your story" in page.inner_text(".stepTag").lower())

        def click_first(locator, timeout=1500):
            try:
                if locator.count() and locator.first.is_visible():
                    locator.first.click(timeout=timeout)
                    return True
            except Exception:
                pass
            return False

        # walk the flow the way a patient would: tap answers, type, upload
        seen = {"interview": False, "safety": False, "upload": False, "papers": False,
                "extraction": False, "merge": False, "readback": False, "handoff": False, "physician": False}
        uploaded = False
        deadline = time.time() + 240
        while time.time() < deadline:
            html = page.inner_text("body")
            if "Listening to you" in html or "Speak your answer" in html:
                seen["interview"] = True
            if "Every rule is shown" in html:
                if not seen["safety"]:
                    page.screenshot(path=str(SHOTS / "p5-safety.png"))
                seen["safety"] = True
            if "Hand over the papers you brought" in html:
                if not seen["upload"]:
                    page.screenshot(path=str(SHOTS / "p4-upload.png"))
                seen["upload"] = True
                if not uploaded:
                    fi = page.locator("input[type=file]")
                    if fi.count():
                        fi.set_input_files({
                            "name": "prescription.png", "mimeType": "image/png",
                            "buffer": base64.b64decode(PNG_1PX),
                        })
                        uploaded = True
                        time.sleep(0.6)
            if "Reading your papers" in html or "papers we read" in html:
                if not seen["papers"]:
                    page.screenshot(path=str(SHOTS / "p6-papers.png"))
                seen["papers"] = True
            if "What the kiosk understood" in html:
                if not seen["extraction"]:
                    page.screenshot(path=str(SHOTS / "p7-extraction.png"))
                seen["extraction"] = True
            if "Your history and your papers together" in html:
                if not seen["merge"]:
                    page.screenshot(path=str(SHOTS / "p8-merge.png"))
                seen["merge"] = True
            if "Please check your answers" in html:
                if not seen["readback"]:
                    page.screenshot(path=str(SHOTS / "p9-readback.png"))
                seen["readback"] = True
            if "Your summary is with the doctor" in html:
                if not seen["handoff"]:
                    page.screenshot(path=str(SHOTS / "p10-handoff.png"))
                seen["handoff"] = True
            if page.locator(".locked").count() == 1:
                seen["physician"] = True
                page.screenshot(path=str(SHOTS / "p11-physician.png"), full_page=True)
                break
            # one patient action per pass, in priority order
            if click_first(page.locator(".overlay .btn.danger.big"), timeout=1200):
                pass
            elif page.locator(".detailRow").count() and page.locator(".chipGrid .chip").count():
                chips = page.locator(".chipGrid .chip")
                try:
                    chips.nth(0).click(timeout=1200)
                    chips.nth(1).click(timeout=1200)
                    click_first(page.locator(".card .btnRow .btn:not([disabled])"))
                except Exception:
                    pass
            elif page.locator(".scaleGrid").count():
                try:
                    page.locator(".scaleGrid .scaleBtn", has_text="7").first.click(timeout=1200)
                    click_first(page.locator(".card .btnRow .btn:not([disabled])"))
                except Exception:
                    pass
            elif page.locator(".yesNoRow").count():
                click_first(page.locator(".yesNoRow .chip"))
            elif page.locator(".ccBox").count():
                click_first(page.locator(".ccBox + .chipGrid .chip"))
            elif page.locator("#answer-ta").count():
                try:
                    page.locator("#answer-ta").first.fill("Seene mein dard hai, saans phoolti hai")
                    click_first(page.locator(".inputRow .btn:not(#mic-btn)"))
                except Exception:
                    pass
            elif page.locator(".safetyOk .btnRow .btn").count():
                click_first(page.locator(".safetyOk .btnRow .btn"))
            elif page.locator(".sumConfirm .btn").count():
                click_first(page.locator(".sumConfirm .btn"))
            elif page.locator(".card .btnRow .btn.big:not([disabled])").count():
                click_first(page.locator(".card .btnRow .btn.big:not([disabled])"))
            time.sleep(0.5)

        check("interview captures voice answers automatically", page.evaluate("window.__listened") >= 5,
              "%d recogniser starts" % page.evaluate("window.__listened"))
        check("paper hand-over step waits for an upload", seen["upload"])
        for k, v in seen.items():
            check("screen reached: " + k, v)
        check("FHIR OpConsultRecord shown for the physician", page.locator(".fhirBlock").count() == 1)
        check("assessment & plan locked to the physician", page.locator(".locked").count() == 1)

        browser.close()
    server.shutdown()

    print()
    failed = [c for c in checks if not c[1]]
    for e in errors:
        print("  ERROR " + e)
    print("checks: %d/%d passed" % (len(checks) - len(failed), len(checks)))
    print("console/page errors: %d" % len(errors))
    if failed or errors:
        sys.exit(1)
    print("ALL OK")


if __name__ == "__main__":
    main()
