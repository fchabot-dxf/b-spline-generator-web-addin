// T84 items 1-2: Arched Funnel (Template 16) + Tulip (Template 17) diagrams, PRODUCTION engine
// (outlineDefects + offsetOutlineInward + frameMiters + miterStaysInsideWood), same pipeline F31 item 1's
// sand-timer diagram used (tools/repro/f31_item1_sandtimer_diagram.mjs on the fb-app worktree) -- this
// script mirrors that one's own structure closely (bulgeArc, continuityCheck, check(), range-finding,
// svgFor) rather than reinventing it.
//
// Both templates share ONE builder: an arch top, straight-or-concave upper sides tapering to a waist, then
// outward-bulging lower curves to a flat base. Funnel (T16) = upperCurveFrac 0 (straight sides, bulgeArc's
// own documented behaviour at sag<1e-9 is a straight line); Tulip (T17) = upperCurveFrac > 0 (concave sides
// bulging toward the centreline). Reference geometry: the advisor's own approved Shapely render,
// C:/Users/danse/.bspline-status/shots/fred/flask_and_archtimer_render.py's own arch_timer() (y-up,
// origin at the board's own bottom-left; converted below to this script's own y-down, centre-origin
// convention -- see the comment above buildArchedTimer for the exact conversion).
//
// BAR-COUNT FLAG (read before treating this as final): the dispatch's own brief and the advisor's own
// reference script both say "7 bars"; this diagram builds 6 (arch, upper_R, lower_R, base, lower_L,
// upper_L), one continuous arch rather than two halves meeting at the apex. The advisor's own reference
// script constructs the arch as two symmetric halves purely because it reuses a mirror() helper on the
// RIGHT side's own point list -- the apex itself is perfectly tangent (the top of a symmetric arc), so by
// this project's own "a bar is a maximal run of TANGENT-joined pieces, miter only at a true corner"
// convention (T7/T11 precedent, fb_engine template_data.py's own FRAME_BARS), splitting it into two bars
// there would need either a non-mitered-but-non-tangent joint (inconsistent) or a visible miter at the very
// top-centre (not asked for, and "always miter" means every BAR boundary gets one, not that a smooth arc
// must be cut in two). Flagged for the advisor/Fred to confirm; not resolved here since this is diagram-only.
//
// Usage: node tools/repro/t84_items1_2_archedfunnel_tulip_diagram.mjs <repoRoot> [htmlOutPath]
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const [ROOT_ARG, HTML_OUT_ARG] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG ?? process.cwd()).href.replace(/\/$/, '');
const root = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const imp = (p) => import(root + p);
const { outlineDefects, primitiveToPathD, joinSegmentPathsIntoClosedD } = await imp('editor/editor-shape-lattice-generator.js');
const { offsetOutlineInward } = await imp('editor/outline-offset.js');
const { frameMiters, miterStaysInsideWood } = await imp('editor/editor-frame-profile.js');

const T = 0.75, BBO = 0.25;
function regionFor(W, H) { return { hw: W / 2 - BBO, hh: H / 2 - BBO }; }
function mkLine(p0, p1) { return { type: 'L', p0, p1 }; }
const ang = (c, p) => Math.atan2(p.y - c.cy, p.x - c.cx);

