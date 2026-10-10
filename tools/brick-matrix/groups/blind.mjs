// Brick matrix group 'blind': no freeze without its card (Fred's rule: a loading signal before every long computation).
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

// ---- BLIND_BUDGET (seat D 2026-10-08, advisor pick after the phone audits -- tools/repro/art_phone_audit.mjs): each
// fix so far pinned its own path in a unit test (frame / photo stages, the brush bake, Generate's requires sync, the
// board size); nothing stopped the NEXT long computation from running before its card. Each row is a user action on
// Fred's phone rig -- 390x844, coarse pointer, REAL CDP touch, CPU throttled (`cpu`) for the measured action only --
// and its BLIND time: long-task ms before the card's first visible animation frame (sampled per frame; a long task's
// own entry is delivered after it ends, so a card set at the end of a blind task would read as shown -- MEASURED).
// A row fails over its budget. `closeEditor`: Apply first (the editor closes, its board kept); `sidebar`: that sidebar tab, its collapsed panels opened (the editor closed); `open`: the
// editor, on that tab; `pre`: taps (unthrottled) that set the action up; `act`: { tap } an element id,
// { tapSel } a selector, { set, value } a field's input + change, { stroke } a touch drag in board fractions,
// { drag, values } a slider's input ticks then its release.
// A SEQUENTIAL group (index.mjs): --parallel runs it alone after the others, so no other group's load is in its timing.
export const BLIND_BUDGET = {
  viewport: { width: 390, height: 844 },
  cpu: 4,
  quietMs: 800,
  // a long task is only REPORTED from 50 ms, so any real freeze before the card reads >= ~50: 25 catches every one (MEASURED
  // broken: 52-281 ms; fixed: 0, once 1 ms -- a task overlapping the card's first frame); raised per row only with a reason
  budgetMs: 25,
  // LOAD CALIBRATION -- DETECTION ONLY (advisor 2026-10-09: it must never pass a row on its own). On a FAIL the page
  // runs a fixed workload under the same CPU throttle, `runs` times, and its median is set against `quietMs`, the
  // same workload's median on a quiet PC: the FAIL's detail then says how loaded the machine was at that moment
  // ("machine loaded x2.4" from `loadedAt`), so a gate reader can tell a load-inflated FAIL from a real one. The verdict
  // never changes. quietMs: MEASURED 2026-10-09 (seat D, right after a gate, nothing else heavy: the app page at 390 px,
  // CPU x4, 2 probes x 7 runs -> medians 331 / 342 ms, single runs 280-373): a load factor under ~1.15 is noise, so a
  // loaded verdict starts at 1.5.
  calibration: { iterations: 3e6, runs: 3, quietMs: 336, loadedAt: 1.5 },
  rows: [
    { name: 'Board width change (sidebar, editor closed)', sidebar: 'board', act: { set: 'widthIn', value: 7.25 }, fixedBy: '497e30d' },
    // the sidebar phone audit's small ones (advisor: the budget pins them)
    { name: 'Output: Colour edges', sidebar: 'output', act: { tap: 'colourEdges' } },
    { name: 'Decor: add a stamp layer', sidebar: 'decor', act: { tap: 'stampAddLayer' } },
    { name: 'Decor: stamp Clear', sidebar: 'decor', act: { tap: 'btnStampClear' } },
    // MEASURED: no task at all on one run, one 57 ms task (no rebuild, no card) on another -- the long-task floor, left as
    // the Scissors check's 53 ms was (advisor); pinned here against a real regression
    { name: 'Surface: Reset tweaks', sidebar: 'surface', act: { tap: 'filterTweaksReset' }, budgetMs: 100 },
    // seat A's re-time 2026-10-09 (smoothRadius 1944 ms "blind" on the photo board): the drag's rebuild starts after the
    // drag + its debounce, ~0.85 s past t0 -- a settle counting quiet from t0 ended the row before it (seat D, MEASURED)
    { name: 'Surface: smoothing slider drag', sidebar: 'surface', act: { drag: 'smoothRadiusSlider', values: [2, 3, 4, 5] } },
    { name: 'Wall Generate, the first lay', open: 'editorTabBrick', pre: ['brickTool_wall'], act: { tap: 'brickGenerate' }, fixedBy: '200ad4c' },
    { name: 'Brush stroke', pre: ['brickTool_brush'], act: { stroke: [[0.22, 0.45], [0.78, 0.5]] }, fixedBy: '12718cf' },
    { name: 'Raised brush stroke', pre: ['brickTool_raisedBrush', 'brickRaisedMode_bricks'], act: { stroke: [[0.22, 0.62], [0.78, 0.64]] }, fixedBy: '12718cf' },
    { name: 'Grout cut stroke', pre: ['brickRaisedMode_grout'], act: { stroke: [[0.3, 0.2], [0.7, 0.75]] }, post: ['brickRaisedMode_bricks'], fixedBy: '12718cf' },
    { name: 'Area brush stroke', pre: ['brickTool_wall', 'brickSubTool_wall_area', 'brickWallAreaWidth_2'], act: { stroke: [[0.3, 0.3], [0.62, 0.38]] } },
    { name: 'Frame tab Generate', pre: ['editorTabFrame'], act: { tap: 'editorFrameGenerate' } },
    { name: 'Photo pattern pick', pre: ['editorTabPhoto', 'photoTab_source'], act: { tapSel: '#photoPatternRow button' } },
    // the editor's backdrop repaint after a Photo change (seat D 2026-10-09: ~340 ms, no card) -- the 'backdrop' stage
    { name: 'Photo: blur slider release (editor open)', pre: ['photoTab_adjust', 'photoTool_blur'], act: { set: 'photoBlurSlider', value: 3 } },
    { name: 'Photo: Rotate 90 (editor open)', pre: ['photoTab_source', 'photoTool_rotateFlip'], act: { tap: 'photoBtnRotate' } },
    // the sidebar's quick settings on a board WITH bricks (seat D 2026-10-09, feedback audit on seat A's loaded board:
    // a pick re-rendered the Brick panel before its stage could paint, 53-79 ms frozen with no card)
    { name: 'Sidebar quick: brick set (bricks laid)', closeEditor: true, sidebar: 'decor', act: { tap: 'brickQuick_set_4' } },
    { name: 'Sidebar quick: grout colour None (bricks laid)', sidebar: 'decor', act: { tap: 'brickQuick_groutColor_none' } },
    // the Art tab (seat A's re-time 2026-10-09, main e6c4f35: 0.56-0.9 s with no feedback at all) -- in order, each on
    // the last one's board: a Generate, its Undo, the Redo, a Shape Generate, its Undo
    { name: 'Art: Lattice Generate', open: 'editorTabArtwork', pre: ['artTab_lattice'], act: { tap: 'latticeGenerate' } },
    { name: 'Art: Undo after a Generate', act: { tap: 'editorUndo' } },
    { name: 'Art: Redo', act: { tap: 'editorRedo' } },
    { name: 'Art: Shape Generate', pre: ['artTab_shape'], act: { tap: 'shapeLatticeGenerate' } },
    { name: 'Art: Undo after a Shape Generate', act: { tap: 'editorUndo' } },
  ],
};
export const sequential = true; // index.mjs: --parallel runs it alone, after the parallel groups
export const runsLast = true; // it reloads the page

