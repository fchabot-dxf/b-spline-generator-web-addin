/**
 * core/bricks/arch-surround.js — PORTABLE (see rng.js). 2026-10-11 (Fred approved the "Rowlock arch + keystone" frame;
 * then: "the arch must ALWAYS CONFORM to the wood frame's shape" -- "If I want a semicircle I'll form the frame into
 * one" -- and "no inward offset"): a BLIND arch, laid as an INNER BAND STACK on the frame's own contour, directly inside the
 * frame's bands (one joint off, no wall between them). So it follows the frame by construction: a flat top gives a flat (jack) arch, an arched top curved voussoirs, a
 * pointed top a pointed arch; the jambs follow the sides (waists included) and the sill the bottom.
 *
 *   the stack: [the frame's bands] + the hood (one thin row, raised, all round: with no wall outside the arch, a hood
 *   over the top only would leave a hood-deep strip down the sides) + two rowlock rings (soldier rows, half a brick deep). Stones are SLABS of the hood + rings
 *   band between two lines normal to the contour, measured along it: the keystone at the top centre, a springer at each
 *   end of the top span (where the top meets the sides), a sill block at each end of the bottom span.
 *
 * The top (bottom) span is the frame primitive the centre line meets first from above (below); its two ends are the
 * springing points (the sill's corners). Every size is declared in ARCH_SPECS. A frame too narrow for the stack (its
 * opening splits into lobes, the rings collide, the stones meet) is fitted by Fred's ladder -- the full stack, then no
 * hood, then one ring -- and skipped (fit note 'archTooNarrow') when even that does not fit. The wall fills the opening.
 */
import { mulberry32, seedFor } from './rng.js';
import { scaledSet, brickSetById, RELIEF_LEVELS } from './library.js';
import { bricksContourBands } from './contour-bands.js';
import { pickSample } from './piece-plan.js';
import { polygonIntersection, polygonDifference, lobesOf, signedArea, offsetPathInward, inwardSignFor, dedupePolygon } from './geometry.js';

/** The arches a frame preset can carry (library.js FRAME_PRESETS `arch`). Lengths in inches unless named by brick
 *  unit (L = length, H = height of the frame's scaled set). */
/** A stone outline's edges shorter than this many joints are dropped before it is grown into the hole the courses are
 *  cleared off (a sub-joint edge is no side, and its normal throws the mitre out). */
export const STONE_EDGE_MIN_JOINTS = 0.5;
export const ARCH_SPECS = Object.freeze({
  rowlock_keystone: Object.freeze({
    hoodDepthH: 0.5, // the hood: one row this x H deep, all round, directly inside the frame's bands
    rings: 2, // rowlock rings: soldier rows (pitch H along the contour), each ringDepthL x L deep
    ringDepthL: 0.5,
    // the frame motifs' RELIEF tags (library.js RELIEF_LEVELS): the hood row names the fill motif (band-motif.js tags its
    // pieces), the keystone takes the same tag (Fred, 2026-10-11: raised like the hood)
    hoodRelief: 'raised',
    keystoneRelief: 'raised',
    keystoneHalfIn: 0.32, // the keystone: this far each way along the contour from the top centre
    springerTopIn: 0.6, // a springer: this far along the top span from its end ...
    springerSideIn: 0.3, // ... and this far down the side
    sillBlockHalfIn: 0.5, // a sill block: this far each way along the contour from the bottom span's end
    stoneSetId: 6, // the keystone, springers and sill blocks: Grey ashlar
    // Fred's "shrink to fit, skip with a hint": the stacks tried in order, the first that fits is laid
    ladder: Object.freeze([Object.freeze({ hood: true, rings: 2 }), Object.freeze({ hood: false, rings: 2 }), Object.freeze({ hood: false, rings: 1 })]),
  }),
  soldier_quoin: Object.freeze({
    hoodDepthH: 0,
    rings: 1, // single soldier band (0.5 * brickLengthIn)
    ringDepthL: 0.5,
    hoodRelief: null,
    keystoneRelief: null,
    keystoneHalfIn: 0.32,
    springerTopIn: 0.6,
    springerSideIn: 0.3,
    sillBlockHalfIn: 0.5,
    stoneSetId: 6,
    ladder: Object.freeze([Object.freeze({ hood: false, rings: 1 })]),
  }),
});

const OVERLAP_SQIN = 1e-4; // two pieces sharing more than this are a collision (the rings meeting in a narrow neck)

/** A one-row band of exactly `d` inches (contour-bands.js's own one-row-of-a-declared-depth band, `narrowedTo`). */
const row = (pattern, d) => ({ pattern, widthIn: d, narrowedTo: d });

