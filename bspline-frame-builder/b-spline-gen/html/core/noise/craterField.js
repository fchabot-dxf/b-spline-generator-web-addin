/**
 * craterField.js — shared impact-crater model for Moon and Mars (T78 items
 * 2/3, Fred: "the planet ones aren't planet-like at all, craters don't look
 * like craters either", plus the two T78 MOON REFERENCE amendments with
 * actual lunar photos). NOT registered in `index.js` — this is an internal
 * helper `moon.js`/`mars.js` import, not a selectable noise mode itself.
 *
 * Real crater morphology, per Fred's reference photos and the dispatch:
 *   - THREE named crater types, keyed by size (real lunar/martian
 *     morphology genuinely differs by size, not just "bigger bowl"):
 *       'simple'  (small)       — bowl floor + a crisp raised rim.
 *       'complex' (medium-large) — bowl floor gives way to a FLATTER floor,
 *                                  TERRACED/slumped inner walls, and a
 *                                  CENTRAL PEAK CLUSTER (2-3 bumps, not one
 *                                  point) — matches the close-up reference's
 *                                  centre-left crater exactly.
 *       'basin'   (rare, giant) — a flat-floored basin + rim, NO peak (the
 *                                  close-up reference's largest crater).
 *   - Raised rim + an outward-fading ejecta apron on every type.
 *   - Power-law per-cell radius (few large, many small): radius is drawn
 *     from `sizeRoll ** powerLaw`, powerLaw > 1 skewing small.
 *   - Overlap: within one crater-type/scale's own cell neighborhood, the
 *     LOCALLY DOMINANT crater (most negative excavation at that point) is
 *     used OUTRIGHT, never summed with a neighbor — this is what makes a
 *     newer/deeper crater's rim read as intact while an older, shallower
 *     one it overlaps looks bitten into/interrupted at the boundary,
 *     without needing a literal simulated "age" system. DIFFERENT scales
 *     (e.g. a small crater and a big basin) are still SUMMED — a small
 *     fresh crater sitting inside a big crater's own flat floor is real
 *     lunar morphology (the reference's basin is "peppered with small
 *     fresh craters" on its floor), not something to suppress.
 *   - `freshness` (a per-crater hash roll) degrades older craters: shallower
 *     floor, softer rim — "partly buried/degraded older craters" per the
 *     close-up reference, never fully erasing one (freshness only ranges
 *     the profile amplitude down to 35%, not to 0).
 *   - `mariaGate` (0..1, supplied by the CALLER from its own relief field)
 *     suppresses crater density where the caller's terrain is "maria" —
 *     the near-side reference photo's wide dark basins have visibly FEWER
 *     craters than the highlands/far side. Not a hard gate (maria still
 *     keep a small fraction) since the reference does show a few craters
 *     inside maria too.
 *
 * Bright ray systems (the near-side reference's radiating white streaks
 * around fresh craters) are NOT modelled here at all — the amendment is
 * explicit that rays are ALBEDO, not relief, and this is a physical height
 * field for carving, not a rendered color texture; adding raised "ray"
 * relief would be actively wrong.
 */

/**
 * T78 tuning finding: Perlin `noise2()` output is NOT uniformly distributed
 * in [-1,1] (it's a smoothly-interpolated gradient product, concentrated
 * near 0 -- measured min/max over 2000 samples landed inside [0.16, 0.89]
 * after the [0,1) remap below, nowhere near the edges), so using it
 * directly as a density-threshold gate silently makes a "density: 0.26"
 * parameter fire far less than 26% of the time. `hashInt` (an integer
 * bit-mixing finalizer, the well-known technique behind MurmurHash3/
 * splitmix-style hashes) gives a genuinely uniform [0,1) instead.
 */
function hashInt(x) {
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return x >>> 0;
}

/** A single scalar derived from the caller's own already-seeded
 *  `noiseFine` instance, folded into `cellHash`'s own integer hash below so
 *  crater placement still changes with the terrain's own seed -- reads
 *  `noiseFine` only through its public `noise2()` method (no dependence on
 *  its private permutation table), same access every other filter already
 *  uses. */
function seedFingerprint(noiseFine) {
  const f = noiseFine.noise2(0.5173, 0.7291);
  return hashInt(Math.floor((f * 0.5 + 0.5) * 0xffffffff) | 0);
}

/** Decorrelated per-cell pseudo-random in [0,1), genuinely uniform (see
 *  `hashInt`'s own doc comment above). */
