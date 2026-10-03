// F31 item 2: Flask (Template 15) diagram, PRODUCTION engine (outlineDefects + offsetOutlineInward +
// frameMiters), same pipeline as every diagram this session. 6 bars: top, 2 neck sides (straight), 2 dome
// sides (outward-bulging arcs), base. Reference: Fred's own sketch + the advisor's own
// flask_and_archtimer_render.py (Shapely) in C:/Users/danse/.bspline-status/shots/fred/.
//
// TOP WIDTH (Fred-approved shared handle, 2026-10-03): "every new template gets ONE shared declared handle:
// key 'topWidth' ... sets where the top bar meets the sides." For Flask the neck is dead straight for its
// whole height, so "neck width" (the proposed template-specific handle) and "topWidth" (the new shared one)
// are the SAME physical quantity -- declared under the shared key rather than inventing a second one.
//
// DOME FULLNESS: the advisor's own render pins the dome arc with a VERTICAL-TANGENT-AT-BASE constraint (zero
// free parameters once the neck's own two corners are fixed), which reproduces Fred's approved shape exactly
// but leaves no room for a tunable handle. Generalised: the dome is built with the SAME sagitta-bulge
// `bulgeArc` helper the Sand Timer diagram uses (bulging away from the centreline), with its OWN default
// sagitta set to whatever the vertical-tangent construction implies -- computed once, below, not guessed --
// so the default reproduces the approved render bit for bit, and "dome fullness" becomes a genuine handle
// around that default.
//
// Usage: node tools/repro/f31_item2_flask_diagram.mjs <repoRoot> [htmlOutPath]
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const [ROOT_ARG, HTML_OUT_ARG] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG ?? process.cwd()).href.replace(/\/$/, '');
const root = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const imp = (p) => import(root + p);
const { outlineDefects, primitiveToPathD, joinSegmentPathsIntoClosedD } = await imp('editor/editor-shape-lattice-generator.js');
const { offsetOutlineInward } = await imp('editor/outline-offset.js');
const { frameMiters } = await imp('editor/editor-frame-profile.js');

const T = 0.75, BBO = 0.25;
function regionFor(W, H) { return { hw: W / 2 - BBO, hh: H / 2 - BBO }; }
function mkLine(p0, p1) { return { type: 'L', p0, p1 }; }
const ang = (c, p) => Math.atan2(p.y - c.cy, p.x - c.cx);

/** Verbatim from the Sand Timer diagram: arc from p0 to p1 bulging OUTWARD (away from `awayPoint`) by
 *  sagitta `sag`. See that script's own doc comment for the derivation. */
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

/** The advisor's own closed-form "vertical tangent at base" arc (Y-DOWN, this file's convention): the circle
 *  through `top` and `base` whose tangent at `base` is horizontal in X (i.e. vertical in the usual Y-up sense
 *  -- a flat approach to the board's own bottom edge), centre on `base`'s own Y. Used ONCE, below, purely to
 *  measure that construction's own implied sagitta so the generic bulgeArc's own default reproduces it.
 */
function sagittaOfVerticalTangentArc(top, base) {
  const { x: x1, y: y1 } = top, { x: x0, y: y0 } = base;
  const xc = (x1 * x1 - x0 * x0 + (y1 - y0) ** 2) / (2 * (x1 - x0));
  const R = Math.abs(x0 - xc);
  const mx = (x1 + x0) / 2, my = (y1 + y0) / 2;
  return Math.hypot(mx - xc, my - y0) >= 0 ? R - Math.hypot(xc - mx, y0 - my) : 0; // R minus centre-to-chord-midpoint distance
}

/** Flask outer outline (6 primitives, travel order matching every other diagram this session: down the
 *  right side, across the bottom, up the left side, across the top, closing). Fractions scale with the board:
 *    topWidthFrac    fraction of hw, the neck's own half-width (shared handle, F31 header rule)
 *    neckHeightFrac  0..1, fraction of the FULL height the neck itself occupies, measured down from the top
 *    domeFullness    fraction of hw, the dome arc's own outward sagitta (default = the vertical-tangent value)
 */