/** Pure: a closed polyline's arclength helpers -- the point + unit tangent at s, and the s of the nearest point. */
function polyParam(M) {
  const cum = [0];
  for (let i = 1; i <= M.length; i++) { const a = M[i - 1], c = M[i % M.length]; cum.push(cum[i - 1] + Math.hypot(c.x - a.x, c.y - a.y)); }
  const per = cum[M.length];
  const wrap = (v) => ((v % per) + per) % per;
  const at = (sv) => {
    sv = wrap(sv);
    let i = 0;
    while (i < M.length - 1 && cum[i + 1] < sv) i++;
    const a = M[i], c = M[(i + 1) % M.length], l = cum[i + 1] - cum[i] || 1, f = (sv - cum[i]) / l;
    return { p: { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f }, t: { x: (c.x - a.x) / l, y: (c.y - a.y) / l } };
  };
  const nearest = (pt) => {
    let best = Infinity, bs = 0;
    for (let i = 0; i < M.length; i++) {
      const a = M[i], c = M[(i + 1) % M.length], dx = c.x - a.x, dy = c.y - a.y, l2 = dx * dx + dy * dy || 1;
      const f = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2));
      const d = Math.hypot(a.x + dx * f - pt.x, a.y + dy * f - pt.y);
      if (d < best) { best = d; bs = cum[i] + f * Math.sqrt(l2); }
    }
    return bs;
  };
  /** The polyline from arclength a to b (forward, wrapping), its vertices included. */
  const sub = (a, b) => {
    a = wrap(a); const len = wrap(b - a), pts = [at(a).p];
    for (let k = 0; k < M.length; k++) { const d = wrap(cum[k] - a); if (d > 1e-9 && d < len - 1e-9) pts.push({ d, p: M[k] }); }
    const inner = pts.slice(1).sort((x, y) => x.d - y.d).map((x) => x.p);
    return [pts[0], ...inner, at(a + len).p];
  };
  return { per, wrap, at, nearest, sub };
}

/** Pure: a frame primitive's two end points (a line's, an arc's). */
const endsOf = (pr) => (pr.type === 'line' ? [pr.p0, pr.p1]
  : [{ x: pr.cx + pr.r * Math.cos(pr.theta1), y: pr.cy + pr.r * Math.sin(pr.theta1) }, { x: pr.cx + pr.r * Math.cos(pr.theta2), y: pr.cy + pr.r * Math.sin(pr.theta2) }]);

/** Pure: the frame's top and bottom primitives -- the ones the vertical centre line (x = cx) crosses first from above and
 *  from below -- as the two ends of each span (spanEnds) and the top crossing point (each primitive sampled densely; a
 *  crossing interpolated between samples). */
export function topAndBottom(primitives, cx) {
  const hits = [];
  primitives.forEach((pr, k) => {
    const pts = Array.from({ length: 65 }, (_, j) => {
      const f = j / 64;
      if (pr.type === 'line') return { x: pr.p0.x + (pr.p1.x - pr.p0.x) * f, y: pr.p0.y + (pr.p1.y - pr.p0.y) * f };
      const th = pr.theta1 + (pr.theta2 - pr.theta1) * f;
      return { x: pr.cx + pr.r * Math.cos(th), y: pr.cy + pr.r * Math.sin(th) };
    });
    for (let j = 0; j < pts.length - 1; j++) {
      const a = pts[j], b = pts[j + 1];
      if ((a.x - cx) * (b.x - cx) > 0 || a.x === b.x) continue;
      hits.push({ x: cx, y: a.y + ((cx - a.x) / (b.x - a.x)) * (b.y - a.y), k });
    }
  });
  if (!hits.length) return null;
  const top = hits.reduce((a, p) => (p.y < a.y ? p : a)), bot = hits.reduce((a, p) => (p.y > a.y ? p : a));
  return { topEnds: spanEnds(primitives, top), bottomEnds: spanEnds(primitives, bot), topPoint: top };
}
/** Pure: the two ends of the span the centre line crosses at `hit` -- its primitive's ends; when it crosses at a vertex
 *  (a pointed top: two primitives meet on the centre line), the far ends of the two primitives meeting there. */
function spanEnds(primitives, hit) {
  const EPS = 1e-6, same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < EPS;
  const ends = endsOf(primitives[hit.k]);
  const at = ends.findIndex((e) => same(e, hit));
  if (at < 0) return ends;
  const other = primitives.findIndex((pr, k) => k !== hit.k && endsOf(pr).some((e) => same(e, hit)));
  if (other < 0) return ends;
  return [ends[1 - at], endsOf(primitives[other]).find((e) => !same(e, hit))];
}

