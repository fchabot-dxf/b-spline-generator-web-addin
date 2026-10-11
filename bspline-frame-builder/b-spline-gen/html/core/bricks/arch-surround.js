/**
 * core/bricks/arch-surround.js — PORTABLE (see rng.js). 2026-10-11 (Fred approved the "Rowlock arch + keystone" frame,
 * the advisor's mock board 1): a BLIND arch on the wall, inside the frame -- a semicircle on two straight jambs, the
 * opening filled with wall like the rest (the board is not cut; the Fusion frame template is untouched).
 *
 *   two rowlock rings of radial headers (arc-voussoir.js voussoirPieces, free arcs) carried down the jambs as two
 *   staggered header columns; a thin hood ring outside them (raised); a stone KEYSTONE at the crown and stone SPRINGERS
 *   at both ends of the arch; a sill of two staggered header courses between the jambs with a stone block under each.
 *
 * Every size is declared in ARCH_SPECS, in units of the frame set's own (scaled) brick: L = length, H = height, J = the
 * grout joint -- numbers from the approved mock (frame_mock.mjs rowlockArch). Board inches, y DOWN (the crown of the
 * arch is at angle -PI/2 about its centre). layArch returns the pieces (each tagged with its `part`, a stone piece with
 * its own `setId`), the arch's OUTER outline (the wall is cut around it) and its OPENING (the wall fills it again).
 */
import { mulberry32, seedFor } from './rng.js';
import { scaledSet, brickSetById } from './library.js';
import { voussoirPieces } from './arc-voussoir.js';
import { pickSample } from './piece-plan.js';

/** The arches a frame preset can carry (library.js FRAME_PRESETS `arch`). */
export const ARCH_SPECS = Object.freeze({
  rowlock_keystone: Object.freeze({
    rings: 2, // rowlock rings, each ringDepthL x L deep, headers on end (their face, H, along the arc)
    ringDepthL: 0.5,
    hoodDepthH: 0.5, // the hood ring outside the rings, hoodDepthH x H deep, pieces about one brick long
    hoodLevelIn: 0.04, // the hood stands proud of the bricks (a per-piece height offset, the height mask's own channel)
    keystoneHalfIn: 0.32, // the keystone's half width at the intrados (its half angle there = keystoneHalfIn / r)
    keystoneFlare: 1.25, // its half angle at the hood, x the intrados one (a wedge)
    keystoneDropIn: 0.08, // it hangs this far below the intrados and stands this far + 0.02 past the hood
    springerIn: 0.6, // each springer's length along the intrados (its angle = springerIn / r)
    pierIn: 0.5, // the wall left between the frame's inner path and each jamb
    apexCourses: 2, // the hood's apex sits this many wall courses below the interior's top
    stoneSetId: 6, // the keystone, springers and sill blocks: Grey ashlar
    minOpeningL: 2, // the smallest opening, x L: when not even that fits, the arch is not laid (fit note 'archTooNarrow')
  }),
});

const PI = Math.PI;

/** Pure: the interior's horizontal span through x = cx at height y (the nearest boundary crossings left and right of cx),
 *  or null when cx is outside the interior there. */
export function spanAt(poly, cx, y) {
  let left = -Infinity, right = Infinity, crossings = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a.y > y) === (b.y > y)) continue;
    const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (x < cx) { left = Math.max(left, x); crossings++; } else right = Math.min(right, x);
  }
  return crossings % 2 === 1 && Number.isFinite(left) && Number.isFinite(right) ? { left, right } : null;
}