function buildFlask(topWidthFrac, neckHeightFrac, domeFullnessFrac, W, H) {
  const { hw, hh } = regionFor(W, H);
  const nw = hw * topWidthFrac;
  const neckBottomY = -hh + neckHeightFrac * 2 * hh;
  const domeSag = hw * domeFullnessFrac;
  const neckTopR = { x: nw, y: -hh }, neckTopL = { x: -nw, y: -hh };
  const neckBottomR = { x: nw, y: neckBottomY }, neckBottomL = { x: -nw, y: neckBottomY };
  const baseR = { x: hw, y: hh }, baseL = { x: -hw, y: hh };
  const domeR = bulgeArc(neckBottomR, baseR, domeSag, { x: 0, y: (neckBottomR.y + baseR.y) / 2 });
  const domeL = bulgeArc(baseL, neckBottomL, domeSag, { x: 0, y: (baseL.y + neckBottomL.y) / 2 });
  const prims = [mkLine(neckTopR, neckBottomR), domeR, mkLine(baseR, baseL), domeL, mkLine(neckBottomL, neckTopL), mkLine(neckTopL, neckTopR)];
  return { hw, hh, prims, neckTopR, neckTopL, neckBottomR, neckBottomL, nw, neckBottomY, domeSag };
}

const PIECE_NAMES = ['neck_R', 'dome_R', 'bottom', 'dome_L', 'neck_L', 'top'];
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
const primEnd = (p, atEnd) => (p.type === 'L' ? (atEnd ? p.p1 : p.p0) : { x: p.cx + p.rx * Math.cos(atEnd ? p.theta1 + p.dTheta : p.theta1), y: p.cy + p.ry * Math.sin(atEnd ? p.theta1 + p.dTheta : p.theta1) });

/** F30 item 5's own lesson: every piece's own END must exactly meet the NEXT piece's own START. */
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
function mirrorCheck(prims) {
  // Right-side pieces (0,1) vs left-side (4,3 -- travel-reversed): endpoints/radii should be exact mirrors.
  const RIGHT = [0, 1], LEFT = [4, 3];
  let worst = 0, worstAt = null;
  for (let k = 0; k < RIGHT.length; k++) {
    const r = prims[RIGHT[k]], l = prims[LEFT[k]];
    const rPts = [primEnd(r, false), primEnd(r, true)], lPts = [primEnd(l, true), primEnd(l, false)];
    for (let i = 0; i < 2; i++) {
      const err = Math.max(Math.abs(rPts[i].x - -lPts[i].x), Math.abs(rPts[i].y - lPts[i].y));
      if (err > worst) { worst = err; worstAt = `${PIECE_NAMES[RIGHT[k]]}/${PIECE_NAMES[LEFT[k]]} pt${i}`; }
    }
    if (r.type === 'A' && l.type === 'A') {
      const err = Math.abs(r.rx - l.rx);
      if (err > worst) { worst = err; worstAt = `${PIECE_NAMES[RIGHT[k]]}/${PIECE_NAMES[LEFT[k]]} radius`; }
    }
  }
  return { worstMismatchIn: worst, worstAt };
}

