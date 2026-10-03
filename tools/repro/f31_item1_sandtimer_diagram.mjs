// F31 item 1: Sand Timer (Template 14) diagram, PRODUCTION engine (outlineDefects + offsetOutlineInward +
// frameMiters), same pipeline every other diagram this session used. 6 bars: top, bottom, upper/lower on each
// side; each side = two OUTWARD-bulging arcs meeting at a sharp pinch (mitered there -- a genuine corner, the
// two arcs' tangents differ). Reference: Fred's own sketch + the advisor's sandtimer_render.py (Shapely-based
// approximation) in C:/Users/danse/.bspline-status/shots/fred/ -- this reuses that script's own exact sagitta-
// bulge geometry (arc3), re-derived here against the app's own primitive format + the PRODUCTION offset/miter
// code instead of Shapely, so the diagram shows what the real engine would actually build.
//
// Usage: node tools/repro/f31_item1_sandtimer_diagram.mjs <repoRoot> [htmlOutPath]
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

/** Arc from p0 to p1 bulging OUTWARD (away from `awayPoint`) by sagitta `sag`. Same closed-form sagitta
 *  circle as the T10+taper diagram's own archPrimitive, generalised: the bulge DIRECTION is computed from
 *  the chord's own normal (picking whichever side is farther from `awayPoint`) instead of assumed "up", and
 *  the sweep branch is picked by checking the TRUE apex point (mid + normal*sag) lies on it, instead of a
 *  fixed -90deg. Reduces to a straight line at sag=0 (not expected to be hit here, but guarded).
 */
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

/** Sand Timer outer outline (6 primitives, travel order matching every other diagram this session: down the
 *  right side, across the bottom, up the left side, across the top, closing). Params are all fractions so the
 *  shape scales with the board:
 *    pinchReachFrac  0..1, how far IN from the side the pinch sits (0 = no pinch at all, pinchHalf = hw)
 *    bulgeFrac       fraction of hw, the outward sagitta of each of the 4 side arcs
 *    pinchHeightFrac 0..1, 0 = pinch at the top edge, 1 = at the bottom edge, 0.5 = centred (Fred's sketch)
 */
function buildSandTimer(pinchReachFrac, bulgeFrac, pinchHeightFrac, W, H) {
  const { hw, hh } = regionFor(W, H);
  const pinchHalf = hw * (1 - pinchReachFrac);
  const bulge = hw * bulgeFrac;
  const pinchY = -hh + pinchHeightFrac * 2 * hh;
  const TL = { x: -hw, y: -hh }, TR = { x: hw, y: -hh }, BR = { x: hw, y: hh }, BL = { x: -hw, y: hh };
  const pR = { x: pinchHalf, y: pinchY }, pL = { x: -pinchHalf, y: pinchY };
  const upperR = bulgeArc(TR, pR, bulge, { x: 0, y: (TR.y + pR.y) / 2 });
  const lowerR = bulgeArc(pR, BR, bulge, { x: 0, y: (pR.y + BR.y) / 2 });
  const lowerL = bulgeArc(BL, pL, bulge, { x: 0, y: (BL.y + pL.y) / 2 });
  const upperL = bulgeArc(pL, TL, bulge, { x: 0, y: (pL.y + TL.y) / 2 });
  const prims = [upperR, lowerR, mkLine(BR, BL), lowerL, upperL, mkLine(TL, TR)];
  return { hw, hh, prims, pR, pL, pinchHalf, bulge, pinchY, pinchReachFrac, bulgeFrac, pinchHeightFrac };
}

const PIECE_NAMES = ['upper_R', 'lower_R', 'bottom', 'lower_L', 'upper_L', 'top'];
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
const primEnd = (p, atEnd) => (p.type === 'L' ? (atEnd ? p.p1 : p.p0) : { x: p.cx + p.rx * Math.cos(atEnd ? p.theta1 + p.dTheta : p.theta1), y: p.cy + p.ry * Math.sin(atEnd ? p.theta1 + p.dTheta : p.theta1) });

