// RAIL-SPACING R6 item 4: Fred's own case ("a rail exactly on the boundary") — set the active layer's
// pattern record DIRECTLY (rails.mode:'spacing', anchor:'start'), call generatePattern, and screenshot
// the result. R6 is engine+data only (no panel UI yet, R7's job), so this drives the pattern record
// the same way the dispatch instructs, not a UI field.
//   python tools/serve_app.py 8780
//   node tools/repro/rail_spacing_shot.mjs <outPrefix> <paletteUrl> [desktop|mobile] [cdpPort]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9390);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-railspacing-${PORT}`;
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

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`document.getElementById('btnStampEdit')?.click()`); await sleep(2500);
await evalJS(`document.getElementById('toolLattice')?.click()`); await sleep(500);

// Drive the pattern record directly (R6 = engine + data only, no panel UI for this yet — R7's job).
const result = await evalJS(`(async()=>{ const e = window.svgEditor;
  const { generatePattern } = await import('./editor/editor-lattice-pattern.js');
  const { getActiveLayer } = await import('./editor/layers.js');
  const layer = (e._layers||[]).find(l => l.id === getActiveLayer(e));
  layer.pattern = layer.pattern || {};
  layer.pattern.rails = { mode: 'spacing', anchor: 'start', spacing: 1 };
  layer.pattern.ties = { ...(layer.pattern.ties||{}), mode: 'count', span: { mode: 'rails', rails: 1 }, minSpacing: 0 };
  await generatePattern(e, layer.pattern);
  const rails = [...e._sketchLayer.children()].filter(el => el.attr('data-lattice') === 'rail');
  const ys = rails.map(el => Number(el.attr('y1'))).sort((a,b)=>a-b);
  const boundaryTopY = ys.length ? ys[0] : null;
  return JSON.stringify({ railCount: rails.length, firstRailY: boundaryTopY, gaps: ys.slice(1).map((y,i)=>+(y-ys[i]).toFixed(6)) });
})()`);
await shot('rail-on-boundary');
console.log(JSON.stringify({ mode: MODE, result: JSON.parse(result || 'null'), errors: errors.slice(0, 5) }, null, 1));
ws.close(); chrome.kill();
