/**
 * Mars (Red Planet) 🔴🛰️
 * Dry-river-network martian terrain — dendritic drainage carving highland
 * massifs, flat-topped mesas with cliff edges, dust-softened impact
 * craters (the shared `craterField` model, same as Moon), and faint
 * wind-streak banding.
 *
 * T78 (Fred: "the planet ones aren't planet-like at all, craters don't
 * look like craters either") REWORK — item 3 dispatch: "the same crater
 * model [as Moon] but dust-softened, plus dry CHANNELS/valleys, flat-
 * topped MESAS with cliff edges (layered steps), and faint wind streaks.
 * Distinct from Moon at a glance." Craters are secondary here (Mars is
 * NOT saturated with craters like the Moon — atmosphere + dust + water
 * erosion erase most of them over time); the drainage network and mesa
 * terraces are the dominant, Mars-identifying feature, which is what
 * keeps this distinct from Moon at a glance even though both now share
 * the same underlying crater engine.
 *
 * Composition (large → small):
 *   1. Continental relief — low-freq FBM pow-curve → highland plateaus
 *                            and basin floors (Tharsis vs Hellas), with
 *                            the HIGHEST relief bands quantized into
 *                            flat-topped mesa terraces (cliff edges at
 *                            each step) — a localized feature, not a
 *                            global staircase.
 *   2. Drainage — dominant dendritic river network from fractalRidge2,
 *                 carved deep on highlands, fading on basins.
 *   3. Crater field — `craterField()` (shared with Moon), dust-softened:
 *                      lower rim amplitude, independently placed from
 *                      Moon's own field via `saltOffset`.
 *   4. Wind streaks — faint, heavily-direction-stretched low-freq banding.
 *   5. Rust ridges  — faint mid-freq fractalRidge2 → tectonic banding
 *                      and wind-scoured ridges on the plateaus.
 *   6. Surface dust — fine FBM grain.
 */
import { craterField } from './craterField.js';

export const id = 'mars';
export const label = 'Mars Surface';
export const cMultiplier = 3.0;

export const tweaks = [
  { key: 'reliefHeight', label: 'Relief Height',  default: 0.55, min: 0.10, max: 1.20, step: 0.05, desc: 'Highland massif amplitude' },
  { key: 'riverDepth',   label: 'River Depth',    default: 0.45, min: 0.00, max: 0.90, step: 0.02, desc: 'Dendritic drainage carving' },
  { key: 'craterScale',  label: 'Crater Scale',   default: 0.18, min: 0.00, max: 0.50, step: 0.02, desc: 'Crater pit depth' },
  { key: 'ridgeAmount',  label: 'Rust Ridges',    default: 0.06, min: 0.00, max: 0.20, step: 0.01, desc: 'Faint tectonic banding' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const reliefHeight = t.reliefHeight ?? 0.55;
  const riverDepth   = t.riverDepth   ?? 0.45;
  const craterScale  = t.craterScale  ?? 0.18;
  const ridgeAmount  = t.ridgeAmount  ?? 0.06;

  // ── 1. CONTINENTAL RELIEF + MESAS ──────────────────────────────────
  const cf = scale * 0.42;
  const wx = noiseWarp.fbm(su * 0.8, sv * 0.8, 2) * (warpIntensity * 1.0);
  const wy = noiseWarp.fbm(su * 0.8 + 5, sv * 0.8 + 9, 2) * (warpIntensity * 1.0);
  const reliefRaw = (noiseFine.fbm(su * cf * aspect + wx, sv * cf + wy, 5, 2.0, 0.5) + 1) * 0.5;
  // Flat-topped mesas with cliff edges: ONLY the highest-relief bands
  // (highland massif crests) get quantized into terrace levels -- a
  // localized butte/plateau feature, not a global staircase over the
  // whole board. `mesaMask` fades the effect in smoothly so the terrace
  // itself still has a real cliff (the Math.round jump), while low/basin
  // terrain stays smooth and un-terraced.
  const mesaMask = smoothstep01(0.50, 0.70, reliefRaw);
  const TERRACE_LEVELS = 5;
  const terracedRaw = Math.round(reliefRaw * TERRACE_LEVELS) / TERRACE_LEVELS;
  const reliefWithMesas = reliefRaw * (1 - mesaMask) + terracedRaw * mesaMask;
  // T78 tuning: the drainage network + mesa terraces need to read as the
  // DOMINANT martian feature (item 3: "distinct from Moon at a glance"),
  // so relief/valleys carry a higher internal amplitude than the old file
  // did -- craters are deliberately secondary here (Mars genuinely has
  // far fewer surviving craters than the Moon; atmosphere + dust erosion
  // erase most of them).
  const relief = Math.pow(reliefWithMesas, 1.3) * reliefHeight * 1.7;

  // ── 2. DENDRITIC DRAINAGE (dry channels/valleys, dominant) ─────────
  // Two octave-shifted river networks at slightly different scales merge
  // into a multi-tributary system that branches like real fluvial erosion.
  const vf = scale * 2.2;
  const vwx = noiseWarp.fbm(su * 1.6, sv * 1.6, 3) * (warpIntensity * 1.6);
  const vwy = noiseWarp.fbm(su * 1.6 + 3, sv * 1.6 + 7, 3) * (warpIntensity * 1.6);
  const drainA = noiseFine.fractalRidge2((su + vwx) * vf * aspect, (sv + vwy) * vf, 5);
  const drainB = noiseFine.fractalRidge2((su + vwx) * vf * 1.7 * aspect + 4.4, (sv + vwy) * vf * 1.7 + 6.6, 4);
  const drainage = Math.max(drainA, drainB * 0.7);
  const erosionGate = Math.max(0, (relief - 0.08) / 0.45);
  const valleys = -Math.pow(Math.max(0, drainage), 2.0) * riverDepth * 1.6 * erosionGate;

  // ── 3. CRATER FIELD (shared with Moon, dust-softened) ──────────────
  // Mars is NOT saturated with craters like the Moon (erosion erases
  // most of them) -- lower rim amplitude ("dust-softened"), and a
  // saltOffset so Mars's own crater sites are placed INDEPENDENTLY from
  // Moon's, even at the identical seed/scale.
  const craters = craterField(noiseFine, su, sv, aspect, scale, {
    craterDensity: 0.22,
    craterDepth: (craterScale / 0.18) * 0.8,
    rimHeight: 0.35,
    saltOffset: 5000,
  });

  // ── 4. WIND STREAKS (faint, direction-stretched banding) ───────────
  const windAngle = 0.4;
  const wsx = su * Math.cos(windAngle) + sv * Math.sin(windAngle);
  const wsy = -su * Math.sin(windAngle) + sv * Math.cos(windAngle);
  const streaks = noiseFine.fbm(wsx * scale * 3.0, wsy * scale * 45.0, 2) * 0.012;

  // ── 5. RUST RIDGES (tectonic + wind-scoured) ───────────────────────
  const ridges = noiseFine.fractalRidge2(su * scale * 1.4 * aspect + wx * 0.5, sv * scale * 1.4 + wy * 0.5, 4) * ridgeAmount;

  // ── 6. SURFACE DUST ────────────────────────────────────────────────
  const dustRaw = (noiseFine.fbm(su * scale * 16.0 * aspect, sv * scale * 16.0, 3, 2.0, 0.45) + 1) * 0.5;
  const dust = (dustRaw - 0.5) * 0.04;

  return relief + valleys + craters + streaks + ridges + dust;
};

function smoothstep01(a, b, x) {
  const tt = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return tt * tt * (3 - 2 * tt);
}
