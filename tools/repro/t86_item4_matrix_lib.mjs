// T86 item 4: shared measurement library for the brick-frame stress matrix (every template x every
// preset x corner style mitre/butt). Node-only (no DOM) -- `editor-brick-tool.js`/`editor-ui.js`
// touch `document` at import time (confirmed live, T86 item 2), so every helper here is a plain
// re-derivation of the SAME primitive-building logic the t86_item*_preview.mjs scripts already use,
// not a shortcut.
import { inwardSignFor, pointInPolygon } from '../../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { radialSignAt } from '../../bspline-frame-builder/b-spline-gen/html/core/bricks/arc-voussoir.js';
import { bricksContourBands } from '../../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_PATTERNS, scaledSet } from '../../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { axisLen, courseHeightFor } from '../../bspline-frame-builder/b-spline-gen/html/core/bricks/layouts/bond.js';

export function tessellate(primitives, steps = 24) {
  const points = [];
  for (const prim of primitives) {
    if (prim.type === 'arc') {
      for (let k = 0; k < steps; k++) {
        const t = prim.theta1 + ((prim.theta2 - prim.theta1) * k) / steps;
        points.push({ x: prim.cx + prim.r * Math.cos(t), y: prim.cy + prim.r * Math.sin(t) });
      }
    } else points.push(prim.p0);
  }
  return points;
}

function signedAreaOf(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}
function bboxOf2(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** T86 item 4 harness bug (Fred, found in `t86_item4_templates.png`: template_16/17 drew as plain
 *  pointed arches instead of their real arch+sides+waist+bulges+base shape). ROOT CAUSE: this
 *  function used to build its own primitives from `frameContourSilhouette(frame, 0, 0)` -- the
 *  "Offset from frame" feature's own chokepoint, NOT a plain contour reader. MEASURED directly:
 *  `offsetOutlineInward(frameCutProfile(...).primitives, 0)` -- offset ZERO, nothing should ever
 *  collapse -- nonetheless collapses T16/T17's own two upper sides AND their arch arc (3 of 6
 *  primitives) to the SAME single degenerate point, leaving only 3 real primitives (arc-line-arc,
 *  exactly the "plain pointed arch" wrongly rendered) -- a genuine bug in `outline-offset.js`'s own
 *  collapse detection for this specific topology, confirmed independent of the harness (it would
 *  affect the real "Offset from frame" Shape Lattice feature too, since `distance:0` is literally
 *  its own declared default -- flagged separately, not fixed here, see the WORK-LOG entry this
 *  harness fix cites). `frameCutProfile`'s OWN primitives (the template's true, un-offset cut
 *  profile -- never routed through any offset/collapse logic at all) are the correct ground truth:
 *  MEASURED to return all 6 of T16/T17's own declared bars, matching their design exactly. This
 *  harness never needed an OFFSET contour in the first place (it always asked for `distance=0`,
 *  i.e. no offset) -- reading `frameCutProfile` directly is not a workaround, it is the more direct,
 *  correct source for what this harness actually wants.
 */
export function templatePrimitives(FRAME_DEFS, normalizeFrameRecord, frameCutProfile, templateId, W, H) {
  const record = normalizeFrameRecord({ templateId });
  const prof = frameCutProfile(FRAME_DEFS, record, { widthIn: W, heightIn: H });
  if (!prof || prof.defects.length || !prof.fit.ok) return { error: 'frameInvalid' };
  const raw = prof.primitives.map((prim) => (prim.type === 'L'
    ? { type: 'line', p0: prim.p0, p1: prim.p1 }
    : { type: 'arc', cx: prim.cx, cy: prim.cy, r: prim.rx, theta1: prim.theta1, theta2: prim.theta1 + prim.dTheta }));
  const inwardSign = inwardSignFor(tessellate(raw));
  const primitives = raw.map((prim) => {
    if (prim.type === 'line') {
      const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y, len = Math.hypot(dx, dy);
      return { ...prim, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign };
    }
    const midT = (prim.theta1 + prim.theta2) / 2;
    const mid = { x: prim.cx + prim.r * Math.cos(midT), y: prim.cy + prim.r * Math.sin(midT) };
    const direction = Math.sign(prim.theta2 - prim.theta1) || 1;
    const tangent = { tx: -Math.sin(midT) * direction, ty: Math.cos(midT) * direction };
    const radialSign = radialSignAt(tangent, mid.x, mid.y, prim.cx, prim.cy, inwardSign);
    return { ...prim, radialSign };
  });
  return { primitives };
}

