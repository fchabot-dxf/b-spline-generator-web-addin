// F26 OFFSET-FROM-FRAME acceptance, real Chrome through the real panels (desktop): Shape Lattice (Hourglass,
// Generate) -> choose T1 in the Frame tab -> toggle "Offset from frame" ON -> Distance 0 / +0.5 / -0.25, each
// checked against the FRAME'S OWN OUTER EDGE (not the inner edge, F26's own reference-point move) via the
// SAME cf.contourSilhouette/fp.frameContext modules the app itself reads (contour_from_frame_acceptance.mjs's
// own STATE pattern, extended with a live geometric distance-to-outer-edge measurement). Also proves negative
// values are no longer rejected (the panel field, no clamp to the default).
//   node tools/repro/f26_offset_from_frame_shots.mjs <outPrefix> <paletteUrl> [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9611);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-offsetframe-${PORT}`;
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

// distance from the DRAWN contour's own centerline samples to the frame's OUTER edge (the cut profile) --
// the F26 reference point -- plus whether every sample is inside/outside that outer polygon.
const STATE = `(async()=>{
  const ed = window.svgEditor;
  const cf = await import('./editor/contour-from-frame.js');
  const fp = await import('./editor/editor-frame-profile.js');
  const sl = await import('./editor/properties-shape-lattice.js');
  const lp = await import('./editor/editor-lattice-pattern.js');
  const fm = await import('./core/preview/frame-mesh.js');
  const layer = ed._layers.find((l) => l.pattern && l.pattern.shape && l.pattern.boundary && l.pattern.boundary.shapeId);
  const p = layer && layer.pattern;
  if (!p) return JSON.stringify({ noPattern: true });
  const widths = { ...lp.PATTERN_DEFAULTS.widths, ...(p.widths || {}) };
  const cw = p.contour && p.contour.width != null ? p.contour.width : widths.rails;
  const frame = fp.frameContext(ed);
  const region = sl._shapeContourRegion(ed, p);
  const exp = cf.contourSilhouette(p, region, cw, frame);
  const ff = cf.contourFromFrameOf(p);
  const outerProf = fp.frameCutProfile(frame.defs, frame.record, frame.board);
  const outerPoly = fm.sampleOutline(outerProf.primitives, 64);
  // sample the DRAWN contour's own centerline (the exp primitives, since that's what's actually rendered)
  const samples = [];
  for (const prim of exp.primitives) {
    if (prim.collapsed) continue;
    if (prim.type === 'L') for (let k = 2; k <= 8; k += 2) samples.push({ x: prim.p0.x + (prim.p1.x - prim.p0.x) * k / 10, y: prim.p0.y + (prim.p1.y - prim.p0.y) * k / 10 });
    else for (let k = 0; k <= 8; k++) { const th = prim.theta1 + prim.dTheta * k / 8; samples.push({ x: prim.cx + prim.rx * Math.cos(th), y: prim.cy + prim.rx * Math.sin(th) }); }
  }
  const distToOuter = (q) => {
    let best = Infinity;
    for (const seg of outerProf.primitives) {
      if (seg.collapsed) continue;
      if (seg.type === 'L') {
        const dx = seg.p1.x - seg.p0.x, dy = seg.p1.y - seg.p0.y, L2 = dx*dx + dy*dy;
        const t = L2 ? Math.max(0, Math.min(1, ((q.x - seg.p0.x)*dx + (q.y - seg.p0.y)*dy) / L2)) : 0;
        best = Math.min(best, Math.hypot(seg.p0.x + t*dx - q.x, seg.p0.y + t*dy - q.y));
      } else {
        best = Math.min(best, Math.abs(Math.hypot(q.x - seg.cx, q.y - seg.cy) - seg.rx));
      }
    }
    return best;
  };
  const dists = samples.map(distToOuter);
  const insideCount = samples.filter((q) => fm.pointInPolygon(q.x, q.y, outerPoly)).length;
  return JSON.stringify({
    on: ff.on, distance: ff.distance, fromFrame: !!exp.fromFrame, err: exp.fromFrameError || null,
    fieldValue: document.getElementById('shapeLatticeContourFromFrameDistance')?.value,
    minDistToOuter: Math.min(...dists), maxDistToOuter: Math.max(...dists),
    sampleCount: samples.length, insideCount, allInside: insideCount === samples.length, allOutside: insideCount === 0,
    strokeWidth: cw,
  }); })()`;
const state = async () => JSON.parse(await evalJS(STATE));

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolShapeLattice').click(); await W(800);
  document.getElementById('shapePresetHourglass')?.click(); await W(400);
  document.getElementById('shapeLatticeGenerate').click(); await W(2500); })()`);

const pick = (id, v) => evalJS(`(async()=>{ const e = document.getElementById('${id}'); e.value = '${v}'; e.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,1500)); })()`);
await pick('editorFrameTemplate', 'template_1');
await evalJS(`(async()=>{ const e = document.getElementById('shapeLatticeContourFromFrame'); e.checked = true; e.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); })()`);

const field = (fid, v) => evalJS(`(async()=>{ const e = document.getElementById('${fid}'); e.value = '${v}'; e.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); })()`);
const out = { steps: {} };
for (const d of [0, 0.5, -0.25]) {
  await field('shapeLatticeContourFromFrameDistance', String(d));
  const s = await state();
  out.steps[String(d)] = s;
  await shot(`distance_${d}`.replace('-', 'neg').replace('.', '_'));
}

const s0 = out.steps['0'], sPos = out.steps['0.5'], sNeg = out.steps['-0.25'];
const SW = s0.strokeWidth || 0;
// maxDistToOuter (not min) is the exact check: MEASURED live, it matches the expected offset to the pixel in
// every case here (0.125 / 0.625 / 0.125) -- minDistToOuter is pulled down by samples near a corner arc,
// where the nearest point on the OUTER outline legitimately sits on a neighbouring piece (the same effect the
// unit test's own "middle of the line only" sampling exists to avoid; this script samples arcs too, so it
// takes the max instead of restricting which points it samples).
out.checks = {
  // 0: on the outer edge -- the flattest sample sits within stroke/2 of it, every sample inside (or on) the polygon
  d0_onOuterEdge: s0.distance === 0 && Math.abs(s0.maxDistToOuter - SW / 2) < 0.01,
  // +0.5: inward, 0.5+stroke/2 from the outer edge, every sample inside
  dPos_inward: sPos.distance === 0.5 && sPos.allInside && Math.abs(sPos.maxDistToOuter - (0.5 + SW / 2)) < 0.01,
  // -0.25 (the checklist's own case): accepted (fieldValue actually holds -0.25, not clamped to 0.25), every
  // sample OUTSIDE the polygon, at 0.25-stroke/2 from it
  dNeg_fieldAcceptsNegative: sNeg.fieldValue === '-0.25',
  dNeg_outward: sNeg.distance === -0.25 && sNeg.allOutside && Math.abs(sNeg.maxDistToOuter - (0.25 - SW / 2)) < 0.01,
  noErrors: [s0, sPos, sNeg].every((s) => !s.err),
};
out.ok = Object.values(out.checks).every(Boolean) && !errors.length;
out.errors = errors.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
ws.close(); chrome.kill();