/** Pure: where the arch goes in `interior` (a polygon, board inches, y down) for `spec` and the scaled set `s`. Centred,
 *  its sill on the bottom. Its hood's apex is tried from `apexCourses` courses below the top downward, one wall course at
 *  a time; at each, the LARGEST intrados whose real outline (the hood's circle above the springing line, the jambs'
 *  outer faces below it) keeps a pier from the interior's edge at every height (the hood may stand into the pier), with jambs at least one course tall (a
 *  bisection: a bigger arch is wider and springs lower). The placement kept is the one with the largest opening (area);
 *  on a plain rectangle that is the top one -- the mock's -- and on a shaped frame (an hourglass waist, a notched top) the
 *  arch moves down below what it cannot cross. { cx, yc, ri, D, t, rh, yBot, yFloor, L, H, J } or
 *  { fit: 'archTooNarrow' } (no arch with a minOpeningL opening fits anywhere). */
export function archPlacement(interior, spec, s) {
  const L = s.brickLengthIn, H = s.brickHeightIn, J = s.grout.widthIn;
  const xs = interior.map((p) => p.x), ys = interior.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, top = Math.min(...ys), bot = Math.max(...ys);
  const D = spec.rings * spec.ringDepthL * L, t = spec.hoodDepthH * H;
  const yFloor = bot - J / 2; // the sill's underside: half a joint off the wall's edge
  const yBot = yFloor - D; // the jambs stand on the sill blocks (D x D) and the sill courses (D deep)
  const lo0 = (spec.minOpeningL * L) / 2;
  const fitsAt = (apex, ri) => {
    const rh = ri + D + J + t, yc = apex + rh;
    if (yBot - yc < H) return false; // jambs at least one course
    for (let k = 0; k <= 96; k++) {
      const y = apex + ((yFloor - apex) * k) / 96;
      // the pier is measured from the rings / jambs (as in the mock); the hood stands into it, inside the interior
      const chord = (r) => Math.sqrt(Math.max(0, r * r - (yc - y) ** 2));
      const need = y < yc ? Math.max(chord(ri + D) + spec.pierIn, chord(rh) + J / 2) : ri + D + spec.pierIn;
      const sp = spanAt(interior, cx, y);
      if (!sp || cx - sp.left < need || sp.right - cx < need) return false;
    }
    return true;
  };
  let best = null;
  for (let k = spec.apexCourses; ; k++) {
    const apex = top + J / 2 + k * (H + J);
    if (apex + lo0 + D + J + t + H > yBot) break; // not even the smallest arch fits below here
    if (!fitsAt(apex, lo0)) continue;
    let lo = lo0, hi = (Math.max(...xs) - Math.min(...xs)) / 2;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fitsAt(apex, mid)) lo = mid; else hi = mid; }
    const rh = lo + D + J + t, yc = apex + rh;
    const area = 2 * lo * (yBot - yc) + (PI * lo * lo) / 2; // the opening
    if (!best || area > best.area * (1 + 1e-9)) best = { area, ri: lo, apex };
  }
  if (!best) return { fit: 'archTooNarrow' };
  // the jambs' outer faces on head joints of the wall's bond, which the engine centres on the arch (bondOriginX = cx):
  // a half-brick step from the centre, so the piers are whole and half bricks, never slivers (seat A's live shot: a
  // 0.5 in pier on the bond's own phase dropped its slivers, dark voids down one side). The opening only ever shrinks.
  const h = (L + J) / 2, m = Math.floor((best.ri + D + J) / h + 1e-9), snapped = m * h - D - J;
  const ri = snapped >= lo0 ? snapped : best.ri;
  const rh = ri + D + J + t;
  return { cx, yc: best.apex + rh, ri, D, t, rh, yBot, yFloor, L, H, J };
}

