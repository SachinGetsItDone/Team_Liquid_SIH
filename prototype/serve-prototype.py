"""Serve the MediKiosk prototype over loopback so the microphone is allowed.

Browsers refuse microphone permission to `file://` pages, so voice input only
works when the page is served over http on 127.0.0.1. Everything else in the
prototype works from the file directly.

Run:  python prototype/serve-prototype.py
Stop: Ctrl+C
"""

import http.server
import os
import socket
import socketserver
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INDEX = "medikiosk-prototype.html"
PORTS = range(8010, 8030)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):  # keep the console quiet
        pass


def free_port():
    for port in PORTS:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise SystemExit("no free port in range")


def main():
    port = free_port()
    url = "http://127.0.0.1:%d/%s" % (port, INDEX)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
        print("MediKiosk prototype")
        print("  URL:  " + url)
        print("  Voice: allow the microphone when the browser asks.")
        print("  Stop: Ctrl+C")
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
