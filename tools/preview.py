"""Serve the real frontend with in-memory sample data and no remote connections."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent


def render_preview():
    html = (ROOT / "frontend/index.html").read_text()
    # Replace external configuration and the SDK before the actual app executes.
    html = re.sub(r'<script\b[^>]*\bsrc="[^"]+"[^>]*>\s*</script>', "", html)
    fixture = (ROOT / "tools/preview-data.js").read_text()
    html = html.replace("</head>", f"<script>{fixture}</script></head>", 1)
    html = html.replace("<h1>MegaKotxea</h1>",
                        '<h1>MegaKotxea · Demo local</h1>'
                        '<p style="text-align:center;font-size:13px">'
                        'Datos ficticios · Los cambios se borran al recargar</p>')
    return html.encode()


class PreviewHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] != "/":
            self.send_error(404)
            return
        content = render_preview()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy",
                         "default-src 'none'; script-src 'unsafe-inline'; "
                         "style-src 'unsafe-inline'; img-src data:; connect-src 'none'")
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler)
    print(f"Dummy preview: http://localhost:{args.port} · Ctrl+C to stop", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
