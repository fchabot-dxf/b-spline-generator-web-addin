"""serve_app.py — serve THIS checkout's app locally WITH its stylesheets, for headless screenshots.

The palette links its CSS as ../../styles/<name>.css (the deploy script rewrites that on publish). Serving only
b-spline-gen/html/ puts styles/ out of reach and every screenshot renders unstyled. Serving bspline-frame-builder/
as the root keeps the relative path valid.

    python tools/serve_app.py [port]        (default 8780; run from any worktree)
    -> http://127.0.0.1:<port>/b-spline-gen/html/bspline_gen_palette.html
"""
import functools, http.server, os, socketserver, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bspline-frame-builder")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8780

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.abspath(ROOT))
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"http://127.0.0.1:{PORT}/b-spline-gen/html/bspline_gen_palette.html", flush=True)
    httpd.serve_forever()
