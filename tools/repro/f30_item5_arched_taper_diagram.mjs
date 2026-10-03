// F30 item 5: Arched (T10) + taper diagram, PRODUCTION engine (offsetOutlineInward + frameMiters), same
// pattern as the earlier Hourglass/Narrow Neck taper diagram, but the top piece is T10's own arch instead of
// a flat edge. KEY INSIGHT: the taper's own `taperedCorner` targets a horizontal line at y=-hh (the board's
// top edge) for T1; for T10 the horn doesn't reach the board edge at all -- it stops at the arch's own
// chord, y = -hh + archRise (eating into the horn, exactly as the real engine's hourglassConstruction does
// unconditionally). Passing `hh - archRise` in place of `hh` into the UNMODIFIED `taperedCorner` reproduces
// that target line exactly (lineAtY(..., -(hh-archRise)) === lineAtY(..., -hh+archRise)), so the shared
// taper construction needs zero changes for the arched case.
//
// Usage: node tools/repro/f30_item5_arched_taper_diagram.mjs <repoRoot> [htmlOutPath] [jsonOutPath]
//   <repoRoot>    the checkout to load the app's own modules from (current repo or a HEAD worktree)
//   [htmlOutPath] where to write the 6-panel miter-diagram HTML (default: this script's own dir)
//   [jsonOutPath] where to write the exported outer-primitive JSON (default: shots/seatC/taper_outlines_7x9.json)
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const [ROOT_ARG, HTML_OUT_ARG, JSON_OUT_ARG] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG ?? process.cwd()).href.replace(/\/$/, '');
const root = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const imp = (p) => import(root + p);
const { hourglassConstruction, generateSilhouette, paramsFromShapeModel, outlineDefects, primitiveToPathD, joinSegmentPathsIntoClosedD } = await imp('editor/editor-shape-lattice-generator.js');
const { offsetOutlineInward } = await imp('editor/outline-offset.js');
const { frameMiters } = await imp('editor/editor-frame-profile.js');
const { default: FRAME_DEFS } = await imp('data/frame-defs.js');
const T10 = FRAME_DEFS.templates.find((t) => t.id === 'template_10');
console.log('T10 hidden:', T10.hidden, 'shapeModel provisional:', !!T10.shapeModel.provisional);

