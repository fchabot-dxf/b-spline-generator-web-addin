// H2 SEG-COLOR-PANEL acceptance: a Shape Lattice contour segment shows the
// "Selected piece" panel with COLOUR + Reset only (no width control),
// reading/writing the SAME PATTERN.contour.segmentColors[i] storage the
// toolbar COLOR control already drives.
//   node tools/repro/seg_color_panel_shots.mjs <outPrefix> <paletteUrl> [desktop|mobile] [port]
// Serve with tools/serve_app.py so the CSS loads.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9394);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-segcolor-${PORT}`;
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
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails.exception).slice(0, 400)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };

let failures = 0;
function check(cond, label) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolShapeLattice').click(); await W(800);
  document.getElementById('shapePresetHourglass')?.click(); await W(300);
  document.getElementById('shapeLatticeGenerate').click(); await W(2500);
})()`);

// Direct select (not a pixel click) -- deterministic, matches
// piece_override_shots.mjs's own established convention.
const initial = JSON.parse(await evalJS(`(()=>{
  const seg = document.querySelector('[data-contour-seg]');
  const ed = window.svgEditor;
  const wrapped = ed._sketchLayer.children().toArray().find(c => c.node === seg);
  ed._select(wrapped);
  seg.id = 'lt_seg0';
  return JSON.stringify({ stroke: seg.getAttribute('stroke'), segIndex: +seg.getAttribute('data-contour-seg') });
})()`));
console.log('initial segment state:', JSON.stringify(initial));
await sleep(300);

// 1) Panel shows, correct kind, colour matches, NO width row.
const panelState = await evalJS(`(()=>{
  const panel = [...document.querySelectorAll('.lattice-piece-panel')].find(p => p.getBoundingClientRect().width > 0);
  if (!panel || panel.style.display === 'none') return JSON.stringify({ visible: false });
  const kind = panel.querySelector('.lattice-piece-panel-kind')?.textContent;
  const swatch = panel.querySelector('.lattice-piece-color');
  const widthRow = panel.querySelector('.lattice-piece-width-row');
  return JSON.stringify({ visible: true, kind, swatchBg: swatch?.style.background, widthRowDisplay: widthRow?.style.display });
})()`);
console.log('panel state on segment select:', panelState);
const p1 = JSON.parse(panelState);
check(p1.visible, 'H2: panel becomes visible for a selected contour segment');
check(p1.kind === 'Contour segment', `H2: panel kind label reads "Contour segment" (got "${p1.kind}")`);
check(p1.widthRowDisplay === 'none', `H2: width row is hidden for a contour segment (display="${p1.widthRowDisplay}")`);

// 2) Set via the panel's OWN colour control (real click -> mosaic -> pick),
// same UI path a person uses -- not a direct API call.
await evalJS(`[...document.querySelectorAll('.lattice-piece-color')].find(b => b.getBoundingClientRect().width > 0)?.click()`);
await sleep(400);
const pickResult = await evalJS(`(()=>{ const cell = [...document.querySelectorAll('button')].find(b => (b.title||'').toLowerCase() === '#1565c0'); if (cell) { cell.click(); return 'clicked'; } return 'NOT FOUND'; })()`);
console.log('mosaic pick:', pickResult);
await sleep(400);
const afterSet = await evalJS(`(()=>{
  const seg = document.getElementById('lt_seg0');
  const p = window.svgEditor._layers.find(l => l.pattern)?.pattern;
  const panel = [...document.querySelectorAll('.lattice-piece-panel')].find(p => p.getBoundingClientRect().width > 0);
  return JSON.stringify({
    stroke: seg.getAttribute('stroke'),
    stored: p?.contour?.segmentColors?.[${initial.segIndex}],
    resetVisible: panel.querySelector('.lattice-piece-color-reset')?.style.visibility,
  });
})()`);
console.log('after panel colour set:', afterSet);
const a1 = JSON.parse(afterSet);
check(a1.stroke === '#1565c0', `H2: segment's rendered stroke matches the panel pick (got ${a1.stroke})`);
check(a1.stored === '#1565c0', `H2: PATTERN.contour.segmentColors[i] holds the SAME value the toolbar path writes (got ${a1.stored})`);
check(a1.resetVisible === 'visible', 'H2: Reset button appears once a segment colour is set via the panel');
await shot('panel_colour_set');

// 3) Reset via the panel -- clears storage, repaints the default, hides Reset.
await evalJS(`[...document.querySelectorAll('.lattice-piece-color-reset')].find(b => b.offsetParent)?.click()`);
await sleep(300);
const afterReset = await evalJS(`(()=>{
  const seg = document.getElementById('lt_seg0');
  const p = window.svgEditor._layers.find(l => l.pattern)?.pattern;
  const panel = [...document.querySelectorAll('.lattice-piece-panel')].find(p => p.getBoundingClientRect().width > 0);
  return JSON.stringify({
    stroke: seg.getAttribute('stroke'),
    hasEntry: ${initial.segIndex} in (p?.contour?.segmentColors || []),
    resetVisible: panel.querySelector('.lattice-piece-color-reset')?.style.visibility,
  });
})()`);
console.log('after panel reset:', afterReset);
const a2 = JSON.parse(afterReset);
check(a2.stroke === initial.stroke, `H2: Reset repaints the segment back to its original default (got ${a2.stroke}, want ${initial.stroke})`);
check(!a2.hasEntry, 'H2: Reset DELETES the stored entry (not merely repaints)');
check(a2.resetVisible === 'hidden', 'H2: Reset button hides itself once cleared');

