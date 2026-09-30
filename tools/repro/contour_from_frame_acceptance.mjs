// F21 CONTOUR-FROM-FRAME acceptance, real Chrome through the real panels (desktop).
//   Shape Lattice (Hourglass, Generate) -> the toggle is disabled with a hint (no frame) -> choose T1 in the
//   Frame tab select -> toggle ON: the drawn contour == the frame's inner edge offset by Distance (the module's
//   own expected geometry), the Shape / Segments blocks inert, no param handles, the fill inside the contour ->
//   LINKED: a real Shoulder handle drag in the Frame tab, a thickness change, a Trim offset change and a Distance
//   change each refit the contour + refill, keeping the active layer -> toggle OFF restores the preset exactly ->
//   Undo brings the frame contour back. Shots at each step.
//   node tools/repro/contour_from_frame_acceptance.mjs <outPrefix> <paletteUrl> [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9571);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-contourframe-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disk-cache-size=1', 'about:blank'], { stdio: 'ignore' });
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
const W8 = (ms) => sleep(ms);

// the state that matters: the drawn contour vs the module's expected one, the fill inside it, the panel
const STATE = `(async()=>{
  const ed = window.svgEditor;
  const cf = await import('./editor/contour-from-frame.js');
  const fp = await import('./editor/editor-frame-profile.js');
  const sl = await import('./editor/properties-shape-lattice.js');
  const lp = await import('./editor/editor-lattice-pattern.js');
  const gen = await import('./editor/editor-shape-lattice-generator.js');
  const fm = await import('./core/preview/frame-mesh.js');
  const layer = ed._layers.find((l) => l.pattern && l.pattern.shape && l.pattern.boundary && l.pattern.boundary.shapeId);
  const p = layer && layer.pattern;
  if (!p) return JSON.stringify({ noPattern: true });
  const widths = { ...lp.PATTERN_DEFAULTS.widths, ...(p.widths || {}) };
  const cw = p.contour && p.contour.width != null ? p.contour.width : widths.rails;
  const region = sl._shapeContourRegion(ed, p);
  const exp = cf.contourSilhouette(p, region, cw, fp.frameContext(ed));
  const els = lp._findBoundaryElements(ed, p.boundary.shapeId);
  const drawn = els.map((e) => e.attr('d'));
  const expected = exp.primitives.map((q) => gen.primitiveToPathD(q));
  const preset = gen.generateContourSilhouette(region, p.shape, cw).primitives.map((q) => gen.primitiveToPathD(q));
  // the fill: every rail end inside the drawn contour (its sampled polygon, a hair of slack)
  const poly = fm.sampleOutline(exp.primitives, 32);
  const rails = ed._sketchLayer.children().toArray().filter((e) => e.node && e.node.getAttribute('data-lattice') === 'rail' && e.node.hasAttribute('data-lattice-gen'));
  const inside = (x, y) => [[0,0],[0.01,0],[-0.01,0],[0,0.01],[0,-0.01]].some(([dx, dy]) => fm.pointInPolygon(x + dx, y + dy, poly));
  const railsInside = rails.every((r) => inside(+r.attr('x1'), +r.attr('y1')) && inside(+r.attr('x2'), +r.attr('y2')));
  const railKey = rails.map((r) => [r.attr('x1'), r.attr('y1'), r.attr('x2'), r.attr('y2')].map((v) => (+v).toFixed(4)).join(',')).sort().join(';');
  const $ = (id) => document.getElementById(id);
  return JSON.stringify({
    on: cf.contourFromFrameOf(p).on, distance: cf.contourFromFrameOf(p).distance, fromFrame: !!exp.fromFrame, err: exp.fromFrameError || null,
    pieces: drawn.length, matchesExpected: drawn.length === expected.length && drawn.every((d, i) => d === expected[i]),
    matchesPreset: drawn.length === preset.length && drawn.every((d, i) => d === preset[i]),
    rails: rails.length, railsInside, railKey,
    toggleDisabled: $('shapeLatticeContourFromFrame')?.disabled, hintShown: $('shapeLatticeContourFromFrameHint')?.style.display === 'block',
    shapeInert: !!$('shapeLatticeShapeBlock')?.inert, segmentsInert: !!$('shapeLatticeSegmentsBlock')?.inert,
    handles: sl.paramHandleRecords(ed).length, activeLayer: ed._activeLayer, source: p.shape.source,
  }); })()`;
