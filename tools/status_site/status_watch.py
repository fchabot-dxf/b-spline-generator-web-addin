"""status_watch.py — token-free progress page for the advisor/worker loop.

Reads (never writes) the loop's own files — both HANDOFF.md seats, ROADMAP.md
section headings, recent git commits on main + lane-b — renders PROGRESS.md +
index.html into ./out, and deploys ./out to its own Cloudflare Pages project
ONLY when the rendered content changed. No Claude involved.

Run:  python tools/status_site/status_watch.py          (loop, every 60 s)
      python tools/status_site/status_watch.py --once   (render + deploy once)
Env:  CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from the repo's .env
      (never printed). Project: STATUS_PROJECT below.
"""
import hashlib, html, os, re, shutil, subprocess, sys, time
from datetime import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SEATS = [  # declared: which checkout is which seat, and its task file (checklist = progress)
    {"name": "Seat A", "path": ROOT, "branch": "main", "task": "NEXT-SESSION.md"},
    {"name": "Seat B", "path": ROOT + "-lane-b", "branch": "lane-b", "task": "NEXT-SESSION-lane-b.md"},
]


def _checklist(path, task, branch):
    """(done, total): items are the task file's `[TAG]` checklist lines; an item is DONE when any commit on the
    seat's branch has `[TAG]` in its subject. Fully automatic — nobody ticks anything."""
    f = os.path.join(path, task)
    if not os.path.exists(f):
        return 0, 0
    tags = re.findall(r"^\s*- \[[ xX]\] \[([A-Za-z0-9_-]+)\]", open(f, encoding="utf-8", errors="replace").read(), re.M)
    if not tags:
        return 0, 0
    subjects = _git(ROOT, "log", "--format=%s", "-300", "origin/" + branch) + _git(path, "log", "--format=%s", "-300")
    norm = lambda x: re.sub(r"[\s_-]+", " ", x).strip().lower()
    # advisor dispatch/doc commits mention the same tags — only real work commits count
    subj = norm("
".join(l for l in subjects.splitlines() if not re.match(r"\s*docs", l, re.I)))
    # a tag counts when its words appear as a whole phrase in any commit subject ("T74-AMEND-0" ~ "T74 AMEND 0 ...")
    return sum(bool(re.search(r"(?<![a-z0-9])" + re.escape(norm(t)) + r"(?![a-z0-9])", subj)) for t in tags), len(tags)


def _bar(done, total, width=10):
    if not total:
        return "no checklist"
    n = round(width * done / total)
    return "█" * n + "░" * (width - n) + f"  {done}/{total}"
STATUS_PROJECT = "bspline-status"
OUT = os.path.join(os.path.dirname(__file__), "out")
INTERVAL_S = 60


def _env():
    envp = os.path.join(ROOT, ".env")
    if os.path.exists(envp):
        for line in open(envp, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def _git(path, *args):
    try:
        return subprocess.run(["git", "-C", path, *args], capture_output=True, text=True, timeout=30,
                              encoding="utf-8", errors="replace").stdout
    except Exception:
        return ""


def _handoff(path):
    f = os.path.join(path, "HANDOFF.md")
    d = {}
    if os.path.exists(f):
        for line in open(f, encoding="utf-8", errors="replace"):
            if ":" in line:
                k, v = line.split(":", 1)
                d[k.strip()] = v.strip()
    return d


def _roadmap():
    f = os.path.join(ROOT, "ROADMAP.md")
    items = []
    if os.path.exists(f):
        for line in open(f, encoding="utf-8", errors="replace"):
            m = re.match(r"^## (Queued|In progress|Done)([^—]*)— (.+)$", line.rstrip())
            if m:
                items.append((m.group(1), m.group(2).strip(" ()"), m.group(3)[:110]))
    return items


def collect():
    _git(ROOT, "fetch", "-q", "origin")
    seats = []
    for s in SEATS:
        h = _handoff(s["path"])
        who = "worker (working)" if h.get("to") == "worker" else "advisor (reviewing)"
        d, t = _checklist(s["path"], s["task"], s["branch"])
        seats.append({**s, "turn": h.get("turn", "?"), "who": who, "note": h.get("note", ""),
                      "updated": h.get("updated", ""), "done": d, "total": t})
    commits = {b: _git(ROOT, "log", "--format=%h|%cr|%s", "-8", "origin/" + b).strip().splitlines() for b in ("main", "lane-b")}
    return seats, commits, _roadmap()


def render(seats, commits, roadmap):
    md = ["# B-Spline — progress", ""]
    for s in seats:
        md += [f"## {s['name']} ({s['branch']}) — turn {s['turn']}, ball: {s['who']}", f"Task: {_bar(s['done'], s['total'])}",
               f"{s['note']}", f"_updated {s['updated']}_", ""]
    for b, cs in commits.items():
        md += [f"## Recent commits — {b}"] + [f"- `{c.split('|')[0]}` {c.split('|')[2]} ({c.split('|')[1]})" for c in cs if c.count("|") >= 2] + [""]
    body = "\n".join(md)
    e = html.escape

    def hbar(done, total, label):
        if not total:
            return f'<div class="bar"><span class="lbl">{e(label)}: no checklist</span></div>'
        pct = round(100 * done / total)
        return (f'<div class="bar"><div class="track"><div class="fill" style="width:{pct}%"></div></div>'
                f'<span class="lbl">{e(label)} {done}/{total} · {pct}%</span></div>')
    cards = "".join(
        f'<section class="seat"><h2>{e(s["name"])} <small>{e(s["branch"])} · turn {e(s["turn"])}</small></h2>'
        f'<p class="ball {"w" if "worker" in s["who"] else "a"}">{e(s["who"])}</p>'
        f'{hbar(s["done"], s["total"], "task")}<p>{e(s["note"])}</p>'
        f'<p class="t">updated {e(s["updated"])}</p></section>' for s in seats)
    def lst(rows, cls):
        return "".join(f'<li class="{cls}">{e(r[2])}{" <em>" + e(r[1]) + "</em>" if r[1] else ""}</li>' for r in rows)
    com = "".join(f'<details><summary>Commits — {e(b)} ({len(cs)})</summary><ul class="c">' + "".join(
        f'<li><code>{e(c.split("|")[0])}</code> {e(c.split("|")[2])} <span>{e(c.split("|")[1])}</span></li>'
        for c in cs if c.count("|") >= 2) + "</ul></details>" for b, cs in commits.items())
    page = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>B-Spline progress</title><style>
:root{{--bg:#f6f7f9;--fg:#1c2330;--mut:#667085;--card:#fff;--w:#1d6fd8;--a:#b86a00;--line:#e3e6eb}}
@media(prefers-color-scheme:dark){{:root{{--bg:#12151b;--fg:#e6e9ef;--mut:#98a2b3;--card:#1b2029;--line:#2a313c}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;padding:16px;max-width:900px;margin-inline:auto}}
h1{{font-size:20px;margin:4px 0 14px}} h2{{font-size:15px;margin:18px 0 6px}} small,.t,span,em{{color:var(--mut);font-size:12px;font-style:normal}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}}
.seat{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}} .seat h2{{margin-top:0}}
.ball{{font-weight:700;margin:4px 0}} .ball.w{{color:var(--w)}} .ball.a{{color:var(--a)}}
.bar{{margin:8px 0}} .track{{height:8px;background:var(--line);border-radius:4px;overflow:hidden}}
.fill{{height:100%;background:var(--w)}} .lbl{{font-size:12px;color:var(--mut)}}
details{{margin:14px 0}} summary{{font-weight:700;cursor:pointer}}
ul{{padding-left:18px;margin:4px 0}} li{{margin:3px 0}} li.d{{color:var(--mut)}} code{{font-size:12px}}
</style></head><body><h1>B-Spline generator — progress <small>generated {datetime.now():%Y-%m-%d %H:%M}</small></h1>
<div class="grid">{cards}</div>{com}</body></html>"""
    return body, page


def _wrangler():
    for c in (shutil.which("wrangler"), shutil.which("wrangler.cmd"),
              os.path.expandvars(r"%APPDATA%\npm\wrangler.cmd")):
        if c and os.path.exists(c):
            return c
    return None


def deploy():
    w = _wrangler()
    if not w or not os.environ.get("CLOUDFLARE_API_TOKEN"):
        print("status: wrangler or CLOUDFLARE_API_TOKEN missing — rendered locally only")
        return False
    r = subprocess.run([w, "pages", "deploy", OUT, "--project-name", STATUS_PROJECT, "--branch", "main",
                        "--commit-dirty=true"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    ok = r.returncode == 0
    print(f"status: deploy {'ok' if ok else 'FAILED'} {datetime.now():%H:%M:%S}")
    if not ok:
        print((r.stderr or r.stdout)[-400:])
    return ok


def once(last_hash=None):
    seats, commits, roadmap = collect()
    md, page = render(seats, commits, roadmap)
    h = hashlib.sha1((md).encode()).hexdigest()   # content only (not the timestamp)
    if h == last_hash:
        return h
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "PROGRESS.md"), "w", encoding="utf-8").write(md)
    open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(page)
    return h if deploy() else last_hash


if __name__ == "__main__":
    _env()
    h = once()
    while "--once" not in sys.argv:
        time.sleep(INTERVAL_S)
        try:
            h = once(h)
        except Exception as ex:
            print("status: error", ex)
