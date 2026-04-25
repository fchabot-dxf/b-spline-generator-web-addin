/**
 * Anatomical (Chest) 🧘‍♂️🧬
 * Symmetrical pectoral/sternum structural geometry with skeletal rib detail and skin FBM.
 */
export const id = 'chest';
export const label = 'Anatomical';
export const cMultiplier = 1.8;

export const tweaks = [
  { key: 'pectoralStrength', label: 'Pectoral Strength', default: 0.70, min: 0.00, max: 1.20, step: 0.05, desc: 'Pectoral mound height' },
  { key: 'absStrength',      label: 'Abs Strength',      default: 0.25, min: 0.00, max: 0.50, step: 0.01, desc: 'Six-pack mound depth' },
  { key: 'ribStrength',      label: 'Rib Striation',     default: 0.08, min: 0.00, max: 0.20, step: 0.01, desc: 'Side-rib striation amplitude' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, octaves, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const pectoralStrength = t.pectoralStrength ?? 0.70;
  const absStrength      = t.absStrength      ?? 0.25;
  const ribStrength      = t.ribStrength      ?? 0.08;

  // 1. Structural Torso Geometry (Global gradients)
  const dx = Math.abs(su * 2 - 1); // Distance from central sternum line
  const dy = sv;

  // Smooth Gaussian sternum valley (Eliminates sharp creases)
  const sternum = (1.0 - Math.exp(-dx * dx * 16.0)) * 0.52;

  // Organic pectoral mounding (Softened mass)
  const pectoral = Math.exp(-Math.pow(dx - 0.45, 2) * 20.0) * Math.exp(-Math.pow(dy - 0.45, 2) * 10.0) * pectoralStrength;

  // Smooth Shoulders (Deltoids)
  const deltoid = Math.exp(-Math.pow(dx - 0.9, 2) * 16.0) * Math.exp(-Math.pow(dy - 0.25, 2) * 14.0) * 0.45;

  // Organic Neck (Top center)
  const neck = Math.exp(-(dx * dx) * 40.0) * Math.max(0, 1.0 - dy * 7.0) * 0.35;

  // Soft V-Clavicle (Transition between shoulders/neck)
  const clavicle = Math.max(0, 1.0 - Math.abs(dy - (0.12 + dx * 0.1)) * 14.0) * Math.exp(-dx * 1.5) * 0.16;

  // 2. Abdominals (Six-pack)
  const absMask = Math.max(0, (dy - 0.6) * 6.0);
  const absWz = noiseFine.noise2(su * 4.0, sv * 4.0) * 0.15;
  const absRows = Math.exp(-Math.pow(Math.sin((dy + absWz) * 14.0), 2.0) * 8.0);
  const absCols = Math.exp(-Math.pow((dx + absWz) - 0.45, 2) * 14.0);
  const abs = (absRows * 0.5 + absCols * 0.5) * absMask * absStrength;

  // 3. Skin Texture (Simplex FBM)
  const f = scale * 2.5;
  const swarp = warpIntensity * 0.5;
  const wx = noiseWarp.noise2(su * 2.5, sv * 2.5) * swarp;
  const wz = noiseWarp.noise2(su * 2.5 + 5, sv * 2.5 + 2) * swarp;
  const skin = (noiseFine.fbm((su + wx) * f * aspect, (sv + wz) * f, octaves, 2.0, roughness) + 1.0) * 0.5;

  // 4. Ribcage Sides (Striations)
  const ribFreq = 30.0;
  const ribWarp = noiseFine.noise2(su * 5.5, sv * 5.5) * 2.8;
  const ribMask = Math.max(0, (dy - 0.35) * 3.0) * (1.0 - pectoral);
  const ribs = Math.sin((dy - 0.1) * ribFreq + ribWarp) * ribStrength * ribMask;

  return (pectoral + deltoid + abs + neck + (skin * 0.3) - sternum + ribs + clavicle);
};
