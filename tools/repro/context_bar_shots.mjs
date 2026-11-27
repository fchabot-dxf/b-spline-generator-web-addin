// CONTEXT BAR shots (owner 2026-11-27; main/editor-tool-bar.js): headless Chrome (hidden), desktop 1400 x 900 and phone
// 390 x 844 (touch), per tab with a tool armed: the bar's row, its '⋯' sheet open, the slimmer side panel, the Height tab's
// visual pickers open. The same script runs on origin/main (the "before": the bar's pieces are absent, the clicks report it).
// Prints per shot the active bar row's size, whether it scrolls sideways, and its smallest touch target on the phone.
//   (cd bspline-frame-builder && python ../tools/brick-matrix/serve.py 8810)
//   node tools/repro/context_bar_shots.mjs <outDir> http://127.0.0.1:8810/b-spline-gen/html/bspline_gen_palette.html [cdpPort] [desktop|phone|both]
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT, URL, PORTARG, ONLY] = process.argv.slice(2);
const PORT = Number(PORTARG || 9360);
mkdirSync(OUT, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${OUT}/chrome-cb-${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', windowsHide: true });
console.log('chrome pid', chrome.pid);
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
  if (msg.method === 'Page.javascriptDialogOpening') { ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } })); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
});
const send = (method, params = {}, ms = 60000) => new Promise((r) => {
  const i = ++id;
  const t = setTimeout(() => { pending.delete(i); console.log('CDP timeout', method); r({ error: `timeout ${method}` }); }, ms);
  pending.set(i, (msg) => { clearTimeout(t); r(msg); });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJS = async (expr, ms = 180000) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, ms); if (r.error || r.result?.exceptionDetails) return `EVAL ERROR ${JSON.stringify(r.error || r.result.exceptionDetails).slice(0, 300)}`; return r.result?.result?.value; };
let TAG = '';
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (!r.result) { console.log('shot failed', name); return; } const f = `${OUT}/${TAG}-${name}.png`; writeFileSync(f, Buffer.from(r.result.data, 'base64')); console.log('shot', f); };
// scrolled into view FIRST, then clicked a moment later (a picker's grid closes on any scroll: main/icon-select.js)
const click = async (sel, wait = 500) => {
  const q = JSON.stringify(sel);
  let v = await evalJS(`(()=>{ const b=document.querySelector(${q}); if (!b) return 'missing ' + ${q}; b.scrollIntoView?.({ block: 'nearest' }); return 'ok'; })()`);
  if (v === 'ok') { await sleep(350); v = await evalJS(`(()=>{ const b=document.querySelector(${q}); if (!b) return 'missing'; b.click(); return 'ok'; })()`); }
  if (v !== 'ok') console.log(TAG, v);
  await sleep(wait);
  return v;
};
/** The active bar row: its box, whether it scrolls sideways, its items, its smallest control (the touch floor check). */
const barState = () => evalJS(`(()=>{ const top = document.getElementById('editorToolbarTop'); const topH = top ? Math.round(top.getBoundingClientRect().height) : null;
  const bar = document.getElementById('editorToolBar'); if (!bar) return JSON.stringify({ topH, bar: 'none (before)' });
  const g0 = document.getElementById('editorToolBarGroup'); if (g0) { g0.scrollLeft = 0; g0.dispatchEvent(new Event('scroll')); }
  const row = [...bar.querySelectorAll('[data-tool-bar-row]')].find((r) => r.style.display !== 'none'); const g = document.getElementById('editorToolBarGroup');
  if (!row) return JSON.stringify({ row: null, group: g && getComputedStyle(g).display });
  const r = row.getBoundingClientRect(), gr = g.getBoundingClientRect();
  const ctrls = [...row.querySelectorAll('button, input, select')].filter((c) => c.getClientRects().length && !c.closest('.tool-bar-more-sheet') && !c.closest('[style*="display: none"]'));
  const min = ctrls.reduce((m, c) => Math.min(m, Math.round(c.getBoundingClientRect().height)), 999);
  const items = [...row.children].filter((c) => c.getClientRects().length && getComputedStyle(c).display !== 'none');
  const inView = items.filter((c) => c.getBoundingClientRect().right <= gr.right + 1).length;
  return JSON.stringify({ topH, row: row.dataset.toolBarTab + ':' + row.dataset.toolBarTool, items: items.length, inView, hint: g.getAttribute('data-scroll-more'), w: Math.round(r.width), h: Math.round(r.height), groupW: Math.round(gr.width), groupH: Math.round(gr.height), scrolls: g.scrollWidth > g.clientWidth + 1, minControlPx: min }); })()`);