const T = 0.75, BBO = 0.25;
function regionFor(W, H) {
  const hw = W / 2 - BBO, hh = H / 2 - BBO;
  return { hw, hh, region: { x: -hw, y: -hh, w: 2 * hw, h: 2 * hh } };
}
const Mx = (p) => ({ x: -p.x, y: p.y });
const extTangentPt = (c1, r1, c2, r2) => ({ x: c1.cx + (c2.cx - c1.cx) * (r1 / (r1 + r2)), y: c1.cy + (c2.cy - c1.cy) * (r1 / (r1 + r2)) });
function mkLine(p0, p1) { return { type: 'L', p0, p1 }; }
const ang = (c, p) => Math.atan2(p.y - c.cy, p.x - c.cx);
function mkArc(c, r, pFrom, pTo, longWay) {
  const a0 = ang(c, pFrom); let a1 = ang(c, pTo);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (longWay) d = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI;
  return { type: 'A', cx: c.cx, cy: c.cy, rx: r, ry: r, phi: 0, theta1: a0, dTheta: d };
}
function lineAtY(p, d, yLine) { const t = (yLine - p.y) / d.y; return { x: p.x + t * d.x, y: yLine }; }
function lineCircleNear(p0, d, c, r, ref) {
  const fx = p0.x - c.cx, fy = p0.y - c.cy;
  const A = d.x * d.x + d.y * d.y, B = 2 * (fx * d.x + fy * d.y), C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = (-B + s) / (2 * A), t2 = (-B - s) / (2 * A);
  const p1 = { x: p0.x + t1 * d.x, y: p0.y + t1 * d.y }, p2 = { x: p0.x + t2 * d.x, y: p0.y + t2 * d.y };
  return Math.hypot(p1.x - ref.x, p1.y - ref.y) < Math.hypot(p2.x - ref.x, p2.y - ref.y) ? p1 : p2;
}
function _closestPointOnLine(p0, d, c) {
  const fx = p0.x - c.cx, fy = p0.y - c.cy;
  const t = -(fx * d.x + fy * d.y) / (d.x * d.x + d.y * d.y);
  return { x: p0.x + t * d.x, y: p0.y + t * d.y };
}
// Verbatim from the earlier T1/T2 taper diagram (the shared taper construction) -- `hh` here is the TARGET
// LINE's own distance from centre, not necessarily the board's half-height (see this file's own header comment).
function taperedCorner(circle, waistCircle, convexSign, taperDeg, hw, hhTarget) {
  const r = circle.r, S = r + waistCircle.r;
  const th = (taperDeg * Math.PI) / 180;
  const dir = { x: Math.sin(th), y: Math.cos(th) };
  const n = { x: dir.y, y: -dir.x };
  const tanPtA = { x: circle.cx + convexSign * r * n.x, y: circle.cy + convexSign * r * n.y };
  const topCornerA = lineAtY(tanPtA, dir, -hhTarget);
  if (topCornerA.x <= hw + 1e-9) return { circle, topCorner: topCornerA, tanPt: tanPtA };
  const topCornerB = { x: hw, y: -hhTarget };
  const offsetP0 = { x: topCornerB.x - convexSign * r * n.x, y: topCornerB.y - convexSign * r * n.y };
  const newCentre = lineCircleNear(offsetP0, dir, waistCircle, S, { x: circle.cx, y: circle.cy })
    ?? _closestPointOnLine(offsetP0, dir, waistCircle);
  const tanPtB = { x: newCentre.x + convexSign * r * n.x, y: newCentre.y + convexSign * r * n.y };
  return { circle: { cx: newCentre.x, cy: newCentre.y, r }, topCorner: topCornerB, tanPt: tanPtB };
}
function archPrimitive(p0, p1, rise) {
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  const halfChord = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 2;
  const R = (halfChord * halfChord + rise * rise) / (2 * rise);
  const cx = mx, cy = my - rise + R;
  const th0 = Math.atan2(p0.y - cy, p0.x - cx), th1 = Math.atan2(p1.y - cy, p1.x - cx);
  let dTheta = th1 - th0;
  const apexTheta = -Math.PI / 2;
  const onSweep = (d) => { const u = (apexTheta - th0) / d; return u > 0 && u < 1; };
  if (!onSweep(dTheta)) dTheta += dTheta > 0 ? -2 * Math.PI : 2 * Math.PI;
  return { type: 'A', cx, cy, rx: R, ry: R, phi: 0, theta1: th0, dTheta };
}

/** Arched (T10) + taper: T10's own real fitted shoulder/waist/hip/archRise, UNCHANGED; the horn becomes a
 *  slanted line (tangent to the SAME shoulder circle) up to the arch's own (now possibly narrower) chord,
 *  instead of a vertical horn up to the flat top. Returns outer primitives (12) + info. */
function buildArchedTaper(taperDeg, W, H) {
  const { hw, hh, region } = regionFor(W, H);
  const resolved = paramsFromShapeModel('hourglass', T10.shapeModel, region);
  const g = hourglassConstruction(region, resolved); // untapered (resolved carries no taperAngle)
  const archRise = g.arch ? g.arch.rise : 0;
  if (archRise <= 0) throw new Error('T10 resolved with no arch -- check shapeModel');
  // SAFETY: don't hand-rederive the shoulder/waist/hip/base chain (indices 1-9) -- reuse the REAL engine's own
  // exact primitives for them (guaranteed correct, incl. whichever waist-arc branch g.waistMajor picks at this
  // board size) and replace ONLY the 3 taper-affected pieces: right horn (0), left horn (10), arch (11).
  const sil = generateSilhouette(region, { preset: 'hourglass', params: resolved });
  const waOrig = { cx: g.waistCx, cy: g.waistCenterY, r: g.radiusWaist };
  const { circle: sh, topCorner, tanPt: hornPt } = taperedCorner(
    { cx: g.shoulderCx, cy: g.shoulderY, r: g.cornerRadiusTop }, waOrig, +1, taperDeg, hw, hh - archRise);
  const shWa = extTangentPt(sh, sh.r, waOrig, waOrig.r); // shoulder-to-waist tangent, re-derived (sh may have
  // shifted off the real engine's own shoulder centre if taperedCorner took its inset branch).
  const arch = archPrimitive(Mx(topCorner), topCorner, archRise);
  const prims = [...sil.primitives];
  prims[0] = mkLine(topCorner, hornPt);
  prims[1] = mkArc(sh, sh.r, hornPt, shWa, false);
  prims[10] = mkLine(Mx(hornPt), Mx(topCorner));
  prims[9] = mkArc({ cx: -sh.cx, cy: sh.cy }, sh.r, Mx(shWa), Mx(hornPt), false);
  prims[11] = arch;
  return { hw, hh, prims, topCorner, hornPt, sh, wa: waOrig, archRise, topX: topCorner.x };
}