/** Does any pair of `polys` overlap (more than OVERLAP_SQIN)? Bounding boxes first. */
function anyOverlap(polys) {
  const boxes = polys.map((p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; });
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
    const inter = polygonIntersection(polys[i], polys[j]);
    if (inter.length >= 3 && Math.abs(signedArea(inter)) > OVERLAP_SQIN) return true;
  }
  return false;
}

/**
 * Lay the arch of `specOrId` (an ARCH_SPECS id, or a spec) on the frame contour `primitives` inside the frame's
 * `frameBands`. opts: { set (the frame's set, unscaled), scale, seed }.
 * Returns { pieces, region, opening, step } or { fit: 'archTooNarrow', pieces: [] }:
 *   pieces -- the hood / ring / stone pieces, each tagged `part` (hood, ring, keystone, springer, sillBlock); a stone
 *             carries its own `setId`; the hood and keystone their RELIEF tag (relief + its level in heightOffset);
 *   region -- the arch's footprint as grout region entries [{ outer, holes }] (the frame's inner edge, the opening its hole);
 *   opening -- the wall laid again inside it; step -- the ladder step laid (0 = the full stack).
 */
export function layArch(specOrId, primitives, frameBands, opts) {
  const spec = typeof specOrId === 'string' ? ARCH_SPECS[specOrId] : specOrId;
  if (!spec || !primitives || !primitives.length) return null;
  const s = scaledSet(opts.set, opts.scale || 1);
  const layOpts = { set: opts.set, seed: opts.seed, scale: opts.scale, bandFit: false };
  const plan = (bands) => bricksContourBands(primitives, bands, { ...layOpts, planOnly: true }).innerPath;
  const fb = [...(frameBands || [])];
  const interior = plan(fb);
  if (!interior || interior.length < 3) return { fit: 'archTooNarrow', pieces: [] };
  const xs = interior.map((p) => p.x), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const tb = topAndBottom(primitives, cx);
  if (!tb) return { fit: 'archTooNarrow', pieces: [] };
  for (let step = 0; step < spec.ladder.length; step++) {
    const res = tryStack(spec, spec.ladder[step], { primitives, fb, plan, layOpts, s, tb, seed: opts.seed });
    if (res) return { ...res, step };
  }
  return { fit: 'archTooNarrow', pieces: [] };
}