// Identical to f31_item1_sandtimer_diagram.mjs's own bulgeArc (verbatim) -- the one proven, production-
// format arc builder this session's diagrams all use. Bulges p0->p1 OUTWARD (away from `awayPoint`) by
// sagitta `sag`; sag<1e-9 -> a straight line (this is what makes upperCurveFrac=0 give the Funnel's own
// straight sides for free, same builder as the Tulip).
function bulgeArc(p0, p1, sag, awayPoint) {
  if (sag < 1e-9) return mkLine(p0, p1);
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  const dx = p1.x - p0.x, dy = p1.y - p0.y, L = Math.hypot(dx, dy), halfChord = L / 2;
  let nx = -dy / L, ny = dx / L;
  const dAway = (mx + nx - awayPoint.x) ** 2 + (my + ny - awayPoint.y) ** 2;
  const dMid = (mx - awayPoint.x) ** 2 + (my - awayPoint.y) ** 2;
  if (dAway < dMid) { nx = -nx; ny = -ny; }
  const R = (halfChord * halfChord + sag * sag) / (2 * sag);
  const cx = mx + nx * (sag - R), cy = my + ny * (sag - R);
  const c = { cx, cy };
  const th0 = ang(c, p0), th1 = ang(c, p1);
  let dTheta = th1 - th0;
  while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
  while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
  const apex = { x: mx + nx * sag, y: my + ny * sag };
  const apexTheta = ang(c, apex);
  const onSweep = (d) => { const u = (((apexTheta - th0) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) / d; return u > 0 && u < 1; };
  if (!onSweep(dTheta)) dTheta += dTheta > 0 ? -2 * Math.PI : 2 * Math.PI;
  return { type: 'A', cx, cy, rx: R, ry: R, phi: 0, theta1: th0, dTheta };
}

/** Arched Funnel / Tulip outer outline (6 primitives, travel order matching every other diagram this
 *  session: down the right side, across the base, up the left side, closing with the arch -- same order
 *  f31's own sand-timer uses, just with the "top" piece an arch instead of a straight line).
 *
 *  Coordinate conversion from the advisor's own reference (flask_and_archtimer_render.py's arch_timer(),
 *  y-up, origin at the board's own bottom-left, W/H already BBO-adjusted): this script's own convention is
 *  centre-origin, y-DOWN (matching f31/f30). x_here = x_ref - hw; y_here = hh - y_ref. The reference's own
 *  literal fractions (tw=0.75*hw, rise=0.26*0.75*W=0.39*hw, wy=0.45*H -> waistHeightFrac 0.55 in this
 *  script's own 0=top/1=bottom convention, ww=0.38*hw, lower sagitta 0.55in at 7x9 -> bulgeFrac~=0.169)
 *  become this builder's own default handle values, below.
 *
 *    archHalfSpan   FIXED at 0.75*hw (not a handle -- matches the advisor's own approved proportion; the
 *                   dispatch's own "arch height" handle is archRiseFrac, the SAGITTA, not the half-span)
 *    archRiseFrac   fraction of hw, the arch's own sagitta (bulges toward the top edge)
 *    waistWidthFrac fraction of hw, the waist's own half-width
 *    waistHeightFrac 0..1, 0 = waist at the top edge, 1 = at the bottom edge (same convention as F31 item
 *                   1's own pinchHeightFrac -- "the offset", per the dispatch)
 *    bulgeFrac      fraction of hw, the outward sagitta of the 2 lower curves (waist to base corner)
 *    upperCurveFrac fraction of hw, the INWARD (concave) sagitta of the 2 upper sides (arch end to waist);
 *                   0 = straight (Funnel); >0 = concave (Tulip) -- same bulgeArc, opposite awayPoint side
 */
function buildArchedTimer(archRiseFrac, waistWidthFrac, waistHeightFrac, bulgeFrac, upperCurveFrac, W, H) {
  const { hw, hh } = regionFor(W, H);
  const archHalfSpan = hw * 0.75;
  const archRise = hw * archRiseFrac;
  const waistHalf = hw * waistWidthFrac;
  const waistY = -hh + waistHeightFrac * 2 * hh;
  const bulge = hw * bulgeFrac;
  const upperCurve = hw * upperCurveFrac;

  const topR = { x: archHalfSpan, y: -hh + archRise }, topL = { x: -archHalfSpan, y: -hh + archRise };
  const BR = { x: hw, y: hh }, BL = { x: -hw, y: hh };
  const waistR = { x: waistHalf, y: waistY }, waistL = { x: -waistHalf, y: waistY };

  // arch: bulges toward the top edge (away from the board's own bottom-centre)
  const arch = bulgeArc(topL, topR, archRise, { x: 0, y: hh });
  // upper sides: away-point OUTSIDE the board's own left/right edge -> the bulge goes INWARD (concave)
  // toward the centreline when upperCurve>0; a straight line (Funnel) at upperCurve=0 regardless.
  const upperRSide = bulgeArc(topR, waistR, upperCurve, { x: hw * 3, y: (topR.y + waistY) / 2 });
  const upperLSide = bulgeArc(waistL, topL, upperCurve, { x: -hw * 3, y: (topL.y + waistY) / 2 });
  // lower curves: away-point on the centreline -> bulges OUTWARD, same convention as the sand-timer's own
  const lowerR = bulgeArc(waistR, BR, bulge, { x: 0, y: (waistY + BR.y) / 2 });
  const lowerL = bulgeArc(BL, waistL, bulge, { x: 0, y: (BL.y + waistY) / 2 });

  const prims = [upperRSide, lowerR, mkLine(BR, BL), lowerL, upperLSide, arch];
  return {
    hw, hh, prims, topR, topL, waistR, waistL, archHalfSpan, archRise, waistHalf, waistY, bulge, upperCurve,
    archRiseFrac, waistWidthFrac, waistHeightFrac, bulgeFrac, upperCurveFrac,
  };
}

const PIECE_NAMES = ['upper_R', 'lower_R', 'base', 'lower_L', 'upper_L', 'arch'];
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
const primEnd = (p, atEnd) => (p.type === 'L' ? (atEnd ? p.p1 : p.p0) : { x: p.cx + p.rx * Math.cos(atEnd ? p.theta1 + p.dTheta : p.theta1), y: p.cy + p.ry * Math.sin(atEnd ? p.theta1 + p.dTheta : p.theta1) });

// Identical in shape to f31/f30's own continuityCheck -- the F30 item 5 lesson (a real gap mirror-symmetry
// checking alone missed, since both sides had the identical bug): every piece's own END must exactly meet
// the NEXT piece's own START.
function continuityCheck(prims) {
  let worst = 0, worstAt = null;
  const n = prims.length;
  for (let i = 0; i < n; i++) {
    const a = prims[i], b = prims[(i + 1) % n];
    const gap = Math.hypot(primEnd(a, true).x - primEnd(b, false).x, primEnd(a, true).y - primEnd(b, false).y);
    if (gap > worst) { worst = gap; worstAt = `${PIECE_NAMES[i]}->${PIECE_NAMES[(i + 1) % n]}`; }
  }
  return { worstGapIn: worst, worstAt };
}

function check(label, archRiseFrac, waistWidthFrac, waistHeightFrac, bulgeFrac, upperCurveFrac, W, H) {
  const b = buildArchedTimer(archRiseFrac, waistWidthFrac, waistHeightFrac, bulgeFrac, upperCurveFrac, W, H);
  const outerDef = outlineDefects(b.prims, { requireTangency: false });
  const inner = offsetOutlineInward(b.prims, T);
  const innerReal = inner.filter((p) => !p.collapsed);
  const innerDef = outlineDefects(innerReal, { requireTangency: false });
  const lens = b.prims.map(primLength);
  const minLen = Math.min(...lens);
  const miters = frameMiters(b.prims, inner);
  const noThinTips = miterStaysInsideWood(b.prims, miters, T); // header rule: "no thin or needle tips"
  const hw = b.hw, hh = b.hh;
  let oob = 0;
  for (const p of b.prims) {
    const pts = p.type === 'L' ? [p.p0, p.p1] : Array.from({ length: 9 }, (_, i) => ({ x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta * i / 8), y: p.cy + p.ry * Math.sin(p.theta1 + p.dTheta * i / 8) }));
    for (const q of pts) if (q.x < -hw - 1e-6 || q.x > hw + 1e-6 || q.y < -hh - 1e-6 || q.y > hh + 1e-6) oob++;
  }
  const collapsedCount = inner.filter((p) => p.collapsed).length;
  const continuity = continuityCheck(b.prims);
  const clean = outerDef.length === 0 && innerDef.length === 0 && oob === 0 && collapsedCount === 0 && continuity.worstGapIn < 1e-6;
  const ok = clean && minLen >= T - 1e-9 && miters.length === 6 && noThinTips;
  console.log(`${label} ${W}x${H} arch=${archRiseFrac.toFixed(3)} ww=${waistWidthFrac.toFixed(3)} wh=${waistHeightFrac.toFixed(3)} bulge=${bulgeFrac.toFixed(3)} upCurve=${upperCurveFrac.toFixed(3)}: outerDef=${outerDef.length} innerDef=${innerDef.length} collapsed=${collapsedCount} oob=${oob} minLen=${minLen.toFixed(4)} miters=${miters.length} noThinTips=${noThinTips} clean=${clean} OK=${ok}`);
  if (continuity.worstGapIn >= 1e-6) console.log(`  CONTINUITY GAP: ${continuity.worstGapIn.toFixed(4)}in at ${continuity.worstAt}`);
  if (outerDef.length) console.log('  outerDef', JSON.stringify(outerDef));
  if (innerDef.length) console.log('  innerDef', JSON.stringify(innerDef));
  return { ok, clean, b, inner, miters, minLen };
}