const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));

function check(label, build, taperDeg, W, H) {
  const b = build(taperDeg, W, H);
  const outerDef = outlineDefects(b.prims, { requireTangency: false }).filter((d) => d.kind !== 'notTangent');
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
  const clean = outerDef.length === 0 && innerDef.length === 0 && oob === 0;
  const ok = clean && minLen >= T - 1e-9;
  console.log(`${label} ${W}x${H} taper=${taperDeg.toFixed(2)}deg: outerDef=${outerDef.length} innerDef=${innerDef.length} minLen=${minLen.toFixed(4)} oob=${oob} miters=${miters.length} clean=${clean} OK=${ok} topX=${b.topX.toFixed(4)} archRise=${b.archRise.toFixed(4)}`);
  if (outerDef.length) console.log('  outerDef detail', JSON.stringify(outerDef));
  if (innerDef.length) console.log('  innerDef detail', JSON.stringify(innerDef));
  return { ok, clean, b, inner, miters, outerDef, innerDef, minLen };
}

function minFeasibleTaper(build, W, H, floor = -15) {
  if (check('_probe', build, floor, W, H).clean) return floor;
  let lo = floor, hi = 0;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (check('_probe', build, mid, W, H).clean) hi = mid; else lo = mid;
  }
  return hi;
}

console.log('--- Arched (T10) + taper, 7x9, sweep ---');
for (const d of [-15, -10, -8, -4, 0, 4, 8, 10, 15]) check('(c) Arched', buildArchedTaper, d, 7, 9);
console.log('--- Arched (T10) + taper, 6x9, sweep ---');
for (const d of [-15, -10, -8, -4, 0, 4, 8, 10, 15]) check('(c) Arched', buildArchedTaper, d, 6, 9);

const min79 = minFeasibleTaper(buildArchedTaper, 7, 9);
const min69 = minFeasibleTaper(buildArchedTaper, 6, 9);
console.log('7x9 own true minimum (clean):', min79.toFixed(2), 'deg');
console.log('6x9 own true minimum (clean):', min69.toFixed(2), 'deg');

function svgFor(result, label, hw, hh) {
  const { b, inner, miters } = result;
  const outerD = joinSegmentPathsIntoClosedD(b.prims.map((p) => primitiveToPathD(p)));
  const innerD = joinSegmentPathsIntoClosedD(inner.filter((p) => !p.collapsed).map((p) => primitiveToPathD(p)));
  const pad = 0.55;
  // the arch's own apex rises above -hh, so pad the viewbox top enough to show it (archRise up to ~0.5in typical)
  const topPad = pad + b.archRise;
  const vbX = -hw - pad, vbY = -hh - topPad, vbW = 2 * hw + 2 * pad, vbH = hh * 2 + topPad + pad;
  return `
  <svg width="620" height="${Math.round(620 * vbH / vbW)}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">
    <rect class="board" x="${-hw}" y="${-hh}" width="${2 * hw}" height="${2 * hh}"/>
    <path class="outer" d="${outerD}"/>
    <path class="inner" d="${innerD}"/>
    ${miters.map((m) => `<line class="miter" x1="${m.outer.x}" y1="${m.outer.y}" x2="${m.inner.x}" y2="${m.inner.y}"/>
    <circle class="pt" cx="${m.outer.x}" cy="${m.outer.y}" r="0.035"/><circle class="pt" cx="${m.inner.x}" cy="${m.inner.y}" r="0.035"/>`).join('\n')}
    <text class="cap" x="0" y="${hh + pad - 0.1}">${label}</text>
  </svg>`;
}