let sleep, send, js, jsJSON, shot, checkRow, waitApp;
export function bind(ctx) { ({ sleep, send, js, jsJSON, shot, checkRow, waitApp } = ctx); }
export async function run() { await runBlindBudget(); }

/** Pure: the calibration's words for a FAIL's detail -- never a verdict. `medianMs` = this moment's workload median. */
export function loadNote(medianMs, cal = BLIND_BUDGET.calibration) {
  if (!Number.isFinite(medianMs)) return 'calibration: not measured';
  if (!cal.quietMs) return `calibration ${Math.round(medianMs)} ms (no quiet baseline declared)`;
  const x = medianMs / cal.quietMs, r = Math.round(x * 10) / 10;
  return `calibration ${Math.round(medianMs)} ms vs quiet ${cal.quietMs} ms: ${x >= cal.loadedAt ? `machine loaded x${r} -- this FAIL may be load; re-run quiet` : `machine not loaded (x${r}) -- a real FAIL`}`;
}
// the fixed workload (integer + sqrt math, no allocation); returns its time in ms
const CALIBRATE = (n) => `(() => { const t = performance.now(); let s = 0; for (let i = 0; i < ${n}; i++) s = (s + Math.sqrt(i ^ (s & 1023))) % 1e9; return performance.now() - t + (s < 0 ? 1 : 0); })()`;
async function calibrate(cal = BLIND_BUDGET.calibration) {
  await send('Emulation.setCPUThrottlingRate', { rate: BLIND_BUDGET.cpu });
  const t = [];
  try { for (let i = 0; i < cal.runs; i++) t.push(await js(CALIBRATE(cal.iterations))); } finally { await send('Emulation.setCPUThrottlingRate', { rate: 1 }); }
  return t.sort((a, b) => a - b)[Math.floor(t.length / 2)];
}

