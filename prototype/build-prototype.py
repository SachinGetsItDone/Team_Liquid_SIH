"""Assemble the MediKiosk prototype into ONE self-contained HTML file.

Reads the editable sources in prototype/medikiosk-src/ and writes
prototype/medikiosk-prototype.html. The output needs no server, no network and
no build step at run time — it is a single file that can be opened directly, or
served over localhost when the microphone is wanted.

Run:  python prototype/build-prototype.py
"""

from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "medikiosk-src"
OUT = HERE / "medikiosk-prototype.html"

PARTS = ["languages.js", "content.js", "body.js", "app.js"]

HTML_HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light" />
<meta name="description" content="MediKiosk — patient self check-in for OPD: voice and touch history, paper digitisation, and a physician-ready summary." />
<title>MediKiosk — OPD self check-in</title>
<style>
{css}
</style>
</head>
<body class="kiosk">
<a class="skip" href="#pane">Skip to content</a>
<header class="app-header" id="kiosk-header"></header>
<div class="progress-wrap" id="progress"></div>
<main class="screen" id="pane" role="main" aria-live="polite"></main>
<footer class="footer-bar" id="footer"></footer>
<div id="sound-hint" class="sound-hint hidden">Tap once anywhere to start the voice</div>
<noscript><p style="padding:30px">This prototype needs JavaScript enabled.</p></noscript>
<script>
{js}
</script>
</body>
</html>
"""


def read(name: str) -> str:
    return (SRC / name).read_text(encoding="utf-8")


def main() -> None:
    css = read("style.css")
    js = "\n\n".join("/* ===== " + p + " ===== */\n" + read(p) for p in PARTS)
    # A literal </script> inside injected JS would close the tag early.
    js = js.replace("</script", "<\\/script")
    html = HTML_HEAD.format(css=css, js=js)
    OUT.write_text(html, encoding="utf-8")
    size = OUT.stat().st_size
    print("wrote %s (%d bytes, %.1f KB)" % (OUT.name, size, size / 1024))
    print("open:  file://%s" % OUT)
    print("mic:   python prototype/serve-prototype.py")


if __name__ == "__main__":
    main()
