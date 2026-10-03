// T84 item 6 (Fred, screenshot): "Offset from frame" on the Shape Lattice panel with the Arched Funnel
// (template_16) or Tulip (template_17) frame chosen -- the same real-Chrome panel-driving pattern as
// f26_offset_from_frame_shots.mjs, pointed at T16/T17 instead of T1. Captures the live fromFrameError
// (or its absence) plus a screenshot, for a before/after record of the fix.
//   node tools/repro/t84_item6_offset_from_frame_t16t17_shots.mjs <outPrefix> <paletteUrl> [templateId] [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, TPL_ARG, PORTARG] = process.argv.slice(2);
const TEMPLATE_ID = TPL_ARG || 'template_16';
const PORT = Number(PORTARG || 9612);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-t84item6-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disk-cache-size=1', 'about:blank'], { stdio: 'ignore' });
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
const evalJS = async (expr) => {
  const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
  if (r?.exceptionDetails) errors.push('EVAL: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).split(/\r?\n/)[0]);
  return r?.result?.value;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };

const STATE = `(async()=>{
  const ed = window.svgEditor;
  const cf = await import('./editor/contour-from-frame.js');
  const fp = await import('./editor/editor-frame-profile.js');
  const sl = await import('./editor/properties-shape-lattice.js');
  const lp = await import('./editor/editor-lattice-pattern.js');
  const layer = ed._layers.find((l) => l.pattern && l.pattern.shape && l.pattern.boundary && l.pattern.boundary.shapeId);
  const p = layer && layer.pattern;
  if (!p) return JSON.stringify({ noPattern: true });
  const widths = { ...lp.PATTERN_DEFAULTS.widths, ...(p.widths || {}) };
  const cw = p.contour && p.contour.width != null ? p.contour.width : widths.rails;
  const frame = fp.frameContext(ed);
  const region = sl._shapeContourRegion(ed, p);
  const exp = cf.contourSilhouette(p, region, cw, frame);
  const ff = cf.contourFromFrameOf(p);
  return JSON.stringify({
    templateId: frame.record && frame.record.templateId,
    on: ff.on, distance: ff.distance, fromFrame: !!exp.fromFrame, err: exp.fromFrameError || null,
    primitiveCount: Array.isArray(exp.primitives) ? exp.primitives.length : null,
  }); })()`;
const state = async () => JSON.parse(await evalJS(STATE));

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolShapeLattice').click(); await W(800);
  document.getElementById('shapePresetHourglass')?.click(); await W(400);
  document.getElementById('shapeLatticeGenerate').click(); await W(2500); })()`);

const pick = (id, v) => evalJS(`(async()=>{ const e = document.getElementById('${id}'); e.value = '${v}'; e.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,1500)); })()`);
await pick('editorFrameTemplate', TEMPLATE_ID);
await evalJS(`(async()=>{ const e = document.getElementById('shapeLatticeContourFromFrame'); e.checked = true; e.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); })()`);

const s = await state();
await shot(`${TEMPLATE_ID}_offset_from_frame`);

const out = { templateId: TEMPLATE_ID, state: s, ok: !s.err && s.fromFrame && s.primitiveCount > 0, errors: errors.slice(0, 5) };
console.log(JSON.stringify(out, null, 1));
ws.close(); chrome.kill();