/** The harness check Fred asked for, aimed at the RIGHT target: `frameContourSilhouette` is the one
 *  just proven unreliable at `distance=0` for some topologies, so checking the matrix's own
 *  primitives AGAINST it would be circular. Instead this checks the matrix's own primitives (built
 *  above) against an INDEPENDENTLY re-tessellated `frameCutProfile` -- a different walk of the SAME
 *  ground-truth source, so it still catches a real conversion bug (a dropped segment, a wrong
 *  next-point lookup) even though it can no longer catch a bug inside `frameCutProfile` itself.
 *  ALSO reports whether `frameContourSilhouette` itself agrees with that ground truth -- a general
 *  detector for exactly the class of bug this item found, not just a one-off fix for T16/T17. */
export function checkContourConsistency(FRAME_DEFS, normalizeFrameRecord, frameCutProfile, frameContourSilhouette, templateId, W, H, primitives) {
  const record = normalizeFrameRecord({ templateId });
  const prof = frameCutProfile(FRAME_DEFS, record, { widthIn: W, heightIn: H });
  const groundTruth = tessellate(prof.primitives.map((p) => (p.type === 'L'
    ? { type: 'line', p0: p.p0 } : { type: 'arc', cx: p.cx, cy: p.cy, r: p.rx, theta1: p.theta1, theta2: p.theta1 + p.dTheta })), 48);
  const gtArea = Math.abs(signedAreaOf(groundTruth)), gtBox = bboxOf2(groundTruth);
  const mine = tessellate(primitives, 48);
  const mineArea = Math.abs(signedAreaOf(mine)), mineBox = bboxOf2(mine);
  const AREA_TOL = 0.01, BOX_TOL = 0.01;
  const issues = [];
  if (Math.abs(mineArea - gtArea) > AREA_TOL) issues.push(`primitives area ${mineArea.toFixed(3)} != frameCutProfile area ${gtArea.toFixed(3)}`);
  for (const k of ['minX', 'maxX', 'minY', 'maxY']) {
    if (Math.abs(mineBox[k] - gtBox[k]) > BOX_TOL) issues.push(`primitives bbox.${k} ${mineBox[k].toFixed(3)} != frameCutProfile bbox.${k} ${gtBox[k].toFixed(3)}`);
  }
  let sil;
  try { sil = frameContourSilhouette({ defs: FRAME_DEFS, record, board: { widthIn: W, heightIn: H } }, 0, 0); } catch (e) { sil = { error: String(e && e.message || e) }; }
  if (!sil.error) {
    const silPoly = tessellate(sil.primitives.map((p) => (p.type === 'L' ? { type: 'line', p0: p.p0 } : { type: 'arc', cx: p.cx, cy: p.cy, r: p.rx, theta1: p.theta1, theta2: p.theta1 + p.dTheta })), 48);
    const silArea = Math.abs(signedAreaOf(silPoly));
    if (Math.abs(silArea - gtArea) > gtArea * 0.05 + AREA_TOL) {
      issues.push(`frameContourSilhouette area ${silArea.toFixed(3)} disagrees with frameCutProfile area ${gtArea.toFixed(3)} (own known distance=0 collapse bug, not this harness)`);
    }
  }
  return { ok: issues.length === 0, issues };
}

function isSimplePolygon(poly) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const segCross = (a0, a1, b0, b1) => {
    const d1 = cross(b0, b1, a0), d2 = cross(b0, b1, a1), d3 = cross(a0, a1, b0), d4 = cross(a0, a1, b1);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === (i + 1) % n || i === (j + 1) % n) continue;
    if (segCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
  }
  return true;
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function bboxOf(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function overlapFraction(subject, other) {
  const { minX, maxX, minY, maxY } = bboxOf(subject);
  const GRID = 8; // coarse by design -- this matrix scans hundreds of cases, not one fixture;
  // each flagged pair is then re-examined at full GRID=100 precision (the T86 item 2 precedent) only
  // for cases that actually fail, not for every pair in every one of 476 cases up front.
  let inSubject = 0, inBoth = 0;
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const x = minX + ((maxX - minX) * (i + 0.5)) / GRID, y = minY + ((maxY - minY) * (j + 0.5)) / GRID;
    if (!pointInPolygon(x, y, subject)) continue;
    inSubject++;
    if (pointInPolygon(x, y, other)) inBoth++;
  }
  return inSubject ? inBoth / inSubject : 0;
}