const arcPts = (cx, cy, r, t0, t1, maxStep = (5 * PI) / 180) => {
  const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) / maxStep));
  return Array.from({ length: n + 1 }, (_, k) => { const t = t0 + ((t1 - t0) * k) / n; return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }; });
};
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** Pure: pieces of about `pitch` filling [a, b] with joints of J between them -- whole pieces, or (`stagger`) shifted
 *  half a piece so the run starts and ends with a half piece (a header column / course over its neighbour's joints).
 *  [{ a, b }], each piece's own extent (the joints excluded). */
export function run(a, b, pitch, J, stagger) {
  const len = b - a, n = Math.max(1, Math.round((len + J) / (pitch + J)));
  const step = (len + J) / n; // one piece + one joint
  const centres = []; // the joints' centre lines
  for (let i = 1; i < n; i++) centres.push(a + i * step - J / 2);
  const cuts = stagger ? [...centres.map((c) => c - step / 2), centres.length ? centres[centres.length - 1] + step / 2 : a + step / 2 - J / 2] : centres;
  const bounds = [a, ...cuts.filter((c) => c > a + J && c < b - J), b];
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s0 = i === 0 ? bounds[i] : bounds[i] + J / 2, s1 = i === bounds.length - 2 ? bounds[i + 1] : bounds[i + 1] - J / 2;
    if (s1 - s0 > J) out.push({ a: s0, b: s1 });
  }
  return out;
}

/**
 * Lay the arch of `spec` (an ARCH_SPECS id, or a spec) in `interior`. opts: { set (the frame's set, unscaled), scale,
 * seed }. Returns { pieces, outer, opening, placement } or { fit } when it does not fit.
 * A piece: { id, polygon, pieceId, sampleId, flip, heightOffset, part, setId? } (setId only on stone pieces).
 */