function tryStack(spec, rung, { primitives, fb, plan, layOpts, s, tb, seed }) {
  const L = s.brickLengthIn, H = s.brickHeightIn, J = s.grout.widthIn;
  const hood = { ...row('stretcher', spec.hoodDepthH * H), motif: spec.hoodRelief }, ring = row('soldier', spec.ringDepthL * L);
  const head = [...fb, ...(rung.hood ? [hood] : [])];
  const stack = [...head, ...Array.from({ length: rung.rings }, () => ring)];
  const archOuter = plan(fb), opening = plan(stack); // the arch starts at the frame's inner edge
  // too narrow: the opening split into lobes (a neck the stack closes) or next to nothing left of it
  if (!opening || opening.length < 3 || lobesOf(opening, 1e-4).length !== 1 || Math.abs(signedArea(opening)) < L * L) return null;
  const laid = bricksContourBands(primitives, stack, layOpts).bricks;
  const nf = fb.length;
  let hoodPieces = rung.hood ? laid.filter((b) => b.bandIndex === nf) : [];
  let ringPieces = laid.filter((b) => b.bandIndex >= nf + (rung.hood ? 1 : 0));
  if (!ringPieces.length) return null;
  // the rings' mid line: every slab is measured along it
  const M = plan([...head, row('soldier', (spec.ringDepthL * L * rung.rings) / 2)]);
  const P = polyParam(M);
  const band = archOuter; // the stones span the hood + rings ...
  const openingEdge = offsetPathInward(opening, J, -inwardSignFor(opening)); // ... to a joint off the opening, as the rings stop
  // a stone is the stretch of the band between two points of its mid line: the matching stretches of its outer and inner
  // edges (their corners included), joined -- robust on concave curves, where normals would cross inside the band
  const Po = polyParam(band), Pi = polyParam(openingEdge);
  // the edge's stretch between the points nearest the span's two ends: of its two ways round, the one about as long as
  // the span (a stone is short; the other way is the rest of the edge)
  const lenOf = (pts) => pts.reduce((acc, p, i) => (i ? acc + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
  const stretch = (Q, s0, s1) => {
    const a = Q.nearest(P.at(s0).p), b = Q.nearest(P.at(s1).p), want = Math.abs(s1 - s0);
    const fwd = Q.sub(a, b), back = Q.sub(b, a).reverse();
    return Math.abs(lenOf(fwd) - want) <= Math.abs(lenOf(back) - want) ? fwd : back;
  };
  const depth = spec.ringDepthL * L * rung.rings + (rung.hood ? spec.hoodDepthH * H : 0);
  const slab = (s0, s1) => {
    const outer = stretch(Po, s0, s1), inner = stretch(Pi, s0, s1);
    const q = [...outer, ...inner.reverse()], a = Math.abs(signedArea(q));
    // a stone in the band only: not larger than its span, not into the opening (otherwise none: the rung fails below)
    const intoOpening = polygonIntersection(q, opening);
    if (intoOpening.length >= 3 && Math.abs(signedArea(intoOpening)) > OVERLAP_SQIN) return [];
    return q.length >= 3 && a > OVERLAP_SQIN && a < 3 * depth * (Math.abs(s1 - s0) + 2 * depth) ? [q] : [];
  };
  const sTop = P.nearest(tb.topPoint);
  const [ta, tz] = tb.topEnds.map((e) => P.nearest(e));
  // the top span: from one end to the other, the way through the top centre
  const [spanA, spanLen] = P.wrap(sTop - ta) <= P.wrap(tz - ta) ? [ta, P.wrap(tz - ta)] : [tz, P.wrap(ta - tz)];
  const stones = [];
  for (const q of slab(sTop - spec.keystoneHalfIn, sTop + spec.keystoneHalfIn)) stones.push({ polygon: q, part: 'keystone' });
  // a springer at each end of the top span: springerTopIn along the top, springerSideIn down the side
  for (const [a, b] of [[spanA - spec.springerSideIn, spanA + spec.springerTopIn], [spanA + spanLen - spec.springerTopIn, spanA + spanLen + spec.springerSideIn]]) {
    for (const q of slab(a, b)) stones.push({ polygon: q, part: 'springer' });
  }
  for (const e of tb.bottomEnds) {
    const sJ = P.nearest(e);
    for (const q of slab(sJ - spec.sillBlockHalfIn, sJ + spec.sillBlockHalfIn)) stones.push({ polygon: q, part: 'sillBlock' });
  }
  // every stone or none: a keystone, two springers, two sill blocks -- a stack that cannot place them all (a top too short,
  // a corner its band cannot turn) is not laid; the ladder tries the next
  const count = (part) => stones.filter((x) => x.part === part).length;
  if (count('keystone') !== 1 || count('springer') !== 2 || count('sillBlock') !== 2 || anyOverlap(stones.map((x) => x.polygon))) return null;
  // the bricks are cleared off the stones, a joint off -- every cut piece kept (fill-shape.js bricksClearOf's rule). A
  // stone's outline first loses its sub-joint edges (STONE_EDGE_MIN_JOINTS): a mitred grow throws the vertex of a
  // degenerate edge up to 5 joints out (MEASURED: a sill block's zero-length edge and a springer's 0.009 in one cut
  // a wedge out of the course beside them -- the gap sweep's arch_keystone rows, bare 0.07 - 0.19 of a brick face)
  const holes = stones.map((st) => { const q = dedupePolygon(st.polygon, J * STONE_EDGE_MIN_JOINTS); return offsetPathInward(q, J, -inwardSignFor(q)); });
  const clear = (pieces) => pieces.flatMap((b) => {
    let parts = [b.polygon];
    for (const h of holes) parts = parts.flatMap((q) => { const d = polygonDifference(q, h); return d.holeIgnored ? [q] : d; });
    parts = parts.filter((q) => q.length >= 3);
    return parts.length === 1 && parts[0] === b.polygon ? [b] : parts.map((polygon, k) => ({ ...b, id: `${b.id}~${k}`, polygon }));
  });
  ringPieces = clear(ringPieces);
  hoodPieces = clear(hoodPieces);
  const stone = scaledSet(brickSetById(spec.stoneSetId), 1);
  const jitter = (id) => (mulberry32(seedFor(seed, 'arch-jitter', id))() * 2 - 1) * (s.heightJitterIn || 0);
  const pieces = [
    ...hoodPieces.map((b) => ({ ...b, id: `arch-${b.id}`, part: 'hood' })), // tagged by its motif (relief + level)
    ...ringPieces.map((b) => ({ ...b, id: `arch-${b.id}`, part: 'ring' })),
    ...stones.map((st, id) => {
      const { sampleId, flip } = pickSample(stone, seed, 'arch-stone', id);
      return { id: `arch-stone-${id}`, polygon: st.polygon, pieceId: 'arch', sampleId, flip, part: st.part, setId: spec.stoneSetId,
        ...(st.part === 'keystone' ? { relief: spec.keystoneRelief } : {}),
        heightOffset: jitter(id) + (st.part === 'keystone' ? RELIEF_LEVELS[spec.keystoneRelief] || 0 : 0) };
    }),
  ];
  return {
    pieces,
    region: [{ outer: archOuter, holes: [opening] }],
    opening,
  };
}
