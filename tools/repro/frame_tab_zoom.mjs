// FB-APP F18 (FRAME-TAB-ZOOM, Fred on his phone): in the editor's Frame tab, a two-finger pinch zooms, a one-finger
// drag OFF a handle pans, and a one-finger drag that STARTS ON a handle still drags the handle. Real touch events
// (Input.dispatchTouchEvent), mobile emulation; reads back editor._view and the frame record.
//   node tools/repro/frame_tab_zoom.mjs <outPrefix> <paletteUrl> [template_1|template_2] [port]
// Writes <outPrefix>_pinched.png, _handle.png; prints the checks as JSON (ok:false on any miss).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, TEMPLATE = 'template_1', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9431);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-framezoom-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) { /* not up yet */ }
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, k) => ({ x: p.x, y: p.y, id: k })) });
const STATE = `(async()=>{ const rec = (await import('./core/frame-record.js')).getFrameRecord(); const v = window.svgEditor._view;
  return JSON.stringify({ view: { cx: v.cx, cy: v.cy, zoom: v.zoom }, seeds: rec.seeds }); })()`;
const state = async () => JSON.parse(await evalJS(STATE));

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const sel = document.getElementById('frameTemplate'); sel.value = '${TEMPLATE}'; sel.dispatchEvent(new Event('change')); await W(400);
  document.getElementById('btnEditFrameShape').click(); await W(3000); })()`);
// the canvas centre and a point well away from every handle (screen px)
const findGeo = async () => JSON.parse(await evalJS(`(()=>{ const ed = window.svgEditor, m = ed._draw.node.getScreenCTM();
  const scr = (p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
  const r = document.getElementById('editorSVGContainer').getBoundingClientRect();
  const hs = ed._frameHandles.map((h) => ({ key: h.key, ...scr(h.anchor) }));
  const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  // an empty spot: the canvas point farthest from every handle along a small grid
  let best = c, bestD = -1;
  for (let fx = 0.2; fx <= 0.8; fx += 0.1) for (let fy = 0.2; fy <= 0.8; fy += 0.1) {
    const p = { x: r.left + r.width * fx, y: r.top + r.height * fy };
    if (p.x < 20 || p.y < 20 || p.x > innerWidth - 20 || p.y > innerHeight - 20) continue; // on screen only
    // the CANVAS all around (touch adjustment snaps a touch near a button onto it), not a toolbar/overlay button
    const svgBox = document.getElementById('editorSVGContainer');
    const clear = [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]].every(([ox, oy]) => { const u = document.elementFromPoint(p.x + ox, p.y + oy); return u && svgBox.contains(u); });
    if (!clear) continue;
    const d = Math.min(...hs.map((h) => Math.hypot(h.x - p.x, h.y - p.y)));
    if (d > bestD) { bestD = d; best = p; }
  }
  return JSON.stringify({ centre: c, empty: best, emptyDist: bestD, handles: hs }); })()`));
const geo = await findGeo();
const checks = { template: TEMPLATE, handles: geo.handles.length, emptyDist: Math.round(geo.emptyDist) };

// 1. a one-finger drag that STARTS on a handle drags it (the view does not move); first, while every handle is on screen
const s2 = await state();
const hs = JSON.parse(await evalJS(`(()=>{ const ed = window.svgEditor, m = ed._draw.node.getScreenCTM();
  return JSON.stringify(ed._frameHandles.map((h) => ({ key: h.key, axis: h.axis, x: m.a * h.anchor.x + m.c * h.anchor.y + m.e, y: m.b * h.anchor.x + m.d * h.anchor.y + m.f }))); })()`));
const h = hs[0];
const [dx, dy] = h.axis === 'x' ? [-30, 0] : [0, 30];
await touch('touchStart', [{ x: h.x, y: h.y }]);
for (let k = 1; k <= 8; k++) { await touch('touchMove', [{ x: h.x + dx * k / 8, y: h.y + dy * k / 8 }]); await sleep(30); }
await touch('touchEnd', []); await sleep(800);
const s3 = await state();
checks.handle = { key: h.key, before: s2.seeds[h.key] ?? null, after: s3.seeds[h.key] ?? null };
checks.handleOk = s3.seeds[h.key] != null && s3.seeds[h.key] !== s2.seeds[h.key]
  && s3.view.cx === s2.view.cx && s3.view.cy === s2.view.cy && s3.view.zoom === s2.view.zoom;
await shot('handle');

// 2. pinch: two fingers spreading apart about the canvas centre
const s0 = await state();
const { x: cx, y: cy } = geo.centre;
await touch('touchStart', [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }]);
for (let k = 1; k <= 8; k++) { await touch('touchMove', [{ x: cx - 40 - 10 * k, y: cy }, { x: cx + 40 + 10 * k, y: cy }]); await sleep(30); }
await touch('touchEnd', []); await sleep(400);
const s1 = await state();
checks.pinchZoom = { before: s0.view.zoom, after: s1.view.zoom };
checks.pinchOk = s1.view.zoom > s0.view.zoom * 1.3 && JSON.stringify(s1.seeds) === JSON.stringify(s0.seeds);
await shot('pinched');

// 3. one-finger pan off every handle (the empty spot, recomputed after the zoom)
const { x: ex, y: ey } = (await findGeo()).empty;
checks.preState = await evalJS(`(()=>{ const e = window.svgEditor; return JSON.stringify({ pointers: e._activePointers.size, pinch: !!e._pinchPrev, panning: !!e._isPanning, locked: !!e._artworkLocked }); })()`);
checks.panAt = await evalJS(`(()=>{ const e = document.elementFromPoint(${ex}, ${ey}); return e ? e.tagName + '#' + (e.id || '') + ' in ' + (e.closest('[id]') || {}).id : 'none'; })()`);
await touch('touchStart', [{ x: ex, y: ey }]);
checks.afterDown = await evalJS(`(()=>{ const e = window.svgEditor; return JSON.stringify({ pointers: e._activePointers.size, panning: !!e._isPanning, at: [${ex}, ${ey}] }); })()`);
for (let k = 1; k <= 8; k++) { await touch('touchMove', [{ x: ex + 5 * k, y: ey + 4 * k }]); await sleep(30); }
await touch('touchEnd', []); await sleep(400);
const sP = await state();
checks.panSeeds = { before: s1.seeds, after: sP.seeds };
checks.pan = { dcx: +(sP.view.cx - s1.view.cx).toFixed(4), dcy: +(sP.view.cy - s1.view.cy).toFixed(4) };
checks.panOk = (Math.abs(sP.view.cx - s1.view.cx) > 1e-3 || Math.abs(sP.view.cy - s1.view.cy) > 1e-3)
  && JSON.stringify(sP.seeds) === JSON.stringify(s1.seeds) && sP.view.zoom === s1.view.zoom;

checks.errors = errors.slice(0, 3);
checks.ok = !!(checks.pinchOk && checks.panOk && checks.handleOk && !errors.length);
console.log(JSON.stringify(checks));
ws.close(); chrome.kill();
