// Usage: node scripts/smoke-editor.mjs <outDir> [desktop|mobile|perf] [url]
// Headless-Chrome (CDP, no deps) smoke test of the SVG editor lattice/pattern flow on the live site (or a local URL).
// Prints a JSON report (counts, layers, probes, console errors) and writes screenshots to <outDir>.
// Minimal CDP driver (no deps): live-site smoke test of the SVG editor lattice/pattern flow.
//
// SE8b-3: `perf` mode measures editor._onChange's CHANGE_PIPELINE (main/app-init.js) during a real
// drag — generates a lattice, turns on window.__editorDebug='PERF', drags the whole selection for
// ~2s (~120 mousemoves), then reads the structured window.__perfLog array _perfLog pushed to (one
// {kind,step,ms} record per pipeline step) and reports count/median/p95 per "<kind> <step>" plus
// the per-frame totals. No parsing of formatted [PERF] console/fusLog text — window.__perfLog is
// the one purpose-built channel a headless CDP script can read back directly.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const MODE = process.argv[3] || 'desktop';          // desktop | mobile | perf
const URL = process.argv[4] || 'https://bspline-generator.pages.dev/';
const PORT = MODE === 'mobile' ? 9334 : MODE === 'perf' ? 9335 : 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-${MODE}`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-${MODE}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find(t => t.type === 'page') || {}).webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
    logs.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL });
await sleep(9000);

const report = {};
report.buildStamp = await evalJS(`(document.body.innerText.match(/[0-9a-f]{7} · 20\\d\\d-\\d\\d-\\d\\d/)||[''])[0]`);
report.editorPresent = await evalJS(`!!window.svgEditor`);
await evalJS(`document.getElementById('btnStampEdit').click(); true`);
await sleep(2500);
report.modalOpen = await evalJS(`getComputedStyle(document.getElementById('svgEditorModal')).display`);
await shot(`${MODE}-1-editor.png`);

await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(800);
report.mode = await evalJS(`window.svgEditor._currentMode`);
report.patternPanelHidden = await evalJS(`document.getElementById('editorLatticePanel').classList.contains('hidden')`);
report.gridVisible = await evalJS(`!!(window.svgEditor._grid && window.svgEditor._grid.visible)`);
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(3500);
report.lattice = await evalJS(`(() => { const c = {}; document.querySelectorAll('#editorSVGContainer [data-lattice]').forEach(e => { const k = e.getAttribute('data-lattice'); c[k] = (c[k]||0)+1; }); return c; })()`);
report.owned = await evalJS(`document.querySelectorAll('#editorSVGContainer [data-lattice-gen]').length`);
report.layers = await evalJS(`window.svgEditor._layers.map(l => l.name + (l.visible===false?'(hidden)':'')).join(', ')`);
report.activeLayer = await evalJS(`String(window.svgEditor._activeLayer)`);
report.generateLabel = await evalJS(`document.getElementById('latticeGenerate').textContent.trim()`);
await shot(`${MODE}-2-generated.png`);

if (MODE === 'mobile') {
  const box = await evalJS(`(() => { const r = document.getElementById('editorSVGContainer').getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
  report.zoomBefore = await evalJS(`window.svgEditor._view && window.svgEditor._view.zoom`);
  const pts = (d) => [{ x: box.x - d, y: box.y, id: 1 }, { x: box.x + d, y: box.y, id: 2 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30) });
  for (let d = 35; d <= 120; d += 5) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) }); await sleep(16); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(800);
  report.zoomAfterPinch = await evalJS(`window.svgEditor._view && window.svgEditor._view.zoom`);
  report.latticeAfterPinch = await evalJS(`document.querySelectorAll('#editorSVGContainer [data-lattice]').length`);
  report.touchActionsVisible = await evalJS(`(() => { const g = document.querySelector('[id*="TouchActions"],[class*="touch-actions"]'); return g ? getComputedStyle(g).display : 'none-found'; })()`);
  await shot(`${MODE}-3-pinched.png`);
}

