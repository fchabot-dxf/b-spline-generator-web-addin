/**
 * Magma (Molten Crust) 🌋🔥
 * Cooled lava plates separated by RAISED bright fissures of glowing rock.
 *
 * Composition (substrate → highlights):
 *   1. Crust dome      — gentle FBM swell across each Voronoi cell, so
 *                       plates aren't dead flat; they have the slight
 *                       pillowed top of cooling pahoehoe.
 *   2. Flow striations — rotated low-amplitude sine bands → frozen
 *                       evidence of the original molten flow direction.
 *   3. Vesicular pocking — pumice bubble holes, raised rims, gated to
 *                       plate interiors so cracks stay clean.
 *   4. Crust grain     — fine FBM micro-roughness across plate tops.
 *   5. Ridged fracture lines — sinuous hairline cracks within plates.
 *   6. Primary cracks  — domain-warped Voronoi distance, INVERTED with
 *                       a sharp pow → bright raised lava veins between
 *                       plates. This is the signature feature.
 *   7. Secondary fines — second Voronoi at higher freq → finer thermal-
 *                       contraction cracks within plates.
 */
export const id = 'magma';
export const label = 'Molten Crust';
export const cMultiplier = 2.6;

export const tweaks = [
  { key: 'crackBrightness', label: 'Crack Brightness', default: 0.55, min: 0.10, max: 1.00, step: 0.05, desc: 'Primary lava-vein height' },
  { key: 'vesicleStrength', label: 'Vesicle Strength', default: 0.45, min: 0.00, max: 1.00, step: 0.05, desc: 'Pumice bubble depth' },
  { key: 'crustGrain',      label: 'Crust Grain',      default: 0.06, min: 0.00, max: 0.20, step: 0.01, desc: 'Plate-top micro-texture' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const crackBrightness = t.crackBrightness ?? 0.55;
  const vesicleStrength = t.vesicleStrength ?? 0.45;
  const crustGrain      = t.crustGrain      ?? 0.06;

  // Domain warp → organic, irregular plate boundaries (no rigid cells)
  const wf = 1.4;
  const wx = noiseWarp.fbm(su * wf, sv * wf, 3) * (warpIntensity * 1.6);
  const wy = noiseWarp.fbm(su * wf + 4.1, sv * wf + 8.7, 3) * (warpIntensity * 1.6);

  // Plate-edge proximity (used to suppress in-plate texture near the
  // bright crack ridges so the cracks stay clean and bold).
  const f1 = scale * 1.6;
  const d1 = noiseFine.worleyNoise2((su + wx) * f1 * aspect, (sv + wy) * f1);
  const interior = Math.max(0, Math.min(1, (d1 - 0.10) * 4.0));

  // ── 1. CRUST DOME (gentle swell within each plate) ─────────────────
  const crustNoise = (noiseFine.fbm(su * scale * 0.9 + wx * 0.3, sv * scale * 0.9 + wy * 0.3, 4) + 1) * 0.5;
  const crust = Math.pow(crustNoise, 1.4) * 0.32;

  // ── 2. FLOW STRIATIONS ─────────────────────────────────────────────
  const flowAngle = (noiseWarp.noise2(su * 0.4, sv * 0.4) * 0.5 + 0.5) * Math.PI * 0.6;
  const fu = su * Math.cos(flowAngle) - sv * Math.sin(flowAngle);
  const flow = Math.sin(fu * scale * 12.0 + noiseWarp.fbm(su * 2, sv * 2, 2) * 3.0) * 0.07 * interior;

  // ── 3. VESICULAR POCKING ───────────────────────────────────────────
  const pf = scale * 5.0;
  const pD = noiseFine.worleyNoise2((su + wx * 0.5) * pf * aspect, (sv + wy * 0.5) * pf);
  const bubbleRim = Math.pow(Math.max(0, 1.0 - Math.abs(pD - 0.14) * 9.0), 1.8) * 0.10;
  const bubbleHole = -Math.pow(Math.max(0, 0.10 - pD), 1.4) * vesicleStrength;
  const vesicles = (bubbleRim + bubbleHole) * interior;

  // ── 4. CRUST GRAIN ─────────────────────────────────────────────────
  const grainRaw = noiseFine.fbm(su * scale * 11.0 * aspect, sv * scale * 11.0, 3, 2.0, 0.55);
  const grain = grainRaw * crustGrain * interior;

  // ── 5. RIDGED FRACTURE LINES ───────────────────────────────────────
  const ridgeRaw = noiseFine.fractalRidge2(su * scale * 2.6 * aspect + wx * 0.6, sv * scale * 2.6 + wy * 0.6, 3);
  const ridgeLines = Math.pow(Math.max(0, ridgeRaw), 3.5) * 0.14 * interior;

  // ── 6. PRIMARY CRACKS ──────────────────────────────────────────────
  const cracks1 = Math.pow(Math.max(0, 1.0 - d1 * 2.0), 4.0) * crackBrightness;

  // ── 7. SECONDARY FINE CRACKS ───────────────────────────────────────
  const f2 = scale * 4.5;
  const d2 = noiseFine.worleyNoise2((su + wx * 0.4) * f2 * aspect, (sv + wy * 0.4) * f2);
  const cracks2 = Math.pow(Math.max(0, 1.0 - d2 * 1.6), 6.0) * 0.18;

  return crust + flow + vesicles + grain + ridgeLines + cracks1 + cracks2;
};
