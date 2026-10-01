// T81 item 5 re-reported SHOTS (Fred saw the yellow highlight persist again): a tie multi-selected
// alongside a rail, pruned when that rail's end is stretched past it, used to leave an orphaned yellow
// halo (editor-interaction.js _commitLatticeMove never told the selection/highlight machinery about
// pruneAfterRailStretch's own DOM removal). Real headless Chrome, real mouse events, [Select] icon tool:
//   Generate; click a tie to select it; SHIFT+click the rail's own end (adds the rail to the selection
//   without replacing it) -> drag the end inward past the tie (prunes it) -> release. Shot + a JSON report
//   of window.svgEditor's own live selection/highlight state.
//   node tools/repro/t81_item5_multiselect_prune_shots.mjs <outPrefix> <paletteUrl> [chromePath] [port]
// KNOWN GAP (not yet root-caused): the 'lattice' (rect Lattice) run completes and produced the acceptance
// shots this fix was verified against; the 'shapeLattice' run hung past this script's own sleeps during
// this turn's own use and had to be killed -- the fix itself is still proven for Shape Lattice too, via
// tests/lattice-drag-highlight.test.js's own mutation-tested unit coverage (same gesture, both tools, run
// through the real getModeHandler), just not with a second live screenshot. Worth revisiting before relying
// on this script's own Shape Lattice half again.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9468);
const PROFILE = `${dirname(PREFIX)}/chrome-t81i5-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
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
const toScreen = async (p) => JSON.parse(await evalJS(`(()=>{ const m = window.svgEditor._draw.node.getScreenCTM();
  return JSON.stringify({ x: m.a * ${p.x} + m.c * ${p.y} + m.e, y: m.b * ${p.x} + m.d * ${p.y} + m.f }); })()`));
const mouse = (type, s, extra = {}) => send('Input.dispatchMouseEvent', { type, x: s.x, y: s.y, button: 'left', ...extra });
const SHIFT = 8;
async function click(pt, modifiers = 0) {
  const s = await toScreen(pt);
  await mouse('mouseMoved', s, { button: 'none' }); await sleep(80);
  await mouse('mousePressed', s, { clickCount: 1, modifiers }); await sleep(60);
  await mouse('mouseReleased', s, { clickCount: 1, modifiers }); await sleep(200);
}
async function drag(from, to, steps, modifiers = 0) {
  const s0 = await toScreen(from), s1 = await toScreen(to);
  await mouse('mouseMoved', s0, { button: 'none' }); await sleep(80);
  await mouse('mousePressed', s0, { clickCount: 1, modifiers }); await sleep(60);
  for (let k = 1; k <= steps; k++) {
    await mouse('mouseMoved', { x: s0.x + (s1.x - s0.x) * k / steps, y: s0.y + (s1.y - s0.y) * k / steps }, { buttons: 1, modifiers });
    await sleep(25);
  }
  await mouse('mouseReleased', s1, { clickCount: 1, modifiers }); await sleep(500);
}

// Same plan-finder as rail_end_stretch_shots.mjs: the rail whose end is nearest a tie END sitting on it.
const PLAN = `(()=>{ const L = window.svgEditor._sketchLayer.node;
  const P = (e) => ({ el: e, a: { x: +e.getAttribute('x1'), y: +e.getAttribute('y1') }, b: { x: +e.getAttribute('x2'), y: +e.getAttribute('y2') } });
  const rails = [...L.querySelectorAll('line[data-lattice="rail"]')].map(P);
  const ties = [...L.querySelectorAll('line[data-lattice="tie"]')].map(P);
  let best = null;
  for (const r of rails) {
    const row = r.a.y, lo = Math.min(r.a.x, r.b.x), hi = Math.max(r.a.x, r.b.x);
    for (const t of ties) {
      const on = [t.a, t.b].some((p) => Math.abs(p.y - row) < 1e-6) && t.a.x > lo + 0.3 && t.a.x < hi - 0.3;
      if (!on) continue;
      const gap = hi - t.a.x;
      if (!best || gap < best.gap) best = { gap, row, lo, hi, col: t.a.x, tieMidY: (t.a.y + t.b.y) / 2 };
    }
  }
  return best ? JSON.stringify({ ...best, sp: window.svgEditor._grid.spacing || 0.25 }) : JSON.stringify({ error: 'no rail with a tie end on it' }); })()`;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
const report = { runs: [] };
for (const tool of ['lattice', 'shapeLattice']) {
  await send('Page.navigate', { url: URL }); await sleep(8000);
  await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    document.getElementById('btnStampEdit').click(); await W(2500);
    ${tool === 'lattice'
      ? `document.getElementById('toolLattice').click(); await W(800); document.getElementById('latticeGenerate').click(); await W(2500);`
      : `document.getElementById('toolShapeLattice').click(); await W(800); document.getElementById('shapePresetHourglass')?.click(); await W(300);
         document.getElementById('shapeLatticeGenerate').click(); await W(2500);`}
    window.svgEditor._lattice.drawKind = 'select';
    document.getElementById('editorSVGContainer').scrollIntoView({ block: 'center' }); await W(300); })()`);
  const planRaw = await evalJS(PLAN);
  const plan = JSON.parse(planRaw || '{"error":"plan eval failed"}');
  const run = { tool, plan };
  report.runs.push(run);
  if (plan.error) continue;

  const tiePt = { x: plan.col, y: plan.tieMidY };
  const railEndPt = { x: plan.hi, y: plan.row };
  await click(tiePt); // select the tie alone
  run.afterTieClick = JSON.parse(await evalJS(`JSON.stringify({ selCount: (window.svgEditor._selectedElements||[]).length,
    haloCount: window.svgEditor._highlightLayer.node.children.length })`));
  await shot(`${tool}_1_tie_selected`);

  await click(railEndPt, SHIFT); // shift-click the rail's own END: ADDS it, does not replace
  run.afterShiftClick = JSON.parse(await evalJS(`JSON.stringify({ selCount: (window.svgEditor._selectedElements||[]).length,
    haloCount: window.svgEditor._highlightLayer.node.children.length })`));
  await shot(`${tool}_2_both_selected`);

  // drag the rail's end inward, past the tie's column (prunes it)
  const inward = { x: plan.col - plan.sp, y: plan.row };
  await drag(railEndPt, inward, 10);
  run.afterStretch = JSON.parse(await evalJS(`JSON.stringify({
    tieStillInDom: !!window.svgEditor._sketchLayer.node.querySelector('line[data-lattice="tie"][x1="${plan.col}"]'),
    selCount: (window.svgEditor._selectedElements||[]).length,
    selIncludesDetached: (window.svgEditor._selectedElements||[]).some((el) => el && el.node && !el.node.isConnected),
    haloCount: window.svgEditor._highlightLayer.node.children.length,
    hint: document.getElementById('editorStatusHint')?.textContent || '' })`));
  await shot(`${tool}_3_after_stretch_pruned`);
}
report.errors = errors;
writeFileSync(`${PREFIX}_report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close(); chrome.kill();
