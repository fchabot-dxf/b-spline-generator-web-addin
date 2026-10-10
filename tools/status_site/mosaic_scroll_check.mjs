// STATUS-MOSAIC-SCROLL check (seat E, 2026-10-09): can a FINGER scroll the lightbox mosaic on a phone?
// Render the site locally first (never the live out/ folder), from tools/status_site:
//   python -c "import status_watch as s; s.OUT=r'<dir>'; s.deploy=lambda: True; s.once()"
// then: node tools/status_site/mosaic_scroll_check.mjs <dir>. 430 px mobile + touch emulation (headless Chrome over CDP).
// The control drag must scroll the page itself (else the harness, not the page, is broken); then the same drag on the
// open mosaic must move its scrollTop, and no tile may sit in a column off the side. Exit 0 = scrolls, 1 = it does not, 2 = the harness could not scroll at all.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = process.argv[2], page = process.argv[3] || 'index.html', PORT = 9871, HTTP = 9872;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server = spawn('python', ['-m', 'http.server', String(HTTP), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), 'seate-lb-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const out = { pids: [server.pid, chrome.pid] };
try {
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} }
  const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.enable'); await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/${page}` }); await sleep(2500);
  const drag = async (x, y0, y1) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let k = 1; k <= 12; k++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * k) / 12 }] }); await sleep(16); }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600);
  };
  out.controlBefore = await js('scrollY'); await drag(215, 700, 250); out.controlAfter = await js('scrollY');
  await js('scrollTo(0,0)');
  // open the shot set with the most thumbnails, then the mosaic
  out.opened = await js(`(()=>{ const sets=[...document.querySelectorAll('.shots')]; const s=sets.sort((a,b)=>b.querySelectorAll('img.thumb').length-a.querySelectorAll('img.thumb').length)[0]||document;
    const t=s.querySelector('img.thumb'); if(!t) return 0; t.click(); return s.querySelectorAll('img.thumb').length; })()`);
  await sleep(1200);
  await js(`document.getElementById('lbGrid').click()`); await sleep(1200);
  out.mosaic = await js(`(()=>{ const m=document.getElementById("lbMosaic"), ims=[...m.querySelectorAll("img")], last=ims[ims.length-1].getBoundingClientRect(); return { on: m.classList.contains("on"), scrollTop: m.scrollTop, scrollHeight: m.scrollHeight, clientHeight: m.clientHeight, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, tiles: ims.length, loaded: ims.filter((i)=>!i.dataset.src).length, lastTile: [Math.round(last.left), Math.round(last.top)] }; })()`);
  await js(`document.getElementById('lbMosaic').scrollTop=0`); await sleep(300);
  out.hit = await js(`(()=>{ const e=document.elementFromPoint(215,600); return e? e.tagName+'#'+e.id+'.'+e.className : null; })()`);
  await drag(215, 750, 250);
  out.mosaicAfterDrag = await js(`document.getElementById('lbMosaic').scrollTop`);
  await js(`document.getElementById('lbMosaic').scrollBy(0,300)`); await sleep(200);
  out.mosaicAfterScrollBy = await js(`document.getElementById('lbMosaic').scrollTop`);
  ws.close();
} finally { chrome.kill(); server.kill(); }
console.log(JSON.stringify(out));
// every tile in a visible column too: a mosaic wider than its box hides whole columns off to the side
process.exit(!(out.controlAfter > 0) ? 2 : out.mosaicAfterDrag > 0 && out.mosaic.scrollWidth <= out.mosaic.clientWidth ? 0 : 1);
