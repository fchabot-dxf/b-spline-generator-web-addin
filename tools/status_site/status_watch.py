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
import glob, hashlib, html, json, os, re, shutil, subprocess, sys, time
from datetime import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# Declared seats (tools/status_site/seats.json): each names its STATION. Seats on this watcher's own station are read
# from their local checkout; seats on another station from origin (their HANDOFF.md never leaves that machine).
STATION = os.environ.get("BSPLINE_STATION", "home-pc")
_SEATS_DOC = json.load(open(os.path.join(os.path.dirname(__file__), "seats.json"), encoding="utf-8"))
STATIONS = _SEATS_DOC["stations"]
SEATS = [{**s, "path": (ROOT + s.get("checkout", "")) if s["station"] == STATION else None} for s in _SEATS_DOC["seats"]]


def _checklist(path, task, branch):
    """(done, total): items are the task file's `[TAG]` checklist lines; an item is DONE when any commit on the
    seat's branch has `[TAG]` in its subject. Fully automatic — nobody ticks anything."""
    text = _task_text(path, task, branch)
    tags = re.findall(r"^\s*- \[[ xX]\] \[([A-Za-z0-9_-]+)\]", text, re.M)
    if not tags:
        return 0, 0
    subjects = _git(ROOT, "log", "--format=%s", "-300", "origin/" + branch) + (_git(path, "log", "--format=%s", "-300") if path else "")
    norm = lambda x: re.sub(r"[\s_-]+", " ", x).strip().lower()
    # advisor dispatch/doc commits mention the same tags — only real work commits count
    work = [l for l in subjects.splitlines() if not re.match(r"\s*docs", l, re.I)]
    subj = norm(" | ".join(work))
    # a tag counts when its words appear as a whole phrase in any commit subject ("T74-AMEND-0" ~ "T74 AMEND 0 ...")
    return sum(bool(re.search(r"(?<![a-z0-9])" + re.escape(norm(t)) + r"(?![a-z0-9])", subj)) for t in tags), len(tags)


def _task_text(path, task, branch):
    """A seat's task file: from its checkout, or (remote seat, path None) from origin."""
    if path is None:
        return _git(ROOT, "show", "origin/" + branch + ":" + task)
    f = os.path.join(path, task)
    return open(f, encoding="utf-8", errors="replace").read() if os.path.exists(f) else ""


def _remote_state(s):
    """What a remote seat's HANDOFF.md would say, reconstructed from origin: the task file's Ball line + its last commit."""
    ball = re.search(r"\*\*Ball:\s*([^*]+)\*\*", _task_text(None, s["task"], s["branch"]))
    last = next((l for l in _git(ROOT, "log", "--format=%cr|%s", "-100", "origin/" + s["branch"]).splitlines()
                 if re.match(s["commits"], l.split("|", 1)[1])), "")
    when, subj = (last.split("|", 1) + [""])[:2] if last else ("", "")
    return {"turn": "-", "who": "remote (" + STATIONS.get(s["station"], s["station"]) + ")", "note": (ball.group(1).strip() if ball else "") +
            (f"  | last: {subj}" if subj else ""), "updated": when}


def _session_url(seat):
    """A seat's Claude link: its declared url, or its local session's CURRENT Remote Control id (looked up by name)."""
    if seat.get("url"):
        return seat["url"]
    if not seat.get("session"):
        return ""
    for f in glob.glob(os.path.join(os.path.expanduser("~"), ".claude", "sessions", "*.json")):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        if d.get("name") == seat["session"] and d.get("bridgeSessionId"):
            return "https://claude.ai/code/" + d["bridgeSessionId"]
    return ""


def _bar(done, total, width=10):
    if not total:
        return "no checklist"
    n = round(width * done / total)
    return "█" * n + "░" * (width - n) + f"  {done}/{total}"
