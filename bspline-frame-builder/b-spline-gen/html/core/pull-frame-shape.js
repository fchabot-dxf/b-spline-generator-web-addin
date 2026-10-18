/**
 * core/pull-frame-shape.js -- Pull from Fusion, part 2: the WOOD-FRAME SKETCH SHAPE syncs back (seat B 2026-10-18;
 * advisor 66, Fred: "He can't change the frame PATTERN in Fusion, but changing the frame's SKETCH SHAPE must sync
 * back"; "Pull SEEDS shapes and NEVER applies dimension constraints").
 *
 * Send writes the frame shape as SEED GEOMETRY (frame-handles.js frameSeedGeometry -> fb_engine/seed_geometry.py):
 * the template's own seed Line/Arc3Point steps, tagged FrameBuilder/ID = the seedMap id. Pull reads those same
 * ids back (`pulled` = {id: {points}}, the SAME shape frameSeedGeometry returns) and this module inverts them to
 * the template's own SEEDED handle values (record.seeds) -- one generic fit over the template's declared handles
 * with the app's own forward generator as the model, so every template with a seedMap fits with no per-template
 * code (tests/pull-frame-shape.test.js round-trips all of them). Pure: no DOM, no record writes.
 *
 *   - an edit the handles CAN express  -> one row per handle that moved (old -> new, inches);
 *   - an edit they cannot (residual > FRAME_SHAPE_FIT_TOL_IN: an arc turned to a line, a point dragged off its
 *     symmetry, a curve added/removed) -> `beyond`, NO rows, the record is left as is (seed, don't constrain);
 *   - a fitted value outside the handle's feasible range -> the row is kept but flagged `outOfRange` (detection
 *     only; the dialog leaves it unchecked -- advisor 66 / AGENTS.md: never a clamp).
 */
import { frameCutProfile } from '../editor/editor-frame-profile.js';
import { frameSeedGeometry, frameParamRanges, frameHandleTable, BASIS } from '../editor/frame-handles.js';
import { CHANGE_EPS_IN } from './pull-changelist.js';

/** Largest per-curve point distance (inches) at which the fitted handles still reproduce the pulled shape. Starting
 *  value (advisor 66); the live residuals decide whether it holds. */
export const FRAME_SHAPE_FIT_TOL_IN = 0.005;
/** An untouched Fusion sketch re-solves within ~4e-5 in of what Send seeded (MEASURED, F20); within this the shape
 *  is "not edited" and no fit runs, so solver noise can never become a row. */
export const FRAME_SHAPE_UNEDITED_IN = 0.001;

/** Samples per handle in the range sweep that seeds the refine. */
const SWEEP_STEPS = 24;
const TIE_BREAK = 1e-7;
const _d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The pulled curve's point distance to a model curve, tolerant of the sketch's own S/E direction (a Fusion arc's
 *  start/end need not be the Arc3Point's). Only line/arc entries carry points; pins and radius seeds do not
 *  come back as curves. */
function _curveDist(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let fwd = 0, rev = 0;
  for (let i = 0; i < a.length; i++) { fwd = Math.max(fwd, _d(a[i], b[i])); rev = Math.max(rev, _d(a[i], b[b.length - 1 - i])); }
  return Math.min(fwd, rev);
}

/** Per seedMap id (line/arc kinds that the pull actually returned): the model-vs-pulled distance. */
function _residuals(tpl, model, pulled) {
  const out = {};
  for (const e of tpl.seedMap || []) {
    if (e.kind !== 'line' && e.kind !== 'arc') continue;
    const p = pulled[e.id];
    if (!p || !Array.isArray(p.points)) continue;
    out[e.id] = _curveDist(model[e.id] && model[e.id].points, p.points);
  }
  return out;
}

const _worst = (res) => Math.max(0, ...Object.values(res).filter((v) => v !== Infinity));
const _sumsq = (res) => Object.values(res).reduce((s, v) => s + (v === Infinity ? 1e6 : v * v), 0);

/** Nelder-Mead minimise `f` from `x0` (a small, dependency-free one: <= ~7 dims, a cheap smooth cost). */
function _nelderMead(f, x0, step, iters = 400) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step[i]; simplex.push(p); }
  let vals = simplex.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]); vals = order.map((i) => vals[i]);
    if (vals[n] - vals[0] < 1e-14) break;
    const c = Array.from({ length: n }, (_, k) => simplex.slice(0, n).reduce((s, p) => s + p[k], 0) / n);
    const at = (t) => c.map((v, k) => v + t * (simplex[n][k] - v));
    const xr = at(-1), fr = f(xr);
    if (fr < vals[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; } }
    else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
    else {
      const xc = at(fr < vals[n] ? -0.5 : 0.5), fc = f(xc);
      if (fc < Math.min(fr, vals[n])) { simplex[n] = xc; vals[n] = fc; }
      else { for (let i = 1; i <= n; i++) { simplex[i] = simplex[0].map((v, k) => v + 0.5 * (simplex[i][k] - v)); vals[i] = f(simplex[i]); } }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: simplex[best], cost: vals[best] };
}

/** Fit the pulled frame shape back onto the record's seeded handles.
 *  `defs` = FRAME_DEFS, `record` = the app's frame record (P.frame), `board` = {widthIn, heightIn},
 *  `pulled` = {seedId: {points: [[x,y],...]}} (Fusion sketch inches, centred, y up -- frameSeedGeometry's own frame).
 *  Returns { status: 'none'|'unchanged'|'changed'|'beyond', rows, residuals, worstIn, beyondIds }.
 *  `rows`: [{scope:'frameShape', key, label, basis, from, to (inches), fromFrac, toFrac, unit:'in', outOfRange}]. */
