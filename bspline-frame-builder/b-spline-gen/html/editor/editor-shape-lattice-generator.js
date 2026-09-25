/**
 * editor-shape-lattice-generator.js — SE14 Slice 1 (T53): the pure
 * silhouette generator (SE14-SHAPE-LATTICE-DESIGN.md §3/§4/§7).
 * seed + region -> keypoints -> per-segment styles -> exact L/A
 * primitives. No DOM, no editor object — same "pure function" contract
 * `computePattern`/`shapeToPrimitives` already set for this codebase.
 *
 * Ported from `reference/svgcreator-deployed/pathloop.js`'s own
 * `PathGenerator.generate(ctx)` (base -> shoulder-taper -> neck ->
 * head-widen -> head-arc, mirrored about a centerline) and `utils.js`'s
 * `decomposeSegment`/`resolveGenerator` (the bulge->arc formula and the
 * left/head/right/base assembly order) — NOT copied verbatim: this
 * module uses this session's own seeded RNG (`lcgPoints`, `core/
 * terrain.js`) and this session's own center-form `A` primitive
 * (`{cx,cy,rx,ry,phi,theta1,dTheta}`, `shapeToPrimitives`' own shape),
 * built via `arcCenterParam` (`path-layout.js`) rather than the
 * reference's own SVG-command `{r,sweep}` form.
 *
 * A THIRD proportion tier (`waist`, SE14 §7, Ground-truth #4) is
 * inserted between the reference's own base and neck rows — genuinely
 * new geometry the reference doesn't have, not a port.
 */
import { lcgPoints } from '../core/terrain.js';
import { arcCenterParam } from './path-layout.js';

const MIX = (a, b, t) => a + (b - a) * t;

/** Same per-item derived-sub-seed convention `editor-lattice-pattern.js`'s
 *  own `_columnSeed` already established (module-private there, so
 *  duplicated here rather than imported) — every logical random value
 *  draws from its OWN seed, so which zone widths are explicit (and thus
 *  skip their own draw) never perturbs any OTHER value's own draw. A
 *  stronger reproducibility property than one shared advancing stream
 *  (the reference's own `random()` closure) would give. */