export function layArch(specOrId, interior, opts) {
  const spec = typeof specOrId === 'string' ? ARCH_SPECS[specOrId] : specOrId;
  if (!spec || !interior || interior.length < 3) return null;
  const s = scaledSet(opts.set, opts.scale || 1);
  const pl = archPlacement(interior, spec, s);
  if (pl.fit) return { fit: pl.fit, pieces: [] };
  const { cx, yc, ri, D, rh, yBot, yFloor, H, J, L } = pl;
  const stone = scaledSet(brickSetById(spec.stoneSetId), 1);
  const seed = opts.seed;
  const pieces = [];
  let nextId = 0;
  const jitter = (id) => (mulberry32(seedFor(seed, 'arch-jitter', id))() * 2 - 1) * (s.heightJitterIn || 0);
  const push = (polygon, part, isStone = false, extraLevel = 0) => {
    const id = nextId++;
    const { sampleId, flip } = pickSample(isStone ? stone : s, seed, 'arch', id);
    pieces.push({ id: `arch-${id}`, polygon, pieceId: 'arch', sampleId, flip, heightOffset: jitter(id) + extraLevel, part, ...(isStone ? { setId: spec.stoneSetId } : {}) });
  };
  const ks = spec.keystoneHalfIn / ri, sp = spec.springerIn / ri;
  const ksAt = (r) => ks * (1 + (spec.keystoneFlare - 1) * Math.min(1, Math.max(0, (r - ri) / (rh - ri))));
  // the half joint either side of the keystone / springers, as an angle at radius r
  const gapAt = (r) => J / 2 / r;

  // keystone (stone): a wedge from below the intrados to past the hood
  {
    const r0 = ri - spec.keystoneDropIn, r1 = rh + spec.keystoneDropIn + 0.02;
    const a0 = ksAt(ri), a1 = ksAt(rh);
    push([...arcPts(cx, yc, r0, -PI / 2 - a0, -PI / 2 + a0), ...arcPts(cx, yc, r1, -PI / 2 + a1, -PI / 2 - a1)], 'keystone', true);
  }
  // springers (stone): sectors at both arch ends, intrados to hood
  for (const [t0, t1] of [[-PI, -PI + sp], [-sp, 0]]) {
    push([...arcPts(cx, yc, ri, t0, t1), ...arcPts(cx, yc, rh, t1, t0)], 'springer', true);
  }
  // the rings, then the hood: voussoirs between the springers and the keystone, a half joint off each
  const radii = [];
  for (let k = 0; k < spec.rings; k++) {
    const r0 = ri + k * (D / spec.rings) + (k ? J / 2 : 0), r1 = ri + (k + 1) * (D / spec.rings) - (k < spec.rings - 1 ? J / 2 : 0);
    radii.push({ r0, r1, pitch: H, part: 'ring', level: 0 });
  }
  radii.push({ r0: ri + D + J, r1: rh, pitch: L, part: 'hood', level: spec.hoodLevelIn });
  for (const { r0, r1, pitch, part, level } of radii) {
    const r = (r0 + r1) / 2, half = (r1 - r0) / 2;
    // the keystone flares outward: clear its widest angle across this ring (at the ring's outer radius), plus a joint
    const kEdge = ksAt(r1) + J / r0;
    const left = [-PI + sp + gapAt(r), -PI / 2 - kEdge], right = [-PI / 2 + kEdge, -sp - gapAt(r)];
    for (const [t0, t1] of [left, right]) {
      const res = voussoirPieces(cx, yc, r, t0, t1, half, 1, pitch, J, s, seed, `arch-${part}`, nextId);
      for (const p of res.pieces) push(p.polygon, part, false, level);
    }
  }
  // the jambs: the rings carried down as two staggered header columns, from below the springers to the sill blocks
  const yJ0 = yc + J, yJ1 = yBot - J / 2; // a full joint under the springers (their underside is the springing line)
  for (const side of [-1, 1]) {
    for (let k = 0; k < spec.rings; k++) {
      const xa = cx + side * (ri + k * (D / spec.rings) + (k ? J / 2 : 0)), xb = cx + side * (ri + (k + 1) * (D / spec.rings) - (k < spec.rings - 1 ? J / 2 : 0));
      for (const seg of run(yJ0, yJ1, H, J, k % 2 === 1)) push(rect(Math.min(xa, xb), seg.a, Math.max(xa, xb), seg.b), 'jamb');
    }
    // the sill block under the jamb (stone)
    const x0 = cx + side * ri, x1 = cx + side * (ri + D);
    push(rect(Math.min(x0, x1) + (side > 0 ? J / 2 : 0), yBot + J / 2, Math.max(x0, x1) - (side < 0 ? J / 2 : 0), yFloor), 'sillBlock', true); // a half joint off the sill
  }
  // the sill: two staggered header courses between the jambs
  for (let k = 0; k < spec.rings; k++) {
    const y0 = yBot + J / 2 + k * (D / spec.rings) + (k ? J / 2 : 0), y1 = yBot + J / 2 + (k + 1) * (D / spec.rings) - (k < spec.rings - 1 ? J / 2 : 0);
    for (const seg of run(cx - ri + J / 2, cx + ri - J / 2, H, J, k % 2 === 1)) push(rect(seg.a, y0, seg.b, Math.min(y1, yFloor)), 'sill');
  }

  // the outer outline (the wall is cut around it): the hood over the top -- with the keystone's head standing past it --
  // and the jambs' outer faces down to the floor
  const kOut = rh + spec.keystoneDropIn + 0.02, kA = ksAt(rh);
  const outer = [
    ...arcPts(cx, yc, rh, -PI, -PI / 2 - kA), ...arcPts(cx, yc, kOut, -PI / 2 - kA, -PI / 2 + kA), ...arcPts(cx, yc, rh, -PI / 2 + kA, 0),
    { x: cx + ri + D, y: yc }, { x: cx + ri + D, y: yFloor }, { x: cx - ri - D, y: yFloor }, { x: cx - ri - D, y: yc },
  ];
  // the opening (the wall fills it): the intrados over the top, the jambs' inner faces down to the sill -- half a joint in
  // (the wall's own edge rule: its pieces keep half a joint off the line they fill to; the keystone's drop is cut around)
  const ro = ri - J / 2;
  const opening = [...arcPts(cx, yc, ro, -PI, 0), { x: cx + ro, y: yBot }, { x: cx - ro, y: yBot }];
  const keystone = pieces.find((p) => p.part === 'keystone').polygon; // it hangs into the opening: the opening's wall is cut around it
  return { pieces, outer, opening, keystone, placement: pl };
}