const note = async (name) => console.log(TAG, name, await barState());

async function run(tag, metrics, touchOn) {
  TAG = tag;
  await send('Emulation.setDeviceMetricsOverride', metrics);
  await send('Emulation.setTouchEmulationEnabled', { enabled: touchOn, maxTouchPoints: touchOn ? 5 : 1 });
  await send('Storage.clearDataForOrigin', { origin: new globalThis.URL(URL).origin, storageTypes: 'all' });
  // a fresh start is a random board (Math.random): seed it so before / after open the same board
  if (!run.seeded) { run.seeded = true; await send('Page.addScriptToEvaluateOnNewDocument', { source: '(()=>{ let s=12345; Math.random=()=>{ s=(s*16807)%2147483647; return (s-1)/2147483646; }; })();' }); }
  await send('Page.navigate', { url: URL }); await sleep(9000);
  const v = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    for (let i = 0; i < 60 && !document.getElementById('viewMode_2d'); i++) await W(250); await W(1500);
    const shown = () => { const m = document.getElementById('svgEditorModal'); return !!m && getComputedStyle(m).display !== 'none'; };
    for (const id of ['viewMode_2d', 'btnMainLayersOpenEditor']) { if (shown()) break; document.getElementById(id)?.click(); for (let i = 0; i < 60 && !shown(); i++) await W(250); }
    if (!shown()) { await (await import('./main/frame-panel.js')).openEditorOn('artwork'); for (let i = 0; i < 120 && !shown(); i++) await W(250); }
    for (let i = 0; i < 60 && !(window.svgEditor && window.svgEditor._sketchLayer); i++) await W(250); await W(1000);
    return shown() ? 'open' : 'not open'; })()`);
  console.log(tag, 'editor', v);
  // Draw
  await click('#editorTabArtwork', 800);
  await click('#toolSelect'); await note('draw-select'); await shot('draw-select');
  await click('#toolDraw'); await note('draw-pen'); await shot('draw-pen');
  await click('#toolText'); await note('draw-text'); await shot('draw-text');
  await click('#toolStripe'); await note('draw-stripe'); await shot('draw-stripe');
  await click('[data-tool-bar-row]:not([style*="none"]) .tool-bar-more-btn'); await shot('draw-stripe-more');
  await click('#toolSelect');
  // Lattice
  await click('#editorTabLattice', 800);
  await click('#toolLattice', 800); await note('lattice'); await shot('lattice');
  // Brick
  await click('#editorTabBrick', 800);
  await click('#brickTool_wall', 1500); await click('#brickSubTool_wall_heights', 800); await note('brick-wall-heights'); await shot('brick-wall-heights');
  await click('#brickTool_brush', 1200); await note('brick-brush'); await shot('brick-brush');
  await click('[data-tool-bar-row]:not([style*="none"]) .tool-bar-more-btn'); await shot('brick-brush-more');
  // Height (the Pixel tab)
  await click('#editorTabHeight', 800);
  await click('#heightNew', 1500);
  await click('[data-height-tool="brush"]'); await note('height-brush'); await shot('height-brush');
  await click('[data-tool-bar-row]:not([style*="none"]) .tool-bar-more-btn'); await shot('height-brush-more');
  await click('#editorCanvasContainer', 300);
  await click('#height_falloffChip'); await shot('height-falloff-picker');
  await click('#height_tipChip'); await shot('height-tip-picker');
  await click('#editorCanvasContainer', 300);
  await click('[data-height-tool="marquee"]'); await note('height-marquee'); await shot('height-marquee');
  await click('[data-tool-bar-row]:not([style*="none"]) .tool-bar-more-btn'); await shot('height-marquee-more');
  await click('#height_featherProfileChip'); await shot('height-feather-picker');
  await click('[data-height-tool="gradient"]'); await note('height-gradient'); await shot('height-gradient');
  await click('#height_gradFalloffChip'); await shot('height-gradient-curve-picker');
}

try {
  await send('Runtime.enable'); await send('Page.enable');
  const only = ONLY || 'both';
  if (only !== 'phone') await run('desktop', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, false);
  if (only !== 'desktop') await run('phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, true);
  console.log('exceptions', JSON.stringify(errors));
} finally { killChrome(); }
process.exit(0);
