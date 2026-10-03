// H23 item 68 SPIKE, Part 1 (app side, no Fusion): render the artwork's colour layers (lattice
// rails/ties/nodes/contour, stripes) to a TRANSPARENT PNG -- alpha=0 where there's no artwork,
// same colours as the 3D preview -- at a declared resolution (40 px/in), board-aligned. NOT wired
// into the real Send flow (per the dispatch: "no wiring into the normal Send until Fred sees it")
// -- this is a standalone tool, same convention as tools/repro/capture_send_payload.mjs (CDP, no
// deps) and tools/repro/frame_send_shots.mjs (the PNG-bytes-from-a-headless-browser precedent).
//
// Pipeline, run for-real in the live app page (not reimplemented in Node): editor.save() -> the
// REAL sketch SVG -> buildDrapeSvg(editor._layers, sketchSvg) (drape-svg.js, already filters down
// to only the colour-carrying artwork, transparent everywhere else) -> sanitizeSvgForRaster ->
// prepareSvgForRaster(svg, pxW, pxH) -> renderSvgNative(ctx, svg, pxW, pxH) (render-svg.js, the
// SAME rasterizer the stamp pipeline and the 3D preview's own drape texture already use) ->
// canvas.toDataURL('image/png') -> decoded and written to disk in Node.
//
//   node tools/repro/decal_png_spike.mjs <outDir> [paletteUrl] [--template=<id>] [--board=WxH] [--dpi=<n>]
//
// Reproduces Fred's own exact scenario by default (same as items 66/67's own live reproductions):
// template_1, Shape Lattice + Offset from frame (distance 0 -- H23 item 70), every contour segment
// striped black/white via the REAL Stripe tool, rails/ties/nodes coloured red/yellow/navy. The
// scenario itself is shared (./_edge_colour_scenario.mjs) -- every edge-colour repro script uses it.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildEdgeColourScenario } from './_edge_colour_scenario.mjs';

const OUT = process.argv[2] || 'bspline-frame-builder/scratch/decal-spike';
const URL = process.argv[3] && !process.argv[3].startsWith('--')
  ? process.argv[3] : 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const TEMPLATE = (process.argv.find((a) => a.startsWith('--template=')) || '').slice(11) || 'template_1';
const BOARD = (process.argv.find((a) => a.startsWith('--board=')) || '').slice(8); // "WxH" or ''
const DPI = Number((process.argv.find((a) => a.startsWith('--dpi=')) || '').slice(6) || 40); // px/in, the declared resolution
const PORT = 9345;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });
const PROFILE_DIR = `${process.env.TEMP || process.env.TMP || '/tmp'}/chrome-decalspike-${process.pid}`;
mkdirSync(PROFILE_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    logs.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
  if (r?.exceptionDetails) logs.push('EVAL ERROR ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).split(/\r?\n/)[0]);
  return r?.result?.value;
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(3000);

const report = { template: TEMPLATE, dpi: DPI, board: BOARD || '(default)' };
let editorPresent = false;
for (let i = 0; i < 20 && !editorPresent; i++) {
  editorPresent = await evalJS(`!!window.svgEditor`);
  if (!editorPresent) await sleep(1000);
}
report.editorPresent = editorPresent;
if (!editorPresent) { console.log(JSON.stringify(report, null, 1)); ws.close(); chrome.kill(); process.exit(1); }

// Optional board size override.
if (BOARD) {
  const [bw, bh] = BOARD.split('x');
  await evalJS(`(() => {
    const w = document.getElementById('widthIn'), h = document.getElementById('heightIn');
    w.value = '${bw}'; w.dispatchEvent(new Event('change'));
    h.value = '${bh}'; h.dispatchEvent(new Event('change'));
  })()`);
  await sleep(600);
}

// 1-4: template select, Shape Lattice + Offset-from-frame (ON, distance 0 -- H23 item 70) +
// Generate, Stripe every contour segment black/white, rails/ties/nodes coloured -- the shared
// scenario every edge-colour repro script now uses (was duplicated inline here before item 70).
const scenario = await buildEdgeColourScenario(evalJS, sleep, { template: TEMPLATE });
report.lattice = await evalJS(`(() => { const c = {}; document.querySelectorAll('#editorSVGContainer [data-lattice]').forEach(e => { const k = e.getAttribute('data-lattice'); c[k] = (c[k]||0)+1; }); return c; })()`);
report.stripeResult = scenario.stripeResult;

// 4. The actual spike: editor.save() -> buildDrapeSvg -> sanitize/prepare -> renderSvgNative ->
// canvas.toDataURL('image/png'), at the declared DPI, board-aligned (viewBox stays raw inches,
// pixel size = inches * dpi -- the SAME convention editor.save()'s own dpi param already uses,
// editor-io.js).
const spikeResult = await evalJS(`(async () => {
  const editor = window.svgEditor;
  const { buildDrapeSvg } = await import('./core/preview/drape-svg.js');
  const { sanitizeSvgForRaster, prepareSvgForRaster, renderSvgNative } = await import('./core/stamp/render-svg.js');
  const sketchSvg = editor.save(editor, 96); // the editor's own save() dpi -- irrelevant to the OUTPUT pixel size, prepareSvgForRaster overrides it below
  const drapeSvg = buildDrapeSvg(editor._layers, sketchSvg);
  if (!drapeSvg) return { error: 'buildDrapeSvg returned empty -- no colour-carrying layers found' };
  const mW = editor._mW, mH = editor._mH;
  const dpi = ${DPI};
  const pxW = Math.round(mW * dpi), pxH = Math.round(mH * dpi);
  const safe = prepareSvgForRaster(sanitizeSvgForRaster(drapeSvg), pxW, pxH);
  const canvas = document.createElement('canvas');
  canvas.width = pxW; canvas.height = pxH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  await renderSvgNative(ctx, safe, pxW, pxH);
  const dataUrl = canvas.toDataURL('image/png');
  // Pixel-verification discipline: sample known-meaningful points directly from the REAL canvas
  // (no PNG decoder needed in Node -- this repo has none installed) rather than eyeballing the
  // exported file. A red rail sits at editor y=1 (just below the top), spanning most of the
  // board's own width -- sample its own vertical centre in pixel space.
  const sample = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  const railPxY = Math.round((1 / mH) * pxH); // editor y=1in -> pixel row
  const railPxX = Math.round(pxW / 2);
  return {
    mW, mH, dpi, pxW, pxH,
    drapeSvgLength: drapeSvg.length,
    dataUrl,
    cornerSample: sample(2, 2), // near a corner -- expect transparent (alpha 0)
    centerSample: sample(Math.round(pxW / 2), Math.round(pxH / 2)), // board centre -- likely between rails, transparent
    railSample: sample(railPxX, railPxY), // on a red rail line -- expect ~(198,40,40,255)
    railSampleAt: { x: railPxX, y: railPxY },
  };
})()`);

report.spike = spikeResult ? { ...spikeResult, dataUrl: undefined, dataUrlLength: spikeResult.dataUrl?.length } : null;
if (spikeResult?.dataUrl) {
  const b64 = spikeResult.dataUrl.split(',')[1];
  writeFileSync(`${OUT}/artwork-decal.png`, Buffer.from(b64, 'base64'));
}

report.logs = logs.slice(0, 20);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);