// BOTH board sizes come back topologically clean (no crossing/degenerate piece) across the WHOLE declared
// [-15,15] band (min79/min69 above both resolve to the literal -15 floor, not a narrower per-shape one the
// way T1/T2's shoulder-collision floor was) -- the real constraint is the 0.75in frame-thickness piece-length
// floor, not topology, so "the range ends" here means the declared +-15, not a computed one.
const finalCases = [
  ['7x9', 7, 9, -15, 'min (-15)'], ['7x9', 7, 9, 8, 'default'], ['7x9', 7, 9, 15, 'max'],
  ['6x9', 6, 9, -15, 'min (-15)'], ['6x9', 6, 9, 8, 'default'], ['6x9', 6, 9, 15, 'max'],
];
const svgs = finalCases.map(([name, W, H, deg, tag]) => {
  const r = check(name, buildArchedTaper, deg, W, H);
  const thinFlag = r.minLen < 0.75 ? ` -- THIN piece ${r.minLen.toFixed(2)}in < 0.75in` : '';
  return svgFor(r, `Arched + taper (${deg} deg, ${tag}), ${name}${thinFlag}`, r.b.hw, r.b.hh);
});
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}
  .row{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:20px;max-width:1340px;}
  .outer{fill:#d9b48a;stroke:#5a3a28;stroke-width:0.035;}
  .inner{fill:#fff;stroke:#2255dd;stroke-width:0.03;stroke-dasharray:0.06 0.05;}
  .board{fill:#f7f7f7;stroke:#e05050;stroke-width:0.02;stroke-dasharray:0.08 0.06;}
  .miter{stroke:#e02020;stroke-width:0.04;}
  .pt{fill:#e02020;}
  .cap{fill:#333;font-size:0.21px;text-anchor:middle;}
</style></head><body><div class="row">${svgs.join('')}</div></body></html>`;
const outPath = HTML_OUT_ARG ?? new URL('./f30_item5_arched_taper_diagram.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
writeFileSync(outPath, html);
console.log('wrote', outPath);

// ---------------------------------------------------------------------------------------------------------
// F30 item 5 amendment (Fred: "try it in Fusion"): export the OUTER outline primitives at 7x9 for taper
// -15/-8/0/+8 deg, exactly what the diagram above drew (same buildArchedTaper, same prims array) -- no
// cleanup, no fix, so whatever Fusion shows (including -15's own suspect shape) is the SAME thing the
// diagram rendered, not a corrected version.
//
// AXES / ORIGIN (stated per the dispatch): origin = board centre; +X = right; +Y = DOWN (toward the base
// -- same local convention hourglassConstruction's own doc comment declares, "Y-down, region-local"). The
// board itself spans x in [-hw,+hw], y in [-hh,+hh]; the top edge/arch sits at NEGATIVE y, the base at
// POSITIVE y. All values in inches. Units/axes repeated in the JSON's own "meta" block so it stands alone.
function primToExport(p) {
  if (p.type === 'L') return { kind: 'line', p0: { x: p.p0.x, y: p.p0.y }, p1: { x: p.p1.x, y: p.p1.y } };
  const start = { x: p.cx + p.rx * Math.cos(p.theta1), y: p.cy + p.ry * Math.sin(p.theta1) };
  const end = { x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta), y: p.cy + p.ry * Math.sin(p.theta1 + p.dTheta) };
  return {
    kind: 'arc',
    centre: { x: p.cx, y: p.cy },
    radius: p.rx,
    start, end,
    startAngleDeg: (p.theta1 * 180) / Math.PI,
    sweepDeg: (p.dTheta * 180) / Math.PI, // signed: + = angle increasing (CCW in this +Y-down frame), - = CW
  };
}
const PIECE_NAMES = ['horn_R', 'shoulder_R', 'waist_R', 'hip_R', 'horn_bottom_R', 'base',
  'horn_bottom_L', 'hip_L', 'waist_L', 'shoulder_L', 'horn_L', 'arch'];
function mirrorCheck(prims) {
  // Right-side pieces (0-4) vs left-side pieces (6-10, same order reversed: horn_bottom_L..horn_L maps to
  // horn_bottom_R..horn_R) -- for an exact mirror, piece i's own endpoints at x should be the negation of
  // its mirror partner's, same y. Reports the worst mismatch found, not just pass/fail.
  const RIGHT = [0, 1, 2, 3, 4], LEFT = [10, 9, 8, 7, 6]; // paired in TRAVEL order (horn-to-hip both sides)
  let worst = 0, worstAt = null;
  for (let k = 0; k < RIGHT.length; k++) {
    const r = prims[RIGHT[k]], l = prims[LEFT[k]];
    const rPts = r.type === 'L' ? [r.p0, r.p1] : [{ x: r.cx + r.rx * Math.cos(r.theta1), y: r.cy + r.ry * Math.sin(r.theta1) }, { x: r.cx + r.rx * Math.cos(r.theta1 + r.dTheta), y: r.cy + r.ry * Math.sin(r.theta1 + r.dTheta) }];
    const lPts = l.type === 'L' ? [l.p0, l.p1] : [{ x: l.cx + l.rx * Math.cos(l.theta1), y: l.cy + l.ry * Math.sin(l.theta1) }, { x: l.cx + l.rx * Math.cos(l.theta1 + l.dTheta), y: l.cy + l.ry * Math.sin(l.theta1 + l.dTheta) }];
    // left piece travels hip->horn while right travels horn->hip (opposite order) -- compare reversed.
    const lPtsRev = [lPts[1], lPts[0]];
    for (let i = 0; i < 2; i++) {
      const dx = Math.abs(rPts[i].x - -lPtsRev[i].x), dy = Math.abs(rPts[i].y - lPtsRev[i].y);
      const err = Math.max(dx, dy);
      if (err > worst) { worst = err; worstAt = `${PIECE_NAMES[RIGHT[k]]}/${PIECE_NAMES[LEFT[k]]} pt${i}`; }
    }
    if (r.type === 'A' && l.type === 'A') {
      const err = Math.abs(r.rx - l.rx);
      if (err > worst) { worst = err; worstAt = `${PIECE_NAMES[RIGHT[k]]}/${PIECE_NAMES[LEFT[k]]} radius`; }
    }
  }
  return { worstMismatchIn: worst, worstAt };
}

const EXPORT_ANGLES = [-15, -8, 0, 8];
const exportCases = EXPORT_ANGLES.map((deg) => {
  const r = check('(export)', buildArchedTaper, deg, 7, 9);
  const sym = mirrorCheck(r.b.prims);
  console.log(`EXPORT taper=${deg}deg symmetry check: worst mismatch ${sym.worstMismatchIn.toFixed(6)}in at ${sym.worstAt}`);
  return {
    taperAngleDeg: deg,
    boardWidthIn: 7, boardHeightIn: 9,
    boardInnerHalfWidthIn: r.b.hw, boardInnerHalfHeightIn: r.b.hh, // after the 0.25in bounding-box offset
    archRiseIn: r.b.archRise,
    frameThicknessIn: T,
    symmetryCheck: sym,
    topologyClean: r.clean, minPieceLengthIn: r.minLen,
    outerPrimitives: r.b.prims.map((p, i) => ({ name: PIECE_NAMES[i], ...primToExport(p) })),
  };
});
const exportJson = {
  meta: {
    template: 'Template 10 (Arched Hourglass) + shared taperAngle construction -- F30 item 5, not yet a real template',
    units: 'inches',
    origin: 'board centre',
    axes: '+X = right, +Y = DOWN (toward the base); the arch/top sits at NEGATIVE y, the base at POSITIVE y',
    pieceOrder: PIECE_NAMES,
    note: 'exactly what the diagram PNG drew for each angle, including -15 deg as-is (no fix applied) -- ' +
      'Fred asked to see this in Fusion directly; see symmetryCheck per case for the worst L/R mismatch found.',
  },
  cases: exportCases,
};
const jsonOutPath = JSON_OUT_ARG ?? 'C:/Users/danse/.bspline-status/shots/seatC/taper_outlines_7x9.json';
writeFileSync(jsonOutPath, JSON.stringify(exportJson, null, 2));
console.log('wrote', jsonOutPath);
