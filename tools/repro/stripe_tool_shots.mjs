// F27 item 3 STRIPE tool acceptance + shots (Fred: "if I wanted a line to become alternating segments of colour,
// can we make a dedicated tool for that?"). Real Chrome, real pointer events through the stripe tool's own
// handlers (stripeHandler.hover/start), same CDP rig as tools/repro/contour_cut_acceptance.mjs.
//   Shape Lattice (Hourglass, Generate) -> Stripe tool (the S key) -> hover an ARC contour segment (preview ticks)
//   -> tap it (Count 5, capped by the contour's own stroke width -- Fred: "The only distance it should use is the
//   stroke width" -- so a short shoulder arc under a thick contour takes fewer: sub-arcs A B A..., one centre) -> set Count 7, tap a RAIL (7 stripes, one chain) -> Colour C on,
//   re-tap the SAME rail (re-striped with 3 colours, still 7 pieces, not 13) -> Length drives -> undo (back to
//   the 2-colour rail) -> undo (the rail whole again). Shots at each step.
//   node tools/repro/stripe_tool_shots.mjs <outPrefix> <paletteUrl> [port]
//   CHROME=/path/to/chrome overrides the Windows default (e.g. /opt/pw-browsers/chromium-1194/chrome-linux/chrome).
//   OFFLINE_CDN=<dir> (a sandbox with no route to cdnjs): serve svg.js / three.js from <dir>/svg.min.js and
//   <dir>/three.min.js (the same versions, from their npm packages) and fail every other off-host request.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9593);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-stripe-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disk-cache-size=1', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
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
  if (msg.method === 'Fetch.requestPaused') { onPaused(msg.params); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
});
function onPaused({ requestId, request }) {
  const lib = /svg\.js\/3\.2\.0\/svg\.min\.js$/.test(request.url) ? 'svg.min.js' : /three\.js\/r128\/three\.min\.js$/.test(request.url) ? 'three.min.js' : null;
  if (!lib) { send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return; }
  const body = readFileSync(`${process.env.OFFLINE_CDN}/${lib}`).toString('base64');
  send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }], body });
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
  if (r?.exceptionDetails) errors.push('EVAL: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).split(/\r?\n/)[0]);
  return r?.result?.value;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };
const toScreen = async (p) => JSON.parse(await evalJS(`(()=>{ const m = window.svgEditor._draw.node.getScreenCTM();
  return JSON.stringify({ x: m.a * ${p.x} + m.c * ${p.y} + m.e, y: m.b * ${p.x} + m.d * ${p.y} + m.f }); })()`));
async function hover(p) { const s = await toScreen(p); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y }); await sleep(200); }
async function tap(p) {
  const s = await toScreen(p);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1 }); await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1 }); await sleep(300);
}
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k }); await sleep(300);
}
const setField = (fid, v) => evalJS(`(()=>{ const f = document.getElementById('${fid}'); f.value = '${v}';
  f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const undo = () => evalJS(`(async()=>{ window.svgEditor.undo(); await new Promise(r=>setTimeout(r,400)); })()`);

// every stripe piece currently on the canvas, grouped by stripe id, in draw order
const STRIPES = `(async()=>{
  const cc = await import('./editor/editor-contour-cut.js');
  const els = window.svgEditor._sketchLayer.children().toArray().filter((e) => e.node && e.node.hasAttribute('data-stripe'));
  const out = {};
  for (const e of els) {
    const k = e.node.getAttribute('data-stripe');
    (out[k] = out[k] || []).push({ kind: e.node.getAttribute('data-lattice') || (e.node.hasAttribute('data-boundary-ref') ? 'contour' : 'line'),
      stroke: e.attr('stroke'), prim: e.type === 'path' ? cc.primitiveFromContourD(e.attr('d')) : null,
      seg: e.node.getAttribute('data-contour-seg'), x1: +e.attr('x1'), x2: +e.attr('x2'), y1: +e.attr('y1') });
  }
  return JSON.stringify(out);
})()`;
const stripes = async () => JSON.parse(await evalJS(STRIPES));
const CONTOUR_ARC = `(async()=>{
  const cc = await import('./editor/editor-contour-cut.js');
  const els = window.svgEditor._sketchLayer.children().toArray().filter((e) => e.node && e.type === 'path' && e.node.hasAttribute('data-boundary-ref'));
  const arc = els.map((e) => cc.primitiveFromContourD(e.attr('d'))).find((p) => p && p.type === 'A');
  return JSON.stringify(arc);
})()`;
const RAIL = `(()=>{ const ls = window.svgEditor._sketchLayer.children().toArray().filter((e) => e.node && e.node.getAttribute('data-lattice') === 'rail' && !e.node.hasAttribute('data-stripe'));
  const r = ls.map((e) => ({ x1: +e.attr('x1'), y1: +e.attr('y1'), x2: +e.attr('x2'), y2: +e.attr('y2') })).sort((a, b) => Math.abs(b.x2 - b.x1) - Math.abs(a.x2 - a.x1))[0];
  return JSON.stringify(r); })()`;
const arcMid = (a, f = 0.5) => { const t = a.theta1 + a.dTheta * f; return { x: a.cx + a.rx * Math.cos(t), y: a.cy + a.ry * Math.sin(t) }; };

await send('Runtime.enable'); await send('Page.enable');
if (process.env.OFFLINE_CDN) await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolShapeLattice').click(); await W(800);
  document.getElementById('shapePresetHourglass')?.click(); await W(400);
  document.getElementById('shapeLatticeGenerate').click(); await W(2500); })()`);
