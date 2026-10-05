/**
 * core/bricks/height-profile.js — PORTABLE (see rng.js). H23 item 73(c): the 3D height PROFILE
 * within a single brick's own top face -- a rounded "shoulder" near the edge, a slight CROWN
 * (dome) toward the centre, and random chipped corners -- declared per set as
 * `set.heightProfile = {edgeRadiusIn, crown, chipRate, chipSizeIn, surfaceShare, edgeNoiseIn?,
 * edgeNoiseScaleIn?}` (advisor,
 * referencing shots/advisor/brick_3d_compare.png: "rounded worn edges + slight crown + chipped
 * corners + real photo surface"). All pure geometry (distance-to-edge, declared sine easing,
 * seeded chip placement) -- no image/raster dependency, so it stays inside the portable core.
 *
 * The "real photo surface" detail (a de-lit, high-pass version of the brick's own sample photo)
 * is EXPLICITLY NOT built here: it needs real pixel decoding (blur, luminance), which a zero-
 * dependency core can't do (core/bricks/ has no canvas -- the SAME split already approved for the
 * 'continuous' profile's own pixel blending, item 72). `brickTopHeight` instead takes an OPTIONAL
 * `sampleDetailAt(x, y, brick)` callback -- the adapter's own job to supply, returning a value in
 * [-1, 1] (above/below the sample's own mean), scaled here by `surfaceShare * reliefIn`. Omitted,
 * the shape-only height (shoulder + crown + chips) is still a complete, correct answer on its own.
 */
import { mulberry32, seedFor } from './rng.js';
import { valueNoise2 } from './noise2d.js';

/** Perpendicular distance from (x,y) to the nearest EDGE of a convex polygon (every brick this
 *  engine produces -- a plain quad, or a mitred triangle/pentagon -- is convex). */
function distanceToNearestEdge(x, y, polygon) {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    const px = a.x + t * dx, py = a.y + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < best) best = d;
  }
  return best;
}

/** The polygon's own centroid's distance to its nearest edge -- an approximate "how far can you
 *  get from every edge" scale, good enough for the near-rectangular shapes here (never an exact
 *  inradius solve; a declared simplification, matching this file's own general precision level). */
function maxInteriorDistance(polygon) {
  const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  return distanceToNearestEdge(cx, cy, polygon) || 1e-6;
}

/** Hash an id (brick ids are a mix of numbers and formatted strings, e.g. 'frame-12') to a plain
 *  integer, for seedFor's own cellId slot. */