function _subSeed(seed, salt) {
  return (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
}
function _draw(seed, salt) {
  return lcgPoints(_subSeed(seed, salt), 1)[0].u;
}

/** SE14 §4 — the declared style vocabulary. Only `straight`/`curve`/
 *  `kink` are wired this slice (Fred's own explicit three, Q2 ruling);
 *  the rest are `ALL_STYLES`' own reference-ported names, declared here
 *  as a documented, additive-later extension point (a new string value,
 *  no schema change) rather than silently unavailable. */
export const ALL_STYLES = [
  'straight', 'curve', 'kink',
  'arc-deep', 'arc-flat', 'arc-in', 'arc-in-deep',
  'ellipse-out', 'ellipse-in', 'sharp', 'step-out', 'step-in', 'notch', 's-bend',
];
export const WIRED_STYLES = ['straight', 'curve', 'kink'];

/** SE14 §7 — declared first-guess per-zone width ranges (fraction of
 *  fullW). `shoulder`/`neck`/`head` are the reference's own exact ranges
 *  (`pathloop.js:124-126`); `waist` is this design's own first guess
 *  (open question 4, tunable from Fred's reaction, not measured against
 *  a reference target). */
export const WIDTH_RANGES = {
  shoulder: [0.75, 1.15],
  waist: [0.35, 0.70],
  neck: [0.10, 0.28],
  head: [0.28, 0.58],
};

/** SE14 §2's own declared shape — the default `PATTERN.shape`. */
export const SHAPE_DEFAULTS = {
  source: 'generated',
  seed: 42,
  proportions: { waist: 18, neck: 42, chin: 74 },
  widths: { shoulder: null, waist: null, neck: null, head: null },
  symmetryRelax: 0,
  // `head` is declared for naming continuity with the reference's own
  // per-zone dial (`headKeypointCount`) but NOT consumed by Slice 1: SE14
  // §3 stage 2 drops the reference's own head-arc interior keypoints
  // entirely (headLeft connects to headRight via exactly ONE segment,
  // like any other segment — no special-cased head geometry). Reserved,
  // additive-later if a future slice ever needs to subdivide the head
  // connector.
  keypointCounts: { base: 2, shoulder: 1, waist: 1, neck: 1, head: 1 },
  segments: [],
};

const SALT = {
  fullW: 1, fullH: 2,
  widthShoulder: 10, widthWaist: 11, widthNeck: 12, widthHead: 13,
  relax: 20,
  segmentLeft: 100, // + left segment index (bottom -> top)
  segmentHead: 200,
  segmentRight: 300, // + right segment index, ONLY drawn when relax>0 (else mirrored from left)
  segmentBaseSub: 400, // + base-row subdivision index (only nonzero when keypointCounts.base>2)
  segmentBaseClose: 500,
};

function _zoneWidth(widths, zone, seed, salt) {
  const explicit = widths && widths[zone];
  const [minR, maxR] = WIDTH_RANGES[zone];
  if (explicit != null) return MIX(minR, maxR, explicit / 100);
  return MIX(minR, maxR, _draw(seed, salt));
}

function _lerpPts(a, b, n) {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return pts;
}

/** A left-side row's point + its mirror, `relax`-blended toward an
 *  independent right side. NOTE (a disclosed, measured finding, not
 *  assumed): in the reference (`pathloop.js:148-157`), the "independent"
 *  blend target for neck/head is `cx + w/2` — which is ALGEBRAICALLY
 *  IDENTICAL to the mirror target `cx + (cx - left.x)` since
 *  `left.x = cx - w/2` always. So `relax` is a mathematical no-op for
 *  every row except the base (only `rightBase.x` gets an actual
 *  independent jitter, via its own random draw, below) — ported AS
 *  WRITTEN (Slice 1 is a port, not a redesign of `symmetryRelax`), not
 *  silently "fixed" into having an effect it never had in the reference. */
function _mirrorPair(cx, half, y, relax) {
  const left = { x: cx - half, y };
  const mirror = { x: cx + (cx - left.x), y };
  const right = { x: mirror.x + (cx + half - mirror.x) * relax, y };
  return [left, right];
}

/** SE14 §4's `kink` construction: two `L`s meeting at a new apex offset
 *  perpendicular from the chord's own midpoint — same apex-offset
 *  formula the reference's own `computeAccurateBBox`'s `processSegment`
 *  uses for an arc's own bbox sagitta point (`utils.js:36-39`), reused
 *  here for the sharp-vertex case since it's the same "outward offset
 *  from chord midpoint by bulge * halfChord" geometry either way. */
function _bulgeApex(a, b, signedBulge, cx) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const od = mx >= cx ? 1 : -1;
  const nx = -dy / len, ny = dx / len;
  const h = signedBulge * (len / 2) * od;
  return { x: mx + nx * h, y: my + ny * h };
}

/** Ground-truth #3's own ported formula (`utils.js`'s `decomposeSegment`,
 *  `R = |chord/2 * (1+b^2)/(2b)|`) — builds the SVG-arc-command form
 *  `{R, sweep}` exactly as the reference does, then hands it to
 *  `arcCenterParam` (already exported, already tested, T47) to get this
 *  session's own center-form primitive, rather than hand-deriving the
 *  center from the bulge geometry a second time. `|bulge|<1` always
 *  gives an included angle < pi (a minor arc), matching the reference's
 *  own implicit assumption (it never computes/passes a largeArc flag at
 *  all) — largeArc is always 0 here for the same reason. */
function _arcPrimitive(a, b, signedBulge, cx) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2;
  const od = mx >= cx ? 1 : -1;
  const perpLeftX = -dy / len;
  const perpLeftIsOutward = (perpLeftX * od) > 0;
  const bClamped = Math.max(-0.999, Math.min(0.999, signedBulge));
  const R = Math.abs(((len / 2) * (1 + bClamped * bClamped)) / (2 * bClamped));
  const isOutward = bClamped > 0;
  const sweep = isOutward === perpLeftIsOutward ? 0 : 1;
  const param = arcCenterParam(a.x, a.y, R, R, 0, 0, sweep, b.x, b.y);
  // Degenerate fallback (param===null, e.g. a near-zero chord): same
  // convention `_primitivesFromSubpath` already uses for a degenerate A.
  if (!param) return { type: 'L', p0: a, p1: b };
  const { cx: ccx, cy: ccy, rx, ry, phi, theta1, dTheta } = param;
  return { type: 'A', cx: ccx, cy: ccy, rx, ry, phi, theta1, dTheta };
}