const report = {};
await shot('0_generated');

await key('s'); // the tool's own shortcut
report.mode = await evalJS(`window.svgEditor._currentMode`);
report.panelVisible = await evalJS(`!document.getElementById('editorStripePanel').classList.contains('hidden')`);
await shot('1_stripe_tool');

// 1) a contour ARC: hover (preview ticks), then tap
const arc = JSON.parse(await evalJS(CONTOUR_ARC));
await hover(arcMid(arc, 0.4));
report.previewTicks = await evalJS(`(()=>{ const m = window.svgEditor._handleLayer.findOne('#stripe-marker'); return m ? m.children().length : 0; })()`);
report.lengthFollowsOnHover = await evalJS(`document.getElementById('stripeLength').value`);
report.contourStrokeWidth = await evalJS(`window.svgEditor._sketchLayer.children().toArray().find((e) => e.node && e.node.hasAttribute('data-boundary-ref')).attr('stroke-width')`);
await shot('2_arc_hover');
await tap(arcMid(arc, 0.4));
let S = await stripes();
const arcRun = Object.values(S).find((r) => r[0].kind === 'contour');
report.arc = arcRun && { n: arcRun.length, strokes: arcRun.map((s) => s.stroke),
  centres: arcRun.map((s) => [s.prim.cx.toFixed(5), s.prim.cy.toFixed(5)].join(',')),
  sweepDeg: arcRun.map((s) => ((s.prim.dTheta * 180) / Math.PI).toFixed(3)) };
await shot('3_arc_striped');

// 2) a RAIL, Count 7
await setField('stripeCount', 7);
const rail = JSON.parse(await evalJS(RAIL));
const railMid = { x: (rail.x1 + rail.x2) / 2 + 0.01, y: (rail.y1 + rail.y2) / 2 };
await tap(railMid);
S = await stripes();
const railRun = () => Object.values(S).find((r) => r[0].kind === 'rail');
report.rail = { n: railRun().length, strokes: railRun().map((s) => s.stroke), xs: railRun().map((s) => [s.x1, s.x2]) };
await shot('4_rail_striped');

// 3) Colour C on, re-tap the SAME rail: re-striped (replaced, not added to)
await evalJS(`(()=>{ const c = document.getElementById('stripeThree'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await tap(railMid);
S = await stripes();
report.railRestriped = { n: railRun().length, strokes: railRun().map((s) => s.stroke) };
await shot('5_rail_restriped_3_colours');

// 4) Length drives: the Count follows for the hovered line
await setField('stripeLength', 0.5);
await hover(railMid);
report.countFollows = await evalJS(`document.getElementById('stripeCount').value`);
await shot('6_length_drives');

// 5) undo = one step each
await undo();
S = await stripes();
report.afterUndo1 = { n: railRun()?.length, strokes: railRun()?.map((s) => s.stroke) };
await undo();
S = await stripes();
report.afterUndo2 = { railStriped: !!railRun() };
await shot('7_undone');

report.errors = errors.slice(0, 5);
report.ok = !!(report.mode === 'stripe' && report.panelVisible && report.arc?.n >= 2 && report.previewTicks === report.arc.n - 1
  && new Set(report.arc.centres).size === 1 && report.rail.n === 7 && report.railRestriped.n === 7
  && new Set(report.railRestriped.strokes.slice(0, 3)).size === 3 && report.afterUndo1.n === 7
  && new Set(report.afterUndo1.strokes).size === 2 && !report.afterUndo2.railStriped && !errors.length);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
