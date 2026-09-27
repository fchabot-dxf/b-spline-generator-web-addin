// T81 item 7 SHOTS (Fred: "I'd like to be able to adjust length of rails in lattice tool, by grabbing the ends").
// Real headless Chrome, real mouse events through the lattice tools' own handlers, [Select] icon tool:
//   rect Lattice and Shape Lattice: Generate; pick the rail with a tie END nearest its right end; hover that rail end
//   (end handle shown) -> press + drag the end inward past that tie (mid-drag) -> release (tie removed, hint says so)
//   -> press + drag outward far past the boundary (stops at the boundary). Shots at each step + a JSON report.
//   node tools/repro/rail_end_stretch_shots.mjs <outPrefix> <paletteUrl> [chromePath] [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9467);
const PROFILE = `${dirname(PREFIX)}/chrome-railend-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  // a sandbox whose CDN access (three.js etc.) goes through an HTTPS proxy: hand it to Chrome, local server bypassed
  ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=127.0.0.1;localhost'] : []),
  'about:blank'], { stdio: 'ignore' });
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
  if (msg.method === 'Fetch.requestPaused') { serveLocal(msg.params); return; }
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
async function drag(from, to, steps, midShot) {
  const s0 = await toScreen(from), s1 = await toScreen(to);
  await mouse('mouseMoved', s0, { button: 'none' }); await sleep(80);
  await mouse('mousePressed', s0, { clickCount: 1 }); await sleep(60);
  for (let k = 1; k <= steps; k++) {
    await mouse('mouseMoved', { x: s0.x + (s1.x - s0.x) * k / steps, y: s0.y + (s1.y - s0.y) * k / steps }, { buttons: 1 });
    await sleep(25);
    if (midShot && k === steps) {
      await shot(midShot);
      drag.mid = await evalJS(`JSON.stringify({ heldHandles: window.svgEditor._handleLayer.node.querySelectorAll('[data-rail-end-handle]').length,
        mode: window.svgEditor._latticeMove && window.svgEditor._latticeMove.mode, cursor: document.getElementById('editorSVGContainer').className })`);
    }
  }
  await mouse('mouseReleased', s1, { clickCount: 1 }); await sleep(500);
}

// the rail (drawn, any ownership) whose right end is nearest a tie END sitting on it; the tie's column
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
      if (!best || gap < best.gap) best = { gap, row, lo, hi, col: t.a.x };
    }
  }
  if (!best) return JSON.stringify({ error: 'no rail with a tie end on it' });
  const tiesAt = (row, col) => [...L.querySelectorAll('line[data-lattice="tie"]')].filter((e) => Math.abs(+e.getAttribute('x1') - col) < 1e-6
    && [+e.getAttribute('y1'), +e.getAttribute('y2')].some((y) => Math.abs(y - row) < 1e-6)).length;
  return JSON.stringify({ ...best, tiesAtCol: tiesAt(best.row, best.col), sp: window.svgEditor._grid.spacing || 0.25 }); })()`;
const railAt = (row, lo) => `(()=>{ const e = [...window.svgEditor._sketchLayer.node.querySelectorAll('line[data-lattice="rail"]')]
  .find((e) => Math.abs(+e.getAttribute('y1') - ${row}) < 1e-6 && Math.abs(Math.min(+e.getAttribute('x1'), +e.getAttribute('x2')) - ${lo}) < 1e-6);
  return e ? JSON.stringify({ lo: Math.min(+e.getAttribute('x1'), +e.getAttribute('x2')), hi: Math.max(+e.getAttribute('x1'), +e.getAttribute('x2')) }) : null; })()`;

// CDN_LOCAL (optional): a JSON map { "<url substring>": "<local file>" } served in place of the CDN (a sandbox whose
// egress policy blocks cdnjs); anything else paused is let through unchanged.
const CDN_LOCAL = process.env.CDN_LOCAL ? JSON.parse(process.env.CDN_LOCAL) : null;
function serveLocal({ requestId, request }) {
  const key = Object.keys(CDN_LOCAL || {}).find((k) => request.url.includes(k));
  if (!key) { send('Fetch.continueRequest', { requestId }); return; }
  send('Fetch.fulfillRequest', { requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
    body: readFileSync(CDN_LOCAL[key]).toString('base64') });
}
if (CDN_LOCAL) await send('Fetch.enable', { patterns: [{ urlPattern: '*cdnjs.cloudflare.com*' }] });
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
    window.svgEditor._lattice.drawKind = 'select'; window.svgEditor._grid.geometrySnap = true;
    document.getElementById('editorSVGContainer').scrollIntoView({ block: 'center' }); await W(300); })()`);
  const planRaw = await evalJS(PLAN); if (!planRaw) { console.log("PLAN failed", errors); }
  const plan = JSON.parse(planRaw || '{"error":"plan eval failed"}');
  const run = { tool, plan, canvas: await evalJS(`(()=>{ const r = document.getElementById('editorSVGContainer')?.getBoundingClientRect();
    return r ? [r.x, r.y, r.width, r.height].map(Math.round).join(',') : 'none'; })()`) };
  report.runs.push(run);
  if (plan.error) continue;
  await shot(`${tool}_1_idle`);
  // hover the right end: the end handle appears
  const endPt = { x: plan.hi, y: plan.row };
  await mouse('mouseMoved', await toScreen({ x: plan.hi - 0.6, y: plan.row + 0.4 }), { button: 'none' }); await sleep(100);
  await mouse('mouseMoved', await toScreen(endPt), { button: 'none' }); await sleep(250);
  run.hover = await evalJS(`JSON.stringify({ hover: !!window.svgEditor._railEndHover, end: window.svgEditor._railEndHover?.end,
    handles: window.svgEditor._handleLayer.node.querySelectorAll('[data-rail-end-handle]').length,
    cursor: document.getElementById('editorSVGContainer').className })`);
  await shot(`${tool}_2_hover_end`);
  // drag the end inward, past the tie (one cell short of its column)
  const inward = { x: plan.col - plan.sp, y: plan.row };
  await drag(endPt, inward, 10, `${tool}_3_mid_drag_inward`);
  run.midDrag = drag.mid;
  run.afterShorten = { rail: JSON.parse(await evalJS(railAt(plan.row, plan.lo))),
    tiesLeftAtCol: await evalJS(`[...window.svgEditor._sketchLayer.node.querySelectorAll('line[data-lattice="tie"]')].filter((e) => Math.abs(+e.getAttribute('x1') - ${plan.col}) < 1e-6 && [+e.getAttribute('y1'), +e.getAttribute('y2')].some((y) => Math.abs(y - ${plan.row}) < 1e-6)).length`),
    hint: await evalJS(`document.getElementById('editorStatusHint')?.textContent || ''`) };
  await shot(`${tool}_4_after_shorten`);
  // drag it outward far past the boundary: it stops at the boundary
  const r1 = run.afterShorten.rail;
  await drag({ x: r1.hi, y: plan.row }, { x: plan.hi + 5, y: plan.row }, 14, null);
  run.afterLengthen = JSON.parse(await evalJS(railAt(plan.row, plan.lo)));
  run.originalHi = plan.hi;
  await shot(`${tool}_5_after_drag_past_boundary`);
  // one undo reverts the lengthen only
  await evalJS(`(async()=>{ window.svgEditor.undo(); await new Promise(r=>setTimeout(r,300)); })()`);
  run.afterOneUndo = JSON.parse(await evalJS(railAt(plan.row, plan.lo)));
}
report.errors = errors;
writeFileSync(`${PREFIX}_report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close(); chrome.kill();