function hashId(id) {
  if (typeof id === 'number') return id | 0;
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

const sineEase = (t) => Math.sin(Math.max(0, Math.min(1, t)) * Math.PI / 2);

/**
 * The height (inches) of a brick's own top face at board-inch point (x,y), shape-only plus an
 * optional surface-detail contribution. Does NOT clamp to reliefMaxIn (engine.js's sampleHeight
 * -- the one place every source of height variation funnels through -- does that).
 *
 * @param {number} x @param {number} y — board-inch point, assumed inside `brick.polygon`
 * @param {{polygon:{x:number,y:number}[], id:(number|string), heightOffset?:number}} brick
 * @param {object} set — a library.BRICK_SETS entry (reads set.heightProfile, set.reliefIn)
 * @param {number} seed
 * @param {(x:number,y:number,brick:object)=>number} [sampleDetailAt] — adapter-supplied, see header
 * @returns {number} height in inches (shape + detail + this brick's own existing heightOffset)
 */
export function brickTopHeight(x, y, brick, set, seed, sampleDetailAt) {
  const hp = set.heightProfile || {};
  const edgeRadiusIn = hp.edgeRadiusIn ?? 0;
  const crown = hp.crown ?? 0;
  const chipRate = hp.chipRate ?? 0;
  const chipSizeIn = hp.chipSizeIn ?? 0;
  const surfaceShare = Math.max(0, Math.min(1, hp.surfaceShare ?? 0));
  const edgeNoiseIn = hp.edgeNoiseIn ?? 0;
  const edgeNoiseScaleIn = hp.edgeNoiseScaleIn ?? 0;
  const reliefIn = set.reliefIn ?? 0.125;

  const dist = distanceToNearestEdge(x, y, brick.polygon);
  // EDGE WEAR (F35 item 18, the Weathered surface style; seat B agreed): the shoulder's distance-to-edge
  // perturbed by a continuous board-space value noise, so the worn shoulder line wanders = ragged
  // edges. Optional, default 0 = exactly the plain shoulder. Shoulder only: chips and the crown read
  // the true geometry below.
  const shoulderDist = (edgeNoiseIn > 0 && edgeNoiseScaleIn > 0)
    ? Math.max(0, dist + edgeNoiseIn * (valueNoise2(seedFor(seed, 'edge-wear', 0), x / edgeNoiseScaleIn, y / edgeNoiseScaleIn) * 2 - 1))
    : dist;

  // SHOULDER: a sine ease from 0 (at the edge) to 1 (edgeRadiusIn or further inward). edgeRadiusIn
  // <= 0 (no declared profile) means full height everywhere -- the original flat-top behaviour.
  const shoulder = edgeRadiusIn > 1e-6 ? sineEase(shoulderDist / edgeRadiusIn) : 1;

  // CROWN: an additional small dome ON TOP of the shoulder (added, not min()-combined with it --
  // MEASURED: combining via min(1, shoulder+dome) silently swallowed the whole dome everywhere
  // shoulder was already at its own max, which is most of a brick's own interior once past
  // edgeRadiusIn, defeating "a slight dome" entirely). 0 at the edge, `crown` (a small fraction,
  // the advisor's own declared 0-0.2 range) extra at the brick's own centre.
  const maxDist = maxInteriorDistance(brick.polygon);
  const dome = crown * sineEase(dist / maxDist);

  let height = reliefIn * (1 - surfaceShare) * shoulder + reliefIn * dome;

  // SURFACE DETAIL (optional, adapter-supplied -- see header): a de-lit high-pass sample value in
  // [-1,1], normalised to a declared SHARE of the relief budget, added (not multiplied) on top of
  // the shape so it reads as fine texture riding on the shoulder/crown, not a separate layer.
  if (sampleDetailAt && surfaceShare > 0) {
    const detail = Math.max(-1, Math.min(1, sampleDetailAt(x, y, brick)));
    height += detail * reliefIn * surfaceShare;
  }
  // T86 item 23 (Fred: the Wear amount wears stones too): a stone's face is mostly photo detail (the Weathered style
  // multiplies surfaceShare; White rocks reach 0.875), so the worn shoulder above barely shows on it. A set declaring
  // `wearWholeFace` lets the WHOLE face follow the wear: where the edge noise pulls the shoulder line inward, the detail
  // share dips by the same amount. No wear (edgeNoiseIn 0) = the worn and plain shoulders agree = no change.
  if (hp.wearWholeFace && edgeNoiseIn > 0 && edgeRadiusIn > 1e-6) {
    height -= reliefIn * surfaceShare * Math.max(0, sineEase(dist / edgeRadiusIn) - shoulder);
  }

  // CHIPS: a declared per-brick chance of ONE small corner dip (Fred: "chipped corners" --
  // MEASURED off brick_3d_compare.png as an occasional, not universal, detail). Chip/no-chip and
  // which corner are both seeded per brick (deterministic for a given seed), independent of the
  // query point so repeated queries into the same brick agree.
  if (chipRate > 0 && chipSizeIn > 0) {
    const cellId = hashId(brick.id);
    const hasChip = mulberry32(seedFor(seed, 'chip', cellId))() < chipRate;
    if (hasChip) {
      const corner = brick.polygon[Math.floor(mulberry32(seedFor(seed, 'chip-corner', cellId))() * brick.polygon.length)];
      const dCorner = Math.hypot(x - corner.x, y - corner.y);
      if (dCorner < chipSizeIn) {
        // a sine-eased DIP: 0 height right at the corner tip, ramping back up to full height at chipSizeIn away
        height *= sineEase(dCorner / chipSizeIn);
      }
    }
  }

  return height + (brick.heightOffset || 0);
}
