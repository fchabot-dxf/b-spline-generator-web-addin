// FB-APP S3 (F7) acceptance shots (design §3.5): the 3D preview with the panel
// trimmed to the frame + the wood bars, then a LIVE update (wood, then
// frame_thickness) on the same page, no reload.
//   node tools/repro/frame_3d_shots.mjs <outPrefix> <paletteUrl> <template_1|template_2> [desktop|mobile] [port] [live]
// Serve from the bspline-frame-builder folder so the CSS loads.
// Writes <outPrefix>_3d.png (+ _live-wood.png, _live-thickness.png with "live";
// + _closeup.png and refreshFrame timings with a 7th arg "closeup"; F17: 7th arg "below" = _below.png + _iso-edge.png).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, TEMPLATE, MODE = 'desktop', PORTARG, LIVE, CLOSEUP] = process.argv.slice(2);
const PORT = Number(PORTARG || 9361);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-frame3d-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
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
// Read back what the preview actually built (module instances are shared with the page).
const STATE = `(async()=>{ const { AppState } = await import('./main/app-state.js'); const p = AppState.preview;
  const g = p && p._mesh && p._mesh.geometry; const bars = (p?._frameMeshes || []).find(m => m.name === 'frame-bars');
  return JSON.stringify({ frameMeshes: (p?._frameMeshes || []).length,
    trimmed: g ? [g.index.count, (g.userData.fullIndex || []).length] : null,
    barColor: bars ? '#' + bars.material.color.getHexString() : null }); })()`;

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const sel = document.getElementById('frameTemplate'); sel.value = '${TEMPLATE}'; sel.dispatchEvent(new Event('change')); await W(1500); })()`);
const out = { template: TEMPLATE, mode: MODE, initial: JSON.parse(await evalJS(STATE)) };
await shot('3d');
if (LIVE) {
  await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    const w = document.getElementById('frameAppearance'); w.value = '3D Mahogany - Unfinished'; w.dispatchEvent(new Event('change')); await W(1200); })()`);
  out.afterWood = JSON.parse(await evalJS(STATE));
  await shot('live-wood');
  await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    const rec = await import('./core/frame-record.js'); const panel = await import('./main/frame-panel.js');
    rec.setFrameRecord({ params: { frame_thickness: 0.4 } }); panel.syncFramePanel(); await W(1200); })()`);
  out.afterThickness = JSON.parse(await evalJS(STATE));
  await shot('live-thickness');
}
if (CLOSEUP === 'below') {
  // F17 item 4 (Fred's phone shot): the frame seen from BELOW, where the bars' hard edges show, then an iso close-up
  const view = (euler, r, target) => evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    const { AppState } = await import('./main/app-state.js'); const p = AppState.preview, o = p._orbit, T = p._THREE;
    o._targetOrb.q.setFromEuler(new T.Euler(${euler.join(',')}, 'ZXY')); o._targetOrb.r = ${r}; o._targetOrb.target.set(${target.join(',')});
    p._needsRender = true; await W(2500); })()`);
  await view([2.25, 0, 0.6], 12, [0, 0, -0.5]); await shot('below');
  await view([1.05, 0, 0.7], 6, [2.2, 2.4, -0.4]); await shot('iso-edge');
} else if (CLOSEUP) {
  // A low camera at the right-hand waist, where a bar meets the sculpted underside.
  await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    const { AppState } = await import('./main/app-state.js'); const p = AppState.preview, o = p._orbit, T = p._THREE;
    o._targetOrb.q.setFromEuler(new T.Euler(1.32, 0, 0.55, 'ZXY')); o._targetOrb.r = 3.2; o._targetOrb.target.set(2.4, -1.2, 0.3);
    p._needsRender = true; await W(2500); })()`);
  await shot('closeup');
  // refreshFrame cost, with the frame vs with none (ms, mean of 10).
  out.refreshMs = JSON.parse(await evalJS(`(async()=>{ const { AppState } = await import('./main/app-state.js'); const p = AppState.preview;
    const rec = await import('./core/frame-record.js');
    const t = () => { const a = performance.now(); for (let i = 0; i < 10; i++) p.refreshFrame(); return (performance.now() - a) / 10; };
    const withFrame = t(); const saved = rec.getFrameRecord(); rec.setFrameRecord({ templateId: null }); const none = t();
    rec.setFrameRecord(saved); p.refreshFrame();
    return JSON.stringify({ withFrame: +withFrame.toFixed(1), none: +none.toFixed(1) }); })()`));
}
out.errors = errors.slice(0, 3);
console.log(JSON.stringify(out));
ws.close(); chrome.kill();