/** F30 item 5's own lesson (a real shoulder/waist gap that mirror-symmetry checking alone missed, since
 *  both sides had the identical bug): every piece's own END must exactly meet the NEXT piece's own START.
 *  Cheap here too (6 pieces, each built directly from pR/pL/corners, not reused from elsewhere) but worth
 *  asserting rather than assuming, same discipline. */
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

/** The neck opening: the real distance between the right pinch's own INNER point and the left pinch's own
 *  INNER point, after the production inward offset -- the dispatch's own "where the two sides' bars would
 *  meet/overlap" check. Found by nearest-sample on the inner polyline to each outer pinch point (same idea
 *  `outline-offset.js` itself uses internally: each outer vertex maps to one inner vertex at the same index).
 */
function neckOpening(b, inner) {
  // pR/pL are the shared vertex between upper_*/lower_* (index 0/1 boundary on the right, 3/4 on the left).
  // inner[i] is the offset of prims[i]; its own p1 (for upper_R, index 0) / p0 (for lower_R, index 1) should
  // coincide at the inner pinch point (same construction offsetOutlineInward uses: one inner vertex per
  // outer vertex, shared between consecutive pieces).
  const innerPt = (p, atEnd) => (p.type === 'L' ? (atEnd ? p.p1 : p.p0) : { x: p.cx + p.rx * Math.cos(atEnd ? p.theta1 + p.dTheta : p.theta1), y: p.cy + p.ry * Math.sin(atEnd ? p.theta1 + p.dTheta : p.theta1) });
  const rightInnerPinch = innerPt(inner[0], true); // end of inner upper_R == start of inner lower_R
  const leftInnerPinch = innerPt(inner[4], true); // end of inner upper_L == start of inner upper_L... (closing)
  return rightInnerPinch.x - (-Math.abs(leftInnerPinch.x)); // signed gap, >0 = open, <=0 = touching/crossed
}

function check(label, pinchReachFrac, bulgeFrac, pinchHeightFrac, W, H) {
  const b = buildSandTimer(pinchReachFrac, bulgeFrac, pinchHeightFrac, W, H);
  const outerDef = outlineDefects(b.prims, { requireTangency: false });
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
  const neck = neckOpening(b, inner);
  const collapsedCount = inner.filter((p) => p.collapsed).length;
  const continuity = continuityCheck(b.prims);
  const clean = outerDef.length === 0 && innerDef.length === 0 && oob === 0 && collapsedCount === 0 && neck > 1e-6 && continuity.worstGapIn < 1e-6;
  const ok = clean && minLen >= T - 1e-9;
  console.log(`${label} ${W}x${H} reach=${pinchReachFrac.toFixed(3)} bulge=${bulgeFrac.toFixed(3)} hgt=${pinchHeightFrac.toFixed(3)}: outerDef=${outerDef.length} innerDef=${innerDef.length} collapsed=${collapsedCount} oob=${oob} neck=${neck.toFixed(4)}in minLen=${minLen.toFixed(4)} miters=${miters.length} clean=${clean} OK=${ok}`);
  if (continuity.worstGapIn >= 1e-6) console.log(`  CONTINUITY GAP: ${continuity.worstGapIn.toFixed(4)}in at ${continuity.worstAt}`);
  if (outerDef.length) console.log('  outerDef', JSON.stringify(outerDef));
  if (innerDef.length) console.log('  innerDef', JSON.stringify(innerDef));
  return { ok, clean, b, inner, miters, neck, minLen };
}

// --- find the valid range for pinch reach x bulge (the dispatch's own "propose the valid range") ---
function maxBulgeForReach(reach, pinchHeightFrac, W, H, lo = 0, hi = 0.6) {
  if (!check('_probe', reach, lo, pinchHeightFrac, W, H).clean) return lo; // even bulge=0 fails (shouldn't happen)
  if (check('_probe', reach, hi, pinchHeightFrac, W, H).clean) return hi;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (check('_probe', reach, mid, pinchHeightFrac, W, H).clean) lo = mid; else hi = mid;
  }
  return lo;
}
function pinchHeightRange(reach, bulge, W, H) {
  // sweep from centre outward both ways to find where a chamber's own arc degenerates (minLen < T) or the
  // outline stops being clean -- the dispatch's own "offset" handle range ends.
  const probe = (hf) => check('_probe', reach, bulge, hf, W, H);
  let loHf = 0.5, hiHf = 0.5;
  for (let hf = 0.5; hf > 0.02; hf -= 0.01) { if (probe(hf).ok) loHf = hf; else break; }
  for (let hf = 0.5; hf < 0.98; hf += 0.01) { if (probe(hf).ok) hiHf = hf; else break; }
  return [loHf, hiHf];
}

