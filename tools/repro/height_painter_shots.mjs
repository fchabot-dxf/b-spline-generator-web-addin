// HEIGHT-PAINTER slice 1 smoke + shots: open the editor, the Height tab, add a patch, paint two strokes with REAL pointer
// input (CDP mouse, board -> screen through the editor's own screen CTM), shoot the Height tab and the Draw tab (the patch
// carries over, faded), then Apply and shoot the 3D. Prints what it read back and every page exception.
//   python tools/serve_app.py 8790   (serves bspline-frame-builder/ so the CSS loads)
//   node tools/repro/height_painter_shots.mjs <outPrefix> http://127.0.0.1:8790/b-spline-gen/html/bspline_gen_palette.html [desktop|mobile] [cdpPort]
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9361);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-height-${PORT}`;
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
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });

try {
  await send('Runtime.enable'); await send('Page.enable');
  if (MODE === 'mobile') {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  } else {
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  await send('Page.navigate', { url: URL }); await sleep(9000);
  const opened = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    document.getElementById('viewMode_2d').click(); await W(3500);
    document.getElementById('editorTabHeight').click(); await W(500);
    document.getElementById('heightNew').click(); await W(1500);
    const ed = window.svgEditor;
    return JSON.stringify({ mode: ed._currentMode, panel: document.getElementById('editorHeightPanel').style.display, patches: (await import('./core/state.js')).P.heightLayers.length });
  })()`);
  console.log('opened', opened);
  // board inches (editor coords, y down) -> screen px through the sketch layer's own CTM
  const toScreen = async (pts) => JSON.parse(await evalJS(`(()=>{ const g = window.svgEditor._sketchLayer.node, m = g.getScreenCTM(), svg = g.ownerSVGElement;
    return JSON.stringify(${JSON.stringify(pts)}.map(([x, y]) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(m); return [q.x, q.y]; })); })()`));
  const W = await evalJS('(async()=>(await import("./core/state.js")).P.widthIn)()'), H = await evalJS('(async()=>(await import("./core/state.js")).P.heightIn)()');
  // stroke 1: a raise arc across the board; stroke 2: a set-to-height line crossing it
  const arc = Array.from({ length: 40 }, (_, i) => [W * 0.2 + W * 0.6 * (i / 39), H * 0.45 + 0.8 * Math.sin((i / 39) * Math.PI)]);
  for (const [label, pts, setup] of [
    ['raise', arc, `(()=>{ const s=document.getElementById('height_sizeInSlider'); s.value='0.6'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change'));
      const a=document.getElementById('height_amountIn'); a.value='0.2'; a.dispatchEvent(new Event('change')); return 'ok'; })()`],
    ['set', [[W * 0.5, H * 0.2], [W * 0.5, H * 0.8]], `(()=>{ document.querySelector('#heightPanelBody [data-height-choice="mode:set"]').click();
      const t=document.getElementById('height_targetIn'); t.value='0.1'; t.dispatchEvent(new Event('change'));
      const o=document.getElementById('height_opacity'); o.value='1'; o.dispatchEvent(new Event('change')); return 'ok'; })()`],
  ]) {
    await evalJS(setup);
    const sp = await toScreen(label === 'set' ? Array.from({ length: 30 }, (_, i) => [pts[0][0], pts[0][1] + (pts[1][1] - pts[0][1]) * i / 29]) : pts);
    await mouse('mouseMoved', sp[0][0], sp[0][1]);
    await mouse('mousePressed', sp[0][0], sp[0][1]);
    for (const [x, y] of sp.slice(1)) { await mouse('mouseMoved', x, y); await sleep(15); }
    await mouse('mouseReleased', sp[sp.length - 1][0], sp[sp.length - 1][1]);
    await sleep(1500);
  }
  const hover = await toScreen([[W * 0.5, H * 0.45 + 0.8]]);
  await mouse('mouseMoved', hover[0][0], hover[0][1]); await sleep(300);
  const after = await evalJS(`(async()=>{ const { P } = await import('./core/state.js'); const r = P.heightLayers[0];
    const { decodedRaster } = await import('./core/height/raster.js'); const d = decodedRaster(r.raster); let mx = -1e9, mn = 1e9, n = 0;
    for (const v of d) { if (v) n++; if (v > mx) mx = v; if (v < mn) mn = v; }
    return JSON.stringify({ h: r.raster.h, cols: r.raster.cols, rows: r.raster.rows, kb: Math.round(r.raster.data.length / 1024), painted: n, max: mx, min: mn,
      readout: document.getElementById('heightReadout')?.textContent, undo: window.svgEditor._undoStack.length,
      overlay: !!document.querySelector('#heightPatches image[href]'), opacity: document.getElementById('heightPatches')?.getAttribute('opacity') }); })()`);
  console.log('after strokes', after);
  await shot('height-tab');
  await evalJS(`document.getElementById('editorTabArtwork').click()`); await sleep(800);
  console.log('draw tab', await evalJS(`JSON.stringify({ overlay: !!document.querySelector('#heightPatches image[href]'), opacity: document.getElementById('heightPatches')?.getAttribute('opacity'), mode: window.svgEditor._currentMode })`));
  await shot('draw-tab');
  await evalJS(`document.getElementById('editorApply').click()`); await sleep(9000);
  console.log('3d', await evalJS(`(async()=>{ const { lastResult } = await import('./core/state.js'); const { getHeightErrors } = await import('./core/height/layer.js');
    let mx=-1e9; for (const v of lastResult.heights) if (v>mx) mx=v; let bm=-1e9; for (const v of lastResult.cleanHeights) if (v>bm) bm=v;
    // the stamp itself (the board's highest point need not be under the stroke): the largest height the patches ADDED
    let sm=0; for (let k = 0; k < lastResult.heights.length; k++) sm = Math.max(sm, lastResult.heights[k] - lastResult.cleanHeights[k]);
    return JSON.stringify({ peak: mx, cleanPeak: bm, stampMax: +sm.toFixed(4), errors: getHeightErrors() }); })()`));
  await shot('3d');
  console.log('exceptions', JSON.stringify(errors));
} finally { killChrome(); }
process.exit(0);