// 3b) Toolbar COLOR and the panel can't disagree -- driving the SAME
// element through editor.setColor directly (exactly what the main
// toolbar's own colour control calls, NOT through the panel's own click
// handler) and confirming the panel's next read (a fresh select, same as
// a person clicking away and back) shows the identical value, not a
// stale/divergent one. Deselect first: `_select` on an ALREADY-selected
// element is a documented no-op (editor-ui.js's own idempotent guard) and
// would never fire editorSelectionChanged, leaving the panel's swatch
// showing whatever it last held instead of proving anything.
const syncResult = await evalJS(`(()=>{
  const ed = window.svgEditor;
  const seg = document.getElementById('lt_seg0');
  const wrapped = ed._sketchLayer.children().toArray().find(c => c.node === seg);
  ed._selectedElements = [wrapped];
  ed.setColor('#c62828'); // the exact call properties-shape.js's own toolbar control makes
  ed._deselect();
  ed._select(wrapped); // re-select, same as a person clicking away and back
  const panel = [...document.querySelectorAll('.lattice-piece-panel')].find(p => p.getBoundingClientRect().width > 0);
  const swatch = panel.querySelector('.lattice-piece-color');
  const p = ed._layers.find(l => l.pattern)?.pattern;
  return JSON.stringify({ panelSwatch: swatch.style.background, stored: p?.contour?.segmentColors?.[${initial.segIndex}] });
})()`);
console.log('toolbar/panel sync check:', syncResult);
const a5 = JSON.parse(syncResult);
check(a5.stored === '#c62828', 'H2: a toolbar-style setColor() call on the segment writes the SAME segmentColors[i] storage');
check(a5.panelSwatch === 'rgb(198, 40, 40)' || a5.panelSwatch === '#c62828', `H2: the panel's own swatch reflects the toolbar-driven colour, not a stale one (got ${a5.panelSwatch})`);

// 4) Survives Regenerate (same preset -> same topology/segment count).
// Reuses '#1565c0' (confirmed a real, clickable mosaic swatch above) --
// the contour's own plain default ('#2e7d32') is a computed default, not
// necessarily present as a pickable palette cell.
await evalJS(`[...document.querySelectorAll('.lattice-piece-color')].find(b => b.getBoundingClientRect().width > 0)?.click()`);
await sleep(300);
await evalJS(`(()=>{ const cell = [...document.querySelectorAll('button')].find(b => (b.title||'').toLowerCase() === '#1565c0'); cell?.click(); })()`);
await sleep(300);
const beforeRegen = await evalJS(`(()=>{ const p = window.svgEditor._layers.find(l => l.pattern)?.pattern; return p?.contour?.segmentColors?.[${initial.segIndex}]; })()`);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms)); document.getElementById('shapeLatticeGenerate').click(); await W(2000); })()`);
const afterRegen = await evalJS(`(()=>{
  const p = window.svgEditor._layers.find(l => l.pattern)?.pattern;
  const seg = [...document.querySelectorAll('[data-contour-seg]')].find(s => +s.getAttribute('data-contour-seg') === ${initial.segIndex});
  return JSON.stringify({ stored: p?.contour?.segmentColors?.[${initial.segIndex}], stroke: seg?.getAttribute('stroke') });
})()`);
console.log('before/after regenerate:', beforeRegen, afterRegen);
const a3 = JSON.parse(afterRegen);
check(beforeRegen === '#1565c0', `H2: panel colour pick registered before regenerate (got ${beforeRegen})`);
check(a3.stored === '#1565c0' && a3.stroke === '#1565c0', `H2: per-segment colour survives Regenerate (same preset) (got ${JSON.stringify(a3)})`);

// 5) Save/reload round trip -- the export payload carries it, and reopening
// the saved document restores it (the SAME layers/pattern persistence
// mechanism every other lattice colour default already relies on).
const saveResult = JSON.parse(await evalJS(`(()=>{
  const svg = window.svgEditor.save();
  return JSON.stringify({ containsHex: svg.includes('#1565c0'), length: svg.length });
})()`));
check(saveResult.containsHex, 'H2: the saved/exported SVG string carries the segment stored colour verbatim');
const reopenResult = await evalJS(`(async()=>{
  const ed = window.svgEditor;
  const svg = ed.save();
  ed.open(svg, ed._mW, ed._mH);
  const p = ed._layers.find(l => l.pattern)?.pattern;
  const seg = [...document.querySelectorAll('[data-contour-seg]')].find(s => +s.getAttribute('data-contour-seg') === ${initial.segIndex});
  return JSON.stringify({ stored: p?.contour?.segmentColors?.[${initial.segIndex}], stroke: seg?.getAttribute('stroke') });
})()`);
console.log('after save+reopen:', reopenResult);
const a4 = JSON.parse(reopenResult);
check(a4.stored === '#1565c0' && a4.stroke === '#1565c0', `H2: colour survives a save+reopen round trip (got ${JSON.stringify(a4)})`);

await shot('panel_final');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
chrome.kill();
process.exit(failures ? 1 : 0);