function percentile(vals, p) {
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
function summarizePerfLog(entries) {
  const groups = {};
  for (const { kind, step, ms } of entries) {
    const key = `${kind} ${step}`;
    (groups[key] = groups[key] || []).push(ms);
  }
  const out = {};
  for (const [key, vals] of Object.entries(groups)) {
    out[key] = {
      count: vals.length,
      medianMs: Number(percentile(vals, 0.5).toFixed(2)),
      p95Ms: Number(percentile(vals, 0.95).toFixed(2)),
    };
  }
  return out;
}

if (MODE === 'perf') {
  // Drive editor._notifyChange('live') directly, once per Node-side tick
  // (~16ms, matching a 60fps drag), instead of simulating a real mouse
  // drag through hit-testing/selection. Two things ruled that out:
  //   1. editor._selectMany / editor._selectAdd are IMPORTED into
  //      editor.js (from editor-ui.js) but never actually delegated as
  //      instance methods (only _select is) — Ctrl+A/paste/marquee-
  //      finalize/shift-click all call editor._selectMany(...)/
  //      _selectAdd(...) and either silently no-op (guarded call sites)
  //      or THROW (unguarded ones). A pre-existing bug, unrelated to
  //      CHANGE_PIPELINE — flagged in WORK-LOG, not fixed here (out of
  //      this turn's file scope). Working around it by writing
  //      editor._selectedElements directly is possible, but pointless
  //      for what this mode actually measures (below).
  //   2. A whole "press, N moves, release" gesture, when driven as ONE
  //      async page-side expression via CDP Runtime.evaluate, silently
  //      never fires the pipeline at all in this headless setup (proven
  //      by direct comparison: the SAME editor._notifyChange('live')
  //      call, issued as its OWN separate CDP round-trip with a REAL
  //      Node-side wait after it, works every time — bare
  //      requestAnimationFrame itself fires fine either way, so this is
  //      specific to many rAF ticks + timers nested inside one evaluated
  //      async function, not a headless-rAF suspension).
  // What's actually being measured — CHANGE_PIPELINE's own per-step cost
  // — doesn't care which caller triggered it; a real drag's translateSelection
  // calls this exact same editor._notifyChange('live') on every mousemove.
  await evalJS(`window.__editorDebug = 'PERF'; window.__perfLog = []; true`);
  const FRAMES = 120; // ~2s at 60fps, matching the dispatch's own drag duration
  for (let k = 0; k < FRAMES; k++) {
    await evalJS(`window.svgEditor._notifyChange('live'); true`);
    await sleep(16);
  }
  await evalJS(`window.svgEditor._notifyChange('commit'); true`);
  await sleep(400); // let the async serialize/remask steps finish logging

  const perfLog = (await evalJS(`window.__perfLog || []`)) || [];
  report.perfFrames = FRAMES;
  report.perfLogRawCount = perfLog.length;
  report.perfSummary = summarizePerfLog(perfLog);
  await shot(`${MODE}-3-perf.png`);
}

report.railAttrs = await evalJS(`(() => { const e = document.querySelector("[data-lattice=rail]"); return e ? ["x1","y1","x2","y2","stroke","stroke-width","opacity","data-layer"].map(a => a+"="+e.getAttribute(a)).join(" ") : null; })()`);
report.nodeAttrs = await evalJS(`(() => { const e = document.querySelector("[data-lattice=node]"); return e ? ["cx","cy","r","fill","stroke","stroke-width"].map(a => a+"="+e.getAttribute(a)).join(" ") : null; })()`);
report.board = await evalJS(`["mW="+window.svgEditor._mW, "mH="+window.svgEditor._mH, "strokeWidth="+window.svgEditor._strokeWidth].join(" ")`);
report.svgOrder = await evalJS(`[...document.querySelector("#editorSVGContainer svg").children].map(c => (c.id||c.tagName)+"("+c.children.length+")").join(" > ")`);
report.logs = logs.slice(0, 15);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);