function check(label, topWidthFrac, neckHeightFrac, domeFullnessFrac, W, H) {
  const b = buildFlask(topWidthFrac, neckHeightFrac, domeFullnessFrac, W, H);
  const outerDef = outlineDefects(b.prims, { requireTangency: false });
  const continuity = continuityCheck(b.prims);
  const inner = offsetOutlineInward(b.prims, T);
  const innerReal = inner.filter((p) => !p.collapsed);
  const innerDef = outlineDefects(innerReal, { requireTangency: false });
  const lens = b.prims.map(primLength);
  const minLen = Math.min(...lens);
  const miters = frameMiters(b.prims, inner);
  const hw = b.hw, hh = b.hh;
  let oob = 0;
  for (const p of b.prims) {
    const pts = p.type === 'L' ? [p.p0, p.p1] : Array.from({ length: 9 }, (_, i) => ({ x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta * i / 8), y: p.cy + p.ry * Math.sin(p.theta1 + p.dTheta * i / 8) }));
    for (const q of pts) if (q.x < -hw - 1e-6 || q.x > hw + 1e-6 || q.y < -hh - 1e-6 || q.y > hh + 1e-6) oob++;
  }
  const collapsedCount = inner.filter((p) => p.collapsed).length;
  const clean = outerDef.length === 0 && innerDef.length === 0 && oob === 0 && collapsedCount === 0 && continuity.worstGapIn < 1e-6;
  const ok = clean && minLen >= T - 1e-9;
  console.log(`${label} ${W}x${H} topW=${topWidthFrac.toFixed(3)} neckH=${neckHeightFrac.toFixed(3)} dome=${domeFullnessFrac.toFixed(3)}: outerDef=${outerDef.length} innerDef=${innerDef.length} collapsed=${collapsedCount} oob=${oob} minLen=${minLen.toFixed(4)} miters=${miters.length} clean=${clean} OK=${ok}`);
  if (continuity.worstGapIn >= 1e-6) console.log(`  CONTINUITY GAP: ${continuity.worstGapIn.toFixed(4)}in at ${continuity.worstAt}`);
  if (outerDef.length) console.log('  outerDef', JSON.stringify(outerDef));
  if (innerDef.length) console.log('  innerDef', JSON.stringify(innerDef));
  return { ok, clean, b, inner, miters, minLen };
}

// --- measure the advisor's own default (vertical-tangent dome), reproduced bit for bit ---
const DEFAULT_TOPWIDTH = 0.45, DEFAULT_NECKHEIGHT = 0.45; // advisor: nw=0.45*hw, neck spans the top 0.45 of H
{
  const { hw, hh } = regionFor(7, 9);
  const neckBottomY = -hh + DEFAULT_NECKHEIGHT * 2 * hh;
  const top = { x: hw * DEFAULT_TOPWIDTH, y: neckBottomY }, base = { x: hw, y: hh };
  // sagittaOfVerticalTangentArc is derived in (x, y-up-from-base) local terms; translate: measure directly via
  // the SAME chord-midpoint-to-arc-apex distance this file's own bulgeArc would produce, by building the
  // vertical-tangent circle directly (centre on y=hh, same Y-down frame) instead of reusing the Y-up helper.
  const x1 = top.x, y1 = top.y, x0 = base.x, y0 = base.y;
  const xc = (x1 * x1 - x0 * x0 + (y1 - y0) ** 2) / (2 * (x1 - x0));
  const R = Math.abs(x0 - xc);
  const mx = (x1 + x0) / 2, my = (y1 + y0) / 2;
  const centreToChordMid = Math.hypot(xc - mx, y0 - my); // base-row centre, so use y0 (==hh) consistently
  var DEFAULT_DOME_SAG = R - Math.hypot(xc - mx, hh - my);
  var DEFAULT_DOMEFRAC = DEFAULT_DOME_SAG / hw;
  console.log(`Measured default dome sagitta (vertical-tangent-at-base, 7x9): ${DEFAULT_DOME_SAG.toFixed(4)}in = ${DEFAULT_DOMEFRAC.toFixed(4)} of hw`);
}

console.log('--- Flask: default sweep across board sizes ---');
for (const [W, H] of [[6, 9], [7, 9], [9, 12]]) check('default', DEFAULT_TOPWIDTH, DEFAULT_NECKHEIGHT, DEFAULT_DOMEFRAC, W, H);