// --- range-finding, same bisection/stepping pattern as F31 item 1's own maxBulgeForReach/pinchHeightRange.
// `base` is always the FULL 5-element shape-param array (archRiseFrac, waistWidthFrac, waistHeightFrac,
// bulgeFrac, upperCurveFrac) matching check()'s own 5 positional shape args exactly -- every call site
// passes all 5 explicitly so a short/misaligned arg list can't silently shift the rest (the bug this
// script shipped with the first time: `check('_probe', ...args(v), W, H)` was missing upperCurveFrac,
// which shifted W into that slot and H into W, and every "max bulge" search silently measured garbage).
function maxFrac(paramIdx, base, W, H, lo = 0, hi = 0.6) {
  const args = (v) => { const a = base.slice(); a[paramIdx] = v; return a; };
  if (!check('_probe', ...args(lo), W, H).clean) return lo;
  if (check('_probe', ...args(hi), W, H).clean) return hi;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (check('_probe', ...args(mid), W, H).clean) lo = mid; else hi = mid;
  }
  return lo;
}
function waistHeightRange(base, W, H) {
  const probe = (hf) => { const a = base.slice(); a[2] = hf; return check('_probe', ...a, W, H); };
  let loHf = 0.5, hiHf = 0.5;
  for (let hf = 0.5; hf > 0.02; hf -= 0.01) { if (probe(hf).ok) loHf = hf; else break; }
  for (let hf = 0.5; hf < 0.98; hf += 0.01) { if (probe(hf).ok) hiHf = hf; else break; }
  return [loHf, hiHf];
}

