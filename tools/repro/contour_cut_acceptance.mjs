// F27 CONTOUR CUT acceptance (Fred: "the scissors tool doesn't cut contour, it should" -- FINAL RULING: a
// contour cut is a COLOUR BOUNDARY ONLY, never structural). Real Chrome, real pointer events through the
// cut tool's own handlers (cutHandler.start), same rig as tools/repro/cut_tool_acceptance.mjs.
//   Shape Lattice (Hourglass, Generate) -> cut tool -> real tap on a LINE contour segment, real tap on an ARC
//   contour segment: each split (N -> N+1 -> N+2) WITHOUT moving anything else (every untouched sibling's own
//   `d` is byte-identical before/after; the two new halves of a cut piece reconstruct the original's own
//   endpoints exactly) -> a real tap at the same point re-JOINS it (N+2 -> N+1 -> N) -> re-cut both, colour the
//   two halves of the line cut differently (the real setColor path) and confirm both survive undo/redo ->
//   Regenerate clears every cut (back to N). Shots at each step.
//   node tools/repro/contour_cut_acceptance.mjs <outPrefix> <paletteUrl> [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9591);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-contourcut-${PORT}`;
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

const toScreen = async (p) => JSON.parse(await evalJS(`(()=>{ const m = window.svgEditor._draw.node.getScreenCTM();
  return JSON.stringify({ x: m.a * ${p.x} + m.c * ${p.y} + m.e, y: m.b * ${p.x} + m.d * ${p.y} + m.f }); })()`));
async function press(s) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1 }); await sleep(60); }
async function release(s) { await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1 }); await sleep(300); }
async function tap(p) { const s = await toScreen(p); await press(s); await release(s); }
const undo = () => evalJS(`(async()=>{ window.svgEditor.undo(); await new Promise(r=>setTimeout(r,300)); })()`);
const redo = () => evalJS(`(async()=>{ window.svgEditor.redo(); await new Promise(r=>setTimeout(r,300)); })()`);

// the contour's own live pieces, in CONTOUR_SEG_INDEX_ATTR order, plus each one's parsed primitive (via the
// app's own editor-contour-cut.js -- no re-implementation).
const CONTOUR = `(async()=>{
  const cc = await import('./editor/editor-contour-cut.js');
  const ed = window.svgEditor;
  const els = ed._sketchLayer.children().toArray().filter((e) => e.node && e.type === 'path' && e.node.hasAttribute('data-boundary-ref'));
  const ordered = els.slice().sort((a, b) => Number(a.attr('data-contour-seg')) - Number(b.attr('data-contour-seg')));
  return JSON.stringify(ordered.map((e) => ({ i: Number(e.attr('data-contour-seg')), d: e.attr('d'), stroke: e.attr('stroke'), prim: cc.primitiveFromContourD(e.attr('d')) })));
})()`;
const contour = async () => JSON.parse(await evalJS(CONTOUR));
const midOf = (prim) => (prim.type === 'L'
  ? { x: (prim.p0.x + prim.p1.x) / 2, y: (prim.p0.y + prim.p1.y) / 2 }
  : (() => { const t = prim.theta1 + prim.dTheta * 0.5; return { x: prim.cx + prim.rx * Math.cos(t), y: prim.cy + prim.ry * Math.sin(t) }; })());
const ends = (prim) => (prim.type === 'L' ? [prim.p0, prim.p1]
  : [{ x: prim.cx + prim.rx * Math.cos(prim.theta1), y: prim.cy + prim.ry * Math.sin(prim.theta1) },
    { x: prim.cx + prim.rx * Math.cos(prim.theta1 + prim.dTheta), y: prim.cy + prim.ry * Math.sin(prim.theta1 + prim.dTheta) }]);
const near = (a, b, tol = 3e-3) => Math.hypot(a.x - b.x, a.y - b.y) < tol;

/** Proves the cut changed NOTHING but the one targeted piece: every sibling `d` byte-identical (just possibly
 *  reindexed), and the two new halves reconstruct the original's own start/end exactly (colour-boundary-only,
 *  never structural -- the FINAL RULING this whole acceptance exists to prove). */