STATUS_PROJECT = "bspline-status"
OUT = os.path.join(os.path.dirname(__file__), "out")
# no console window flashing for git/wrangler children when run under pythonw (Fred: "a terminal window constantly spawning")
NOWIN = {"creationflags": 0x08000000} if os.name == "nt" else {}
INTERVAL_S = 60
# declared screenshot drop folder: workers save <seat key>/<HHMM>_<tag>_<what>.png here; newest SHOTS_PER_SEAT are published
SHOTS_DIR = os.path.join(os.path.expanduser("~"), ".bspline-status", "shots")
SHOTS_PER_SEAT = 60   # published per seat (newest first); the lightbox swipes through all of them
SHOTS_THUMBS = 6      # thumbnails shown in the seat card grid


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
        return subprocess.run(["git", "-C", path, *args], capture_output=True, text=True, timeout=30, **NOWIN,
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
        if s["path"] is None:
            r = _remote_state(s)
            h, who = r, r["who"]
        else:
            h = _handoff(s["path"])
            who = ("finished (stood down)" if h.get("to") == "done"
                   else "worker (working)" if h.get("to") == "worker" else "advisor (reviewing)")
        d, t = _checklist(s["path"], s["task"], s["branch"])
        if who.startswith("finished") and t:
            d = t
        sd = os.path.join(SHOTS_DIR, s["key"])
        shots = sorted((f for f in (os.listdir(sd) if os.path.isdir(sd) else []) if f.lower().endswith((".png", ".jpg", ".jpeg"))),
                       key=lambda f: os.path.getmtime(os.path.join(sd, f)), reverse=True)[:SHOTS_PER_SEAT]
        seats.append({**s, "url": _session_url(s), "turn": h.get("turn", "?"), "who": who, "note": h.get("note", ""),
                      "updated": h.get("updated", ""), "done": d, "total": t, "shots": shots})
    commits = {b: _git(ROOT, "log", "--format=%h|%cr|%s", "-8", "origin/" + b).strip().splitlines() for b in ("main", "lane-b", "fb-app")}
    return seats, commits, _roadmap()


def render(seats, commits, roadmap):
    md = ["# B-Spline — progress", ""]
    for s in seats:
        md += [f"## {s['name']} ({s['branch']}) — turn {s['turn']}, ball: {s['who']}", f"Task: {_bar(s['done'], s['total'])}",
               f"{s['note']}", f"_updated {s['updated']}_"] + [f"- shot: {x}" for x in s["shots"]] + [""]
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
    card = lambda s: (
        f'<section class="seat"><h2>{(f'<a href="{e(s["url"])}" target="_blank" rel="noopener">{e(s["name"])} ↗</a>' if s.get("url") else e(s["name"]))} <small>{e(s["branch"])} · turn {e(s["turn"])}</small></h2>'
        f'<p class="ball {"w" if "worker" in s["who"] else "a"}">{e(s["who"])}</p>'
        f'{hbar(s["done"], s["total"], "task")}<p>{e(s["note"])}</p>'
        f'<p class="t">updated {e(s["updated"])}</p>'
        + ('<div class="shots">' + "".join(f'<img class="thumb{" more" if i >= SHOTS_THUMBS else ""}" src="shots/{e(s["key"])}/{e(x)}" alt="{e(x)}" title="{e(x)}" loading="lazy" tabindex="0">' for i, x in enumerate(s["shots"]))
           + (f'<span class="morec">+{len(s["shots"]) - SHOTS_THUMBS} more, swipe in the viewer</span>' if len(s["shots"]) > SHOTS_THUMBS else "") + "</div>" if s["shots"] else "")
        + '</section>')
    cards = "".join(f'<h2 class="station">{e(STATIONS.get(st, st))}</h2><div class="grid">'
                    + "".join(card(s) for s in seats if s["station"] == st) + "</div>"
                    for st in STATIONS if any(s["station"] == st for s in seats))
    def lst(rows, cls):
        return "".join(f'<li class="{cls}">{e(r[2])}{" <em>" + e(r[1]) + "</em>" if r[1] else ""}</li>' for r in rows)
    com = "".join(f'<details><summary>Commits — {e(b)} ({len(cs)})</summary><ul class="c">' + "".join(
        f'<li><code>{e(c.split("|")[0])}</code> {e(c.split("|")[2])} <span>{e(c.split("|")[1])}</span></li>'
        for c in cs if c.count("|") >= 2) + "</ul></details>" for b, cs in commits.items())
    page = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>B-Spline progress</title><style>
:root{{--bg:#f6f7f9;--fg:#1c2330;--mut:#667085;--card:#fff;--w:#1d6fd8;--a:#b86a00;--line:#e3e6eb}}
@media(prefers-color-scheme:dark){{:root{{--bg:#12151b;--fg:#e6e9ef;--mut:#98a2b3;--card:#1b2029;--line:#2a313c}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;padding:16px;max-width:900px;margin-inline:auto}}
h1{{font-size:20px;margin:4px 0 14px}} h2{{font-size:15px;margin:18px 0 6px}} small,.t,span,em{{color:var(--mut);font-size:12px;font-style:normal}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}}
.seat{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}} .seat h2{{margin-top:0}}
.ball{{font-weight:700;margin:4px 0}} .ball.w{{color:var(--w)}} .ball.a{{color:var(--a)}}
.bar{{margin:8px 0}} .track{{height:8px;background:var(--line);border-radius:4px;overflow:hidden}}
.fill{{height:100%;background:var(--w)}} .lbl{{font-size:12px;color:var(--mut)}}
img.thumb{{cursor:pointer}} dialog#lb{{border:0;padding:0;margin:0;background:transparent;width:100vw;height:100vh;max-width:100vw;max-height:100vh;overflow:hidden}} dialog#lb::backdrop{{background:rgba(0,0,0,.8)}}
dialog#lb img{{max-width:96vw;max-height:88vh;display:block;border-radius:6px;cursor:pointer}} dialog#lb figcaption{{color:#ddd;font-size:12px;text-align:center;padding-top:4px}}
dialog#lb figure{{margin:0;position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;touch-action:none}} .nav{{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.45);color:#fff;border:0;font-size:28px;width:44px;height:64px;border-radius:8px;cursor:pointer}} @keyframes lbDown{{from{{transform:translateY(var(--dy,0px))}}to{{transform:translateY(100vh)}}}}
dialog#lb.down figure{{animation:lbDown .17s ease-in forwards}}
@media(prefers-reduced-motion:reduce){{dialog#lb.down figure{{animation-duration:1ms}}}}
.nav.p{{left:4px}} .nav.n{{right:4px}} #lbInk{{position:absolute;display:none;touch-action:none;cursor:crosshair}} .mk{{position:absolute;top:6px;left:6px;display:flex;gap:6px}} .mk button{{background:rgba(0,0,0,.55);color:#fff;border:0;font-size:19px;width:40px;height:40px;border-radius:50%;cursor:pointer}} .mk .mko{{display:none}} .mk.on .mko{{display:inline-block}} .mk.on #mkPen{{background:#d32f2f}} .x{{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);color:#fff;border:0;font-size:20px;width:40px;height:40px;border-radius:50%;cursor:pointer}}
.shots img.more{{display:none}} .morec{{grid-column:1/-1;font-size:12px;color:var(--mut)}}
.shots{{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}} .shots img{{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;border:1px solid var(--line)}}
details{{margin:14px 0}} summary{{font-weight:700;cursor:pointer}}
ul{{padding-left:18px;margin:4px 0}} li{{margin:3px 0}} li.d{{color:var(--mut)}} code{{font-size:12px}}
</style></head><body><h1>B-Spline generator — progress <small>generated {datetime.now():%Y-%m-%d %H:%M}</small></h1>
{cards}{com}
<dialog id="lb"><figure><img id="lbImg" alt=""><button class="x" id="lbClose" aria-label="Close">&#10005;</button><canvas id="lbInk"></canvas><div class="mk" id="lbMk"><button id="mkPen" aria-label="Draw" title="Draw">&#9998;</button><button id="mkUndo" class="mko" aria-label="Undo" title="Undo">&#8630;</button><button id="mkClear" class="mko" aria-label="Clear" title="Clear">&#128465;</button><button id="mkSave" class="mko" aria-label="Copy image" title="Copy image">&#128203;</button></div><figcaption id="lbCap"></figcaption></figure></dialog>
<script>
const lb=document.getElementById('lb'), im=document.getElementById('lbImg'), cap=document.getElementById('lbCap');
let set=[], idx=0;
function show(){{ zr(); if(typeof inkReset==='function') inkReset(); const t=set[idx]; im.src=t.src; cap.textContent=(idx+1)+' / '+set.length+'  ·  '+t.alt; }}
function openShot(t){{ set=[...t.closest('.shots').querySelectorAll('img.thumb')]; idx=set.indexOf(t); lb.classList.remove('down');
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches, pre=new Image(); pre.src=t.src;
  const go=()=>{{ show(); fig.style.transform=''; lb.showModal(); lb.scrollTop=0;
    if(!reduce) fig.animate([{{transform:'translateY(100vh)'}},{{transform:'translateY(0)'}}],{{duration:190,easing:'cubic-bezier(.2,.8,.2,1)'}}); }};
  (pre.decode?pre.decode():Promise.resolve()).then(go,go); }}
const fig=lb.querySelector('figure');
function slideClose(dy){{ if(!lb.open||lb.classList.contains('down')) return; fig.style.setProperty('--dy',(dy||0)+'px'); fig.style.transform=''; lb.classList.add('down');
  const done=()=>{{ lb.classList.remove('down'); fig.style.removeProperty('--dy'); lb.close(); }}; fig.addEventListener('animationend',done,{{once:true}}); setTimeout(()=>{{ if(lb.open) done(); }},300); }}
let lastPtr='mouse'; document.addEventListener('pointerdown',ev=>{{ lastPtr=ev.pointerType||'mouse'; }},true);
let stepping=false;
function step(d,fromX){{ if(!set.length||stepping) return; const f=lb.querySelector('figure'); const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const swap=()=>{{ idx=(idx+d+set.length)%set.length; show(); }};
  if(reduce||!f.animate){{ f.style.transform=''; swap(); return; }}
  stepping=true; const w=innerWidth, x0=fromX||0;
  f.style.transform=''; f.animate([{{transform:'translateX('+x0+'px)'}},{{transform:'translateX('+(-d*w)+'px)'}}],{{duration:150,easing:'ease-in',fill:'forwards'}});
  setTimeout(()=>{{ f.getAnimations().forEach(a=>a.cancel()); swap();     // timer-driven, never waits on animation events
    f.animate([{{transform:'translateX('+(d*w)+'px)'}},{{transform:'translateX(0)'}}],{{duration:170,easing:'cubic-bezier(.2,.8,.2,1)'}});
    setTimeout(()=>{{ stepping=false; }},180); }},150); }}
document.getElementById('lbClose').addEventListener('click',ev=>{{ev.stopPropagation();slideClose(0);}});
document.addEventListener('click',ev=>{{ if(drawOn && ev.target.closest('dialog')) return; const t=ev.target.closest('img.thumb'); if(t){{ openShot(t); }} else if(lb.open && ev.target.closest('dialog') && !ev.target.closest('#lbClose') && !moved){{
    if(lastPtr==='mouse' && ev.target!==im){{ slideClose(0); }}           // mouse: click outside the image closes
    else if(zs===1){{ step(ev.clientX<innerWidth/2?-1:1); }} }} }});
document.addEventListener('keydown',ev=>{{ if(lb.open){{ if(ev.key==='ArrowRight'){{step(1);ev.preventDefault();}} else if(ev.key==='ArrowLeft'){{step(-1);ev.preventDefault();}} return; }}
  const t=ev.target.closest&&ev.target.closest('img.thumb'); if(t&&(ev.key==='Enter'||ev.key===' ')){{ev.preventDefault();openShot(t);}} }});
// zoom + pan: pinch + one-finger pan (touch), wheel + drag (mouse); no double-tap (Fred); swipe changes image only at 1x; swipe changes image only at 1x
let zs=1, zx=0, zy=0, moved=false, x0=null, y0=null, pd=0, ps=1, drag=null;
function za(){{ const tf='translate('+zx+'px,'+zy+'px) scale('+zs+')'; im.style.transform=tf; if(typeof ink!=='undefined') ink.style.transform=tf; im.style.cursor=zs>1?'grab':''; }}
function zr(){{ zs=1; zx=0; zy=0; za(); }}
im.style.transformOrigin='center center'; im.style.transition='none';
function zoomAt(ns,cx,cy){{ const r=im.getBoundingClientRect(), ox=cx-(r.left+r.width/2), oy=cy-(r.top+r.height/2);
  ns=Math.max(1,Math.min(6,ns)); const k=ns/zs; zx=zx*k-ox*(k-1); zy=zy*k-oy*(k-1); zs=ns; if(zs===1){{zx=0;zy=0;}} za(); }}
const dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
const mid=t=>({{x:(t[0].clientX+t[1].clientX)/2,y:(t[0].clientY+t[1].clientY)/2}});
// two fingers = pinch AND pan, in normal and markup mode (Fred): the image point under the fingers' start midpoint stays under their current midpoint
let m0=null, zx0=0, zy0=0, C0=null;
function twoFinger(t){{ const m=mid(t), ns=Math.max(1,Math.min(6,ps*dist(t)/pd));
  const ux=(m0.x-C0.x-zx0)/ps, uy=(m0.y-C0.y-zy0)/ps; zs=ns; zx=m.x-C0.x-ns*ux; zy=m.y-C0.y-ns*uy; za(); }}
lb.addEventListener('touchstart',ev=>{{ if(drawOn && ev.touches.length<2) return; moved=false;
  if(ev.touches.length===2){{ pd=dist(ev.touches); ps=zs; x0=null; m0=mid(ev.touches); zx0=zx; zy0=zy;
    const r=im.getBoundingClientRect(); C0={{x:r.left+r.width/2-zx, y:r.top+r.height/2-zy}}; return; }}
  x0=ev.touches[0].clientX; y0=ev.touches[0].clientY; drag={{x:zx,y:zy}}; }},{{passive:true}});
lb.addEventListener('touchmove',ev=>{{ if(drawOn && !(ev.touches.length===2 && pd)) return;
  if(ev.touches.length===2&&pd&&m0){{ twoFinger(ev.touches); moved=true; ev.preventDefault(); return; }}
  if(zs===1&&x0!==null&&ev.touches.length===1){{ const ddy=ev.touches[0].clientY-y0, ddx=ev.touches[0].clientX-x0; if(ddy>0&&ddy>Math.abs(ddx)){{ fig.style.transform='translateY('+ddy+'px)'; moved=true; ev.preventDefault(); return; }}
    if(Math.abs(ddx)>Math.abs(ddy)&&!stepping){{ fig.style.transform='translateX('+ddx+'px)'; moved=true; ev.preventDefault(); return; }} }}
  if(zs>1&&x0!==null&&drag){{ zx=drag.x+ev.touches[0].clientX-x0; zy=drag.y+ev.touches[0].clientY-y0; za(); moved=true; ev.preventDefault(); }} }},{{passive:false}});
lb.addEventListener('touchend',ev=>{{ if(drawOn && !pd) return;
  if(ev.touches.length>0) return; setTimeout(()=>{{moved=false;}},350); if(pd){{ pd=0; m0=null; x0=null; return; }}
  if(x0===null) return; const dx=ev.changedTouches[0].clientX-x0, dy=ev.changedTouches[0].clientY-y0; x0=null;
  if(zs===1 && dy>90 && dy>Math.abs(dx)){{ moved=true; slideClose(dy); return; }}
  if(zs===1 && Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)){{ step(dx<0?1:-1,dx); moved=true; ev.preventDefault(); return; }}
  fig.style.transform='';
  }});
lb.addEventListener('wheel',ev=>{{ ev.preventDefault(); zoomAt(zs*(ev.deltaY<0?1.2:1/1.2),ev.clientX,ev.clientY); }},{{passive:false}});
im.addEventListener('mousedown',ev=>{{ if(drawOn||zs===1) return; ev.preventDefault(); moved=false; drag={{mx:ev.clientX,my:ev.clientY,x:zx,y:zy}};
  const mv=e=>{{ zx=drag.x+e.clientX-drag.mx; zy=drag.y+e.clientY-drag.my; if(Math.abs(e.clientX-drag.mx)+Math.abs(e.clientY-drag.my)>3) moved=true; za(); }};
  const up=()=>{{ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); setTimeout(()=>{{moved=false;}},0); }};
  document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up); }});
lb.addEventListener('close',zr);
// markup: draw red strokes over the screenshot, undo / clear, save the composite at full resolution
let drawOn=false, strokes=[], cur=null;
const ink=document.getElementById('lbInk'), mk=document.getElementById('lbMk'), ictx=ink.getContext('2d');
function inkFit(){{ const w=im.offsetWidth, h=im.offsetHeight;
  ink.style.left=im.offsetLeft+'px'; ink.style.top=im.offsetTop+'px'; ink.style.width=w+'px'; ink.style.height=h+'px'; ink.style.transformOrigin='center center';
  ink.width=Math.round(w*devicePixelRatio*2); ink.height=Math.round(h*devicePixelRatio*2); za(); inkDraw(); }}
function nat(ev){{ const r=ink.getBoundingClientRect(); return [(ev.clientX-r.left)*im.naturalWidth/r.width,(ev.clientY-r.top)*im.naturalHeight/r.height]; }}
function paint(ctx,scale){{ ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#e53935';
  for(const s of strokes){{ ctx.lineWidth=s.w*scale; ctx.beginPath(); s.p.forEach((q,i)=>i?ctx.lineTo(q[0]*scale,q[1]*scale):ctx.moveTo(q[0]*scale,q[1]*scale)); if(s.p.length===1) ctx.lineTo(s.p[0][0]*scale+0.1,s.p[0][1]*scale); ctx.stroke(); }} }}
function inkDraw(){{ ictx.clearRect(0,0,ink.width,ink.height); paint(ictx, ink.width/(im.naturalWidth||1)); }}
function inkReset(){{ strokes=[]; cur=null; if(drawOn) inkDraw(); }}
function setDraw(on){{ drawOn=on; mk.classList.toggle('on',on); ink.style.display=on?'block':'none'; if(on){{ zr(); inkFit(); requestAnimationFrame(inkFit); }} }}
im.addEventListener('load',()=>{{ if(drawOn) inkFit(); }});
const downs=new Set();
ink.addEventListener('pointerdown',ev=>{{ ev.preventDefault(); downs.add(ev.pointerId);
  if(downs.size>1){{ if(cur){{ strokes.splice(strokes.indexOf(cur),1); cur=null; inkDraw(); }} return; }}
  ev.stopPropagation(); try{{ ink.setPointerCapture(ev.pointerId); }}catch(e){{}}
  const r=ink.getBoundingClientRect(); cur={{w:5*im.naturalWidth/r.width, p:[nat(ev)]}}; strokes.push(cur); inkDraw(); }});
ink.addEventListener('pointermove',ev=>{{ if(!cur) return; ev.preventDefault(); cur.p.push(nat(ev)); inkDraw(); }});
['pointerup','pointercancel'].forEach(t=>ink.addEventListener(t,ev=>{{ downs.delete(ev.pointerId); cur=null; }}));
ink.addEventListener('click',ev=>ev.stopPropagation());
['touchstart','touchmove','touchend'].forEach(t=>ink.addEventListener(t,ev=>{{ if(ev.touches.length<2 && !pd) ev.stopPropagation(); }},{{passive:true}}));
mk.addEventListener('click',ev=>ev.stopPropagation());
document.getElementById('mkPen').addEventListener('click',()=>setDraw(!drawOn));
document.getElementById('mkUndo').addEventListener('click',()=>{{ strokes.pop(); inkDraw(); }});
document.getElementById('mkClear').addEventListener('click',()=>{{ strokes=[]; inkDraw(); }});
document.getElementById('mkSave').addEventListener('click',()=>{{
  const c=document.createElement('canvas'); c.width=im.naturalWidth; c.height=im.naturalHeight; const x=c.getContext('2d');
  x.drawImage(im,0,0); paint(x,1);
  const blobP=new Promise(res=>c.toBlob(res,'image/png'));
  const note=t=>{{ const old=cap.textContent; cap.textContent=t; setTimeout(()=>{{ cap.textContent=old; }},1600); }};
  const viaShare=async()=>{{ const blob=await blobP; const f=new File([blob],'marked.png',{{type:'image/png'}});
    if(navigator.canShare&&navigator.canShare({{files:[f]}})){{ try{{ await navigator.share({{files:[f]}}); }}catch(e){{}} }} else note('Copy not supported here'); }};
  if(navigator.clipboard&&window.ClipboardItem){{
    navigator.clipboard.write([new ClipboardItem({{'image/png':blobP}})]).then(()=>note('Copied ✓'),viaShare);
  }} else viaShare(); }});
addEventListener('resize',()=>{{ if(drawOn) inkFit(); }});
lb.addEventListener('close',()=>setDraw(false));

setInterval(()=>{{ if(!lb.open) location.reload(); }}, 60000);
</script></body></html>"""
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
                        "--commit-dirty=true"], capture_output=True, text=True, **NOWIN, encoding="utf-8", errors="replace")
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
    shutil.rmtree(os.path.join(OUT, "shots"), ignore_errors=True)
    for st in seats:
        for x in st["shots"]:
            dst = os.path.join(OUT, "shots", st["key"]); os.makedirs(dst, exist_ok=True)
            shutil.copy2(os.path.join(SHOTS_DIR, st["key"], x), os.path.join(dst, x))
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
