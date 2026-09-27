// F19 ACCEPTANCE (Fred, option b: "push"): a rail dragged across a CUT tie's joint pushes the joint along the tie.
// Real Chrome, real pointer / touch events through the lattice tool's own handlers.
//   Generate a box lattice; cut the longest attached tie ONE cell from the rail (a real ✂ tap); drag the rail's body
//   TWO cells toward the tie's far end (past the joint). Expect: the rail is not blocked; the joint sits one cell
//   ahead of it; both segments >= one cell, still touching, still one straight column; one undo restores everything;
//   an uncut attached tie on the same rail just shrinks, as before. Shots before / mid / after.
//   node tools/repro/tie_push_acceptance.mjs <outPrefix> <paletteUrl> [desktop|mobile] [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9461);
const MOBILE = MODE === 'mobile';
// on touch a gesture commits at the MARKER, INPUT_PROFILE.touch.markerOffsetPx (40) ABOVE the finger (SE7m): a user
// aims the marker, so the finger goes that far BELOW the target
const FINGER_DY = MOBILE ? 40 : 0;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-tiepush-${PORT}`;
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
async function press(s) {
  if (MOBILE) await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y + FINGER_DY }] });
  else { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1 }); }
  await sleep(60);
}
async function moveTo(s) {
  if (MOBILE) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x, y: s.y + FINGER_DY }] });
  else await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, button: 'left', buttons: 1 });
  await sleep(25);
}
async function release(s) {
  if (MOBILE) await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1 });
  await sleep(400);
}
async function tap(p) { const s = await toScreen(p); await press(s); await release(s); }
const undo = () => evalJS(`(async()=>{ window.svgEditor.undo(); await new Promise(r=>setTimeout(r,300)); })()`);

// every lattice line as [kind, x1, y1, x2, y2] (rounded), sorted: the whole drawing, for exact before/after compares
const LINES = `(()=>{ const r = (v) => Math.round(v * 1e9) / 1e9;
  return JSON.stringify([...window.svgEditor._sketchLayer.node.querySelectorAll('line[data-lattice-gen]')]
    .map((e) => [e.getAttribute('data-lattice'), ...['x1','y1','x2','y2'].map((k) => r(+e.getAttribute(k)))].join('|')).sort()); })()`;
const lines = async () => JSON.parse(await evalJS(LINES));
// the pieces of the tie column `col` (world coordinate across the tie), as [start, end] along the tie
const tiePieces = async (V, col) => JSON.parse(await evalJS(`(()=>{ const V = ${V}, ax = V ? 'x' : 'y', fx = V ? 'y' : 'x';
  return JSON.stringify([...window.svgEditor._sketchLayer.node.querySelectorAll('line[data-lattice="tie"][data-lattice-gen]')]
    .map((e) => ({ x1: +e.getAttribute('x1'), y1: +e.getAttribute('y1'), x2: +e.getAttribute('x2'), y2: +e.getAttribute('y2') }))
    .filter((l) => Math.abs(l[fx + '1'] - ${col}) < 1e-9 && Math.abs(l[fx + '2'] - ${col}) < 1e-9)
    .map((l) => ({ s: l[ax + '1'], e: l[ax + '2'], straight: Math.abs(l[fx + '1'] - l[fx + '2']) < 1e-9 }))); })()`));

await send('Runtime.enable'); await send('Page.enable');
if (MOBILE) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

const report = { mode: MODE, runs: [] };
for (const orientation of (MOBILE ? ['horizontal'] : ['horizontal', 'vertical'])) {
  await send('Page.navigate', { url: URL }); await sleep(9000);
  await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    document.getElementById('btnStampEdit').click(); await W(2500);
    document.getElementById('toolLattice').click(); await W(800);
    document.getElementById('${orientation === 'vertical' ? 'latticeOrientVertical' : 'latticeOrientHorizontal'}').click(); await W(300);
    document.getElementById('latticeGenerate').click(); await W(2500);
    const b=[...document.querySelectorAll('button,[role=button]')].find(x=>x.offsetParent && /tap a piece/i.test(x.title||'')); if (b) b.click(); await W(400); })()`);
  // a rail + its LONGEST attached tie (>= 4 cells); the cut point 1 cell from the rail; a body grab on the rail
  // as far as possible from any tie contact, node or end (so the grab is a MOVE of that rail)
  const plan = JSON.parse(await evalJS(`(()=>{ const L = window.svgEditor._sketchLayer.node, sp = window.svgEditor._grid.spacing || 0.25;
    const V = ${orientation === 'vertical'}, ax = V ? 'y' : 'x', fx = V ? 'x' : 'y';
    const P = (e) => ({ a: { x: +e.getAttribute('x1'), y: +e.getAttribute('y1') }, b: { x: +e.getAttribute('x2'), y: +e.getAttribute('y2') } });
    const rails = [...L.querySelectorAll('line[data-lattice="rail"][data-lattice-gen]')].map(P);
    const ties = [...L.querySelectorAll('line[data-lattice="tie"][data-lattice-gen]')].map(P);
    const tlen = (t) => Math.abs(t.b[fx] - t.a[fx]);
    let best = null;
    for (const r of rails) {
      const row = r.a[fx], lo = Math.min(r.a[ax], r.b[ax]), hi = Math.max(r.a[ax], r.b[ax]);
      for (const t of ties) {
        const end = [t.a, t.b].find((p) => Math.abs(p[fx] - row) < 1e-9 && p[ax] > lo + 1e-9 && p[ax] < hi - 1e-9);
        if (!end || tlen(t) < 4 * sp - 1e-9) continue;
        // the longest; among equals the one nearest the rail's middle (clear of the corner overlays on a phone)
        const mid = Math.abs(end[ax] - (lo + hi) / 2);
        if (!best || tlen(t) > tlen(best.t) + 1e-9 || (Math.abs(tlen(t) - tlen(best.t)) < 1e-9 && mid < best.mid)) best = { r, t, row, lo, hi, end, mid, far: end === t.a ? t.b : t.a };
      }
    }
    if (!best) return JSON.stringify({ error: 'no attached tie >= 4 cells' });
    const { row, lo, hi, end, far } = best, dir = Math.sign(far[fx] - row), col = end[ax];
    const at = (u, v) => (V ? { x: v, y: u } : { x: u, y: v });
    const contacts = ties.flatMap((t) => [t.a, t.b]).filter((p) => Math.abs(p[fx] - row) < 1e-9).map((p) => p[ax]);
    const crossings = ties.filter((t) => Math.min(t.a[fx], t.b[fx]) < row - 1e-9 && Math.max(t.a[fx], t.b[fx]) > row + 1e-9).map((t) => t.a[ax]);
    const avoid = [lo, hi, ...contacts, ...crossings];
    let g = null, gd = -1;
    for (let u = lo + sp / 2; u < hi; u += sp / 2) { const d = Math.min(...avoid.map((c) => Math.abs(c - u))); if (d > gd) { gd = d; g = u; } }
    // an UNCUT attached tie on the same rail, on the same side (it must just shrink, as before)
    const uncut = ties.find((t) => t !== best.t && [t.a, t.b].some((p) => Math.abs(p[fx] - row) < 1e-9 && p[ax] > lo && p[ax] < hi)
      && Math.sign([t.a, t.b].find((p) => Math.abs(p[fx] - row) > 1e-9)?.[fx] - row) === dir && tlen(t) >= 3 * sp - 1e-9);
    return JSON.stringify({ sp, V, row, dir, col, far: far[fx], tieLen: tlen(best.t), cutAt: at(col, row + dir * sp),
      grab: at(g, row), grabClearCells: gd / sp, to: at(g, row + dir * 2 * sp),
      uncut: uncut ? { col: uncut.a[ax], far: [uncut.a, uncut.b].find((p) => Math.abs(p[fx] - row) > 1e-9)[fx] } : null }); })()`));
  const run = { orientation, plan };
  if (plan.error) { run.error = plan.error; report.runs.push(run); continue; }
  if (MOBILE) { // the bottom sheet covers the lower canvas: pan the rail's row into the visible band (the F18 way)
    await evalJS(`(async()=>{ const v = await import('./editor/editor-view.js'); const ed = window.svgEditor; ed.fitView();
      const m = ed._draw.node.getScreenCTM(); const sy = m.b * ${plan.grab.x} + m.d * ${(plan.grab.y + plan.to.y) / 2} + m.f;
      ed._view = { ...ed._view, cy: ed._view.cy + (sy - 330) / m.d }; v.applyView(ed);
      await new Promise(r=>setTimeout(r,400)); })()`);
  }
  let onCanvas = 0;
  for (const p of [plan.cutAt, plan.grab, plan.to]) { const q = await toScreen(p); if (await evalJS(`(()=>{ const box = document.getElementById('editorSVGContainer');
    return [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]].every(([ox, oy]) => { const e = document.elementFromPoint(${q.x} + ox, ${q.y + FINGER_DY} + oy); return !!e && box.contains(e); }); })()`)) onCanvas++; }
  run.pointsOnCanvas = `${onCanvas}/3 (each with a clear 30 px neighbourhood)`;
  // cut the tie with a real ✂ tap, one cell from the rail
  await evalJS(`document.getElementById('toolCut').click()`); await sleep(300);
  await tap(plan.cutAt);
  await evalJS(`(async()=>{ document.getElementById('toolLattice').click(); await new Promise(r=>setTimeout(r,400));
    const b=[...document.querySelectorAll('button,[role=button]')].find(x=>x.offsetParent && /tap a piece/i.test(x.title||'')); if (b) b.click(); await new Promise(r=>setTimeout(r,300)); })()`);
  const before = await tiePieces(plan.V, plan.col);
  run.cut = before.length === 2;
  const K0 = await lines();
  await shot(`${orientation}_before`);
  // the drag: press on the rail body, 12 moves to 2 cells toward the far end, a shot halfway (the rail ON the joint)
  const s0 = await toScreen(plan.grab), s1 = await toScreen(plan.to);
  await press(s0);
  run.grabMode = await evalJS(`(()=>{ const m = window.svgEditor._latticeMove; return m ? m.kind + ':' + m.mode + (m.tiePush ? ':push' + m.tiePush.length : '') : null; })()`);
  for (let k = 1; k <= 12; k++) {
    await moveTo({ x: s0.x + (s1.x - s0.x) * k / 12, y: s0.y + (s1.y - s0.y) * k / 12 });
    if (k === 6) { run.mid = await tiePieces(plan.V, plan.col); await shot(`${orientation}_mid`); }
  }
  await release(s1);
  await shot(`${orientation}_after`);
  const after = await tiePieces(plan.V, plan.col);
  const railRow = await evalJS(`(()=>{ const V = ${plan.V}, fx = V ? 'x' : 'y', ax = V ? 'y' : 'x';
    const r = [...window.svgEditor._sketchLayer.node.querySelectorAll('line[data-lattice="rail"][data-lattice-gen]')]
      .find((e) => { const a = +e.getAttribute(ax + '1'), b = +e.getAttribute(ax + '2'); return Math.min(a, b) <= ${plan.V ? plan.grab.y : plan.grab.x} && Math.max(a, b) >= ${plan.V ? plan.grab.y : plan.grab.x}
        && Math.abs(+e.getAttribute(fx + '1') - ${plan.row + plan.dir * 2 * plan.sp}) < 1e-6; });
    return r ? +r.getAttribute(fx + '1') : null; })()`);
  const sp = plan.sp, d = plan.dir, r2 = (v) => Math.round(v * 1e9) / 1e9;
  // the pieces ordered from the rail outward: [attached end, joint], [joint, far end]
  const seg = after.map((p) => (Math.abs(p.s - (plan.row + d * 2 * sp)) < 1e-6 || Math.abs(p.e - (plan.row + d * 2 * sp)) < 1e-6 ? 0 : 1))
  const near = after[seg.indexOf(0)], farSeg = after[seg.indexOf(1)];
  const ordered = (p) => (p ? (d * (p.e - p.s) >= 0 ? [p.s, p.e] : [p.e, p.s]) : null);
  const [n0, n1] = ordered(near) || [], [f0, f1] = ordered(farSeg) || [];
  run.after = { railRow, near: [n0, n1].map(r2), far: [f0, f1].map(r2) };
  run.checks = {
    railNotBlocked: railRow != null && Math.abs(railRow - (plan.row + d * 2 * sp)) < 1e-6,
    jointOneCellAhead: n1 != null && Math.abs(n1 - (plan.row + d * 3 * sp)) < 1e-6,
    nearNotFlipped: near != null && Math.abs(n0 - (plan.row + d * 2 * sp)) < 1e-6 && d * (n1 - n0) >= sp - 1e-6, // from the rail outward
    farAtLeastOneCell: farSeg != null && d * (f1 - f0) >= sp - 1e-6 && Math.abs(f1 - plan.far) < 1e-6,
    coincident: n1 != null && Math.abs(n1 - f0) < 1e-9,
    straight: after.length === 2 && after.every((p) => p.straight),
  };
  if (plan.uncut) {
    const u = await tiePieces(plan.V, plan.uncut.col);
    run.checks.uncutJustShrinks = u.length === 1 && [u[0].s, u[0].e].some((v) => Math.abs(v - (plan.row + d * 2 * sp)) < 1e-6)
      && [u[0].s, u[0].e].some((v) => Math.abs(v - plan.uncut.far) < 1e-6);
  }
  await undo();
  run.checks.oneUndoRestores = JSON.stringify(await lines()) === JSON.stringify(K0);
  run.ok = run.cut && run.grabMode === 'rail:move:push1' && Object.values(run.checks).every(Boolean);
  report.runs.push(run);
}
report.errors = errors.slice(0, 5);
report.ok = report.runs.length > 0 && report.runs.every((r) => r.ok) && !errors.length;
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
