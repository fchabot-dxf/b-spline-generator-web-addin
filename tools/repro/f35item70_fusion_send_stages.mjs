// F35 item 70 (advisor): what the FUSION palette shows during a Send -- the measurement before (and after) the change.
// The palette runs headless in Fusion mode: a stub `adsk.fusionSendData` is planted before the page loads (the trick of
// tools/repro/capture_send_payload.mjs). It records the Send's own calls, and after 'generate_finish' it replays the
// add-in's progress replies through window.fusionJavaScriptHandler.handle -- the add-in's real message list
// (b-spline-gen.py _send_progress), REPLY_GAP_MS apart (a placeholder until a live Send measures the real phases).
// 900 px wide, CPU throttled (CPU, default 4), a board with a Wall lay applied so the bricks phase runs.
// Prints a timeline: every change of the loading overlay (#loading-stage), the status line (#fusion-status) and the
// Send button's label, as ms after the tap, plus the long main-thread tasks and what was on screen during each.
//
//   node tools/repro/f35item70_fusion_send_stages.mjs <outDir> <paletteUrl> [port]
// Env: TAG, CPU (default 4), REPLY_GAP_MS (default 700),
//      PROTOCOL = progress (today's add-in: free-text import_progress) | stage (item 70: import_stage {id} before each)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT_DIR, URL, PORTARG] = process.argv.slice(2);
if (!OUT_DIR || !URL) { console.log('usage: node tools/repro/f35item70_fusion_send_stages.mjs <outDir> <paletteUrl> [port]'); process.exit(1); }
const PORT = Number(PORTARG || 9571);
const TAG = process.env.TAG || 'measure';
const CPU = Number(process.env.CPU || 4);
const REPLY_GAP_MS = Number(process.env.REPLY_GAP_MS || 700);
const PROTOCOL = process.env.PROTOCOL || 'progress';
// The add-in's progress replies during a Send, in its own order (b-spline-gen.py _handle_generate), then success.
// PROTOCOL=stage: each step is reported by its declared id (data/fusion-send-stages.js) -- the item 70 add-in.
const STEPS = [
  ['fusionPrepare', 'Preparing Geometry...'], ['fusionImportStep', 'Importing Clean...'], [null, 'Importing to Fusion...'],
  ['fusionStamp', 'Analyzing Stamping Surface...'], [null, 'Projecting SVG Artwork...'], ['fusionBricks', null],
  ['fusionCleanup', 'Cleaning up graphics...'], ['fusionFrame', 'Building the frame...'], ['fusionFinalize', 'Finalizing Import...'],
];
const ADDIN_REPLIES = [
  ...STEPS.flatMap(([id, msg]) => (PROTOCOL === 'stage' && id ? [['import_stage', { id }]] : [])
    .concat(msg ? [['import_progress', { msg }]] : [])).filter(Boolean),
  ['import_success', {}],
];
const PROFILE = `${OUT_DIR}/.chrome-item70-${PORT}`;
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
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT_DIR}/${TAG}_${name}.png`, Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true }); // the profile is reused: never a cached module
await send('Network.setBlockedURLs', { urls: ['*workers.dev*'] });
// Fusion mode: the stub bridge. After generate_finish it plays the add-in's replies, REPLY_GAP_MS apart.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__sent = [];
  const REPLIES = ${JSON.stringify(ADDIN_REPLIES)};
  window.adsk = { fusionSendData: (action, data) => {
    window.__sent.push({ t: performance.now(), action, size: (data || '').length });
    if (action === 'generate_finish') {
      REPLIES.forEach(([a, d], i) => setTimeout(() => window.fusionJavaScriptHandler && window.fusionJavaScriptHandler.handle(a, JSON.stringify(d)), ${REPLY_GAP_MS} * (i + 1)));
    }
    return 'OK';
  } };` });
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(15000);

// the board: a Wall lay, applied (so the Send carries bricks), then idle
await evalJS(`(async()=>{ const W = ms => new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnEditBricks').click(); await W(3000);
  document.getElementById('editorTabBrick').click(); await W(400);
  document.getElementById('brickTool_wall').click(); await W(400);
  document.getElementById('brickGenerate').click(); await W(1500);
  document.getElementById('editorApply').click(); await W(12000); })()`);

// instruments: the overlay, the status line and the Send button, every change + the next frame; long tasks
await evalJS(`(()=>{
  const els = { overlay: document.getElementById('loading-stage'), status: document.getElementById('fusion-status'), button: document.getElementById('btnDownload') };
  const read = () => ({ overlay: els.overlay && !els.overlay.hidden ? (els.overlay.textContent || '').trim() : '',
    status: els.status && !els.status.hidden ? (els.status.textContent || '').trim() : '', button: (els.button && els.button.textContent || '').trim() });
  window.__log = []; window.__long = [];
  let last = JSON.stringify(read());
  const obs = new MutationObserver(() => { const now = read(); const s = JSON.stringify(now); if (s === last) return; last = s;
    const t = performance.now(); requestAnimationFrame(() => window.__log.push({ t, painted: performance.now(), ...now })); });
  for (const el of Object.values(els)) if (el) obs.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ start: e.startTime, dur: e.duration }); }).observe({ entryTypes: ['longtask'] });
  window.__read = read;
})()`);
await send('Emulation.setCPUThrottlingRate', { rate: CPU });

const t0 = await evalJS(`(()=>{ window.__t0 = performance.now(); document.getElementById('btnDownload').click(); return window.__t0; })()`);
const shots = [];
for (const at of [300, 1500, 4000]) { await sleep(at - (shots.at(-1) || 0)); shots.push(at); await shot(`t${at}`); }
await sleep(REPLY_GAP_MS * (ADDIN_REPLIES.length + 2) + 4000);
const out = JSON.parse(await evalJS(`JSON.stringify({ t0: window.__t0, log: window.__log, long: window.__long.filter((e) => e.start >= window.__t0 - 5),
  sent: window.__sent.filter((s) => s.t >= window.__t0 - 5).map((s) => ({ t: Math.round(s.t - window.__t0), action: s.action, size: s.size })), final: window.__read() })`));
const rel = (t) => Math.round(t - out.t0);
const timeline = out.log.map((e) => ({ at: rel(e.t), painted: rel(e.painted), overlay: e.overlay, status: e.status, button: e.button }));
const sentSummary = [];
for (const s of out.sent) { const lastS = sentSummary.at(-1); if (lastS && lastS.action === s.action) { lastS.n++; lastS.until = s.t; } else sentSummary.push({ ...s, n: 1, until: s.t }); }
const long = out.long.map((e) => {
  const shown = [...out.log].reverse().find((l) => l.painted <= e.start);
  return { at: rel(e.start), ms: Math.round(e.dur), onScreen: shown ? { overlay: shown.overlay, status: shown.status, button: shown.button } : null };
}).filter((e) => e.ms >= 100);
const report = { tag: TAG, cpu: CPU, replyGapMs: REPLY_GAP_MS, timeline, sent: sentSummary, longTasks: long, final: out.final, errors: errors.slice(0, 8) };
writeFileSync(`${OUT_DIR}/${TAG}_item70.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
