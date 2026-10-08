// Seat D (2026-10-08, advisor pick 2): the Art editor on Fred's phone -- every Artwork action timed under his acceptance
// rig (real Chrome, 390 x 844, touch, CPU throttled, default 4x) with REAL touch input (CDP Input.dispatchTouchEvent: a
// covered / inert control does not answer, unlike a scripted .click()), plus a reach pass over every visible control.
// Per action, from the touch until the page is quiet (no long task for QUIET_MS):
//   responseMs   touch -> the end of the last long task (what the finger waits for; ~0 = answered within a frame)
//   longestMs    the longest single main-thread task
//   blindMs      long-task time while the loading card / pill was NOT on screen (reads as frozen)
//   overlay      the card / pill texts seen
// Reach: every visible button / input / select in the Artwork panel and the editor's top bar, scrolled into view: is
// it inside the viewport, is it the element under its own centre (not covered), and its smaller side in px.
//
//   node tools/repro/art_phone_audit.mjs <outDir> [cdpPort] [httpPort]
// Env: CPU (default 4)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../bspline-frame-builder'); // the matrix's root: the palette's relative assets resolve
const [OUT_DIR, PORTARG, HTTPARG] = process.argv.slice(2);
if (!OUT_DIR) { console.log('usage: node tools/repro/art_phone_audit.mjs <outDir> [cdpPort] [httpPort]'); process.exit(1); }
const PORT = Number(PORTARG || 9591), HTTP = Number(HTTPARG || 9592), CPU = Number(process.env.CPU || 4);
const QUIET_MS = 800, VIEW = { width: 390, height: 844 };
const PROFILE = `${OUT_DIR}/.chrome-artphone-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('python', [path.resolve(HERE, '../brick-matrix/serve.py'), String(HTTP)], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  'about:blank'], { stdio: 'ignore' });
const stop = () => { try { chrome.kill(); } catch { /* gone */ } try { server.kill(); } catch { /* gone */ } };
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
}
if (!wsUrl) { console.log('NO CDP'); stop(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const resp = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (resp.result?.exceptionDetails) errors.push('EVAL: ' + (resp.result.exceptionDetails.exception?.description || resp.result.exceptionDetails.text).split('\n')[0]);
  return resp.result?.result?.value;
};

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true }); // a reused profile must not serve a stale stylesheet
  await send('Network.setBlockedURLs', { urls: ['*workers.dev*'] });
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // the phone's own CSS: (pointer: coarse) rules (SA-MOBILE-4's 44 px tool buttons, ...) apply only with it (a first reach
  // pass without it measured the desktop sizes)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/b-spline-gen/html/bspline_gen_palette.html` });
  for (let i = 0; i < 120 && !(await js('!!document.getElementById("btnStampEdit")')); i++) await sleep(500);
  await sleep(4000);
  // open the editor on its Artwork tab (setup, unthrottled)
  await js(`(async () => { const m = document.getElementById('svgEditorModal'); if (!m || m.style.display === 'none') document.getElementById('btnStampEdit').click();
    for (let i = 0; i < 80 && !window.svgEditor?._draw; i++) await new Promise((r) => setTimeout(r, 250));
    document.getElementById('editorTabArtwork')?.click(); await new Promise((r) => setTimeout(r, 1500)); return 1; })()`);
  // the page-side recorders
  await js(`(() => {
    const el = document.getElementById('loading-stage');
    window.__vis = () => !!el && !el.hidden && el.getClientRects().length > 0;
    window.__ov = []; window.__long = [];
    if (el) new MutationObserver(() => { if (window.__vis()) window.__ov.push({ t: performance.now(), txt: (el.textContent || '').trim().slice(0, 60) }); })
      .observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ start: e.startTime, dur: e.duration, vis: window.__vis() }); }).observe({ entryTypes: ['longtask'] });
    window.__settle = async (t0, quiet) => { const W = (ms) => new Promise((r) => setTimeout(r, ms)); const tEnd = performance.now() + 60000;
      for (;;) { await W(100); const last = window.__long.filter((e) => e.start >= t0 - 5).reduce((m, e) => Math.max(m, e.start + e.dur), t0);
        if (performance.now() - last >= quiet || performance.now() > tEnd) break; }
      const tasks = window.__long.filter((e) => e.start >= t0 - 5);
      const end = tasks.reduce((m, e) => Math.max(m, e.start + e.dur), t0);
      return JSON.stringify({ responseMs: Math.round(end - t0), longestMs: Math.round(tasks.reduce((m, e) => Math.max(m, e.dur), 0)),
        busyMs: Math.round(tasks.reduce((s, e) => s + e.dur, 0)), blindMs: Math.round(tasks.filter((e) => !e.vis).reduce((s, e) => s + e.dur, 0)),
        overlay: [...new Set(window.__ov.filter((o) => o.t >= t0 - 5).map((o) => o.txt))] }); };
    window.__centre = (sel) => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) return null;
      e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null; };
    window.__canvas = () => { const n = window.svgEditor?._draw?.node; if (!n) return null; const r = n.getBoundingClientRect();
      const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, innerHeight);
      return { x0, x1, y0, y1 }; };
    return 1; })()`);
  const shot0 = await send('Page.captureScreenshot', { format: 'png' });
  if (shot0.result?.data) writeFileSync(`${OUT_DIR}/art_phone_open.png`, Buffer.from(shot0.result.data, 'base64'));
  console.log('canvas', await js('JSON.stringify(window.__canvas())'));
  await send('Emulation.setCPUThrottlingRate', { rate: CPU });

  const touch = async (points, stepMs = 30) => { // points: [[x, y], ...]: start, moves, end
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0][0], y: points[0][1] }] });
    for (const p of points.slice(1)) { await sleep(stepMs); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const results = [];
  // what an action changed: the drawing's element count and the editor's mode (a gesture that lands nowhere changes neither)
  const state = () => js(`(() => { const ed = window.svgEditor; const n = ed?._draw?.node;
    return JSON.stringify({ els: n ? n.querySelectorAll('path,line,rect,circle,ellipse,polyline,polygon,text').length : -1, mode: ed?._currentMode || '' }); })()`).then(JSON.parse);
  const act = async (name, how) => {
    const before = await state();
    const t0 = await js('performance.now()');
    const ok = await how();
    const m = ok === false ? { skipped: true } : JSON.parse(await js(`window.__settle(${t0}, ${QUIET_MS})`));
    const after = await state();
    m.effect = `${before.els}->${after.els}${before.mode !== after.mode ? ` mode ${before.mode}->${after.mode}` : ''}`;
    results.push({ name, ...m }); console.log(name.padEnd(42), JSON.stringify(m));
  };
  const tapSel = async (sel) => { const c = await js(`JSON.stringify(window.__centre(${JSON.stringify(sel)}))`); const p = c && JSON.parse(c); if (!p) return false; await touch([[p.x, p.y]]); return true; };
  const tabIds = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#artTabStrip [role="tab"]')].map((b) => b.dataset.tab))`) || '[]');
  console.log('tabs', JSON.stringify(tabIds));
  const tapTab = async (tab) => (tab ? tapSel(`#artTabStrip [data-tab="${tab}"]`) : false);
  const canvasDrag = async (fx0, fy0, fx1, fy1, steps = 8) => {
    const c = JSON.parse(await js('JSON.stringify(window.__canvas())')); if (!c) return false;
    const X = (f) => c.x0 + (c.x1 - c.x0) * f, Y = (f) => c.y0 + (c.y1 - c.y0) * f;
    await touch(Array.from({ length: steps + 1 }, (_, k) => [X(fx0 + ((fx1 - fx0) * k) / steps), Y(fy0 + ((fy1 - fy0) * k) / steps)]));
    return true;
  };

  // ---- the actions (each tab, then each tool's own gesture)
  for (const t of tabIds) await act(`tab: ${t}`, () => tapTab(t));
  await act('Draw tab', () => tapTab(tabIds.find((t) => /draw/i.test(t))));
  await act('Draw: freehand stroke', async () => (await tapSel('#toolDraw')) && (await sleep(300), canvasDrag(0.2, 0.3, 0.7, 0.45, 12)));
  await act('Draw: line', async () => (await tapSel('#toolLine')) && (await sleep(300), canvasDrag(0.2, 0.55, 0.75, 0.6, 6)));
  await act('Draw: rect', async () => (await tapSel('#toolRect')) && (await sleep(300), canvasDrag(0.3, 0.65, 0.6, 0.78, 6)));
  await act('Draw: circle', async () => (await tapSel('#toolCircle')) && (await sleep(300), canvasDrag(0.5, 0.2, 0.6, 0.25, 6)));
  await act('Undo (editor)', () => tapSel('#editorUndo'));
  await act('Redo (editor)', () => tapSel('#editorRedo'));
  await act('Edit tab', () => tapTab(tabIds.find((t) => /edit/i.test(t))));
  await act('Edit: select tap on a stroke', async () => (await tapSel('#toolSelect')) && (await sleep(300), canvasDrag(0.45, 0.375, 0.45, 0.375, 1)));
  await act('Edit: Fit', () => tapSel('#toolFit'));
  await act('Edit: Delete', () => tapSel('#toolDelete'));
  await act('Lattice tab', () => tapTab(tabIds.find((t) => /^lattice/i.test(t))));
  await act('Lattice: Generate', () => tapSel('#latticeGenerate'));
  await act('Shape tab', () => tapTab(tabIds.find((t) => /shape/i.test(t))));
  await act('Shape: Generate', () => tapSel('#shapeLatticeGenerate'));
  await act('Undo after Shape Generate', () => tapSel('#editorUndo'));
  await act('Text tab', () => tapTab(tabIds.find((t) => /text/i.test(t))));
  await act('General tab', () => tapTab(tabIds.find((t) => /general/i.test(t))));
  console.log('general body', await js(`JSON.stringify((() => { const b = document.getElementById('artGeneralBody'); const g = ['editorStrokeGroup', 'editorColorGroup', 'editorFillModeGroup'];
    const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), disp: getComputedStyle(e).display }; };
    return { body: box(b), groups: g.map((id) => { const e = document.getElementById(id); return { id, inBody: !!(b && e && b.contains(e)), parent: e?.parentElement?.id || e?.parentElement?.className || '', box: box(e) }; }),
      plus: box(document.getElementById('editorStrokeWidthPlus')) }; })())`));
  await act('General: stroke width +', () => tapSel('#editorStrokeWidthPlus'));
  await act('Layers: add layer', () => tapSel('#editorAddLayer'));
  await act('Layers: toggle first visibility', () => tapSel('#editorLayersList [data-action="visibility"], #editorLayersList .layer-visibility, #editorLayersList input[type="checkbox"]'));

  // ---- reach, per tab (each tab shows its own tools and its tool's settings): every visible control in the Artwork
  // panel + the editor's top bar, scrolled into view
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const reach = [];
  for (const tab of tabIds) {
    await tapTab(tab); await sleep(800);
    const rows = JSON.parse(await js(`JSON.stringify((() => {
      const roots = [document.getElementById('editorLayersPanel'), document.querySelector('#svgEditorModal .editor-topbar, #svgEditorModal header, #editorTopBar, #editorToolbarTop')].filter(Boolean);
      const out = [], seen = new Set();
      for (const root of roots) for (const e of root.querySelectorAll('button, input, select, [role="tab"]')) {
        if (seen.has(e)) continue; seen.add(e);
        if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden' || e.type === 'hidden') continue;
        e.scrollIntoView({ block: 'center', inline: 'center' });
        // a checkbox's target is its label row (the matrix's layout 'Touch targets' rows measure it the same way)
        const r = ((e.type === 'checkbox' && e.closest('label')) || e).getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const inView = cx >= 0 && cx <= innerWidth && cy >= 0 && cy <= innerHeight;
        const hit = inView ? document.elementFromPoint(cx, cy) : null;
        out.push({ id: e.id || e.getAttribute('aria-label') || e.title || e.textContent.trim().slice(0, 20), inView,
          covered: inView && !(hit === e || e.contains(hit) || (e.labels && [...e.labels].some((l) => l.contains(hit)))),
          by: hit && hit !== e && !e.contains(hit) ? (hit.id || hit.className || hit.tagName).toString().slice(0, 40) : '', minPx: Math.round(Math.min(r.width, r.height)) });
      }
      return out; })())`) || '[]');
    for (const r of rows) reach.push({ tab, ...r });
  }
  const bad = reach.filter((r) => !r.inView || r.covered);
  const small = reach.filter((r) => r.inView && !r.covered && r.minPx < 24);
  console.log(`reach (all tabs): ${reach.length} control views, ${bad.length} unreachable/covered, ${small.length} under 24 px`);
  for (const r of bad) console.log('  UNREACHABLE', JSON.stringify(r));
  const smallIds = [...new Set(small.map((r) => `${r.id} ${r.minPx}px`))];
  console.log('  under 24 px:', smallIds.join(' | '));
  writeFileSync(`${OUT_DIR}/art_phone_audit.json`, JSON.stringify({ cpu: CPU, view: VIEW, results, reach, errors }, null, 1));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) writeFileSync(`${OUT_DIR}/art_phone_end.png`, Buffer.from(shot.result.data, 'base64'));
  console.log('errors', errors.length, JSON.stringify(errors.slice(0, 5)));
} finally { stop(); }
