"""Browser test for Module A voice wiring (headless Chromium + stubs).

Covers the three failure modes that made "sound not working" undiagnosable:
  1. Welcome-screen voice self-check panel reports origin/engine/voices/mic state.
  2. Kiosk auto-speak: each question is read aloud after Start; header toggle mutes.
  3. Microphone input: recognition final transcript -> clinical excerpt -> textarea.
  4. file:// origin shows the actionable serve-demo.bat instruction (mic is blocked
     there by browser policy, so we must not pretend recognition is running).

speechSynthesis and SpeechRecognition are stubbed from an init script so the test
is deterministic and offline; the stubs record calls on window.__mkSpoken /
window.__mkRec for assertions.
"""
from __future__ import annotations

import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
SHOTS = HERE / "screenshots"
SHOTS.mkdir(exist_ok=True)
PAGE_FILE = (HERE / "module-a-kiosk-demo.html").resolve()

errors: list[str] = []

STUB = """
(() => {
  window.__mkSpoken = [];
  window.__mkCancels = 0;
  window.__mkRec = [];
  const voices = [
    { name: "Test Hindi Voice", lang: "hi-IN", localService: true, voiceURI: "t1", default: false },
    { name: "Test English (India)", lang: "en-IN", localService: true, voiceURI: "t2", default: true },
  ];
  const synth = window.speechSynthesis;
  if (synth) {
    synth.getVoices = () => voices.slice();
    synth.speak = (u) => { window.__mkSpoken.push({ text: String(u && u.text || ""), lang: u && u.lang || "", voice: u && u.voice ? u.voice.name : null }); };
    synth.cancel = () => { window.__mkCancels++; };
    setTimeout(() => { try { synth.dispatchEvent && synth.dispatchEvent(new Event("voiceschanged")); } catch (e) {} }, 30);
  }
  // assigning a plain object to utterance.voice throws (WebIDL interface check),
  // so wrap the constructor with a permissive voice accessor
  const NativeU = window.SpeechSynthesisUtterance;
  if (NativeU) {
    window.SpeechSynthesisUtterance = function (text) {
      const u = new NativeU(text);
      let v = null;
      try { Object.defineProperty(u, "voice", { get: () => v, set: (nv) => { v = nv; }, configurable: true }); } catch (e) {}
      return u;
    };
  }
  function FakeSR() {
    this.lang = null; this.interimResults = false; this.continuous = false; this.maxAlternatives = 1;
    this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null;
    window.__mkRec.push(this);
  }
  FakeSR.prototype.start = function () {
    const self = this;
    this.onstart && this.onstart();
    setTimeout(() => {
      const t = window.__mkFakeTranscript || "doctor sahab I have chest pain since two days and also breathlessness";
      const results = { length: 1, 0: { isFinal: true, 0: { transcript: t } } };
      self.onresult && self.onresult({ results });
      self.onend && self.onend();
    }, 60);
  };
  FakeSR.prototype.stop = function () { this.onend && this.onend(); };
  FakeSR.prototype.abort = function () { this.onend && this.onend(); };
  window.SpeechRecognition = FakeSR;
})();
"""

SYNTH_ONLY_STUB = """
(() => {
  window.__mkSpoken = [];
  const synth = window.speechSynthesis;
  if (synth) {
    synth.getVoices = () => [];
  }
})();
"""


def start_server() -> tuple[http.server.ThreadingHTTPServer, str]:
    handler = functools_handler()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/module-a-kiosk-demo.html"


def functools_handler():
    from functools import partial
    return partial(http.server.SimpleHTTPRequestHandler, directory=str(HERE))


def collect(page) -> None:
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
            if m.type == "error" else None)


def spoken(page) -> list[dict]:
    return page.evaluate("window.__mkSpoken || []")


