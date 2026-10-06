// F35 item 41 (Fred, on his phone: "the screen looks frozen, the load screen doesn't detect all computing states";
// "can there be actual load stages, like computing, waiting, refreshing?") -- the MEASUREMENT before the change.
// Through the real app (headless Chrome, CDP, the driver of tools/repro/f35item18_editor_session_perf.mjs) at
// 900 px wide with the CPU throttled (Emulation.setCPUThrottlingRate, default x4), for each long action:
//   totalMs   tap -> idle (no rebuild in flight, no stage showing, for 1.5 s)
//   label     the first stage text the loading line showed (null = nothing)
//   setMs     tap -> that text set;   paintMs  tap -> the first animation frame after it was set (= on screen)
//   blockedMs the longest main-thread task during the action (what reads as "frozen")
//   frozenMs  main-thread long-task time that ran BEFORE anything was painted (the uncovered part)
// The cloud is never reached: every request to the projects API is answered in-page after WAIT_MS (fake latency),
// and the API host is blocked at the network layer as a second fence.
//
//   node tools/repro/f35item41_load_stages_measure.mjs <outDir> <paletteUrl> [port]
// Env: TAG (file prefix), CPU (throttle rate, default 4), WAIT_MS (fake cloud latency, default 800)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT_DIR, URL, PORTARG] = process.argv.slice(2);
if (!OUT_DIR || !URL) { console.log('usage: node tools/repro/f35item41_load_stages_measure.mjs <outDir> <paletteUrl> [port]'); process.exit(1); }
const PORT = Number(PORTARG || 9541);
const TAG = process.env.TAG || 'measure';
const CPU = Number(process.env.CPU || 4);
const WAIT_MS = Number(process.env.WAIT_MS || 800);
const PROFILE = `${OUT_DIR}/.chrome-item41-${PORT}`;
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
await send('Browser.setDownloadBehavior', { behavior: 'deny' });
// fake cloud: a project is "open" so Save goes straight to the PUT; every projects call answers after WAIT_MS
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try { localStorage.setItem('splineGenProjectMgrCurrentFile', 'claude-item41-probe'); localStorage.setItem('bspline.editPassword', 'probe-fake'); } catch {}
  window.__fakeCloudCalls = [];
  const _realFetch = window.fetch.bind(window);
  window.fetch = (url, init) => {
    const u = String(url && url.url || url);
    if (/\\/projects/.test(u)) {
      window.__fakeCloudCalls.push((init && init.method || 'GET') + ' ' + u.replace(/^.*\\/projects/, '/projects'));
      const body = (init && init.method === 'PUT') ? { ok: true, savedAt: Date.now() } : { projects: [] };
      return new Promise((r) => setTimeout(() => r(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })), ${WAIT_MS}));
    }
    return _realFetch(url, init);
  };` });
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(15000);

// in-page instruments: every change of the loading line (set time + the next frame = painted), long tasks, idle
await evalJS(`(async()=>{
  const { rebuild } = await import('./core/engine.js');
  const W = ms => new Promise(r=>setTimeout(r,ms));
  // the loading overlay (#loading-stage, item 41) and the older status line (#fusion-status): either one counts
  const els = ['loading-stage', 'fusion-status'].map((i) => document.getElementById(i)).filter(Boolean);
  window.__stageLog = [];
  const textNow = () => els.map((el) => (el.hidden ? '' : (el.textContent || '').trim())).filter(Boolean).join(' | ');
  const obs = new MutationObserver(() => { const txt = textNow(); const t = performance.now();
    window.__stageLog.push({ kind: 'set', t, txt });
    requestAnimationFrame(() => window.__stageLog.push({ kind: 'paint', t: performance.now(), txt })); });
  for (const el of els) obs.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ start: e.startTime, dur: e.duration }); })
    .observe({ entryTypes: ['longtask'] });
  window.__idle = async () => { let quiet = 0; const t0 = performance.now();
    while (quiet < 1500 && performance.now() - t0 < 90000) { await W(100);
      const busy = rebuild.isRebuilding || !!textNow();
      quiet = busy ? 0 : quiet + 100; }
    return performance.now() - t0 - 1500; };
  window.__measure = async (name, act) => {
    await window.__idle();
    window.__stageLog = []; window.__long = [];
    const t0 = performance.now();
    await act();
    await window.__idle();
    const tEnd = performance.now() - 1500;
    const firstSet = window.__stageLog.find((e) => e.kind === 'set' && e.txt);
    const firstPaint = window.__stageLog.find((e) => e.kind === 'paint' && e.txt);
    const paintAt = firstPaint ? firstPaint.t : Infinity;
    const longs = window.__long.filter((e) => e.start >= t0 - 5);
    const frozen = longs.reduce((s, e) => s + Math.max(0, Math.min(e.start + e.dur, paintAt) - e.start), 0);
    return { name, totalMs: Math.round(tEnd - t0), label: firstSet ? firstSet.txt : null,
      setMs: firstSet ? Math.round(firstSet.t - t0) : null, paintMs: firstPaint ? Math.round(firstPaint.t - t0) : null,
      blockedMs: Math.round(Math.max(0, ...longs.map((e) => e.dur))), frozenMs: Math.round(frozen),
      labels: [...new Set(window.__stageLog.filter((e) => e.kind === 'set' && e.txt).map((e) => e.txt))] };
  };
})()`);
await send('Emulation.setCPUThrottlingRate', { rate: CPU });

const results = [];
const measure = async (name, body) => {
  const r = await evalJS(`(async()=>{ const W = ms => new Promise(r=>setTimeout(r,ms));
    return JSON.stringify(await window.__measure(${JSON.stringify(name)}, async () => { ${body} })); })()`);
  const row = r ? JSON.parse(r) : { name, error: 'eval failed' };
  results.push(row);
  console.log(JSON.stringify(row));
};

await measure('open editor', `document.getElementById('btnEditFrameShape').click(); await W(50);`);
await evalJS(`(async()=>{ document.getElementById('editorTabBrick').click(); await new Promise(r=>setTimeout(r,500)); })()`);
await measure('lay wall', `document.getElementById('brickTool_wall').click();`);
await measure('lay frame', `document.getElementById('brickTool_frame').click();`);
await measure('Generate (re-lay all)', `document.getElementById('brickGenerate').click();`);
await measure('pattern builder: open', `document.getElementById('brickTool_wall').click(); await W(300); document.getElementById('brickAccentCustomOpen')?.click();`);
await measure('pattern builder: toggle a cell', `const m = await import('./main/brick-panel.js'); m.builderToggleCell(0, 0);`);
await measure('pattern builder: resize', `const m = await import('./main/brick-panel.js'); m.builderResize(3, 3);`);
await shot('editor_after_builder');
await measure('Apply (bake: brick mask + heights + mesh)', `document.getElementById('editorApply').click();`);
await measure('new terrain seed (rebuild)', `document.getElementById('btnRandomSeed')?.click();`);
await measure('project load (applySnapshot)', `const { applySnapshot } = await import('./main/snapshot-manager.js');
  const { persistableP } = await import('./core/state.js');
  await applySnapshot({ P: JSON.parse(JSON.stringify(persistableP())), preDelta: null, postDelta: null, extraThickenThinMask: null }, window.__preview, { source: 'load' });`);
await measure(`cloud save (fake ${WAIT_MS} ms)`, `document.getElementById('btnQuickSave')?.click();`);
await measure('STEP export (Send, web)', `document.getElementById('btnDownload')?.click(); await W(400); document.getElementById('btnWizardExport')?.click();`);

// a rock set (White rocks, set 3): a lay slow enough to show its own stage; then the overlay mid-work, on screen
await evalJS(`(async()=>{ const W = ms => new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnEditBricks').click(); await W(2500); await window.__idle();
  document.getElementById('editorTabBrick').click(); await W(300);
  document.getElementById('brickTool_wall').click(); await W(300); })()`);
await measure('rock set: pick (first lay)', `document.getElementById('brickSet_3')?.click();`);
await measure('rock set: Generate', `document.getElementById('brickGenerate').click();`);
await measure('rock set: a pattern release', `document.getElementById('brickPattern_herringbone')?.click();`);
const shotDuring = async (name, clickExpr, delayMs) => {
  await evalJS(`window.__idle()`);
  // the tap and the screenshot leave together: the capture is the next composited frame, the one the stage paints in
  // (the lay itself waits for the second frame)
  const tap = send('Runtime.evaluate', { expression: `(()=>{ ${clickExpr}; return 1; })()` });
  if (delayMs) { await tap; await sleep(delayMs); }
  const shotP = shot(name);
  const stage = await evalJS(`JSON.stringify((() => { const el = document.getElementById('loading-stage'); return el && !el.hidden ? { text: el.textContent, surface: el.dataset.surface } : null; })())`);
  await shotP; await tap;
  console.log(JSON.stringify({ shot: name, stage: JSON.parse(stage || 'null') }));
  await evalJS(`window.__idle()`);
};
await shotDuring('pill_mid_lay', `document.getElementById('brickPattern_stretcher').click()`, 0);
await shotDuring('card_mid_generate', `document.getElementById('brickGenerate').click()`, 0);
await shotDuring('card_mid_apply', `document.getElementById('editorApply').click()`, 400);
await shotDuring('pill_mid_open_editor', `document.getElementById('btnEditBricks').click()`, 0); // Apply closed it

const cloud = await evalJS('JSON.stringify(window.__fakeCloudCalls || [])');
const report = { tag: TAG, cpu: CPU, width: 900, fakeCloudCalls: JSON.parse(cloud || '[]'), results, errors: errors.slice(0, 8) };
writeFileSync(`${OUT_DIR}/${TAG}_item41_measure.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ fakeCloudCalls: report.fakeCloudCalls, errors: report.errors }, null, 1));
ws.close(); chrome.kill();
