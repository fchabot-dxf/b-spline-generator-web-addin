// F35 item 18 (4): what an EDITOR SESSION costs on a brick board -- the before/after measurement for
// the "editor shows a static 2D backdrop, Apply builds the 3D" change. Through the real app (headless
// Chrome, the CDP driver of tools/repro/f35item18_flat_organic_shots.mjs) with the PERF timing log on
// (window.__editorDebug = 'PERF' -> window.__perfLog, main/app-init.js _perfLog):
//   1. a brick board at a fine display resolution (Wall + Frame on T1 7x9, spacing SPACING), Applied;
//   2. OPEN the editor: ms until the modal is up and nothing is rebuilding;
//   3. one in-editor change (Brick tab Generate with a different wall pattern): the change pipeline's
//      own per-step ms, how many 3D rebuilds ran, how many times the backdrop image was redrawn;
//   4. APPLY: ms until the 3D is rebuilt and idle.
// Writes a shot of the editor after the change to <outDir>/<TAG>_editor.png and prints a JSON report.
//
//   node tools/repro/f35item18_editor_session_perf.mjs <outDir> <paletteUrl> [port]
// Env: TAG (file prefix, e.g. before/after), SPACING (default 0.015)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT_DIR, URL, PORTARG] = process.argv.slice(2);
if (!OUT_DIR || !URL) { console.log('usage: node tools/repro/f35item18_editor_session_perf.mjs <outDir> <paletteUrl> [port]'); process.exit(1); }
const PORT = Number(PORTARG || 9498);
const TAG = process.env.TAG || 'session';
const SPACING = Number(process.env.SPACING || 0.015);
const PROFILE = `${OUT_DIR}/.chrome-editorperf-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
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
  const resp = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (resp.result?.exceptionDetails) errors.push('EVAL: ' + (resp.result.exceptionDetails.exception?.description || resp.result.exceptionDetails.text).split('\n')[0]);
  return resp.result?.result?.value;
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(14000);

// shared helpers in the page: idle = no rebuild in flight for 1.5 s; counters for rebuilds + backdrop redraws
await evalJS(`(async()=>{
  window.__editorDebug = 'PERF';
  const { rebuild } = await import('./core/engine.js');
  const { updateP } = await import('./core/state.js');
  const W = ms => new Promise(r=>setTimeout(r,ms));
  window.__idle = async () => { let quiet = 0; const t0 = performance.now();
    while (quiet < 1500 && performance.now() - t0 < 60000) { await W(100);
      // busy = a 3D rebuild in flight, or the loading line showing a stage (mask building is not a rebuild)
      const busy = rebuild.isRebuilding || !!(document.getElementById('fusion-status')?.textContent || '').trim();
      quiet = busy ? 0 : quiet + 100; }
    return performance.now() - t0 - 1500; };
  // backdrop redraws = <image> children added to the editor's background layer
  window.__bgDraws = 0;
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName === 'image') window.__bgDraws++; })
    .observe(window.svgEditor._bgLayer.node, { childList: true });
  // the brick board, Applied, at the fine display resolution
  document.getElementById('btnEditFrameShape').click(); await W(3000);
  document.getElementById('editorTabBrick').click(); await W(300);
  document.getElementById('brickTool_wall').click(); await W(2500);
  updateP('spacing', ${SPACING});
  document.getElementById('editorApply').click(); await W(500);
  await window.__idle();
})()`);

const report = { tag: TAG, spacing: SPACING };
report.open = JSON.parse(await evalJS(`(async()=>{
  window.__perfLog = []; window.__bgDraws = 0;
  const t0 = performance.now();
  document.getElementById('btnStampEdit').click();
  const idleMs = await window.__idle();
  return JSON.stringify({ ms: Math.round(performance.now() - t0 - 1500), backdropDraws: window.__bgDraws,
    remasks: window.__perfLog.filter((e) => e.step === 'remask').length });
})()`));
report.change = JSON.parse(await evalJS(`(async()=>{
  const W = ms => new Promise(r=>setTimeout(r,ms));
  window.__perfLog = []; window.__bgDraws = 0;
  document.getElementById('editorTabBrick').click(); await W(300);
  document.getElementById('brickTool_wall').click(); await W(300);
  window.__perfLog = []; window.__bgDraws = 0;
  const t0 = performance.now();
  document.getElementById('brickPattern_herringbone').click();
  document.getElementById('brickGenerate').click();
  await window.__idle();
  const steps = {};
  for (const e of window.__perfLog) if (e.kind === 'commit') steps[e.step] = Math.round((steps[e.step] || 0) + e.ms);
  return JSON.stringify({ ms: Math.round(performance.now() - t0 - 1500), commitSteps: steps,
    remasks: window.__perfLog.filter((e) => e.step === 'remask').length, backdropDraws: window.__bgDraws,
    wallBricks: document.querySelectorAll('[data-brick-gen="1"][data-brick="wall"]').length });
})()`));
{
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT_DIR}/${TAG}_editor.png`, Buffer.from(r.result.data, 'base64'));
}
report.apply = JSON.parse(await evalJS(`(async()=>{
  window.__perfLog = [];
  const { lastResult: r0 } = await import('./core/state.js'); const h0 = r0 && r0.heights;
  const t0 = performance.now();
  document.getElementById('editorApply').click();
  await new Promise(r=>setTimeout(r,300));
  await window.__idle();
  const { lastResult: r1 } = await import('./core/state.js');
  return JSON.stringify({ ms: Math.round(performance.now() - t0 - 1500), rebuilt: !!(r1 && r1.heights !== h0) });
})()`));
report.errors = errors.slice(0, 5);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
