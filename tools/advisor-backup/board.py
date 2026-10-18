"""board.py -- post to the shared progress board (https://progress-board.dansemur.workers.dev, repo
fchabot-dxf/progress-board, README = schema). The push key is read at runtime from
~/.ddcs-bridge/progress-push-key.txt and is never printed, logged or written anywhere else.

  python board.py status '<json without "project">'   -> POST /status  (project "bspline" added)
  python board.py pc '<json>'                         -> POST /pc      (holder/what/pct/eta/since)
  python board.py pc-clear                            -> POST /pc {"holder": ""}
Exit 0 on HTTP 2xx; prints only the status code (never the URL, which carries the key).
"""
import json, os, sys, urllib.request

BASE = "https://progress-board.dansemur.workers.dev"
KEY_FILE = os.path.join(os.path.expanduser("~"), ".ddcs-bridge", "progress-push-key.txt")


def post(path, body):
    key = open(KEY_FILE, encoding="utf-8").read().strip()
    req = urllib.request.Request(f"{BASE}{path}?k={key}", data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (bspline advisor board)"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f"board {path}: {r.status}")
            return 0
    except urllib.error.HTTPError as e:
        print(f"board {path}: {e.code}")
        return 1
    except Exception as e:  # network down: the board is display only, never block the caller
        print(f"board {path}: error {type(e).__name__}")
        return 1


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "status":
        sys.exit(post("/status", {"project": "bspline", **json.loads(sys.argv[2])}))
    if cmd == "pc":
        sys.exit(post("/pc", json.loads(sys.argv[2])))
    if cmd == "pc-clear":
        sys.exit(post("/pc", {"holder": ""}))
    print(__doc__)
    sys.exit(2)
