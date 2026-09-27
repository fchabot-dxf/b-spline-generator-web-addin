// SE16 ✂ ACCEPTANCE (CUT-TOOL-DESIGN §10; Fred: "I don't want the cut tool to break the lattice structure
// editability"). Real Chrome, real pointer events through the lattice tool's own handlers.
//   U = a generated box lattice; K = the SAME lattice with its middle rail cut at 2 tie contacts and one tie cut
//   where it crosses a rail (real ✂ taps), EVERY segment a different colour.
//   The same gestures on U and on K must give IDENTICAL geometry (pieces merged by chain, 1e-9); colours stay on
//   their segments; undo / redo restore each step; a JOINT slides (no gap). Both orientations; touch on mobile.
//   node tools/repro/cut_tool_acceptance.mjs <outPrefix> <paletteUrl> [desktop|mobile] [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9451);
const MOBILE = MODE === 'mobile';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-cutacc-${PORT}`;
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

// model point -> screen, via the editor root's CTM
const toScreen = async (p) => JSON.parse(await evalJS(`(()=>{ const m = window.svgEditor._draw.node.getScreenCTM();
  return JSON.stringify({ x: m.a * ${p.x} + m.c * ${p.y} + m.e, y: m.b * ${p.x} + m.d * ${p.y} + m.f }); })()`));
async function press(s) {
  if (MOBILE) await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y }] });
  else { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1 }); }
  await sleep(60);
}
async function moveTo(s) {
  if (MOBILE) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x, y: s.y }] });
  else await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, button: 'left', buttons: 1 });
  await sleep(25);
}
async function release(s) {
  if (MOBILE) await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1 });
  await sleep(400);
}
/** Drag from model point `from` by model delta `d`; returns the grab mode the editor reported (move/stretch/joint). */
async function drag(from, d) {
  const s0 = await toScreen(from), s1 = await toScreen({ x: from.x + d.x, y: from.y + d.y });
  await press(s0);
  const mode = await evalJS(`(()=>{ const m = window.svgEditor._latticeMove; return m ? m.kind + ':' + m.mode : null; })()`);
  for (let k = 1; k <= 8; k++) await moveTo({ x: s0.x + (s1.x - s0.x) * k / 8, y: s0.y + (s1.y - s0.y) * k / 8 });
  await release(s1);
  return mode;
}
async function tap(p) { const s = await toScreen(p); await press(s); await release(s); }

// the lattice pieces as drawn, merged by chain (the canonical comparison), and the colour of every segment
const CANON = `(async()=>{ const ch = await import('./editor/editor-lattice-chains.js');
  const L = window.svgEditor._sketchLayer.node; const r6 = (v) => Math.round(v * 1e9) / 1e9;
  const lines = [...L.querySelectorAll('line[data-lattice-gen]')].map((e) => ({ kind: e.getAttribute('data-lattice'),
    a: { x: +e.getAttribute('x1'), y: +e.getAttribute('y1') }, b: { x: +e.getAttribute('x2'), y: +e.getAttribute('y2') },
    color: e.getAttribute('data-override-color') }));
  const chains = ch.latticeChains(lines).map((c) => { const xs = c.segments.flatMap((s) => [s.a, s.b]);
    const ax = c.axis || 'x'; const other = ax === 'x' ? 'y' : 'x';
    return [c.kind, r6(xs[0][other]), r6(Math.min(...xs.map((p) => p[ax]))), r6(Math.max(...xs.map((p) => p[ax])))].join('|'); }).sort();
  const nodes = [...L.querySelectorAll('circle[data-lattice-gen]')].map((e) => r6(+e.getAttribute('cx')) + ',' + r6(+e.getAttribute('cy'))).sort();
  const colors = lines.filter((l) => l.color).map((l) => [l.kind, r6(l.a.x), r6(l.a.y), r6(l.b.x), r6(l.b.y), l.color].join('|')).sort();
  return JSON.stringify({ chains, nodes, colors, segments: lines.length }); })()`;
const canon = async () => JSON.parse(await evalJS(CANON));
const same = (a, b) => JSON.stringify(a.chains) === JSON.stringify(b.chains) && JSON.stringify(a.nodes) === JSON.stringify(b.nodes);
const undo = () => evalJS(`(async()=>{ window.svgEditor.undo(); await new Promise(r=>setTimeout(r,300)); })()`);
const redo = () => evalJS(`(async()=>{ window.svgEditor.redo(); await new Promise(r=>setTimeout(r,300)); })()`);

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
  // the middle rail, two tie contacts on it (the cut points), a tie that crosses it (cut there) and the grab points
  const plan = JSON.parse(await evalJS(`(()=>{ const L = window.svgEditor._sketchLayer.node, sp = window.svgEditor._grid.spacing || 0.25;
    const V = ${orientation === 'vertical'}, ax = V ? 'y' : 'x', fx = V ? 'x' : 'y';
    const P = (e) => ({ a: { x: +e.getAttribute('x1'), y: +e.getAttribute('y1') }, b: { x: +e.getAttribute('x2'), y: +e.getAttribute('y2') } });
    const rails = [...L.querySelectorAll('line[data-lattice="rail"][data-lattice-gen]')].map(P).sort((p, q) => p.a[fx] - q.a[fx]);
    const ties = [...L.querySelectorAll('line[data-lattice="tie"][data-lattice-gen]')].map(P);
    const contactsOf = (M) => { const row = M.a[fx], lo = Math.min(M.a[ax], M.b[ax]), hi = Math.max(M.a[ax], M.b[ax]);
      return [...new Set(ties.flatMap((t) => [t.a, t.b]).filter((p) => Math.abs(p[fx] - row) < 1e-9 && p[ax] > lo + 2 * sp && p[ax] < hi - 2 * sp).map((p) => p[ax]))].sort((a, b) => a - b); };
    // the long rail with the most tie contacts
    const scored = rails.map((r) => ({ r, n: contactsOf(r).length, len: Math.abs(r.b[ax] - r.a[ax]) })).filter((q) => q.len >= 8 * sp)
      .sort((p, q) => q.n - p.n || q.len - p.len);
    const M = scored[0].r;
    const row = M.a[fx], lo = Math.min(M.a[ax], M.b[ax]), hi = Math.max(M.a[ax], M.b[ax]);
    const contacts = contactsOf(M);
    // cut 1 ON a tie contact (a joint where a tie meets the rail), cut 2 MID-RAIL at a plain grid point >= 3 cells away
    let c1 = contacts.length ? contacts[Math.floor(contacts.length / 3)] : Math.round((lo + (hi - lo) / 3) / sp) * sp;
    let c2 = null;
    for (let u = Math.ceil((lo + 2 * sp) / sp) * sp; u <= hi - 2 * sp + 1e-9; u += sp) {
      if (Math.abs(u - c1) >= 3 * sp && !contacts.some((c) => Math.abs(c - u) < 1e-9)) { c2 = u; if (u > c1) break; }
    }
    if (c2 != null && c2 < c1) [c1, c2] = [c2, c1];
    const crossing = ties.find((t) => { const tl = Math.min(t.a[fx], t.b[fx]), th = Math.max(t.a[fx], t.b[fx]); return tl < row - 1e-9 && th > row + 1e-9; });
    const at = (u) => (V ? { x: row, y: u } : { x: u, y: row });
    // the LONGEST tie attached to the rail (cut at its middle, grabbed at the middle of its longer half)
    const tlen = (t) => Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y);
    const attached = ties.filter((t) => [t.a, t.b].some((p) => Math.abs(p[fx] - row) < 1e-9 && p[ax] > lo && p[ax] < hi) && t !== crossing)
      .sort((p, q) => tlen(q) - tlen(p))[0];
    const tieFar = attached ? ([attached.a, attached.b].find((p) => Math.abs(p[fx] - row) > 1e-9) || attached.b) : null;
    return JSON.stringify({ sp, V, row, lo, hi, c1, c2, cut1: c1 != null ? at(c1) : null, cut2: c2 != null ? at(c2) : null,
      grab: c1 != null ? [at((lo + c1) / 2), at((c1 + c2) / 2), at((c2 + hi) / 2)] : [],
      ends: [at(lo), at(hi)], crossing, crossAt: crossing ? (V ? { x: crossing.a.x, y: row } : { x: crossing.a.x, y: row }) : null,
      crossGrab: crossing ? { x: (crossing.a.x + (V ? crossing.a.x : crossing.a.x)) , y: crossing.a.y + (row - crossing.a.y) / 2 } : null,
      // the rail moves AWAY from the cut tie (so that tie lengthens; see WORK-LOG: moving a rail across a cut tie's own
      // joint is a separate, not-yet-ruled case)
      awaySign: tieFar ? -Math.sign(tieFar[fx] - row) || 1 : 1,
      tieGrab: attached ? (() => { const L2 = tlen(attached), k = Math.max(1, Math.floor(L2 / sp / 2)), t = k * sp / L2;
        const tm = t < 0.5 ? (1 + t) / 2 : t / 2; // the middle of the LONGER half
        return { x: attached.a.x + (attached.b.x - attached.a.x) * tm, y: attached.a.y + (attached.b.y - attached.a.y) * tm }; })() : null,
      attachedTie: attached ? { x: (attached.a.x + attached.b.x) / 2, y: (attached.a.y + attached.b.y) / 2 } : null,
      // the attached tie is also CUT (at an interior grid point, when it is >= 2 cells long): a cut tie must move as one
      tieCut: attached && Math.hypot(attached.b.x - attached.a.x, attached.b.y - attached.a.y) >= 2 * sp - 1e-9
        ? (() => { const L2 = Math.hypot(attached.b.x - attached.a.x, attached.b.y - attached.a.y), k = Math.max(1, Math.floor(L2 / sp / 2));
            const t = k * sp / L2; return { x: attached.a.x + (attached.b.x - attached.a.x) * t, y: attached.a.y + (attached.b.y - attached.a.y) * t }; })()
        : null }); })()`));
  const run = { orientation, cuts: plan.c1 != null, crossing: !!plan.crossing, gestures: [] };
  if (!run.cuts) { run.error = 'no two tie contacts on the middle rail'; report.runs.push(run); continue; }
  const d = plan.sp, perp = plan.V ? { x: 2 * d * plan.awaySign, y: 0 } : { x: 0, y: 2 * d * plan.awaySign }, along = (k) => (plan.V ? { x: 0, y: k * d } : { x: k * d, y: 0 });
  const tieSide = plan.V ? { x: 0, y: d } : { x: d, y: 0 };
  // the gestures: 3 body grabs (one per future segment), both outer-end stretches, an attached tie, the crossing tie
  const G = [
    ...plan.grab.map((p, k) => ({ name: `rail body #${k + 1}`, from: p, by: perp })),
    { name: 'stretch outer end a', from: plan.ends[0], by: along(-2) },
    { name: 'stretch outer end b', from: plan.ends[1], by: along(2) },
    ...(plan.attachedTie ? [{ name: 'attached tie (cut in K)', from: plan.tieGrab || plan.attachedTie, by: tieSide }] : []),
    ...(plan.crossGrab ? [{ name: 'crossing tie (cut in K)', from: plan.crossGrab, by: tieSide }] : []),
  ];
  if (MOBILE) { // the bottom sheet covers the lower canvas on a phone: zoom out and lift the board into the visible band
    // keep the normal fit zoom (a finger's tolerance must stay under a lattice cell), just pan the rail's row to the
    // middle of the visible band (below the tool strip, above the bottom sheet)
    const rowPt = plan.V ? { x: plan.row, y: (plan.lo + plan.hi) / 2 } : { x: (plan.lo + plan.hi) / 2, y: plan.row };
    await evalJS(`(async()=>{ const v = await import('./editor/editor-view.js'); const ed = window.svgEditor; ed.fitView();
      const m = ed._draw.node.getScreenCTM(); const sy = m.b * ${rowPt.x} + m.d * ${rowPt.y} + m.f;
      ed._view = { ...ed._view, cy: ed._view.cy + (sy - 350) / m.d }; v.applyView(ed);
      await new Promise(r=>setTimeout(r,400)); })()`);
  }
  await shot(`${orientation}_generated`);
  // every gesture / tap point must be ON the canvas (not under a panel or overlay)
  const pts = [...G.map((g) => g.from), ...G.map((g) => ({ x: g.from.x + g.by.x, y: g.from.y + g.by.y })), plan.cut1, plan.cut2, plan.tieCut].filter(Boolean);
  let onCanvas = 0;
  for (const p of pts) { const q = await toScreen(p); if (await evalJS(`(()=>{ const e = document.elementFromPoint(${q.x}, ${q.y}); return !!e && document.getElementById('editorSVGContainer').contains(e); })()`)) onCanvas++; }
  run.pointsOnCanvas = `${onCanvas}/${pts.length}`;
  const U0 = await canon();
  const resU = [];
  for (const g of G) { const mode = await drag(g.from, g.by); resU.push({ mode, after: await canon() }); await undo(); }
  run.uRestored = same(await canon(), U0);
  // K: cut with real ✂ taps, then colour every segment differently
  await evalJS(`document.getElementById('toolCut').click()`); await sleep(300);
  await tap(plan.cut1); await tap(plan.cut2);
  if (plan.crossAt) await tap(plan.crossAt);
  if (plan.tieCut) await tap(plan.tieCut);
  run.tieCut = !!plan.tieCut;
  await shot(`${orientation}_cut`);
  const afterCuts = await canon();
  run.segmentsBeforeAfter = [U0.segments, afterCuts.segments];
  run.cutKeepsGeometry = same(afterCuts, U0);
  await evalJS(`(async()=>{ const o = await import('./editor/editor-piece-override.js'); const L = window.svgEditor._sketchLayer.node;
    const els = window.svgEditor._sketchLayer.children().toArray().filter((e) => e.node.hasAttribute('data-lattice-gen') && e.type === 'line');
    els.forEach((e, k) => o.applyColorOverride(e, o.pieceKindOf(e), '#' + (0x100000 + k * 0x0a1b2c).toString(16).slice(-6))); })()`);
  await evalJS(`(async()=>{ window.svgEditor.pushState(); document.getElementById('toolLattice').click(); await new Promise(r=>setTimeout(r,400));
    const b=[...document.querySelectorAll('button,[role=button]')].find(x=>x.offsetParent && /tap a piece/i.test(x.title||'')); if (b) b.click(); await new Promise(r=>setTimeout(r,300)); })()`);
  const K0 = await canon();
  for (let i = 0; i < G.length; i++) {
    const g = G[i];
    const mode = await drag(g.from, g.by);
    const after = await canon();
    const ok = same(after, resU[i].after) && JSON.stringify(after.colors.length) === JSON.stringify(K0.colors.length);
    await undo();
    const undone = await canon();
    await redo();
    const redone = await canon();
    await undo();
    run.gestures.push({ name: g.name, modeU: resU[i].mode, modeK: mode, identical: ok, colours: after.colors.length,
      undoOk: same(undone, K0) && JSON.stringify(undone.colors) === JSON.stringify(K0.colors), redoOk: same(redone, after) && JSON.stringify(redone.colors) === JSON.stringify(after.colors) });
  }
  // a joint slides: grab joint 1 and drag along the rail; the rail extent is unchanged and no gap opens
  const jointMode = await drag(plan.cut1, along(1));
  const J = await canon();
  run.joint = { mode: jointMode, railsUnchanged: JSON.stringify(J.chains) === JSON.stringify(K0.chains), segments: J.segments };
  await shot(`${orientation}_joint`);
  report.runs.push(run);
}
report.errors = errors.slice(0, 5);
report.ok = report.runs.every((r) => r.cuts && r.uRestored && r.cutKeepsGeometry && r.gestures.every((g) => g.identical && g.undoOk && g.redoOk)
  && r.joint && r.joint.mode === 'rail:joint' && r.joint.railsUnchanged) && !errors.length;
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