function distToPolygon(pt, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * dx, py = a.y + t * dy;
    best = Math.min(best, Math.hypot(pt.x - px, pt.y - py));
  }
  return best;
}

/** Per-band (pattern, nominalArea, pieceCount) for a declared `bands` array -- piece ids are
 *  assigned sequentially per band in `bricksContourBands` itself (confirmed by reading it: `nextId`
 *  carries forward band to band, never reset or tagged), so calling it ONCE per individual band (its
 *  own depth always starts at 0 that way, same geometry either way since each band is independent)
 *  recovers each band's own true piece count -- used to slice the REAL combined-bands piece array by
 *  band without re-deriving `bricksContourBands`'s own internal loop. */
function bandInfo(primitives, bands, opts) {
  // T86 item 11: a real BUG in this matrix's own ratio check, not in the engine -- `opts.set`'s own
  // declared brickLengthIn/brickHeightIn are the UNSCALED base values; `bricksContourBands` (called
  // right below, same `opts`) applies `scaledSet(opts.set, opts.scale)` internally before building a
  // single piece, so every REAL piece is already correctly scaled -- this nominal reference wasn't,
  // comparing a scale^2-sized real piece against a fixed, scale=1 "nominal" and reporting the
  // mismatch as if it were a growing defect. MEASURED directly (a scratch check against a
  // CORRECTLY scaled nominal): `template_1`'s own `single_soldier` ratio is EXACTLY 1.0 at every
  // scale tested (1, 1.5, 2) -- the engine was never broken; only this matrix's own reference was.
  const { brickLengthIn: L, brickHeightIn: H } = scaledSet(opts.set, opts.scale);
  return bands.map((band) => {
    const patternDef = BRICK_PATTERNS[band.pattern || 'stretcher'] || BRICK_PATTERNS.stretcher;
    const naturalWidth = courseHeightFor(patternDef, L, H);
    const pitch = patternDef.kind === 'course-alternating' ? L : axisLen(patternDef.pitchAxis, L, H);
    const nominalArea = pitch * naturalWidth;
    const { bricks } = bricksContourBands(primitives, [band], opts);
    return { pattern: band.pattern, nominalArea, count: bricks.length, cornerStyle: band.cornerStyle || 'mitre' };
  });
}

/** Forces every band's own cornerStyle to `style` (a shallow copy -- never mutates the caller's own
 *  declared preset array/objects). */
export function withCornerStyle(bands, style) {
  return bands.map((b) => ({ ...b, cornerStyle: style }));
}

/**
 * Builds `bands` on `primitives` (a template's own true contour, any size) and measures every
 * criterion T86 item 4 declares: pieces outside the true board outline, worst pairwise overlap
 * AREA, max/min piece area vs. its OWN band's nominal (not a single global constant -- header's own
 * nominal genuinely differs from soldier's), self-intersecting polygons, and fillet/arc coverage
 * (sampled along each arc's own TRUE outer-edge offset curve -- a gap there is a hole in the board's
 * own outline, not merely a thin piece).
 */