console.log('--- Sand Timer: default (reach=0.6, bulge=0.14) sweep across board sizes ---');
for (const [W, H] of [[6, 9], [7, 9], [9, 12]]) check('default', 0.6, 0.14, 0.5, W, H);

console.log('--- Sand Timer: max clean bulge at reach=0.6, centred pinch ---');
const maxBulge = {};
for (const [W, H] of [[6, 9], [7, 9], [9, 12]]) {
  const mb = maxBulgeForReach(0.6, 0.5, W, H);
  maxBulge[`${W}x${H}`] = mb;
  console.log(`${W}x${H}: max clean bulgeFrac = ${mb.toFixed(3)}`);
}

console.log('--- Sand Timer: pinch-height (offset) range at default reach/bulge ---');
const hgtRange = {};
for (const [W, H] of [[6, 9], [7, 9], [9, 12]]) {
  const [lo, hi] = pinchHeightRange(0.6, 0.14, W, H);
  hgtRange[`${W}x${H}`] = [lo, hi];
  console.log(`${W}x${H}: pinchHeightFrac range [${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
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
    <circle class="handle" cx="${b.pR.x}" cy="${b.pR.y}" r="0.07"/>
    <circle class="handle" cx="${b.pL.x}" cy="${b.pL.y}" r="0.07"/>
    <text class="cap" x="0" y="${hh + pad - 0.08}">${label}</text>
  </svg>`;
}

const panels = [];
for (const [W, H] of [[6, 9], [7, 9], [9, 12]]) {
  const key = `${W}x${H}`;
  const def = check(`${key} default`, 0.6, 0.14, 0.5, W, H);
  panels.push(svgFor(def, `${key}: default (reach 0.6, bulge 0.14, centred)`, def.b.hw, def.b.hh));
  const mb = maxBulge[key];
  const atLimit = check(`${key} max-bulge`, 0.6, mb, 0.5, W, H);
  panels.push(svgFor(atLimit, `${key}: max clean bulge ${mb.toFixed(2)} (neck ${atLimit.neck.toFixed(2)}in)`, atLimit.b.hw, atLimit.b.hh));
  const [loHf, hiHf] = hgtRange[key];
  const up = check(`${key} offset-up`, 0.6, 0.14, loHf, W, H);
  panels.push(svgFor(up, `${key}: offset up to ${loHf.toFixed(2)} (small top chamber)`, up.b.hw, up.b.hh));
  const down = check(`${key} offset-down`, 0.6, 0.14, hiHf, W, H);
  panels.push(svgFor(down, `${key}: offset down to ${hiHf.toFixed(2)} (small bottom chamber)`, down.b.hw, down.b.hh));
}
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}
  .row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:20px;max-width:2200px;}
  .outer{fill:#d9b48a;stroke:#5a3a28;stroke-width:0.035;}
  .inner{fill:#fff;stroke:#2255dd;stroke-width:0.03;stroke-dasharray:0.06 0.05;}
  .board{fill:#f7f7f7;stroke:#e05050;stroke-width:0.02;stroke-dasharray:0.08 0.06;}
  .miter{stroke:#e02020;stroke-width:0.035;}
  .pt{fill:#e02020;}
  .handle{fill:#fff;stroke:#1a6b2a;stroke-width:0.04;}
  .cap{fill:#333;font-size:0.19px;text-anchor:middle;}
</style></head><body><div class="row">${panels.join('')}</div></body></html>`;
const outPath = HTML_OUT_ARG ?? new URL('./f31_item1_sandtimer_diagram.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
writeFileSync(outPath, html);
console.log('wrote', outPath);
