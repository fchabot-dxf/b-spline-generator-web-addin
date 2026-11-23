// HEIGHT-PAINTER slice 2 smoke + shots (headless Chrome, REAL pointer input through the editor's own screen CTM): a new
// patch; a brush stroke on layer 1; '+ Paint layer'; a rectangle selection dragged on the canvas; a gradient dragged inside
// it (typed stops); a synthetic 16-bit PNG imported through the real file input (fast-png loads from the CDN on first use)
// and two mapping changes; an export (download off) read back. Prints what it read back and every page exception.
//   python tools/serve_app.py 8797
//   node tools/repro/height_painter2_shots.mjs <outPrefix> http://127.0.0.1:8797/b-spline-gen/html/bspline_gen_palette.html <png16Path> [cdpPort]
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';

const [PREFIX, URL, PNG_PATH, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9363);
// the synthetic 16-bit grey PNG: a dome (black outside its circle) with fine rings -- thousands of distinct levels
{
  const N = 256, vals = new Uint16Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const r = Math.hypot(x - 127.5, y - 127.5) / 120;
    vals[y * N + x] = r >= 1 ? 0 : Math.round(65535 * Math.sqrt(1 - r * r) * (0.9 + 0.1 * Math.cos(r * 40)));
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 16; ihdr[9] = 0;
  const raw = Buffer.alloc(N * (1 + 2 * N));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) raw.writeUInt16BE(vals[y * N + x], y * (1 + 2 * N) + 1 + 2 * x);
  writeFileSync(PNG_PATH, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
// a synthetic EXR (scanline, NO_COMPRESSION, one FLOAT channel R), 4 x 2: top row 0 1 2 3, bottom row 4 5 6 7
const EXR_PATH = PNG_PATH.replace(/\.png$/i, '.exr');
{
  const W = 4, H = 2, parts = [];
  const str = (t) => Buffer.from(t + '\0', 'latin1');
  const i32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, k) => b.writeInt32LE(x, 4 * k)); return b; };
  const f32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, k) => b.writeFloatLE(x, 4 * k)); return b; };
  const attr = (name, type, value) => Buffer.concat([str(name), str(type), i32(value.length), value]);
  const chlist = Buffer.concat([str('R'), i32(2), Buffer.from([0, 0, 0, 0]), i32(1, 1), Buffer.from([0])]);
  parts.push(Buffer.from([0x76, 0x2f, 0x31, 0x01]), i32(2));
  parts.push(attr('channels', 'chlist', chlist), attr('compression', 'compression', Buffer.from([0])),
    attr('dataWindow', 'box2i', i32(0, 0, W - 1, H - 1)), attr('displayWindow', 'box2i', i32(0, 0, W - 1, H - 1)),
    attr('lineOrder', 'lineOrder', Buffer.from([0])), attr('pixelAspectRatio', 'float', f32(1)),
    attr('screenWindowCenter', 'v2f', f32(0, 0)), attr('screenWindowWidth', 'float', f32(1)), Buffer.from([0]));
  const head = Buffer.concat(parts);
  const lineBytes = 8 + W * 4;
  const table = Buffer.alloc(8 * H);
  for (let y = 0; y < H; y++) table.writeBigUInt64LE(BigInt(head.length + table.length + y * lineBytes), 8 * y);
  const lines = [];
  for (let y = 0; y < H; y++) lines.push(i32(y, W * 4), f32(...Array.from({ length: W }, (_, x) => y * W + x)));
  writeFileSync(EXR_PATH, Buffer.concat([head, table, ...lines]));
}
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-height2-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', windowsHide: true });
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
  if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.error || r.result?.exceptionDetails) return `EVAL ERROR ${JSON.stringify(r.error || r.result.exceptionDetails).slice(0, 400)}`; return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('shot', `${PREFIX}_${name}.png`); };
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
const drag = async (sp) => {
  await mouse('mouseMoved', sp[0][0], sp[0][1]);
  await mouse('mousePressed', sp[0][0], sp[0][1]);
  for (const [x, y] of sp.slice(1)) { await mouse('mouseMoved', x, y); await sleep(20); }
  await mouse('mouseReleased', sp[sp.length - 1][0], sp[sp.length - 1][1]);
  await sleep(1200);
};
const line = (a, b, n = 24) => Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * (i / (n - 1)), a[1] + (b[1] - a[1]) * (i / (n - 1))]);
const typeInto = (inputId, v) => `(()=>{ const t=document.getElementById(${JSON.stringify(inputId)}); t.value=${JSON.stringify(String(v))}; t.dispatchEvent(new Event('change')); return 'ok'; })()`;
const state = () => evalJS(`(async()=>{ const { P } = await import('./core/state.js'); const C = await import('./core/height/compose.js'); const { decodedRaster } = await import('./core/height/raster.js');
  const r = P.heightLayers[P.heightLayers.length - 1]; const comp = C.patchComposite(r); let mx = -1e9, mn = 1e9, n = 0; if (comp) for (const v of comp) { if (v) n++; if (v > mx) mx = v; if (v < mn) mn = v; }
  const layers = C.patchLayers(r).map((l) => { const d = decodedRaster(l.raster); return { id: l.id, kind: l.kind, blend: l.blend, opacity: l.opacity, h: l.raster.h, enc: l.raster.enc, mapping: l.mapping, distinct: d ? new Set(d).size : null }; });
  return JSON.stringify({ patches: P.heightLayers.length, layered: 'layers' in r, layers, comp: { max: +mx.toFixed(5), min: +mn.toFixed(5), painted: n },
    selection: !!document.querySelector('#heightPatches .height-selection'), ants: !!document.querySelector('#heightPatches .height-selection animate'),
    status: document.getElementById('heightStatus')?.textContent, undo: window.svgEditor._undoStack.length,
    fastPng: performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /fast-png|iobuffer|pako/.test(u)) }); })()`);

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL }); await sleep(9000);
  console.log('before any import, fast-png loaded:', await evalJS(`JSON.stringify(performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /fast-png|EXRLoader|fflate/.test(u)))`));
  // the open, retried: a first load can replace its own context (the evaluation then comes back empty)
  for (let attempt = 0; attempt < 4; attempt++) {
    const v = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
      for (let i = 0; i < 60 && !document.getElementById('viewMode_2d'); i++) await W(250); await W(1500);
      document.getElementById('viewMode_2d').click();
      for (let i = 0; i < 60 && !(window.svgEditor && window.svgEditor._sketchLayer); i++) await W(250); await W(1000);
      document.getElementById('editorTabHeight').click(); await W(500);
      document.getElementById('heightNew').click(); await W(1500);
      return JSON.stringify({ ok: true, mode: window.svgEditor._currentMode, tools: [...document.querySelectorAll('#editorToolbarHeight [data-height-tool]')].map((b) => b.getAttribute('data-height-tool')) }); })()`);
    console.log('opened', attempt, typeof v === 'string' ? v : JSON.stringify(v));
    if (typeof v === 'string' && v.startsWith('{"ok":true')) break;
    await sleep(3000);
  }
  const toScreen = async (pts) => JSON.parse(await evalJS(`(()=>{ const g = window.svgEditor._sketchLayer.node, m = g.getScreenCTM(), svg = g.ownerSVGElement;
    return JSON.stringify(${JSON.stringify(pts)}.map(([x, y]) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(m); return [q.x, q.y]; })); })()`));
  const W = await evalJS('(async()=>(await import("./core/state.js")).P.widthIn)()'), H = await evalJS('(async()=>(await import("./core/state.js")).P.heightIn)()');
  console.log('board', W, H);

  // layer 1: a raise stroke (the brush)
  await evalJS(typeInto('height_sizeIn', 0.8)); await evalJS(typeInto('height_amountIn', 0.15));
  await drag(await toScreen(line([W * 0.15, H * 0.75], [W * 0.85, H * 0.75], 40)));
  // layer 2
  await evalJS(`document.getElementById('heightLayerAdd').click()`); await sleep(1200);
  console.log('two layers', await state());
  await shot('1-two-layers');
  // a rectangle selection, dragged
  await evalJS(`document.querySelector('[data-height-tool="selectRect"]').click()`); await sleep(200);
  await drag(await toScreen(line([W * 0.25, H * 0.2], [W * 0.75, H * 0.6], 16)));
  console.log('selection', await state());
  await shot('2-rect-selection');
  // a gradient inside it, typed stops, dragged left -> right
  await evalJS(`document.querySelector('[data-height-tool="gradient"]').click()`); await sleep(200);
  await evalJS(typeInto('height_gradStartIn', 0.3)); await evalJS(typeInto('height_gradEndIn', 0.02));
  await evalJS(`document.querySelector('[data-height-choice="gradFalloff:dome"]').click()`); await sleep(100);
  await drag(await toScreen(line([W * 0.2, H * 0.4], [W * 0.8, H * 0.4], 30)));
  console.log('gradient', await state());
  await shot('3-gradient-in-rect');
  // the 16-bit PNG through the real file input
  const { root } = (await send('DOM.getDocument', { depth: -1 })).result;
  const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#heightImportFile' })).result;
  await send('DOM.setFileInputFiles', { nodeId, files: [resolve(PNG_PATH)] });
  await evalJS(`(()=>{ const i=document.getElementById('heightImportFile'); if (i.files.length) i.dispatchEvent(new Event('change')); return i.files.length; })()`);
  await sleep(6000);
  console.log('imported', await state());
  await shot('4-imported-16bit');
  await evalJS(typeInto('height_imageWhiteIn', 0.6)); await sleep(800);
  console.log('mapping white 0.6', await state());
  await shot('5-mapping-white');
  await evalJS(`document.querySelector('[data-height-choice="imageZero:mid"]').click()`); await sleep(300);
  await evalJS(typeInto('height_imageDarkIn', 0.3)); await sleep(800);
  console.log('mapping mid', await state());
  await shot('6-mapping-mid');
  console.log('export', await evalJS(`(async()=>{ const m = await import('./main/height-panel.js'); const out = await m.exportHeightmap({ download: false });
    const lib = await import('${'https://cdn.jsdelivr.net/npm/fast-png@6.2.0/+esm'}'); const back = lib.decode(out.bytes);
    return JSON.stringify({ fileName: out.fileName, bytes: out.bytes.length, range: out.range, back: { w: back.width, h: back.height, depth: back.depth, channels: back.channels } }); })()`));
  // a selection from the Draw tab's layer 1 (the app's own SVG render into the patch frame)
  await evalJS(`document.querySelector('[data-height-tool="selectRect"]').click()`);
  // a star outline (fill none) drawn on the Draw tab's first layer through svg.js, as the editor's own elements are
  console.log('draw a shape', await evalJS(`(()=>{ const ed = window.svgEditor, L = ed._layers[0]; const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 1.2 : 2.6; pts.push([3.5 + r * Math.cos(a), 6.2 + r * Math.sin(a)]); }
    ed._sketchLayer.polygon(pts.map((p) => p.join(',')).join(' ')).attr({ fill: 'none', stroke: '#000', 'stroke-width': 0.04, 'data-layer': String(L.id) });
    document.getElementById('heightSelSource').value = String(L.id); return JSON.stringify({ layer: L.id, name: L.name }); })()`));
  await evalJS(`document.getElementById('heightSelFromShape').click()`); await sleep(2500);
  console.log('select shape', await evalJS(`(async()=>{ const m = await import('./main/height-panel.js'); const s = m.heightSelection(); let n = 0, soft = 0; if (s) for (const v of s.mask) { if (v > 0.5) n++; if (v > 0 && v < 1) soft++; }
    return JSON.stringify({ source: document.getElementById('heightSelSource').value, selected: n, soft, of: s ? s.mask.length : 0, status: document.getElementById('heightStatus').textContent }); })()`));
  await shot('7-select-shape');
  // the EXR through the real file input, as a new patch (three r128 EXRLoader + fflate load now)
  await evalJS(`(()=>{ const c = document.getElementById('height_importAsNew'); if (!c.checked) c.click(); return c.checked; })()`);
  const doc2 = (await send('DOM.getDocument', { depth: -1 })).result.root;
  const fi2 = (await send('DOM.querySelector', { nodeId: doc2.nodeId, selector: '#heightImportFile' })).result.nodeId;
  await send('DOM.setFileInputFiles', { nodeId: fi2, files: [resolve(EXR_PATH)] });
  await sleep(6000);
  console.log('exr', await evalJS(`(async()=>{ const { P } = await import('./core/state.js'); const { decodedRaster } = await import('./core/height/raster.js'); const r = P.heightLayers[P.heightLayers.length - 1];
    const l = r.layers && r.layers[0]; const d = l && decodedRaster(l.raster); const { cols, rows } = l ? l.raster : {};
    return JSON.stringify({ patches: P.heightLayers.length, sizeIn: r.sizeIn, kind: l && l.kind, cols, rows, source: l && l.source, topLeft: d && d[(rows - 1) * cols], topRight: d && d[rows * cols - 1], bottomLeft: d && d[0], bottomRight: d && d[cols - 1],
      scripts: [...document.querySelectorAll('script[src]')].map((s) => s.src).filter((u) => /EXRLoader|fflate/.test(u)), status: document.getElementById('heightStatus').textContent }); })()`));
  await shot('8-exr-new-patch');
  await evalJS(`document.getElementById('editorTabArtwork').click()`); await sleep(800);
  await shot('9-draw-tab');
  console.log('exceptions', JSON.stringify(errors));
} finally { killChrome(); }
process.exit(0);
