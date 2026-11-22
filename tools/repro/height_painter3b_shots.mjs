// HEIGHT-PAINTER slice 3b smoke + shots (headless Chrome, hidden; REAL pointer / touch input): on desktop 1400 x 900 and
// phone 390 x 844 (touch): the brush PICKER opened by its chip, Chisel picked and a stroke, Bevel picked and a dab, the mode
// row and the Modified note, the ERASER from the rail with Hard round. Prints the brush state, the control sizes (28 px
// touch targets) and the raster values it read back, and every page exception.
//   (cd bspline-frame-builder && python ../tools/brick-matrix/serve.py 8810)
//   node tools/repro/height_painter3b_shots.mjs <outDir> http://127.0.0.1:8810/b-spline-gen/html/bspline_gen_palette.html [cdpPort] [desktop|phone|both]
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
  await send('Page.navigate', { url: URL }); await sleep(9000);
  let opened = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const v = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
      for (let i = 0; i < 60 && !document.getElementById('btnStampEdit'); i++) await W(250); await W(1500);
      const shown = () => { const m = document.getElementById('svgEditorModal'); return !!m && getComputedStyle(m).display !== 'none'; };
      for (const id of ['btnStampEdit', 'btnMainLayersOpenEditor']) {
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
  // a control's centre on screen (scrolled into view first); tap / click it with a REAL pointer or touch
  const rect = (sel) => evalJS(`(()=>{ const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'null'; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2, Math.round(r.width), Math.round(r.height)]); })()`);
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
  await drawer(true);
  const brushState = () => evalJS(`(async()=>{ const m = await import('./main/height-panel.js'); const b = m.heightBrush();
    const tiles = [...document.querySelectorAll('[data-height-brush-preset]')]; const r = (e) => { const q = e.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; };
    return JSON.stringify({ tool: m.heightTool(), tip: b.tip, falloff: b.falloff, hardness: b.hardness, followStroke: b.followStroke, buildUp: b.buildUp, mode: b.mode,
      active: tiles.filter((t) => t.classList.contains('active')).map((t) => t.dataset.heightBrushPreset), note: document.getElementById('heightBrushPresetNote')?.textContent,
      chip: r(document.getElementById('heightBrushChip')), tile: r(tiles[0]), rail: [...document.querySelectorAll('#editorToolbarHeight [data-height-tool]')].map((t) => [t.dataset.heightTool, ...r(t)]),
      modes: [...document.querySelectorAll('[data-height-control="mode"] [data-height-choice]')].map((t) => [t.dataset.heightChoice, ...r(t)]),
      tipShown: !document.getElementById('heightGroup_tip').hidden }); })()`);

  // 1. the picker, opened by a real tap on its chip
  console.log(tag, 'chip', await tapSel('#heightBrushChip'));
  console.log(tag, 'picker open', await brushState());
  await shot('1-picker-open');
  // 2. pick Chisel (a real tap on its tile), raise, a stroke
  console.log(tag, 'tile', await tapSel('#heightBrushPreset_chisel'));
  await typeInto('height_sizeIn', 0.6); await typeInto('height_amountIn', 0.12);
  await tapSel('[data-height-choice="mode:raise"]');
  console.log(tag, 'chisel picked', await brushState());
  await drawer(false);
  const sPath = Array.from({ length: 30 }, (_, i) => { const t = i / 29; return [W * (0.2 + 0.3 * t), H * (0.25 + 0.15 * Math.sin(t * Math.PI))]; });
  await drag(await toScreen(sPath));
  const cm = [Math.round(W * 0.35 * ppi), Math.round((H - H * 0.4) * ppi)]; // the path's middle (t = 0.5) as a raster pixel
  console.log(tag, 'chisel stroke', await readPx([cm, [cm[0], cm[1] + 4], [cm[0], cm[1] + 7], [cm[0], cm[1] + 12]]));
  await shot('2-chisel-stroke');
  // 3. pick Bevel, Set 0.15, size 1, a dab
  await drawer(true);
  await tapSel('#heightBrushChip'); await tapSel('#heightBrushPreset_bevel');
  await tapSel('[data-height-choice="mode:set"]');
  await typeInto('height_targetIn', 0.15); await typeInto('height_sizeIn', 1);
  console.log(tag, 'bevel picked', await brushState());
  await drawer(false);
  const dc = [Math.round(cols * 0.7), Math.round(rows * 0.3)];
  const [dp] = await toScreen([ed(dc[0], dc[1])]);
  await tapAt(dp[0], dp[1]);
  console.log(tag, 'bevel dab', await readPx([dc, [dc[0] + 20, dc[1]], [dc[0] + 20, dc[1] + 20], [dc[0] + 52, dc[1]]]));
  await shot('3-bevel-dab');
  // 4. the mode row in view; an edit marks the picker Modified
  await drawer(true);
  await typeInto('height_hardness', 0.45);
  await rect('[data-height-control="mode"]');
  console.log(tag, 'modified', await brushState());
  await shot('4-mode-row');
  // 5. the ERASER: a real tap on its rail button, Hard round, a stroke across the chisel ridge and the bevel
  console.log(tag, 'eraser btn', await tapSel('#editorToolbarHeight [data-height-tool="eraser"]'));
  await tapSel('#heightBrushChip'); await tapSel('#heightBrushPreset_hardRound');
  await typeInto('height_sizeIn', 0.3);
  console.log(tag, 'eraser', await brushState());
  await drawer(false);
  await drag(await toScreen(line([W * 0.35, H * 0.2], [W * 0.35, H * 0.55], 20)));
  await drag(await toScreen(line([W * 0.6, H * 0.7], [W * 0.8, H * 0.7], 16)));
  console.log(tag, 'erased', await readPx([cm, [cm[0] + 20, cm[1]], dc, [dc[0] + 20, dc[1] + 20]]));
  if (!TOUCH) await mouse('mouseMoved', ...(await toScreen([[W * 0.5, H * 0.5]]))[0]);
  TAG = `b_eraser_${tag.slice(2)}`; await shot('stroke'); TAG = tag; // b_eraser_<viewport>-stroke.png
}

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  const only = process.argv[5] || 'both';
  if (only !== 'phone') await run('b_desktop', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, false);
  if (only !== 'desktop') await run('b_phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, true);
  console.log('exceptions', JSON.stringify(errors));
} finally { killChrome(); }
process.exit(0);