/** One `PATTERN.shape.segments[i]` entry -> its own primitive(s), in the
 *  declared storage convention: `bulge` is an UNSIGNED magnitude,
 *  `dir` ('out'|'in') carries the sign (§4's own worked example,
 *  `{bulge:0.18, dir:'out'}` — a friendlier UI split than one signed
 *  slider, and the reason `dir` isn't redundant with `bulge`'s own
 *  sign). `style:'straight'` or a zero/near-zero bulge both fall
 *  through to a plain `L`, matching `decomposeSegment`'s own
 *  `|bulge|<0.001` branch. */
function _segmentToPrimitives(a, b, seg, cx) {
  const style = seg.style || 'straight';
  const signedBulge = (seg.dir === 'in' ? -1 : 1) * Math.abs(seg.bulge || 0);
  if (style === 'straight' || Math.abs(signedBulge) < 0.001) {
    return [{ type: 'L', p0: a, p1: b }];
  }
  if (style === 'kink') {
    const apex = _bulgeApex(a, b, signedBulge, cx);
    return [{ type: 'L', p0: a, p1: apex }, { type: 'L', p0: apex, p1: b }];
  }
  // 'curve' (WIRED_STYLES' own third entry) — any future style that
  // reaches here falls back to the same proven bulge mechanism.
  return [_arcPrimitive(a, b, signedBulge, cx)];
}

/**
 * `region: {x,y,w,h}` (SE14 §3, Q5 ruling — the generator's own explicit
 * area, not an implicit board bbox) + `shape` (a `PATTERN.shape`-shaped
 * object, defaults filled from `SHAPE_DEFAULTS`) -> `{leftKpts,
 * rightKpts, segments, primitives, cx}`. `primitives` is a flat
 * `{type:'L'|'A',...}` list, exactly `shapeToPrimitives`' own return
 * shape (SE13 §2) — no fillets yet (`cornerRadius` is read from a
 * reused/explicit segment but never applied this slice, per §10 Slice 1
 * scope; Slice 2's own job).
 *
 * `shape.segments`, if an array of exactly the freshly-computed expected
 * length, is REUSED verbatim (a user's own per-segment style edits
 * survive a seed/proportion/width change) — otherwise every segment is
 * freshly, deterministically drawn from `seed` (§6: only a
 * `keypointCounts` change, which alone changes the expected count,
 * forces a fresh draw).
 */