function cellHash(fingerprint, ix, iy, salt) {
  const h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(salt, 2246822519) + fingerprint) | 0;
  return hashInt(h) / 4294967296;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * One crater-type/scale layer: tiles (su,sv) space into `freq`-sized cells
 * (aspect-corrected), places a jittered site per occupied cell, and finds
 * the DOMINANT candidate in the surrounding 3x3 neighborhood — the one
 * with the SMALLEST normalized distance `r` to its own site (i.e. whichever
 * crater the point sits most "inside" of, relative to that crater's own
 * radius) — then evaluates and returns ONLY that winner's full profile
 * (bowl/floor, rim, or ejecta, whichever zone the point falls in for THAT
 * crater). This is what makes a newer/deeper crater's own rim read as
 * intact while an older, shallower one it overlaps looks bitten into at
 * the boundary: picking by smallest normalized-r, not by comparing raw
 * signed heights across candidates, is what correctly keeps a candidate's
 * own POSITIVE rim/ejecta contribution instead of only ever surfacing
 * negative bowl floors (a real bug an earlier "most-negative-wins on the
 * final signed height" design had — an isolated crater's own rim, with no
 * competing candidate, could never beat a same-lifetime initial 0 and was
 * silently discarded every time). Different LAYERS (different scales) are
 * still SUMMED by the caller (see file header) — this function only
 * resolves dominance WITHIN one scale's own cell neighborhood.
 * Returns 0 when no crater reaches the point at all.
 */
function craterLayer(fingerprint, su, sv, aspect, freq, opts) {
  const {
    kind, radiusMin, radiusMax, density, powerLaw,
    depthScale, rimHeight, ejectaReach, saltBase, mariaGate,
  } = opts;

  const effectiveDensity = density * (1 - mariaGate * 0.85); // maria: ~15% of normal density, never zero
  const x = su * freq * aspect;
  const y = sv * freq;
  const ix = Math.floor(x); const iy = Math.floor(y);

  let winner = null; // { r, radius, dx, dy, cx, cy }

  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i; const cy = iy + j;
      if (cellHash(fingerprint, cx, cy, saltBase + 0) >= effectiveDensity) continue; // most cells: no crater here
      const jitterX = cellHash(fingerprint, cx, cy, saltBase + 1);
      const jitterY = cellHash(fingerprint, cx, cy, saltBase + 2);
      const siteX = cx + 0.15 + jitterX * 0.7; // keep sites off the cell edge
      const siteY = cy + 0.15 + jitterY * 0.7;
      const sizeRoll = cellHash(fingerprint, cx, cy, saltBase + 3);
      // Power-law radius IN CELL UNITS DIRECTLY (not a fraction of some
      // ceiling) -- radiusMin/radiusMax bound every crater in this layer
      // to a range that's comfortably resolvable at real mesh resolutions
      // (T78 tuning finding: an overly aggressive skew toward tiny radii
      // produced craters smaller than the sample grid itself -- invisible
      // "coverage" near zero even with a sane density).
      const radius = radiusMin + (radiusMax - radiusMin) * Math.pow(sizeRoll, powerLaw);

      const dx = x - siteX; const dy = y - siteY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const reach = radius * ejectaReach;
      if (dist > reach) continue;
      const r = dist / radius; // 0 at centre, 1 at rim, up to ejectaReach at apron edge

      if (!winner || r < winner.r) winner = {
        r, radius, dx, dy, cx, cy,
      };
    }
  }
  if (!winner) return 0;

  const {
    r, radius, dx, dy, cx, cy,
  } = winner;

  // "Partly buried/degraded older craters" (T78 MOON REFERENCE 2):
  // freshness in [0,1], floored at 0.35 so an old crater is muted, not
  // erased outright.
  const freshness = 0.35 + 0.65 * cellHash(fingerprint, cx, cy, saltBase + 4);

  let h;
  if (r <= 1.0) {
    if (kind === 'simple') {
      h = -(1 - r * r); // clean parabolic bowl, -1 at centre, 0 at rim
    } else {
      // 'complex' and 'basin' both get a FLATTER floor than a simple
      // bowl (real large craters have relatively flat floors, not a
      // deep V) -- smoothstep-shaped floor, flat through the middle,
      // curving up only near the wall.
      const floorFlat = -smoothstep(1.0, 0.35, r); // -1 through r<0.35, curving to 0 by r=1
      h = floorFlat;
      if (kind === 'complex') {
        // Central peak CLUSTER (T78 MOON REFERENCE 2: "central peak
        // CLUSTER on a flatter floor", not a single point) -- 3 small
        // bumps jittered around the true centre, each within ~28% of
        // the crater's own radius.
        for (let k = 0; k < 3; k++) {
          const pAng = cellHash(fingerprint, cx, cy, saltBase + 10 + k * 2) * Math.PI * 2;
          const pDist = cellHash(fingerprint, cx, cy, saltBase + 11 + k * 2) * 0.28;
          const px = pDist * Math.cos(pAng); const py = pDist * Math.sin(pAng);
          const pdx = (dx / radius) - px; const pdy = (dy / radius) - py;
          const pd = Math.sqrt(pdx * pdx + pdy * pdy);
          h += Math.max(0, 1 - pd / 0.22) ** 2 * 0.42;
        }
        // Terraced/slumped inner walls: concentric steps between the
        // flat floor and the rim (r in [0.35, 1]).
        const wallT = smoothstep(0.35, 1.0, r);
        h += Math.sin(r * Math.PI * 3.2) * 0.045 * wallT;
      }
      // 'basin': no peak, no terraces -- just the flat floor + rim
      // below. Its own floor is "peppered with small fresh craters"
      // for free, since a SEPARATE, smaller-scale craterLayer call
      // sums its own independent contribution on top (see file header).
    }
    // Raised rim: a lip right at r ~ 1, wider for the bigger types.
    const rimWidth = kind === 'simple' ? 0.14 : 0.22;
    const rimT = Math.max(0, 1 - Math.abs(r - 1) / rimWidth);
    h += (rimT ** 2) * 0.55 * rimHeight;
  } else {
    // Ejecta apron: fades from the rim outward to 0 at `reach`.
    const t = (r - 1) / (ejectaReach - 1);
    h = Math.pow(Math.max(0, 1 - t), 1.6) * 0.16 * rimHeight;
  }

  return h * depthScale * freshness;
}

