// MARQUEE-MOVE shots (a drag inside a selection moves its pixels) (headless Chrome, hidden; REAL pointer / touch input through the editor's own screen
// CTM): on desktop 1400 x 900 (mouse + keys) and phone 390 x 844 (touch): a filled block selected, then MOVED with the Move
// tool (it floats; Enter / the Drop button drops it); the whole layer moved (no selection); a chisel stroke with Turn with the
// stroke; a square Bevel dab. Prints the raster values it read back and every page exception.
//   (cd bspline-frame-builder && python ../tools/brick-matrix/serve.py 8810)
//   node tools/repro/height_painter3_shots.mjs <outDir> http://127.0.0.1:8810/b-spline-gen/html/bspline_gen_palette.html [cdpPort]
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9350);
mkdirSync(OUT, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${OUT}/chrome-mm-${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', windowsHide: true });
console.log('chrome pid', chrome.pid);
const killChrome = () => { try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch (_) { /* gone */ } };
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) { /* not up yet */ }
}
if (!wsUrl) { console.log('NO CDP'); killChrome(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  // the app's "leave this page?" (beforeunload) blocks the next viewport's navigation: accept it
  if (msg.method === 'Page.javascriptDialogOpening') { ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } })); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
});
// every CDP call answers or times out (a navigation that never settles must not hang the probe)
const send = (method, params = {}, ms = 60000) => new Promise((r) => {
  const i = ++id;
  const t = setTimeout(() => { pending.delete(i); console.log('CDP timeout', method); r({ error: `timeout ${method}` }); }, ms);
  pending.set(i, (msg) => { clearTimeout(t); r(msg); });
  ws.send(JSON.stringify({ id: i, method, params }));
});
// an evaluation that never settles (the page replaced its own context) comes back as a timeout instead of hanging the probe
const evalJS = async (expr, ms = 180000) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, ms); if (r.error || r.result?.exceptionDetails) return `EVAL ERROR ${JSON.stringify(r.error || r.result.exceptionDetails).slice(0, 400)}`; return r.result?.result?.value; };
let TAG = '';
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (!r.result) { console.log('shot failed', name); return; } const f = `${OUT}/${TAG}-${name}.png`; writeFileSync(f, Buffer.from(r.result.data, 'base64')); console.log('shot', f); };
let TOUCH = false;
const mouse = (type, x, y, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, modifiers, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 })) });
const drag = async (sp, { alt = false } = {}) => {
  if (TOUCH) {
    await touch('touchStart', [sp[0]]);
    for (const p of sp.slice(1)) { await touch('touchMove', [p]); await sleep(20); }
    await touch('touchEnd', []);
  } else {
    const mod = alt ? 1 : 0;
    await mouse('mouseMoved', sp[0][0], sp[0][1], mod);
    await mouse('mousePressed', sp[0][0], sp[0][1], mod);
    for (const [x, y] of sp.slice(1)) { await mouse('mouseMoved', x, y, mod); await sleep(20); }
    await mouse('mouseReleased', sp[sp.length - 1][0], sp[sp.length - 1][1], mod);
  }
  await sleep(1200);
};
const tapAt = async (x, y) => drag([[x, y], [x, y]]);
const key = async (k, code, vk, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(300); };
const line = (a, b, n = 24) => Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * (i / (n - 1)), a[1] + (b[1] - a[1]) * (i / (n - 1))]);
const typeInto = (inputId, v) => evalJS(`(()=>{ const t=document.getElementById(${JSON.stringify(inputId)}); t.value=${JSON.stringify(String(v))}; t.dispatchEvent(new Event('change')); return 'ok'; })()`);
const click = (sel) => evalJS(`(()=>{ const b=document.querySelector(${JSON.stringify(sel)}); if (!b) return 'missing ' + ${JSON.stringify(sel)}; b.click(); return 'ok'; })()`);
// the patches' own group (editor inches, y down): on the phone layout the sketch layer's CTM was measured 0.84 in off it
const toScreen = async (pts) => JSON.parse(await evalJS(`(()=>{ const g = document.getElementById('heightPatches') || window.svgEditor._sketchLayer.node, m = g.getScreenCTM(), svg = g.ownerSVGElement;
  return JSON.stringify(${JSON.stringify(pts)}.map(([x, y]) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(m); return [q.x, q.y]; })); })()`));