// a fresh page, as Fred opens it: storage cleared, Math.random seeded (a fresh start picks a random frame and terrain --
// the same pick every run, so the rows time the same board)
const FRESH_SEEDED = `try { localStorage.clear(); } catch (e) {}
  (() => { let a = 0x2f6b9d1; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;
// the page-side recorders: long tasks, and the card's first visible frame after each action's start
const RECORDERS = `(() => { if (window.__blindRec) return 1; window.__blindRec = 1;
  const el = () => document.getElementById('loading-stage'); window.__vis = () => { const e = el(); return !!e && !e.hidden && e.getClientRects().length > 0; };
  window.__long = []; window.__shown = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ start: e.startTime, dur: e.duration }); }).observe({ entryTypes: ['longtask'] });
  { let was = false; const tick = () => { const v = window.__vis(); if (v && !was) window.__shown.push(performance.now()); was = v; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  // settled = QUIET ms with no long task since the action ENDED (this is called right after it) and no stage on screen
  // (seat D 2026-10-09: quiet counted from t0 could end a row before its own debounced rebuild began)
  window.__blind = async (t0, quiet) => { const W = (ms) => new Promise((r) => setTimeout(r, ms)); const t1 = performance.now(), tEnd = t1 + 30000;
    for (;;) { await W(100); const last = window.__long.filter((e) => e.start >= t0 - 5).reduce((m, e) => Math.max(m, e.start + e.dur), t1);
      if ((performance.now() - last >= quiet && !window.__vis()) || performance.now() > tEnd) break; }
    const tasks = window.__long.filter((e) => e.start >= t0 - 5), shown = window.__shown.find((t) => t >= t0 - 5);
    const cut = shown ?? Infinity;
    return JSON.stringify({ blindMs: Math.round(tasks.reduce((s, e) => s + Math.max(0, Math.min(e.start + e.dur, cut) - e.start), 0)),
      cardMs: shown == null ? null : Math.round(shown - t0), longestMs: Math.round(tasks.reduce((m, e) => Math.max(m, e.dur), 0)),
      tasks: tasks.map((e) => [Math.round(e.start - t0), Math.round(e.dur)]) }); };
  return 1; })()`;

async function touch(points, stepMs = 30) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0][0], y: points[0][1] }] });
  for (const p of points.slice(1)) { await sleep(stepMs); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const centreOf = (sel) => jsJSON(`JSON.stringify((() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
  e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return r.width && r.height ? [r.left + r.width / 2, r.top + r.height / 2] : null; })())`);
async function tap(sel) { const c = await centreOf(sel); if (!c) return false; await touch([c]); return true; }
async function strokeIn(fracs) {
  const pts = await jsJSON(`JSON.stringify((() => { const ed = window.svgEditor, m = ed._sketchLayer.node.getScreenCTM(); const P = ${JSON.stringify(fracs)}.map(([fx, fy]) => [ed._mW * fx, ed._mH * fy]);
    const out = []; for (let i = 1; i < P.length; i++) for (let k = i === 1 ? 0 : 1; k <= 12; k++) { const x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * k / 12, y = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * k / 12; out.push([m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]); }
    return out; })())`);
  await touch(pts); return true;
}
async function doAct(a) {
  if (a.tap) return tap('#' + a.tap);
  if (a.tapSel) return tap(a.tapSel);
  if (a.set) return js(`(() => { const e = document.getElementById(${JSON.stringify(a.set)}); if (!e) return false; e.value = String(${JSON.stringify(a.value)});
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  if (a.stroke) return strokeIn(a.stroke);
  if (a.drag) { // a slider dragged: an input per value, 120 ms apart, then the release's change
    for (const v of a.values) {
      if (!(await js(`(() => { const e = document.getElementById(${JSON.stringify(a.drag)}); if (!e) return false; e.value = String(${v}); e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`))) return false;
      await sleep(120);
    }
    return js(`(() => { document.getElementById(${JSON.stringify(a.drag)}).dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  }
  return false;
}

async function runBlindBudget() {
  const B = BLIND_BUDGET;
  await send('Emulation.setDeviceMetricsOverride', { ...B.viewport, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
  const added = await send('Page.addScriptToEvaluateOnNewDocument', { source: FRESH_SEEDED });
  try { await send('Page.reload', {}); await waitApp(); } finally { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.result.identifier }); }
  await sleep(3000);
  await js(RECORDERS);
  try {
    for (const row of B.rows) {
      const budget = row.budgetMs ?? B.budgetMs, name = `No blind freeze (phone, CPU x${B.cpu}): ${row.name} -- under ${budget} ms before its card`;
      if (row.closeEditor) { await tap('#editorApply'); await sleep(4000); }
      if (row.sidebar) {
        await tap('#sidebarTab_' + row.sidebar); await sleep(800);
        await js(`(async () => { const root = document.querySelector('.cad-sidebar'); if (!root) return 0; for (const h of root.querySelectorAll('.panel-header.collapsed')) { if (h.getClientRects().length) { h.click(); await new Promise((r) => setTimeout(r, 150)); } } return 1; })()`);
      }
      if (row.open) {
        await js(`(async () => { const m = document.getElementById('svgEditorModal'); if (!m || m.style.display === 'none') document.getElementById('btnStampEdit').click();
          for (let i = 0; i < 80 && !window.svgEditor?._draw; i++) await new Promise((r) => setTimeout(r, 250)); return 1; })()`);
        await tap('#' + row.open); await sleep(1500);
      }
      let ready = true;
      for (const id of row.pre || []) { if (!(await tap('#' + id))) { ready = false; break; } await sleep(700); }
      await sleep(1200); // the setup's own work settles before the measured action
      if (!ready) { checkRow('blind', name, false, `setup control missing (${(row.pre || []).join(', ')})`); continue; }
      await send('Emulation.setCPUThrottlingRate', { rate: B.cpu });
      const t0 = await js('performance.now()');
      const did = await doAct(row.act);
      const m = did ? await jsJSON(`window.__blind(${t0}, ${B.quietMs})`) : null;
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const ok = !!m && m.blindMs <= budget;
      const load = ok || !m ? '' : ` -- ${loadNote(await calibrate())}`; // detection only: the verdict above is final
      checkRow('blind', name, ok, m ? `blind ${m.blindMs} ms, card at ${m.cardMs ?? 'never'} ms, longest task ${m.longestMs} ms, ${m.tasks.length} tasks to ${m.tasks.reduce((e, [s, d]) => Math.max(e, s + d), 0)} ms, first ${JSON.stringify(m.tasks.slice(0, 6))}${load}` : 'the action could not be done');
      if (!ok) await shot(`FAIL_blind_${row.name.replace(/[^A-Za-z0-9]+/g, '_')}`);
      for (const id of row.post || []) { await tap('#' + id); await sleep(500); }
    }
  } finally {
    await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await send('Emulation.setEmulatedMedia', { features: [] });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  }
}
