// HEIGHT-PAINTER slice 5 smoke + shots (headless Chrome, hidden; REAL pointer / touch input). Desktop 1400 x 900 (mouse, the
// I key) and phone 390 x 844 (touch): a patch with a raised ridge and a lowered groove in the Greyscale view (the picture
// read back), the 60 % swatch picked then a Set stroke read back at the mapped inches, the eyedropper on the ridge then a
// stroke at that height. Prints what it read and every page exception.
//   (cd bspline-frame-builder && python ../tools/brick-matrix/serve.py 8810)
//   node tools/repro/height_painter5_shots.mjs <outDir> http://127.0.0.1:8810/b-spline-gen/html/bspline_gen_palette.html [cdpPort] [desktop|phone|both]
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

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
  const rect = (sel) => evalJS(`(()=>{ const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'null'; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2, Math.round(r.width), Math.round(r.height)]); })()`);
  const tapSel = async (sel) => {
    await sleep(300);
    const v = await rect(sel);
    if (v === 'null' || String(v).startsWith('EVAL')) { console.log(tag, 'missing', sel); return null; }
    const [x, y, w, h] = JSON.parse(v);
    if (TOUCH) await tapAt(x, y); else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(500); }
    return [w, h];
  };
  const drawer = async (up) => { if (!TOUCH) return; const hv = JSON.parse(await rect('#editorDrawerHandle')); await drag(line([hv[0], hv[1]], [hv[0], hv[1] + (up ? -420 : 600)], 10)); };
  const M = `const m = await import('./main/height-panel.js'); const { decodedRaster, ensureRasterDecoded } = await import('./core/height/raster.js');`;
  const brushState = () => evalJS(`(async()=>{ ${M} const b = m.heightBrush(); const act = [...document.querySelectorAll('[data-height-grey].active')].map((e) => e.dataset.heightGrey);
    const sw = (p) => { const e = document.querySelector('[data-height-grey="' + p + '"]'); if (!e) return null; const r = e.getBoundingClientRect(); return [e.textContent, Math.round(r.width), Math.round(r.height)]; };
    return JSON.stringify({ tool: m.heightTool(), mode: b.mode, targetIn: +b.targetIn.toFixed(5), activeSwatch: act, readout: document.getElementById('heightGreyReadout')?.textContent, sw0: sw(0), sw50: sw(50), sw60: sw(60), sw100: sw(100) }); })()`);
  /** the stored active layer: how many pixels sit at height v (within 0.0006), and their box */
  const atHeight = (v) => evalJS(`(async()=>{ ${M} await m.whenHeightIdle(); const l = m.activePatchLayer(); await ensureRasterDecoded(l.raster); const d = decodedRaster(l.raster), cols = l.raster.cols;
    let n = 0, c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1; for (let k = 0; k < d.length; k++) if (Math.abs(d[k] - ${v}) < 0.0006) { n++; const c = k % cols, r = (k - c) / cols; if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r; }
    return JSON.stringify({ height: ${v}, pixels: n, box: [c0, r0, c1, r1], undo: window.svgEditor._undoStack.length }); })()`);
  /** the patch picture on the canvas (its <image>), read back at patch pixels: [c, r] -> RGBA */
  const picture = (px) => evalJS(`(async()=>{ ${M} const rec = m.activeHeightLayer(); const img = document.querySelector('[data-height-patch="' + rec.id + '"] image'); const src = img && img.getAttribute('href');
    if (!src) return 'no picture'; const im = new Image(); im.src = src; await im.decode(); const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const ctx = cv.getContext('2d'); ctx.drawImage(im, 0, 0);
    const cols = rec.raster ? rec.raster.cols : rec.layers[0].raster.cols, rows = rec.raster ? rec.raster.rows : rec.layers[0].raster.rows;
    return JSON.stringify({ size: [im.width, im.height], px: ${JSON.stringify(px)}.map(([c, r]) => { const x = Math.floor((c + 0.5) * im.width / cols), y = Math.floor((rows - r - 0.5) * im.height / rows); return [c, r, Array.from(ctx.getImageData(x, y, 1, 1).data)]; }) }); })()`);
  const W2 = W / 2, H2 = H / 2;
  const edB = (X, Y) => [X + W2, H2 - Y];

  // setup: a raised ridge (+0.15 in, X -2.0..-1.5) and a lowered groove (-0.1 in, X 1.5..2.0), full height
  console.log(tag, 'setup', await evalJS(`(async()=>{ ${M} m.selectHeightRect([-2.0, -${H2}], [-1.5, ${H2}]); await m.fillHeight({ heightIn: 0.15 }); m.selectHeightRect([1.5, -${H2}], [2.0, ${H2}]); await m.fillHeight({ heightIn: -0.1 }); m.clearHeightSelection(); await m.whenHeightIdle(); return 'ok'; })()`));

  // 1. the GREYSCALE view (a real tap on View: Greyscale): ridge light, groove dark, unpainted mid-grey under the checker
  await drawer(true);
  await tapSel('[data-height-choice="viewLook:grey"]');
  await sleep(800);
  console.log(tag, 'greyscale picture', await picture([[175, 450], [525, 450], [350, 450], [356, 450], [350, 456]]));
  await drawer(false);
  await shot('1-greyscale');

  // 2. the PALETTE: a real tap on the 60 % swatch -> Set at +0.05 in (Range 0.25: (0.6 - 0.5) x 2 x 0.25)
  await drawer(true);
  await tapSel('#editorToolbarHeight [data-height-tool="brush"]');
  await tapSel('[data-height-grey="60"]');
  await typeInto('height_hardness', 1); await typeInto('height_sizeIn', 0.3);
  console.log(tag, 'picked 60 %', await brushState());
  await shot('2-palette-60');
  await drawer(false);
  await drag(await toScreen(line(edB(-0.8, 2), edB(0.8, 2), 20)));
  console.log(tag, 'set stroke at the 60 % height', await atHeight('0.05'));
  await shot('3-set-stroke');

  // 3. the EYEDROPPER (desktop: the I key; phone: its rail button) on the ridge -> Set target 0.15, back to the Brush
  if (TOUCH) { await drawer(true); await tapSel('#editorToolbarHeight [data-height-tool="eyedropper"]'); await drawer(false); }
  else await key('i', 'KeyI', 73);
  console.log(tag, 'eyedropper armed', JSON.parse(await evalJS(`(async()=>{ ${M} return JSON.stringify({ tool: m.heightTool() }); })()`)));
  const [ep] = await toScreen([edB(-1.75, 0)]);
  await tapAt(ep[0], ep[1]);
  console.log(tag, 'eyedropped', await brushState());
  await drawer(true); await rect('#heightGreySwatches'); await shot('4-eyedropper'); await drawer(false);
  await drag(await toScreen(line(edB(-0.8, -2), edB(0.8, -2), 20)));
  console.log(tag, 'stroke at the eyedropped height', await atHeight(String(JSON.parse(await brushState()).targetIn)));
  if (!TOUCH) await mouse('mouseMoved', ...(await toScreen([edB(0, -3)]))[0]);
  await shot('5-eyedrop-stroke');

  // 4. the SIGNED custom curve (a bump with a moat) on a fresh paint layer, then INVERT (a real tap on the toggle): a dip
  // with a ridge. Read back: the layer's highest and lowest heights.
  const extremes = () => evalJS(`(async()=>{ ${M} await m.whenHeightIdle(); const l = m.activePatchLayer(); await ensureRasterDecoded(l.raster); const d = decodedRaster(l.raster);
    let hi = 0, lo = 0, up = 0, down = 0; for (const v of d) { if (v > hi) hi = v; if (v < lo) lo = v; if (v > 0.001) up++; if (v < -0.001) down++; } return JSON.stringify({ layer: l.name, highest: +hi.toFixed(4), lowest: +lo.toFixed(4), raisedPx: up, carvedPx: down }); })()`);
  console.log(tag, 'moat setup', await evalJS(`(async()=>{ ${M} await m.addPaintLayer(); m.setHeightField('mode', 'raise'); m.setHeightField('falloff', 'custom'); m.setHeightField('customCurve', [[0, 1], [0.6, 0], [0.8, -0.5], [1, 0]]);
    m.setHeightField('sizeIn', 1.2); m.setHeightField('amountIn', 0.1); m.setHeightField('hardness', 0); m.setHeightField('buildUp', false); m.syncHeightPanel(); return JSON.stringify(m.heightBrush()); })()`));
  const [mp] = await toScreen([edB(-1, -2.5)]);
  await tapAt(mp[0], mp[1]);
  console.log(tag, 'moat dab', await extremes());
  if (!TOUCH) await mouse('mouseMoved', ...(await toScreen([edB(-1, -1)]))[0]);
  await shot('6-moat');
  if (tag === 'e_desktop') writeFileSync(`${OUT}/e_moat.png`, readFileSync(`${OUT}/${TAG}-6-moat.png`));
  await drawer(true);
  await tapSel('[data-height-choice="invert:true"]');
  console.log(tag, 'inverted', await brushState());
  await rect('[data-height-control="customCurve"]');
  await shot('7-invert-and-curve');
  await drawer(false);
  const [ip] = await toScreen([edB(1, -2.5)]);
  await tapAt(ip[0], ip[1]);
  console.log(tag, 'inverted dab (dip with a ridge)', await extremes());
  await shot('8-inverted-dab');

  // 5. the CARVE RANGE readout (detection only): now, then after Apply (a real build) and the editor reopened on the Height tab
  const rangeNow = () => evalJS(`(()=>{ const e = document.getElementById('heightCarveRange'); return JSON.stringify({ shown: !!e && !e.hidden, text: e && e.textContent, warning: !!e && e.classList.contains('stl-error') }); })()`);
  console.log(tag, 'carve range (before Apply)', await rangeNow());
  console.log(tag, 'apply + reopen', await evalJS(`(async()=>{ const W = (ms) => new Promise((r) => setTimeout(r, ms)); const st = await import('./core/state.js'); const g0 = st.lastResultGeneration;
    document.getElementById('editorApply').dispatchEvent(new Event('pointerdown')); document.getElementById('editorApply').click();
    for (let i = 0; i < 240 && st.lastResultGeneration === g0; i++) await W(250);
    await W(1000); await (await import('./main/frame-panel.js')).openEditorOn('height'); await W(2500);
    return JSON.stringify({ rebuilt: st.lastResultGeneration !== g0 }); })()`, 120000));
  await drawer(true);
  console.log(tag, 'carve range (after Apply)', await rangeNow());
  await rect('#heightCarveRange');
  await shot('9-range');
  if (tag === 'e_desktop') writeFileSync(`${OUT}/e_range.png`, readFileSync(`${OUT}/${TAG}-9-range.png`));
}

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  const only = process.argv[5] || 'both';
  if (only !== 'phone') await run('e_desktop', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, false);
  if (only !== 'desktop') await run('e_phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, true);
  console.log('exceptions', JSON.stringify(errors));
} finally { killChrome(); }
process.exit(0);