def main() -> int:
    srv, url = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)

            # ---------- Page A: welcome self-check + auto-speak + mute ----------
            ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
            ctx.add_init_script(STUB)
            page = ctx.new_page()
            collect(page)
            page.goto(url)
            page.wait_for_selector("[data-voicecheck]", timeout=10_000)

            vc = page.locator("[data-voicecheck]")
            vc.scroll_into_view_if_needed()
            page.wait_for_function("""() => {
              const t = document.querySelector('[data-voicecheck]').innerText;
              return t.includes('served over http:')
                && t.includes('Voice input engine') && t.includes('available')
                && t.includes('2 system voices found')
                && t.includes('Hindi voice (for Hindi / Hinglish)') && t.includes('available')
                && t.includes('will be asked on first use')
                && !/Chrome|Edge|Google/.test(t);
            }""", timeout=5_000)
            print("PASS  voice self-check reports origin, engines, voices, mic state (no vendor names)")
            page.screenshot(path=str(SHOTS / "a1-voicecheck.png"))

            page.click("[data-vc-test]")
            page.wait_for_timeout(150)
            assert len(spoken(page)) == 1, f"test sound should speak once, got {spoken(page)}"
            print("PASS  'Test sound' button speaks the sample")

            page.click("text=Start · शुरू करें")
            page.wait_for_selector("text=Point to the pain", timeout=5_000)
            page.wait_for_timeout(300)
            sp = spoken(page)
            assert len(sp) == 2, f"auto-speak should fire once after Start, got {len(sp)}"
            last = sp[-1]
            assert last["lang"] == "hi-IN", f"Hinglish prompt must speak Devanagari via hi-IN, got {last}"
            assert any("\u0900" <= ch <= "\u097f" for ch in last["text"]), f"expected Devanagari text, got {last['text']!r}"
            assert last["voice"] == "Test Hindi Voice", f"explicit Hindi voice must be used, got {last}"
            print("PASS  auto-speak reads the question aloud (Devanagari, hi-IN, chosen voice)")

            # mute -> next question stays silent
            page.click("button.soundChip")
            page.wait_for_selector("text=Read-aloud muted", timeout=5_000)
            page.locator('g.bmRegion').filter(has_text="Chest").first.click()
            page.wait_for_selector("text=Step 2 · Main problem", timeout=5_000)
            page.wait_for_timeout(300)
            assert len(spoken(page)) == 2, f"muted kiosk must not speak, got {spoken(page)}"
            print("PASS  header toggle mutes auto-speak")

            # unmute -> answering advances and the next question is read aloud
            page.click("button.soundChip")
            page.wait_for_selector("text=Read-aloud on", timeout=5_000)
            page.locator(".chip.suggested").first.click()
            page.wait_for_selector("text=SOCRATES · S — Site", timeout=5_000)
            page.wait_for_timeout(300)
            sp = spoken(page)
            assert len(sp) == 3, f"unmuted kiosk must speak the next question, got {len(sp)}"
            print("PASS  unmute restores auto-speak on the next question")
            page.screenshot(path=str(SHOTS / "a2-autospeak.png"))
            ctx.close()

            # ---------- Page B: microphone input -> clinical excerpt ----------
            ctx2 = browser.new_context(viewport={"width": 1440, "height": 1000})
            ctx2.add_init_script(STUB)
            page = ctx2.new_page()
            collect(page)
            page.goto(url + "#shot=interview&script=redflag&lang=en&turn=narrative")
            page.wait_for_selector("textarea", timeout=10_000)
            before_cancels = page.evaluate("window.__mkCancels")
            page.click("button.voiceBtn")
            page.wait_for_selector("text=Kept the clinical excerpt", timeout=10_000)
            val = page.input_value("textarea")
            assert "chest pain" in val, f"clinical content missing from textarea: {val!r}"
            assert not val.lower().startswith("doctor"), f"honorific not stripped: {val!r}"
            recs = page.evaluate("window.__mkRec")
            assert len(recs) == 1 and recs[0]["lang"] == "en-IN", f"recognition locale wrong: {recs}"
            after_cancels = page.evaluate("window.__mkCancels")
            assert after_cancels > before_cancels, "starting the mic must stop any playing prompt"
            print("PASS  mic input: en-IN recognition -> excerpt kept, honorific stripped, prompt stopped")

            page.click("button:has-text('Send')")
            page.wait_for_selector("text=Step 2 · Main problem", timeout=5_000)
            print("PASS  spoken answer submits and advances the interview")
            page.screenshot(path=str(SHOTS / "a3-voiceinput.png"))
            ctx2.close()

            # ---------- Page C: file:// origin -> actionable instruction ----------
            ctx3 = browser.new_context(viewport={"width": 1440, "height": 1000})
            ctx3.add_init_script(SYNTH_ONLY_STUB)
            page = ctx3.new_page()
            collect(page)
            page.goto(PAGE_FILE.as_uri() + "#shot=interview&script=redflag&lang=en&turn=narrative")
            page.wait_for_selector("textarea", timeout=10_000)
            page.click("button.voiceBtn")
            page.wait_for_selector("text=serve-demo.bat", timeout=5_000)
            started = page.evaluate("window.__mkRec ? window.__mkRec.length : 0")
            assert started == 0, "file:// page must not attempt recognition (it can never succeed)"
            print("PASS  file:// origin explains the mic block instead of failing silently")
            ctx3.close()

            browser.close()
    finally:
        srv.shutdown()

    if errors:
        print("\nCONSOLE/PAGE ERRORS:")
        for e in errors[:10]:
            print("  " + e[:300])
        return 1
    print("\nMODULE A VOICE BROWSER TEST: ALL PASSED, zero console errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