/** The active layer's stored raster at pixels [[c, r], ...] (+ its h, the undo depth, the move state). */
const readPx = (px) => evalJS(`(async()=>{ const m = await import('./main/height-panel.js'); const { decodedRaster, ensureRasterDecoded } = await import('./core/height/raster.js');
  const W = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && m.heightMoveState().pending; i++) await W(250);
  await m.whenHeightIdle(); const l = m.activePatchLayer(); await ensureRasterDecoded(l.raster); const d = decodedRaster(l.raster), cols = l.raster.cols, rows = l.raster.rows;
  let c0 = cols, r0 = rows, c1 = -1, r1 = -1; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (d[r * cols + c] > 0.1) { if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r; }
  return JSON.stringify({ h: l.raster.h, undo: window.svgEditor._undoStack.length, move: m.heightMoveState(), over01: c1 < 0 ? null : [c0, r0, c1, r1], px: ${JSON.stringify(px)}.map(([c, r]) => [c, r, +d[r * cols + c].toFixed(4)]) }); })()`);
const bar = () => evalJS(`(()=>{ const b = document.getElementById('heightMoveBar'); if (!b) return 'no bar'; const r = (id) => { const e = document.getElementById(id).getBoundingClientRect(); return [Math.round(e.x), Math.round(e.y), Math.round(e.width), Math.round(e.height)]; };
  return JSON.stringify({ hidden: b.hidden, display: getComputedStyle(b).display, drop: r('heightMoveDrop'), cancel: r('heightMoveCancel') }); })()`);