function cutIsShapePreserving(before, after, cutIndex) {
  const beforeDs = before.map((s) => s.d);
  const untouchedBefore = beforeDs.filter((_, i) => i !== cutIndex);
  const cutPiece = before[cutIndex];
  const [origA, origB] = ends(cutPiece.prim);
  const afterDs = after.map((s) => s.d);
  const untouchedStillPresent = untouchedBefore.every((d) => afterDs.includes(d));
  if (after.length !== before.length + 1) return { ok: false, reason: 'count' };
  // the two NEW entries are whatever `d` values are in `after` but not in `before`
  const newOnes = after.filter((s) => !beforeDs.includes(s.d));
  if (newOnes.length !== 2) return { ok: false, reason: 'newCount:' + newOnes.length };
  const [h0, h1] = newOnes.sort((a, b) => a.i - b.i);
  const [a0] = ends(h0.prim), [, a1] = ends(h1.prim);
  const reconstructed = near(a0, origA) && near(a1, origB);
  const seam = near(ends(h0.prim)[1], ends(h1.prim)[0]);
  return { ok: untouchedStillPresent && reconstructed && seam, untouchedStillPresent, reconstructed, seam };
}

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolShapeLattice').click(); await W(800);
  document.getElementById('shapePresetHourglass')?.click(); await W(400);
  document.getElementById('shapeLatticeGenerate').click(); await W(2500); })()`);

const report = { errors: [] };
const N0 = await contour();
report.N = N0.length;
await shot('0_generated');

await evalJS(`document.getElementById('toolCut').click()`); await sleep(300);

// cut 1: the first LINE segment
const lineIdx = N0.findIndex((s) => s.prim.type === 'L');
const arcIdxBefore = N0.findIndex((s) => s.prim.type === 'A');
report.foundLine = lineIdx !== -1; report.foundArc = arcIdxBefore !== -1;
const linePt = midOf(N0[lineIdx].prim);
await tap(linePt);
const N1 = await contour();
report.cut1 = cutIsShapePreserving(N0, N1, lineIdx);
await shot('1_line_cut');

// cut 2: an ARC segment (re-find by type since indices shifted after cut 1)
const arcIdx = N1.findIndex((s) => s.prim.type === 'A');
const arcPt = midOf(N1[arcIdx].prim);
await tap(arcPt);
const N2 = await contour();
report.cut2 = cutIsShapePreserving(N1, N2, arcIdx);
await shot('2_arc_cut');
report.countAfterBothCuts = [N0.length, N1.length, N2.length];

// JOIN: tapping the same line-cut point again should merge it back (N2 -> N2-1), a real reverse gesture
await tap(linePt);
const N3 = await contour();
report.joinLine = { count: N3.length, restoredCount: N3.length === N2.length - 1 };
await shot('3_line_joined');

// JOIN the arc cut too -- back to the original N
await tap(arcPt);
const N4 = await contour();
report.joinArc = { count: N4.length, backToOriginal: N4.length === N0.length, dsMatch: JSON.stringify(N4.map((s) => s.d)) === JSON.stringify(N0.map((s) => s.d)) };
await shot('4_both_joined');

// re-cut both (colour boundary demo), then colour the two line-cut halves DIFFERENTLY via the real setColor path
await tap(linePt);
const N5 = await contour();
// the two NEW pieces after this re-cut are whatever wasn't present right before it (N4)
const newAfterRecut = N5.filter((s) => !N4.some((s0) => s0.d === s.d));
report.recutLineNewPieces = newAfterRecut.length;
if (newAfterRecut.length === 2) {
  const [h0, h1] = newAfterRecut.sort((a, b) => a.i - b.i);
  await evalJS(`(async()=>{ const ed = window.svgEditor;
    const els = ed._sketchLayer.children().toArray().filter((e) => e.node && e.attr('d') === ${JSON.stringify(h0.d)});
    ed._selectedElements = els; ed.setColor('#e53935'); })()`);
  await evalJS(`(async()=>{ const ed = window.svgEditor;
    const els = ed._sketchLayer.children().toArray().filter((e) => e.node && e.attr('d') === ${JSON.stringify(h1.d)});
    ed._selectedElements = els; ed.setColor('#1e88e5'); })()`);
  await sleep(200);
  const N6 = await contour();
  const c0 = N6.find((s) => s.d === h0.d), c1 = N6.find((s) => s.d === h1.d);
  const preRecolourH1 = newAfterRecut.find((s) => s.d === h1.d).stroke;
  report.recolour = { h0stroke: c0 && c0.stroke, h1stroke: c1 && c1.stroke, differ: !!(c0 && c1 && c0.stroke !== c1.stroke) };
  await shot('5_recoloured');
  // one undo reverts the LAST setColor call only (h1, the second one) -- h0's own colour is untouched by it.
  await undo();
  const N7 = await contour();
  const u1 = N7.find((s) => s.d === h1.d), u0 = N7.find((s) => s.d === h0.d);
  report.undoRestoresColour = { h1Reverted: u1 && u1.stroke === preRecolourH1, h0Untouched: u0 && u0.stroke === c0.stroke };
  await redo();
  const N8 = await contour();
  const r1 = N8.find((s) => s.d === h1.d);
  report.redoRestoresColour = { stroke: r1 && r1.stroke, matches: r1 && r1.stroke === c1.stroke };
}

// Regenerate clears every cut, colour override included
await evalJS(`(async()=>{ document.getElementById('shapeLatticeGenerate').click(); await new Promise(r=>setTimeout(r,2500)); })()`);
const N9 = await contour();
report.regenerateClearsCuts = { count: N9.length, backToOriginal: N9.length === N0.length };
await shot('6_regenerated');

report.errors = errors.slice(0, 5);
report.ok = !!(report.foundLine && report.foundArc && report.cut1?.ok && report.cut2?.ok
  && report.joinLine.restoredCount && report.joinArc.backToOriginal && report.joinArc.dsMatch
  && (!report.recolour || (report.recolour.differ && report.undoRestoresColour?.h1Reverted
    && report.undoRestoresColour?.h0Untouched && report.redoRestoresColour?.matches))
  && report.regenerateClearsCuts.backToOriginal
  && !errors.length);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