export function generateSilhouette(region, shape) {
  const s = {
    ...SHAPE_DEFAULTS,
    ...shape,
    proportions: { ...SHAPE_DEFAULTS.proportions, ...(shape && shape.proportions) },
    widths: { ...SHAPE_DEFAULTS.widths, ...(shape && shape.widths) },
    keypointCounts: { ...SHAPE_DEFAULTS.keypointCounts, ...(shape && shape.keypointCounts) },
  };
  const seed = s.seed >>> 0;
  const cx = region.x + region.w / 2;

  // ── 1. Dimensions + widths ─────────────────────────────────────────
  const fullW = region.w * MIX(0.48, 0.84, _draw(seed, SALT.fullW));
  const fullH = region.h * MIX(0.68, 0.94, _draw(seed, SALT.fullH));
  // Reference's own `bottomY = cy + innerH*0.44` (`pathloop.js:115`),
  // translated to this module's own region form: cy===region.y+region.h/2,
  // innerH===region.h, so bottomY = region.y + region.h*0.5 + region.h*0.44
  // = region.y + region.h*0.94 — the SAME 6%-from-the-true-bottom margin,
  // not a new guess.
  const bottomY = region.y + region.h * 0.94;

  const wShoulder = fullW * _zoneWidth(s.widths, 'shoulder', seed, SALT.widthShoulder);
  const wWaist = fullW * _zoneWidth(s.widths, 'waist', seed, SALT.widthWaist);
  const wNeck = fullW * _zoneWidth(s.widths, 'neck', seed, SALT.widthNeck);
  const wHead = fullW * _zoneWidth(s.widths, 'head', seed, SALT.widthHead);

  // Simultaneous (non-chained) clamp from the RAW inputs only — same
  // shape as the reference's own 2-tier `neckT`/`chinT` clamp
  // (`pathloop.js:129-130`), extended to 3 tiers, each >=5% apart.
  const raw = s.proportions;
  const waistT = Math.min(raw.waist, raw.neck - 5, raw.chin - 10) / 100;
  const neckT = Math.min(Math.max(raw.neck, raw.waist + 5), raw.chin - 5) / 100;
  const chinT = Math.max(raw.chin, raw.neck + 5, raw.waist + 10) / 100;

  const yBase = bottomY;
  const yWaist = bottomY - fullH * waistT;
  const yNeck = bottomY - fullH * neckT;
  const yHead = bottomY - fullH * chinT;

  const relax = Math.max(0, Math.min(1, s.symmetryRelax));

  // ── 2. Keypoints ─────────────────────────────────────────────────────
  const leftBase = { x: cx - wShoulder / 2, y: yBase };
  const rightBase = { x: cx + wShoulder / 2, y: yBase };
  if (relax > 0) {
    const indepX = cx + (wShoulder / 2) * (1 + (_draw(seed, SALT.relax) * 0.2 - 0.1));
    rightBase.x = rightBase.x + (indepX - rightBase.x) * relax;
  }

  const [waistLeft, waistRight] = _mirrorPair(cx, wWaist / 2, yWaist, relax);
  const [neckLeft, neckRight] = _mirrorPair(cx, wNeck / 2, yNeck, relax);
  const [headLeft, headRight] = _mirrorPair(cx, wHead / 2, yHead, relax);

  const kc = s.keypointCounts;
  const B = Math.max(2, Math.round(kc.base));
  const nSh = Math.max(1, Math.round(kc.shoulder)); // base -> waist gap
  const nWa = Math.max(1, Math.round(kc.waist)); // waist -> neck gap (new, §7)
  const nNk = Math.max(1, Math.round(kc.neck)); // neck -> head gap

  const leftKpts = [
    leftBase,
    ..._lerpPts(leftBase, waistLeft, nSh),
    waistLeft,
    ..._lerpPts(waistLeft, neckLeft, nWa),
    neckLeft,
    ..._lerpPts(neckLeft, headLeft, nNk),
    headLeft,
  ];
  // No headMidPts (SE14 §3 stage 2: headLeft -> headRight is ONE segment,
  // no interior head-arc keypoints — a deliberate simplification over the
  // reference's own separate head-arc machinery, per SHAPE_DEFAULTS' own
  // comment on `keypointCounts.head`). This also makes leftKpts/rightKpts
  // EXACTLY equal length whenever B===2 (the default): both zone chains
  // use the SAME nSh/nWa/nNk counts, just traversed in opposite
  // directions, so `rightKpts` mirrors `leftKpts` point-for-point.
  const baseMidPts = [];
  for (let i = 1; i < B - 1; i++) {
    const t = i / (B - 1);
    baseMidPts.push({
      x: rightBase.x + (leftBase.x - rightBase.x) * t,
      y: rightBase.y + (leftBase.y - rightBase.y) * t,
    });
  }
  const rightKpts = [
    headRight,
    ..._lerpPts(headRight, neckRight, nNk),
    neckRight,
    ..._lerpPts(neckRight, waistRight, nWa),
    waistRight,
    ..._lerpPts(waistRight, rightBase, nSh),
    rightBase,
    ...baseMidPts,
  ];

  // ── 3. Segments -> primitives ───────────────────────────────────────
  // Flat order: left (bottom->top), head, right (top->bottom), base —
  // §2's own declared ordering, matching `resolveGenerator`'s own
  // assembly (`utils.js:122-135`). No special case for the base-close
  // segment (the reference hardcodes it sharp; this design's own §2/§3
  // declare no such exception, so it's an ordinary segment here — a
  // disclosed, deliberate deviation, not an oversight).
  const expectedSegmentCount = leftKpts.length + rightKpts.length;
  let segments;
  if (Array.isArray(s.segments) && s.segments.length === expectedSegmentCount) {
    segments = s.segments.map((seg) => ({
      style: (seg && seg.style) || 'straight',
      bulge: (seg && seg.bulge) || 0,
      dir: (seg && seg.dir) || 'out',
      cornerRadius: (seg && seg.cornerRadius) || 0,
    }));
  } else {
    // Reference's own `randB = () => (random()-0.5)*0.6` (pathloop.js:228),
    // mapped onto this design's own unsigned-bulge + dir storage.
    const freshBulge = (salt) => (_draw(seed, salt) - 0.5) * 0.6;
    const bulgeToSeg = (bulge) =>
      Math.abs(bulge) < 0.001
        ? { style: 'straight', bulge: 0, dir: 'out', cornerRadius: 0 }
        : { style: 'curve', bulge: Math.abs(bulge), dir: bulge > 0 ? 'out' : 'in', cornerRadius: 0 };

    const nLeftSeg = leftKpts.length - 1;
    const leftSegs = [];
    for (let i = 0; i < nLeftSeg; i++) leftSegs.push(bulgeToSeg(freshBulge(SALT.segmentLeft + i)));

    const headSeg = bulgeToSeg(freshBulge(SALT.segmentHead));

    // §4 "Mirrored pairs": at relax===0, a right-side profile segment
    // COPIES its mirror's own style/bulge (not an independent draw) —
    // right segment i (top->bottom) mirrors left segment (nLeftSeg-1-i)
    // (bottom->top), the exact reverse-index correspondence the
    // symmetric keypoint chains above already establish. relax>0 draws
    // the right side independently (§4's own "no-op once >0").
    const rightProfileSegs = [];
    for (let i = 0; i < nLeftSeg; i++) {
      rightProfileSegs.push(
        relax === 0 ? { ...leftSegs[nLeftSeg - 1 - i] } : bulgeToSeg(freshBulge(SALT.segmentRight + i))
      );
    }

    // Trailing base-row subdivision gaps (only nonzero when B>2 — not
    // part of the "mirrored pairs" concept, there's no left/right
    // distinction on the shared bottom edge) + the one final base-close
    // segment (rightKpts' own last point -> leftKpts[0]).
    const nBaseSub = rightKpts.length - 1 - nLeftSeg;
    const baseSubSegs = [];
    for (let i = 0; i < nBaseSub; i++) baseSubSegs.push(bulgeToSeg(freshBulge(SALT.segmentBaseSub + i)));
    const baseCloseSeg = bulgeToSeg(freshBulge(SALT.segmentBaseClose));

    segments = [...leftSegs, headSeg, ...rightProfileSegs, ...baseSubSegs, baseCloseSeg];
  }

  // Reference's own `baseCx` (`utils.js:113`): the midpoint of the two
  // OUTERMOST base points, not the theoretical `cx` — matters once
  // `relax>0` skews `rightBase.x` off the theoretical centerline.
  const baseCx = (leftKpts[0].x + rightKpts[rightKpts.length - 1].x) / 2;

  const primitives = [];
  let si = 0;
  for (let i = 0; i < leftKpts.length - 1; i++) {
    primitives.push(..._segmentToPrimitives(leftKpts[i], leftKpts[i + 1], segments[si++], baseCx));
  }
  primitives.push(
    ..._segmentToPrimitives(leftKpts[leftKpts.length - 1], rightKpts[0], segments[si++], baseCx)
  );
  for (let i = 0; i < rightKpts.length - 1; i++) {
    primitives.push(..._segmentToPrimitives(rightKpts[i], rightKpts[i + 1], segments[si++], baseCx));
  }
  primitives.push(
    ..._segmentToPrimitives(rightKpts[rightKpts.length - 1], leftKpts[0], segments[si++], baseCx)
  );

  return { leftKpts, rightKpts, segments, primitives, cx: baseCx };
}