export function fitPulledFrameShape(defs, record, board, pulled, { tol = FRAME_SHAPE_FIT_TOL_IN } = {}) {
  const none = { status: 'none', rows: [], residuals: {}, worstIn: 0, beyondIds: [] };
  if (!record || !record.templateId || !pulled) return none;
  const tpl = (defs.templates || []).find((t) => t.id === record.templateId);
  if (!tpl) return none;
  const W = board.widthIn, H = board.heightIn;
  const handles = frameHandleTable(tpl).filter((h) => h.binding === 'seeded');
  const profOf = (seeds) => frameCutProfile(defs, { ...record, seeds: { ...(record.seeds || {}), ...seeds } }, board);
  const modelOf = (seeds) => frameSeedGeometry(tpl, profOf(seeds), W, H);
  const prof0 = profOf({});
  const x0 = handles.map((h) => prof0.params[h.key]);
  const ranges0 = frameParamRanges(tpl, prof0.region, prof0.params);

  const res0 = _residuals(tpl, modelOf({}), pulled);
  if (!Object.keys(res0).length) return none;
  if (_worst(res0) <= FRAME_SHAPE_UNEDITED_IN) return { ...none, status: 'unchanged', residuals: res0, worstIn: _worst(res0) };

  /** Fit just the handles `idxs` (every other handle stays exactly as the record has it, derived or seeded): a
   *  handle left alone keeps whatever the template derives from the others, so a one-handle drag is fitted as a
   *  one-handle drag. Returns { x (values for idxs), seeds, res, worst, cost }. */
  const fitSubset = (idxs) => {
    const seedsOf = (x) => Object.fromEntries(idxs.map((hi, k) => [handles[hi].key, x[k]]));
    const x0s = idxs.map((hi) => x0[hi]);
    // The tiny pull toward the current value only breaks ties: a handle the shape barely depends on (T7's
    // gableNeckWidth over part of its range) must not wander to the end of its range for nothing.
    const cost = (x) => {
      try { return _sumsq(_residuals(tpl, modelOf(seedsOf(x)), pulled)) + TIE_BREAK * x.reduce((a, v, k) => a + (v - x0s[k]) ** 2, 0); }
      catch { return 1e9; }
    };
    const step = x0s.map((v) => Math.max(0.02, Math.abs(v) * 0.1));
    // A local refine alone stalls on a big drag (a handle moved several-fold), so first sweep each handle across
    // its own feasible range (others held) and start the refine from the best sweep value, twice so coupled
    // handles can walk. The refine, not the sweep, sets the accuracy.
    let start = x0s.slice(), startCost = cost(start);
    for (let pass = 0; pass < 2; pass++) {
      idxs.forEach((hi, k) => {
        const r = ranges0[handles[hi].key];
        if (!r || !(r.max > r.min)) return;
        for (let j = 0; j <= SWEEP_STEPS; j++) {
          const x = start.slice(); x[k] = r.min + ((r.max - r.min) * j) / SWEEP_STEPS;
          const c = cost(x);
          if (c < startCost) { start = x; startCost = c; }
        }
      });
    }
    let fit = _nelderMead(cost, start, step);
    for (let k = 1; k <= 3; k++) { // restart: NM stalls on a collapsed simplex
      const again = _nelderMead(cost, fit.x, step.map((v) => v / 4 ** k));
      if (again.cost >= fit.cost) break;
      fit = again;
    }
    const seeds = seedsOf(fit.x);
    const res = _residuals(tpl, modelOf(seeds), pulled);
    return { idxs, seeds, res, worst: _worst(res), cost: fit.cost };
  };

  // A single dragged handle is by far the common edit: try each handle alone first, and only fit them all
  // together when no single handle explains the shape.
  let best = null;
  for (let hi = 0; hi < handles.length; hi++) {
    const f = fitSubset([hi]);
    if (!best || f.cost < best.cost) best = f;
  }
  if (!best || best.worst > tol) {
    const all = fitSubset(handles.map((_, hi) => hi));
    if (!best || all.worst < best.worst) best = all;
  }
  const resF = best.res;
  const worstIn = best.worst;
  const beyondIds = Object.keys(resF).filter((id) => resF[id] > tol);
  if (beyondIds.length) return { status: 'beyond', rows: [], residuals: resF, worstIn, beyondIds };

  const profF = profOf(best.seeds);
  const ranges = frameParamRanges(tpl, profF.region, profF.params);
  const rows = [];
  handles.forEach((h, i) => {
    if (!(h.key in best.seeds)) return;
    const basis = BASIS[h.basis](prof0.region);
    const fitted = best.seeds[h.key];
    const from = x0[i] * basis, to = fitted * basis;
    if (Math.abs(to - from) < CHANGE_EPS_IN) return;
    const r = ranges[h.key];
    const outOfRange = !!r && (fitted < r.min - 1e-6 || fitted > r.max + 1e-6);
    rows.push({ scope: 'frameShape', key: h.key, label: h.label, basis: h.basis, from, to, fromFrac: x0[i], toFrac: fitted, unit: 'in', outOfRange });
  });
  return { status: rows.length ? 'changed' : 'unchanged', rows, residuals: resF, worstIn, beyondIds: [] };
}
