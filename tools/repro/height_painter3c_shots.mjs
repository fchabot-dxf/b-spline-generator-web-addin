// HEIGHT-PAINTER slice 3c smoke + shots (headless Chrome, hidden; REAL pointer / touch input). Fred 2026-11-22: no brush
// presets -- the Brush section is Mode, Tip (Round | Square | Chisel), Falloff (the profiles), then the settings. On desktop
// 1400 x 900 and phone 390 x 844 (touch): the Brush section with its Tip and Falloff rows on screen without scrolling; a
// Square + Linear dab (the bevel); a Chisel stroke (Turn with the stroke, Build up off). Prints the row positions, the
// button sizes (28 px touch targets), the raster values it read back, and every page exception.
//   (cd bspline-frame-builder && python ../tools/brick-matrix/serve.py 8810)
//   node tools/repro/height_painter3c_shots.mjs <outDir> http://127.0.0.1:8810/b-spline-gen/html/bspline_gen_palette.html [cdpPort] [desktop|phone|both]
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9350);
mkdirSync(OUT, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${OUT}/chrome-hp3-${PORT}`;
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
  await send('Network.enable'); await send('Network.clearBrowserCache'); await send('Network.setCacheDisabled', { cacheDisabled: true }); // the page's modules as on disk now
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
  const rect = (sel) => evalJS(`(()=>{ const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'null'; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2, Math.round(r.width), Math.round(r.height)]); })()`);
  const tapSel = async (sel) => {
    await sleep(300);
    const v = await rect(sel);
    if (v === 'null' || String(v).startsWith('EVAL')) { console.log(tag, 'missing', sel); return null; }
    const [x, y, w, h] = JSON.parse(v);
    if (TOUCH) await tapAt(x, y); else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(500); }
    return [w, h];
  };
  // the phone drawer: its handle dragged up (the panel shows) or down (the canvas shows), a real touch drag
  const drawer = async (up) => { if (!TOUCH) return; const hv = JSON.parse(await rect('#editorDrawerHandle')); await drag(line([hv[0], hv[1]], [hv[0], hv[1] + (up ? -420 : 600)], 10)); };
  const section = () => evalJS(`(async()=>{ const m = await import('./main/height-panel.js'); const b = m.heightBrush();
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); return [Math.round(q.top), Math.round(q.bottom), Math.round(q.width), Math.round(q.height)]; };
    let n = document.getElementById('heightPanelBody'); while (n && !(n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY))) n = n.parentElement;
    return JSON.stringify({ tool: m.heightTool(), tip: b.tip, falloff: b.falloff, hardness: b.hardness, roundness: b.roundness, followStroke: b.followStroke, buildUp: b.buildUp, mode: b.mode,
      presets: document.querySelectorAll('[data-height-brush-preset]').length, viewH: window.innerHeight, scroll: n ? [n.id || n.className, n.scrollTop] : null,
      brush: box('#heightGroup_brush'), modeRow: box('#height_mode'), tipRow: box('#height_tip'), falloffRow: box('#height_falloff'),
      tipBtns: [...document.querySelectorAll('[data-height-choice^="tip:"]')].map((t) => [t.dataset.heightChoice, Math.round(t.getBoundingClientRect().width), Math.round(t.getBoundingClientRect().height), !!t.querySelector('svg')]),
      falloffBtns: [...document.querySelectorAll('[data-height-choice^="falloff:"]')].map((t) => [t.dataset.heightChoice, Math.round(t.getBoundingClientRect().width), Math.round(t.getBoundingClientRect().height), !!t.querySelector('svg')]),
      tipExtras: !document.getElementById('heightGroup_tip').hidden }); })()`);

  // 1. the Brush section: Mode, Tip, Falloff on screen without scrolling
  await drawer(true);
  console.log(tag, 'section', await section());
  await shot('1-brush-section');
  // 2. a bevel: Square + Linear, hardness 0.3, Set 0.15, size 1 -- real taps on the rows' buttons; one dab
  await tapSel('[data-height-choice="tip:square"]'); await tapSel('[data-height-choice="falloff:linear"]'); await tapSel('[data-height-choice="mode:set"]');
  await typeInto('height_hardness', 0.3); await typeInto('height_targetIn', 0.15); await typeInto('height_sizeIn', 1);
  console.log(tag, 'bevel set', await section());
  await shot('2-square-linear-picked');
  await drawer(false);
  const dc = [Math.round(cols * 0.7), Math.round(rows * 0.3)];
  const [dp] = await toScreen([ed(dc[0], dc[1])]);
  await tapAt(dp[0], dp[1]);
  console.log(tag, 'bevel dab', await readPx([dc, [dc[0] + 20, dc[1]], [dc[0] + 20, dc[1] + 20], [dc[0] + 52, dc[1]]]));
  await shot('3-bevel-dab');
  // 3. a Chisel stroke: Chisel, Turn with the stroke, Build up off, Raise 0.12, size 0.6, hardness 0
  await drawer(true);
  await tapSel('[data-height-choice="tip:chisel"]'); await tapSel('[data-height-choice="mode:raise"]');
  await tapSel('#height_followStroke'); await tapSel('#height_buildUp');
  await typeInto('height_sizeIn', 0.6); await typeInto('height_amountIn', 0.12); await typeInto('height_hardness', 0);
  console.log(tag, 'chisel set', await section());
  await drawer(false);
  const sPath = Array.from({ length: 30 }, (_, i) => { const t = i / 29; return [W * (0.2 + 0.3 * t), H * (0.25 + 0.15 * Math.sin(t * Math.PI))]; });
  await drag(await toScreen(sPath));
  const cm = [Math.round(W * 0.35 * ppi), Math.round((H - H * 0.4) * ppi)];
  console.log(tag, 'chisel stroke', await readPx([cm, [cm[0], cm[1] + 4], [cm[0], cm[1] + 7], [cm[0], cm[1] + 12]]));
  if (!TOUCH) await mouse('mouseMoved', ...(await toScreen([[W * 0.55, H * 0.3]]))[0]);
  await shot('4-chisel-stroke');
}

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  const only = process.argv[5] || 'both';
  if (only !== 'phone') await run('c_desktop', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, false);
  if (only !== 'desktop') await run('c_phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, true);
  console.log('exceptions', JSON.stringify(errors));
} finally { killChrome(); }
process.exit(0);