const state = async () => JSON.parse(await evalJS(STATE));

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await W8(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolShapeLattice').click(); await W(800);
  document.getElementById('shapePresetHourglass')?.click(); await W(400);
  document.getElementById('shapeLatticeGenerate').click(); await W(2500); })()`);
const out = { steps: {} };
const step = async (name) => { out.steps[name] = await state(); await shot(name); return out.steps[name]; };
await step('1_generated_noframe');

// choose T1 in the Frame tab's own select (the real path: setFrameRecord + syncFramePanel)
const pick = (id, v) => evalJS(`(async()=>{ const e = document.getElementById('${id}'); e.value = '${v}'; e.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,1500)); })()`);
await pick('editorFrameTemplate', 'template_1');
await step('2_frame_chosen');

// toggle ON
await evalJS(`(async()=>{ const e = document.getElementById('shapeLatticeContourFromFrame'); e.checked = true; e.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2500)); })()`);
const on = await step('3_on');

// LINKED 1: a real Shoulder handle drag in the Frame tab (CDP mouse), then back to Artwork
await evalJS(`(async()=>{ document.getElementById('editorTabFrame').click(); await new Promise(r=>setTimeout(r,1200)); })()`);
const h = JSON.parse(await evalJS(`(()=>{ const ed = window.svgEditor, m = ed._draw.node.getScreenCTM(); const h = (ed._frameHandles||[]).find((q) => q.key === 'cornerRadiusTop');
  if (!h) return 'null'; const s = (p) => ({ x: m.a*p.x + m.c*p.y + m.e, y: m.b*p.x + m.d*p.y + m.f });
  return JSON.stringify({ a: s(h.anchor), b: s({ x: h.anchor.x - 0.6, y: h.anchor.y }) }); })()`));
if (h) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.a.x, y: h.a.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.a.x, y: h.a.y, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 8; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.a.x + (h.b.x - h.a.x) * k / 8, y: h.a.y + (h.b.y - h.a.y) * k / 8, button: 'left', buttons: 1 }); await W8(40); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h.b.x, y: h.b.y, button: 'left', clickCount: 1 });
  await W8(2500);
}
await evalJS(`(async()=>{ document.getElementById('editorTabArtwork').click(); await new Promise(r=>setTimeout(r,1500)); })()`);
const shoulder = await step('4_linked_shoulder');
// LINKED 2/3: thickness and Trim offset (the real fields)
const field = (fid, v) => evalJS(`(async()=>{ const e = document.getElementById('${fid}'); e.value = '${v}'; e.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2500)); })()`);
await field('frameThickness', '0.5');
const thick = await step('5_linked_thickness');
await field('frameTrimOffset', '0.5');
const trim = await step('6_linked_trim');
// Distance
await field('shapeLatticeContourFromFrameDistance', '0.5');
const dist = await step('7_distance');
// OFF restores the preset exactly
await evalJS(`(async()=>{ const e = document.getElementById('shapeLatticeContourFromFrame'); e.checked = false; e.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2500)); })()`);
const off = await step('8_off');
// Undo: the frame contour comes back
await evalJS(`(async()=>{ window.svgEditor.undo(); await new Promise(r=>setTimeout(r,1500)); })()`);
const undone = await step('9_undo');

const s1 = out.steps['1_generated_noframe'], s2 = out.steps['2_frame_chosen'];
out.checks = {
  noFrame_toggleDisabled_hint: s1.toggleDisabled === true && s1.hintShown === true,
  frameChosen_toggleEnabled: s2.toggleDisabled === false && s2.hintShown === false,
  on_contourIsFrameOffset: on.on && on.fromFrame && on.matchesExpected && !on.matchesPreset,
  on_shapeAndSegmentsInert_noHandles: on.shapeInert && on.segmentsInert && on.handles === 0,
  on_fillInside: on.rails > 0 && on.railsInside,
  on_notDetached: on.source === 'generated',
  linked_shoulder: !!h && shoulder.matchesExpected && shoulder.railKey !== on.railKey && shoulder.railsInside,
  linked_thickness: thick.matchesExpected && thick.railKey !== shoulder.railKey && thick.railsInside,
  linked_trim: trim.matchesExpected && trim.railKey !== thick.railKey && trim.railsInside,
  distance: dist.distance === 0.5 && dist.matchesExpected && dist.railsInside,
  activeLayerKept: [shoulder, thick, trim].every((s) => s.activeLayer === on.activeLayer),
  off_restoresPreset: !off.on && off.matchesPreset && !off.shapeInert && off.handles > 0 && off.railsInside,
  undo_frameContourBack: undone.on && undone.matchesExpected && undone.fromFrame,
};
out.ok = Object.values(out.checks).every(Boolean) && !errors.length;
out.errors = errors.slice(0, 5);
for (const s of Object.values(out.steps)) delete s.railKey;
console.log(JSON.stringify(out, null, 1));
ws.close(); chrome.kill();