/**
 * Combine basin + complex + simple(x2) crater-scale layers into one signed
 * height contribution.
 *
 * @param noiseFine   the caller's own PerlinNoise instance (already seeded)
 * @param su,sv,aspect  same surface params every filter's own fn() receives
 * @param scale       same PATTERN scale every filter's own fn() receives
 * @param opts.craterDensity  multiplies every layer's own density (default 1)
 * @param opts.craterDepth    multiplies every layer's own depth (default 1)
 * @param opts.rimHeight      multiplies every layer's own rim/ejecta amplitude (default 1)
 * @param opts.mariaGate      0..1 per-point "how much is this maria" (default 0 = pure highlands)
 * @param opts.saltOffset     shifts every layer's own hash salts (default 0) -- lets Mars use a
 *                            DIFFERENT crater field than Moon at the same (su,sv,scale,seed)
 */
export function craterField(noiseFine, su, sv, aspect, scale, opts = {}) {
  const {
    craterDensity = 1, craterDepth = 1, rimHeight = 1, mariaGate = 0, saltOffset = 0,
  } = opts;
  const fingerprint = seedFingerprint(noiseFine);

  // Radius bounds are in CELL UNITS for that layer's own `freq` (i.e.
  // fraction of that layer's own cell size) -- kept comfortably >=0.3 cells
  // at the SMALLEST end of every layer so even the smallest crater in the
  // smallest layer is several sample-grid steps wide at typical mesh
  // resolutions (T78 tuning finding, see craterLayer's own comment).
  // "Few large, many small" comes from BOTH the per-layer power-law skew
  // AND the layer table itself (basin cells are rare/coarse, simple cells
  // are frequent/fine) working together, not one power-law doing all of it.
  const LAYERS = [
    { kind: 'basin',   freq: scale * 0.50, density: 0.07, radiusMin: 0.55, radiusMax: 0.95, powerLaw: 1.5, depthScale: 1.30, ejectaReach: 2.2, salt: 5 },
    { kind: 'complex', freq: scale * 1.20, density: 0.13, radiusMin: 0.42, radiusMax: 0.85, powerLaw: 1.6, depthScale: 1.00, ejectaReach: 2.0, salt: 40 },
    { kind: 'simple',  freq: scale * 2.80, density: 0.20, radiusMin: 0.35, radiusMax: 0.75, powerLaw: 1.8, depthScale: 0.65, ejectaReach: 1.8, salt: 90 },
    { kind: 'simple',  freq: scale * 6.00, density: 0.26, radiusMin: 0.30, radiusMax: 0.68, powerLaw: 1.8, depthScale: 0.42, ejectaReach: 1.6, salt: 150 },
  ];

  let total = 0;
  for (const layer of LAYERS) {
    total += craterLayer(fingerprint, su, sv, aspect, layer.freq, {
      kind: layer.kind,
      radiusMin: layer.radiusMin,
      radiusMax: layer.radiusMax,
      density: layer.density * craterDensity,
      powerLaw: layer.powerLaw,
      depthScale: layer.depthScale * craterDepth,
      rimHeight,
      ejectaReach: layer.ejectaReach,
      saltBase: layer.salt + saltOffset,
      mariaGate,
    });
  }
  return total;
}