// Defaults derived from the advisor's own approved reference (arch_timer() in flask_and_archtimer_render.py):
// archRiseFrac 0.39, waistWidthFrac 0.38, waistHeightFrac 0.55, bulgeFrac ~0.169 (0.55in at 7x9's hw=3.25).
const DEFAULT = [0.39, 0.38, 0.55, 0.169];
const BASE_FUNNEL = [...DEFAULT, 0]; // upperCurveFrac=0 -- straight sides

const SIZES = [[6, 9], [7, 9], [9, 12]];

console.log('=== Arched Funnel (T16): straight upper sides, upperCurveFrac fixed at 0 ===');
console.log('--- default across board sizes ---');
for (const [W, H] of SIZES) check('funnel default', ...BASE_FUNNEL, W, H);

console.log('--- bulge range (arch/waist fixed at default) ---');
const funnelBulgeRange = {};
for (const [W, H] of SIZES) {
  const maxB = maxFrac(3, BASE_FUNNEL, W, H, 0, 0.6);
  funnelBulgeRange[`${W}x${H}`] = maxB;
  console.log(`${W}x${H}: max clean bulgeFrac = ${maxB.toFixed(3)}`);
}

console.log('--- waist-height (offset) range (arch/waist-width/bulge fixed at default) ---');
const funnelHgtRange = {};
for (const [W, H] of SIZES) {
  const [lo, hi] = waistHeightRange(BASE_FUNNEL, W, H);
  funnelHgtRange[`${W}x${H}`] = [lo, hi];
  console.log(`${W}x${H}: waistHeightFrac range [${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
}

console.log('=== Tulip (T17): concave upper sides, upperCurveFrac swept ===');
console.log('--- max clean upperCurveFrac, other handles at default ---');
const tulipMaxCurve = {};
for (const [W, H] of SIZES) {
  const maxC = maxFrac(4, BASE_FUNNEL, W, H, 0, 0.5);
  tulipMaxCurve[`${W}x${H}`] = maxC;
  console.log(`${W}x${H}: max clean upperCurveFrac = ${maxC.toFixed(3)}`);
}
// Default curve depth: a visibly concave but moderate "tulip" shape -- 55% of the max clean value found
// above (not maxed out, per the header rule "simple and not too concave"), floored at a small fixed value
// so a template with an unusually small max still shows a visible curve.
const tulipDefaultCurve = {};
const BASE_TULIP = {};
for (const [W, H] of SIZES) {
  const key = `${W}x${H}`;
  tulipDefaultCurve[key] = Math.max(0.04, tulipMaxCurve[key] * 0.55);
  BASE_TULIP[key] = [...DEFAULT, tulipDefaultCurve[key]];
  console.log(`${key}: default upperCurveFrac = ${tulipDefaultCurve[key].toFixed(3)} (55% of max)`);
}
console.log('--- Tulip default across board sizes ---');
for (const [W, H] of SIZES) check('tulip default', ...BASE_TULIP[`${W}x${H}`], W, H);

// Tulip's OWN bulge and waist-height ranges, WITH its own curve depth active throughout -- NOT the
// Funnel's own ranges (reusing those was the second bug this script shipped with: the Tulip's own
// "waist-up" extreme, checked only at upperCurveFrac=0, silently passed a combination that fails
// miterStaysInsideWood once the curve depth is actually included).
console.log('--- Tulip bulge range (own curve depth active) ---');
const tulipBulgeRange = {};
for (const [W, H] of SIZES) {
  const key = `${W}x${H}`;
  tulipBulgeRange[key] = maxFrac(3, BASE_TULIP[key], W, H, 0, 0.6);
  console.log(`${key}: max clean bulgeFrac (tulip) = ${tulipBulgeRange[key].toFixed(3)}`);
}
console.log('--- Tulip waist-height range (own curve depth active) ---');
const tulipHgtRange = {};
for (const [W, H] of SIZES) {
  const key = `${W}x${H}`;
  const [lo, hi] = waistHeightRange(BASE_TULIP[key], W, H);
  tulipHgtRange[key] = [lo, hi];
  console.log(`${key}: waistHeightFrac range (tulip) [${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
}

function svgFor(result, label, hw, hh, archRise) {
  const { b, inner, miters } = result;
  const outerD = joinSegmentPathsIntoClosedD(b.prims.map((p) => primitiveToPathD(p)));
  const innerD = joinSegmentPathsIntoClosedD(inner.filter((p) => !p.collapsed).map((p) => primitiveToPathD(p)));
  const pad = 0.5;
  const vbX = -hw - pad, vbY = -hh - pad, vbW = 2 * hw + 2 * pad, vbH = 2 * hh + 2 * pad;
  return `
  <svg width="460" height="${Math.round(460 * vbH / vbW)}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">
    <rect class="board" x="${-hw}" y="${-hh}" width="${2 * hw}" height="${2 * hh}"/>
    <path class="outer" d="${outerD}"/>
    <path class="inner" d="${innerD}"/>
    ${miters.map((m) => `<line class="miter" x1="${m.outer.x}" y1="${m.outer.y}" x2="${m.inner.x}" y2="${m.inner.y}"/>
    <circle class="pt" cx="${m.outer.x}" cy="${m.outer.y}" r="0.03"/><circle class="pt" cx="${m.inner.x}" cy="${m.inner.y}" r="0.03"/>`).join('\n')}
    <circle class="handle" cx="${b.waistR.x}" cy="${b.waistR.y}" r="0.07"/>
    <circle class="handle" cx="${b.waistL.x}" cy="${b.waistL.y}" r="0.07"/>
    <text class="cap" x="0" y="${hh + pad - 0.08}">${label}</text>
  </svg>`;
}

const panels = [];
function addPanels(title, isTulip) {
  panels.push(`<h2>${title}</h2><div class="row">`);
  for (const [W, H] of SIZES) {
    const key = `${W}x${H}`;
    const uc = isTulip ? tulipDefaultCurve[key] : 0;
    const bulgeRange = isTulip ? tulipBulgeRange : funnelBulgeRange;
    const hgtRange = isTulip ? tulipHgtRange : funnelHgtRange;

    const def = check(`${key} default`, DEFAULT[0], DEFAULT[1], DEFAULT[2], DEFAULT[3], uc, W, H);
    panels.push(svgFor(def, `${key}: default (arch ${DEFAULT[0]}, ww ${DEFAULT[1]}, wh ${DEFAULT[2]}, bulge ${DEFAULT[3].toFixed(2)}${isTulip ? `, curve ${uc.toFixed(2)}` : ''})`, def.b.hw, def.b.hh));

    const maxB = bulgeRange[key];
    const atBulge = check(`${key} max-bulge`, DEFAULT[0], DEFAULT[1], DEFAULT[2], maxB, uc, W, H);
    panels.push(svgFor(atBulge, `${key}: max clean bulge ${maxB.toFixed(2)}`, atBulge.b.hw, atBulge.b.hh));

    const [loHf, hiHf] = hgtRange[key];
    const up = check(`${key} waist-up`, DEFAULT[0], DEFAULT[1], loHf, DEFAULT[3], uc, W, H);
    panels.push(svgFor(up, `${key}: waist up to ${loHf.toFixed(2)}`, up.b.hw, up.b.hh));
    const down = check(`${key} waist-down`, DEFAULT[0], DEFAULT[1], hiHf, DEFAULT[3], uc, W, H);
    panels.push(svgFor(down, `${key}: waist down to ${hiHf.toFixed(2)}`, down.b.hw, down.b.hh));

    if (isTulip) {
      const maxC = tulipMaxCurve[key];
      const atMaxCurve = check(`${key} max-curve`, DEFAULT[0], DEFAULT[1], DEFAULT[2], DEFAULT[3], maxC, W, H);
      panels.push(svgFor(atMaxCurve, `${key}: max clean curve depth ${maxC.toFixed(2)}`, atMaxCurve.b.hw, atMaxCurve.b.hh));
    }
  }
  panels.push('</div>');
}
addPanels('Arched Funnel (T16) -- straight upper sides', false);
addPanels('Tulip (T17) -- concave upper sides', true);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}
  h2{padding:20px 20px 0;}
  .row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:20px;max-width:2000px;}
  .outer{fill:#d9b48a;stroke:#5a3a28;stroke-width:0.035;}
  .inner{fill:#fff;stroke:#2255dd;stroke-width:0.03;stroke-dasharray:0.06 0.05;}
  .board{fill:#f7f7f7;stroke:#e05050;stroke-width:0.02;stroke-dasharray:0.08 0.06;}
  .miter{stroke:#e02020;stroke-width:0.035;}
  .pt{fill:#e02020;}
  .handle{fill:#fff;stroke:#1a6b2a;stroke-width:0.04;}
  .cap{fill:#333;font-size:0.19px;text-anchor:middle;}
</style></head><body>
<p style="padding:0 20px;max-width:900px;color:#a00;font-weight:bold;">BAR-COUNT FLAG: this diagram builds 6
bars (arch, upper_R, lower_R, base, lower_L, upper_L) with the arch as ONE continuous piece (the apex is
tangent, not a corner). The dispatch and the advisor's own reference caption both say "7 bars" -- that
reference script constructs the arch as two mirrored halves for its own coding convenience, not because the
apex is a real corner. Flagged for confirmation before this becomes template code.</p>
${panels.join('')}
</body></html>`;
const outPath = HTML_OUT_ARG ?? new URL('./t84_items1_2_archedfunnel_tulip_diagram.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
writeFileSync(outPath, html);
console.log('wrote', outPath);