async function run(tag, metrics, touchOn) {
  TAG = tag; TOUCH = touchOn;
  await send('Emulation.setDeviceMetricsOverride', metrics);
  await send('Emulation.setTouchEmulationEnabled', { enabled: touchOn, maxTouchPoints: touchOn ? 5 : 1 });
  // a fresh start per viewport: no session restored from the previous run (it would replace the new patch)
  await send('Storage.clearDataForOrigin', { origin: new globalThis.URL(URL).origin, storageTypes: 'all' });
  await send('Page.navigate', { url: URL }); await sleep(9000);
  let opened = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const v = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
      for (let i = 0; i < 60 && !document.getElementById('viewMode_2d'); i++) await W(250); await W(1500);
      const shown = () => { const m = document.getElementById('svgEditorModal'); return !!m && getComputedStyle(m).display !== 'none'; };
      for (const id of ['viewMode_2d', 'btnMainLayersOpenEditor']) {
        if (shown()) break;
        document.getElementById(id)?.click();
        for (let i = 0; i < 60 && !shown(); i++) await W(250);
      }
      if (!shown()) { await (await import('./main/frame-panel.js')).openEditorOn('height'); for (let i = 0; i < 120 && !shown(); i++) await W(250); }
      if (!shown()) return JSON.stringify({ ok: false, why: 'the editor did not open' });
      for (let i = 0; i < 60 && !(window.svgEditor && window.svgEditor._sketchLayer); i++) await W(250); await W(1000);
      document.getElementById('editorTabHeight').click(); await W(500);
      document.getElementById('heightNew').click(); await W(1500);
      if (window.visualViewport && window.visualViewport.scale !== 1) document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1');
      return JSON.stringify({ ok: true, mode: window.svgEditor._currentMode, tools: [...document.querySelectorAll('#editorToolbarHeight [data-height-tool]')].map((b) => b.getAttribute('data-height-tool')) }); })()`);
    console.log(tag, 'opened', attempt, typeof v === 'string' ? v : JSON.stringify(v));
    if (typeof v === 'string' && v.startsWith('{"ok":true')) { opened = true; break; }
    await sleep(3000);
  }
  await shot('0-opened');
  if (!opened) { console.log(tag, 'SKIPPED: the editor did not open'); return; }
  const W = await evalJS('(async()=>(await import("./core/state.js")).P.widthIn)()'), H = await evalJS('(async()=>(await import("./core/state.js")).P.heightIn)()');
  const ppi = 100, cols = Math.round(W * ppi), rows = Math.round(H * ppi);
  console.log(tag, 'board', W, H, 'patch', cols, 'x', rows);
  // editor point (inches, y down) of raster pixel (c, r) and back
  const ed = (c, r) => [(c + 0.5) / ppi, H - (r + 0.5) / ppi];

  // 1. a block, selected with the MARQUEE (rectangle), filled to 0.2 in
  await click('[data-height-tool="marquee"]');
  const b0 = [Math.round(cols * 0.3), Math.round(rows * 0.55)], b1 = [Math.round(cols * 0.55), Math.round(rows * 0.7)];
  await drag(await toScreen(line(ed(b0[0], b1[1]), ed(b1[0], b0[1]), 12)));
  await typeInto('height_fillHeightIn', 0.2);
  await click('#heightFillApply'); await sleep(1500);
  const mid = [Math.round((b0[0] + b1[0]) / 2), Math.round((b0[1] + b1[1]) / 2)];
  console.log(tag, 'block', await readPx([mid]));
  await shot('1-selected');
  // 2. a drag that STARTS INSIDE the selection with the marquee still active: the pixels float
  const [p0] = await toScreen([ed(mid[0], mid[1])]);
  const [p1] = await toScreen([ed(mid[0] + 60, mid[1] - 40)]);
  await drag(line(p0, p1, 16));
  console.log(tag, 'floating', await readPx([mid, [mid[0] + 60, mid[1] - 40]]), await bar());
  await shot('2-floating');
  if (TOUCH) { const bb = JSON.parse(await bar()); await tapAt(bb.drop[0] + bb.drop[2] / 2, bb.drop[1] + bb.drop[3] / 2); }
  else await key('Enter', 'Enter', 13);
  await sleep(1500);
  console.log(tag, 'dropped', await readPx([mid, [mid[0] + 60, mid[1] - 40]]));
  await shot('3-dropped');
  // 3. a click outside deselects
  const [o] = await toScreen([ed(Math.round(cols * 0.8), Math.round(rows * 0.2))]);
  await tapAt(o[0], o[1]);
  console.log(tag, 'after click outside', await evalJS(`(async()=>{ const m = await import('./main/height-panel.js'); return JSON.stringify({ selection: !!m.heightSelection() }); })()`));
  await shot('4-deselected');
  // 4. the selection row of the options bar: Brush armed + a selection -> shown; no selection -> hidden
  await click('[data-height-tool="marquee"]');
  await drag(await toScreen(line(ed(b0[0], b1[1]), ed(b1[0], b0[1]), 12)));
  await click('[data-height-tool="brush"]'); await sleep(300);
  const rowState = () => evalJS(`(()=>{ const r = document.querySelector('#editorHeightOptions [data-height-bar-tool="__selection"]'); const g = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    return JSON.stringify({ shown: !!r && r.style.display !== 'none', invert: g('heightSelInvert'), clear: g('heightSelClear'), sidePanelSection: !!document.getElementById('heightBranch_selection') }); })()`);
  console.log(tag, 'selection row (brush + selection)', await rowState());
  await shot('5-selection-bar-brush');
  await click('#heightSelInvert'); await sleep(500);
  await shot('6-after-invert');
  await click('#heightSelClear'); await sleep(500);
  console.log(tag, 'selection row (brush, cleared)', await rowState());
  await shot('7-selection-bar-hidden');
}

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  const only = process.argv[5] || 'both'; // 'desktop' | 'phone' | 'both'
  if (only !== 'phone') await run('desktop', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, false);
  if (only !== 'desktop') await run('phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, true);
  console.log('exceptions', JSON.stringify(errors));
} finally { killChrome(); }
process.exit(0);
