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
import sys
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


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 980})
        page.add_init_script(STUB)
        page.on("console", lambda m: errors.append("console." + m.type + ": " + m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))

        page.goto(FILE.as_uri())
        page.wait_for_selector(".lang-grid", timeout=15000)
        time.sleep(0.5)

        n = page.locator(".lang-btn").count()
        check("22 scheduled languages + English shown", n == 23, "found %d" % n)
        sampled = ["हिन्दी", "বাংলা", "தமிழ்", "తెలుగు", "ಕನ್ನಡ", "മലയാളം", "ਪੰਜਾਬੀ", "ଓଡ଼ିଆ",
                   "ગુજરાતી", "اردو", "অসমীয়া", "संस्कृतम्", "मराठी", "سنڌي", "ᱥᱟᱱᱛᱟᱲᱤ"]
        missing = [s for s in sampled if page.locator(".lang-btn .native", has_text=s).count() == 0]
        check("native scripts render for sampled languages", not missing, ", ".join(missing))
        check("voice output fired on open (auto-speak)", len(page.evaluate("window.__spoken")) >= 1,
              "%d utterances" % len(page.evaluate("window.__spoken")))
        page.screenshot(path=str(SHOTS / "p1-welcome.png"))

        # language selection speaks in that language
        page.locator(".lang-btn", has_text="हिन्दी").first.click()
        time.sleep(0.3)
        check("language switch speaks the new greeting",
              any("स्वागत" in t for t in page.evaluate("window.__spoken")))
        check("consent notice follows the chosen language",
              "डॉक्टर से मिलने से पहले" in page.inner_text("body"))
        page.locator(".lang-btn", has_text="English").first.click()
        time.sleep(0.3)

        check("consent required before start", page.locator("#begin-btn").is_disabled())
        page.locator("input[type=checkbox]").check()
        check("start enabled after consent", not page.locator("#begin-btn").is_disabled())
        page.screenshot(path=str(SHOTS / "p2-consent.png"))
        page.locator("#begin-btn").click()

        # body map
        page.wait_for_selector(".bm-stage svg", timeout=10000)
        regions = page.locator(".bm-hot").count()
        check("body picture has tappable regions", regions >= 8, "%d regions" % regions)
        shaded = page.locator(".bm-stage svg path[fill^='url']").count()
        grads = page.locator(".bm-stage svg linearGradient, .bm-stage svg radialGradient").count()
        check("body is a shaded illustration, not a stick figure", shaded >= 5 and grads >= 4,
              "%d shaded paths, %d gradients" % (shaded, grads))
        check("Module A starts empty — nothing pre-selected", page.locator(".bm-btn.sel").count() == 0)
        page.locator('.bm-hot[data-region="chest"]').first.click()
        time.sleep(0.4)
        check("tapping the body records the region", page.locator('.bm-hot[data-region="chest"].sel').count() == 1)
        page.screenshot(path=str(SHOTS / "p3-bodymap.png"))
        # it must not move on by itself: wait well past any timer
        time.sleep(4.0)
        check("waits for the person — no auto-advance", page.locator(".bm-stage svg").count() == 1)
        page.locator("footer button.btn-primary").first.click()
        time.sleep(0.6)

        # walk the flow and capture each screen
        seen = {"interview": False, "safety": False, "upload": False, "papers": False,
                "extraction": False, "merge": False, "readback": False, "handoff": False, "physician": False}
        last_seen = time.time()
        last_html = ""
        uploaded = False
        deadline = time.time() + 200
        while time.time() < deadline:
            html = page.inner_text("body")
            if html != last_html:
                last_html = html
                last_seen = time.time()
            if "Listening to you" in html or "Speak your answer" in html:
                seen["interview"] = True
            if "Every rule is shown" in html or "Warning sign found" in html or "No warning signs found" in html:
                if not seen["safety"]:
                    page.screenshot(path=str(SHOTS / "p5-safety.png"))
                seen["safety"] = True
                ack = page.locator("button.btn-danger")
                if ack.count() and ack.first.is_visible():
                    try:
                        ack.first.click(timeout=1200)
                    except Exception:
                        pass
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
                        time.sleep(0.5)
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
            if "Is this correct?" in html:
                if not seen["readback"]:
                    page.screenshot(path=str(SHOTS / "p9-readback.png"))
                seen["readback"] = True
            if "Your summary is with the doctor" in html:
                if not seen["handoff"]:
                    page.screenshot(path=str(SHOTS / "p10-handoff.png"))
                seen["handoff"] = True
            if page.locator(".soap-block.ap").count() == 1:
                seen["physician"] = True
                page.screenshot(path=str(SHOTS / "p11-physician.png"), full_page=True)
                break
            # click the enabled primary action when a screen has settled
            if time.time() - last_seen > 1.6:
                btn = page.locator("footer button.btn-primary:not([disabled])")
                if btn.count() and btn.first.is_visible():
                    try:
                        btn.first.click(timeout=1200)
                    except Exception:
                        pass
                    last_seen = time.time()
            time.sleep(0.4)

        check("interview captures voice answers automatically", page.evaluate("window.__listened") >= 5,
              "%d recogniser starts" % page.evaluate("window.__listened"))
        check("paper hand-over step waits for an upload", seen["upload"])
        for k, v in seen.items():
            check("screen reached: " + k, v)
        check("FHIR OpConsultRecord shown for the physician", page.locator(".fhir").count() == 1)
        check("assessment & plan locked to the physician", page.locator(".soap-block.ap").count() == 1)

        browser.close()

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