export function measureCase(primitives, bands, opts, boardW, boardH) {
  let built;
  try {
    built = bricksContourBands(primitives, bands, opts);
  } catch (e) {
    return { buildError: String(e && e.message || e) };
  }
  const bricks = built.bricks;
  if (!bricks.length) return { buildError: 'zero pieces' };

  const outline = tessellate(primitives, 48);
  let outsideCount = 0;
  for (const b of bricks) for (const pt of b.polygon) {
    if (!pointInPolygon(pt.x, pt.y, outline) && distToPolygon(pt, outline) > 0.01) outsideCount++;
  }

  let notSimple = 0;
  for (const b of bricks) if (!isSimplePolygon(b.polygon)) notSimple++;

  let worstOverlapArea = 0;
  for (let i = 0; i < bricks.length; i++) {
    const A = bboxOf(bricks[i].polygon);
    for (let j = i + 1; j < bricks.length; j++) {
      const B = bboxOf(bricks[j].polygon);
      if (A.maxX < B.minX - 1e-6 || B.maxX < A.minX - 1e-6 || A.maxY < B.minY - 1e-6 || B.maxY < A.minY - 1e-6) continue;
      const areaI = Math.abs(signedArea(bricks[i].polygon));
      const f = overlapFraction(bricks[i].polygon, bricks[j].polygon);
      worstOverlapArea = Math.max(worstOverlapArea, f * areaI);
    }
  }

  const bands_info = bandInfo(primitives, bands, opts);
  let idx = 0, maxRatio = 0, minRatio = Infinity;
  for (const bi of bands_info) {
    const slice = bricks.slice(idx, idx + bi.count);
    idx += bi.count;
    // T86 item 4's own matrix, not the engine: a 'block' corner inserts a DELIBERATELY oversized
    // quoin unit (T86 item 1's own declared design, already tested there) at each block corner --
    // measuring it against the band's OWN regular-piece nominal always reads as a false "huge piece"
    // (MEASURED: a consistent 8.067x across every template, the quoin's own fixed blockSize^2 vs a
    // 0.15in^2 brick nominal, not a real per-template defect). The ceiling check only ever means
    // anything for the band's own regular coursing, so it's skipped for a 'block' band's own pieces;
    // the floor (a piece collapsing to a true sliver) still applies to every piece, quoin included.
    for (const b of slice) {
      const ratio = Math.abs(signedArea(b.polygon)) / bi.nominalArea;
      if (bi.cornerStyle !== 'block') maxRatio = Math.max(maxRatio, ratio);
      minRatio = Math.min(minRatio, ratio);
    }
  }
  if (!Number.isFinite(minRatio)) minRatio = 0;

  // fillet/arc coverage: for each arc primitive, sample points along its OWN outer-edge (d0=0)
  // offset curve (same curve as the primitive itself here, since arcs are stored at depth 0) and
  // check each is covered by at least one piece.
  let arcSamples = 0, arcCovered = 0;
  for (const prim of primitives) {
    if (prim.type !== 'arc') continue;
    const steps = 12;
    for (let k = 0; k <= steps; k++) {
      const t = prim.theta1 + ((prim.theta2 - prim.theta1) * k) / steps;
      const pt = { x: prim.cx + prim.r * Math.cos(t), y: prim.cy + prim.r * Math.sin(t) };
      arcSamples++;
      if (bricks.some((b) => pointInPolygon(pt.x, pt.y, b.polygon) || distToPolygon(pt, b.polygon) < 0.01)) arcCovered++;
    }
  }
  const arcCoverage = arcSamples ? arcCovered / arcSamples : 1;

  return {
    pieceCount: bricks.length, outsideCount, notSimple, worstOverlapArea,
    maxRatio, minRatio, arcCoverage, arcSamples,
  };
}

export function verdict(m) {
  if (m.buildError) return { pass: false, reasons: [`BUILD_ERROR: ${m.buildError}`] };
  const reasons = [];
  if (m.outsideCount > 0) reasons.push(`${m.outsideCount} vertices outside board`);
  if (m.notSimple > 0) reasons.push(`${m.notSimple} self-intersecting`);
  if (m.worstOverlapArea > 0.02) reasons.push(`overlap area ${m.worstOverlapArea.toFixed(4)}in^2`);
  if (m.maxRatio > 1.2 + 1e-6) reasons.push(`max piece ratio ${m.maxRatio.toFixed(3)}`);
  if (m.minRatio < 0.25 - 1e-6) reasons.push(`min piece ratio ${m.minRatio.toFixed(3)}`);
  if (m.arcCoverage < 0.85 - 1e-6) reasons.push(`arc coverage ${(m.arcCoverage * 100).toFixed(0)}%`);
  return { pass: reasons.length === 0, reasons };
}