function maxCleanParam(paramIdx, lo, hi, base, W, H) {
  const args = [...base];
  const probe = (v) => { args[paramIdx] = v; return check('_probe', ...args, W, H).clean; };
  if (!probe(lo)) return lo;
  if (probe(hi)) return hi;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (probe(mid)) lo = mid; else hi = mid;
  }
  return lo;
}
function minCleanParam(paramIdx, lo, hi, base, W, H) {
  const args = [...base];
  const probe = (v) => { args[paramIdx] = v; return check('_probe', ...args, W, H).clean; };
  if (!probe(hi)) return hi;
  if (probe(lo)) return lo;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (probe(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

console.log('--- Flask: range ends per board size ---');
const ranges = {};
for (const [W, H] of [[6, 9], [7, 9], [9, 12]]) {
  const key = `${W}x${H}`;
  const base = [DEFAULT_TOPWIDTH, DEFAULT_NECKHEIGHT, DEFAULT_DOMEFRAC];
  // topWidth: narrower (smaller) and wider (larger, capped before it nears the dome's own full width)
  const topWMin = minCleanParam(0, 0.05, DEFAULT_TOPWIDTH, base, W, H);
  const topWMax = maxCleanParam(0, DEFAULT_TOPWIDTH, 0.9, base, W, H);
  // neckHeight: shorter neck (smaller frac, more dome) and taller neck (larger frac, less dome)
  const neckHMin = minCleanParam(1, 0.02, DEFAULT_NECKHEIGHT, base, W, H);
  const neckHMax = maxCleanParam(1, DEFAULT_NECKHEIGHT, 0.95, base, W, H);
  // dome fullness: flatter (less sagitta) and fuller (more)
  const domeMin = minCleanParam(2, 0.02, DEFAULT_DOMEFRAC, base, W, H);
  const domeMax = maxCleanParam(2, DEFAULT_DOMEFRAC, 0.9, base, W, H);
  ranges[key] = { topWMin, topWMax, neckHMin, neckHMax, domeMin, domeMax };
  console.log(`${key}: topWidth [${topWMin.toFixed(3)}, ${topWMax.toFixed(3)}], neckHeight [${neckHMin.toFixed(3)}, ${neckHMax.toFixed(3)}], dome [${domeMin.toFixed(3)}, ${domeMax.toFixed(3)}]`);
}

// symmetry sanity on the default case
{
  const r = check('(sym check)', DEFAULT_TOPWIDTH, DEFAULT_NECKHEIGHT, DEFAULT_DOMEFRAC, 7, 9);
  const sym = mirrorCheck(r.b.prims);
  console.log(`Symmetry check (7x9 default): worst mismatch ${sym.worstMismatchIn.toFixed(6)}in at ${sym.worstAt}`);
}

function svgFor(result, label, hw, hh) {
  const { b, inner, miters } = result;
  const outerD = joinSegmentPathsIntoClosedD(b.prims.map((p) => primitiveToPathD(p)));
  const innerD = joinSegmentPathsIntoClosedD(inner.filter((p) => !p.collapsed).map((p) => primitiveToPathD(p)));
  const pad = 0.5;
  const vbX = -hw - pad, vbY = -hh - pad, vbW = 2 * hw + 2 * pad, vbH = 2 * hh + 2 * pad;
  return `
  <svg width="520" height="${Math.round(520 * vbH / vbW)}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">
    <rect class="board" x="${-hw}" y="${-hh}" width="${2 * hw}" height="${2 * hh}"/>
    <path class="outer" d="${outerD}"/>
    <path class="inner" d="${innerD}"/>
    ${miters.map((m) => `<line class="miter" x1="${m.outer.x}" y1="${m.outer.y}" x2="${m.inner.x}" y2="${m.inner.y}"/>
    <circle class="pt" cx="${m.outer.x}" cy="${m.outer.y}" r="0.03"/><circle class="pt" cx="${m.inner.x}" cy="${m.inner.y}" r="0.03"/>`).join('\n')}
    <circle class="handle" cx="${b.neckBottomR.x}" cy="${b.neckBottomR.y}" r="0.07"/>
    <circle class="handle" cx="${b.neckBottomL.x}" cy="${b.neckBottomL.y}" r="0.07"/>
    <text class="cap" x="0" y="${hh + pad - 0.08}">${label}</text>
  </svg>`;
}

const panels = [];
for (const [W, H] of [[6, 9], [7, 9], [9, 12]]) {
  const key = `${W}x${H}`;
  const r = ranges[key];
  const def = check(`${key} default`, DEFAULT_TOPWIDTH, DEFAULT_NECKHEIGHT, DEFAULT_DOMEFRAC, W, H);
  panels.push(svgFor(def, `${key}: default (topWidth ${DEFAULT_TOPWIDTH}, neckHeight ${DEFAULT_NECKHEIGHT}, dome ${DEFAULT_DOMEFRAC.toFixed(2)})`, def.b.hw, def.b.hh));
  const twMin = check(`${key} topWidth-min`, r.topWMin, DEFAULT_NECKHEIGHT, DEFAULT_DOMEFRAC, W, H);
  panels.push(svgFor(twMin, `${key}: topWidth min ${r.topWMin.toFixed(2)} (narrow neck)`, twMin.b.hw, twMin.b.hh));
  const twMax = check(`${key} topWidth-max`, r.topWMax, DEFAULT_NECKHEIGHT, DEFAULT_DOMEFRAC, W, H);
  panels.push(svgFor(twMax, `${key}: topWidth max ${r.topWMax.toFixed(2)} (wide neck)`, twMax.b.hw, twMax.b.hh));
  const nhMin = check(`${key} neckHeight-min`, DEFAULT_TOPWIDTH, r.neckHMin, DEFAULT_DOMEFRAC, W, H);
  panels.push(svgFor(nhMin, `${key}: neckHeight min ${r.neckHMin.toFixed(2)} (short neck)`, nhMin.b.hw, nhMin.b.hh));
  const nhMax = check(`${key} neckHeight-max`, DEFAULT_TOPWIDTH, r.neckHMax, DEFAULT_DOMEFRAC, W, H);
  panels.push(svgFor(nhMax, `${key}: neckHeight max ${r.neckHMax.toFixed(2)} (tall neck)`, nhMax.b.hw, nhMax.b.hh));
  const dMin = check(`${key} dome-min`, DEFAULT_TOPWIDTH, DEFAULT_NECKHEIGHT, r.domeMin, W, H);
  panels.push(svgFor(dMin, `${key}: dome min ${r.domeMin.toFixed(2)} (flat)`, dMin.b.hw, dMin.b.hh));
  const dMax = check(`${key} dome-max`, DEFAULT_TOPWIDTH, DEFAULT_NECKHEIGHT, r.domeMax, W, H);
  panels.push(svgFor(dMax, `${key}: dome max ${r.domeMax.toFixed(2)} (full)`, dMax.b.hw, dMax.b.hh));
}
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}
  .row{display:grid;grid-template-columns:repeat(7,1fr);gap:14px;padding:20px;max-width:3800px;}
  .outer{fill:#d9b48a;stroke:#5a3a28;stroke-width:0.035;}
  .inner{fill:#fff;stroke:#2255dd;stroke-width:0.03;stroke-dasharray:0.06 0.05;}
  .board{fill:#f7f7f7;stroke:#e05050;stroke-width:0.02;stroke-dasharray:0.08 0.06;}
  .miter{stroke:#e02020;stroke-width:0.035;}
  .pt{fill:#e02020;}
  .handle{fill:#fff;stroke:#1a6b2a;stroke-width:0.04;}
  .cap{fill:#333;font-size:0.17px;text-anchor:middle;}
</style></head><body><div class="row">${panels.join('')}</div></body></html>`;
const outPath = HTML_OUT_ARG ?? new URL('./f31_item2_flask_diagram.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
writeFileSync(outPath, html);
console.log('wrote', outPath);
