/**
 * noise-modes.js — Modular strategy definitions for terrain noise types.
 * Each mode has the signature: (su, sv, aspect, params, noiseRefs)
 */

export const NoiseModes = {
  /**
   * Smooth Hills (Simplex)
   * Classic Perlin FBM with warp-displacement.
   */
  simplex: (su, sv, aspect, params, noiseRefs) => {
    const { scale, octaves, roughness, warpIntensity } = params;
    const { noiseFine, noiseWarp } = noiseRefs;

    const sFreq = scale * 2.5;
    const sfx = su * sFreq * aspect;
    const sfz = sv * sFreq;
    const swf = 0.45;
    const swarpAmt = Math.min(2.0, (0.45 + scale * 0.18) * (warpIntensity * 0.8));
    const swx = noiseWarp.noise2(sfx * swf + 3.17, sfz * swf + 7.43) * swarpAmt;
    const swz = noiseWarp.noise2(sfx * swf + 8.61, sfz * swf + 1.29) * swarpAmt;
    
    return (noiseFine.fbm(sfx + swx, sfz + swz, octaves, 2.0, roughness) + 1) * 0.5;
  },

  /**
   * Sculpted Armor (Ridged)
   * High-contrast ridges and flat plateaus.
   */
  sculptural: (su, sv, aspect, params, noiseRefs) => {
    const { scale, warpIntensity } = params;
    const { noiseFine, noiseWarp } = noiseRefs;

    const eFreq = scale * 0.55; // Slightly boosted for better slider range
    const efx = su * eFreq * aspect;
    const efz = sv * eFreq;
    const ewf = 0.4;
    const ewx = noiseWarp.fbm(efx * ewf, efz * ewf, 2) * (warpIntensity * 2.5);
    const ewz = noiseWarp.fbm(efx * ewf + 5.2, efz * ewf + 1.3, 2) * (warpIntensity * 2.5);
    
    const val = noiseFine.fractalRidge2(efx + ewx, efz + ewz, 6, 0.5, 2.1);
    return Math.pow(Math.max(0, val), 2.2);
  },

  /**
   * Fibrous Grain (Hetero)
   * Recalibrated density-varying eroded patches.
   */
  hetero: (su, sv, aspect, params, noiseRefs) => {
    const { scale, warpIntensity } = params;
    const { noiseFine, noiseWarp } = noiseRefs;

    const hFreq = scale * 4.6;
    const hfx = su * hFreq * aspect;
    const hfz = sv * hFreq;
    const hwf = 0.5;
    const hwx = noiseWarp.fbm(hfx * hwf, hfz * hwf, 2) * (warpIntensity * 2.5);
    const hwz = noiseWarp.fbm(hfx * hwf + 5.2, hfz * hwf + 1.3, 2) * (warpIntensity * 2.5);
    
    const val = noiseFine.heteroFractal2((hfx + hwx) * 0.8, hfz + hwz, 6, 0.5, 2.0);
    const detail = (val + 1) * 0.5;

    // Internal "Patches" (mimicking detail coverage = 0.5 by default)
    const pFreq = 2.4; 
    const pVal = (noiseRefs.noiseCoarse.noise2(su * pFreq * aspect, sv * pFreq) + 1.0) * 0.5;
    const patch = Math.max(0, Math.min(1, (pVal - 0.45) * 6.0)); // Sharp threshold
    
    // Smooth area floor (0.2) + Detail influence (0.8 * patch)
    const intensity = 0.2 + 0.8 * patch;
    return 0.5 + (detail - 0.5) * intensity;
  },

  /**
   * Basalt (Terraced)
   * Quantized strata with organic warping.
   */
  basalt: (su, sv, aspect, params, noiseRefs) => {
    const { scale, warpIntensity } = params;
    const { noiseFine, noiseWarp } = noiseRefs;

    const bFreq = scale * 2.2;
    const bfx = su * bFreq * aspect;
    const bfz = sv * bFreq;
    const bwf = 0.4;
    const bwx = noiseWarp.fbm(bfx * bwf, bfz * bwf, 2) * (warpIntensity * 3.5);
    const bwz = noiseWarp.fbm(bfx * bwf + 5.2, bfz * bwf + 1.3, 2) * (warpIntensity * 3.5);
    
    const raw = (noiseFine.fbm(bfx + bwx, bfz + bwz, 6, 2.0, 0.5) + 1) * 0.5;
    
    const steps = 14.0;
    const stepped = Math.floor(raw * steps) / steps;
    const delta = (raw * steps) - Math.floor(raw * steps);
    const smoothStep = (delta > 0.88) ? stepped + (delta - 0.88) / 0.12 * (1.0/steps) : stepped;
    
    return smoothStep;
  },

  /**
   * Lunar (Craters) 🌑🌋
   * High-fidelity impact architecture with central peaks, rim ejecta, and maria.
   */
  artifact: (su, sv, aspect, params, noiseRefs) => {
    const { scale, octaves, roughness } = params;
    const { noiseFine, noiseWarp, rawU, rawV } = noiseRefs;

    const f = scale * 2.5;
    const raw = (noiseFine.fbm(su * f * aspect, sv * f, octaves, 2.0, roughness) + 1.0) * 0.5;
    
    // 1. Plateau Effect (Flat mesas)
    const base = Math.pow(raw, 0.45); // Flattens the tops into plateaus

    // 2. Single Wide Structural Canyon (The "tiny bit" of etching)
    const cFreq = scale * 0.08;
    const cWarp = (noiseRefs.noiseWarp.fbm(su * 2.0, sv * 2.0, 2) + 1.0) * 0.05;
    const cVal = Math.abs(noiseFine.noise2(su * cFreq * aspect + cWarp, sv * cFreq * 10.0 + cWarp));
    const canyon = Math.pow(Math.max(0, 1.0 - cVal * 6.5), 2.5) * 0.18; // Wide and deep

    // Layer 3: Sparse, Shallow Craters (Flat-floor)
    const c1Freq = scale * 0.16;
    const dCrater = noiseFine.worleyNoise2(su * c1Freq * aspect, sv * c1Freq);
    const craters = Math.pow(Math.max(0, 1.0 - dCrater * 1.8), 3.0) * 0.05; // Depth 5%, sharper falloff

    return (base - canyon) - craters;
  },

  /**
   * Cracked (Cellular) 🧩🌋
   * Simulates dried mud or tectonic fissures using warped Voronoi.
   */
  cracked: (su, sv, aspect, params, noiseRefs) => {
    const { scale, warpIntensity } = params;
    const { noiseFine, noiseWarp } = noiseRefs;

    const cFreq = scale * 1.8;
    
    // Warp for "meandering" crack shapes
    const cwx = noiseWarp.fbm(su * 2.5, sv * 2.5, 3) * (warpIntensity * 2.5);
    const cwz = noiseWarp.fbm(su * 2.5 + 4, sv * 2.5 + 1.6, 3) * (warpIntensity * 2.5);
    
    const d = noiseFine.worleyNoise2(su * cFreq * aspect + cwx, sv * cFreq + cwz);
    
    // Contrast the distance to get sharp fissures
    const fissures = 1.0 - Math.pow(Math.min(1.0, d * 1.6), 0.15);
    
    // Add internal plateau texture (dried mud texture)
    const plateau = (noiseFine.fbm(su * cFreq * 4, sv * cFreq * 4, 3) + 1.0) * 0.5;
    
    return Math.max(fissures * 0.95, plateau * 0.35);
  },

  /**
   * Anatomical (Chest) 🧘‍♂️🧬
   * Symmetrical pectoral/sternum structural geometry with skeletal rib detail and skin FBM.
   */
  chest: (su, sv, aspect, params, noiseRefs) => {
    const { scale, octaves, roughness, warpIntensity } = params;
    const { noiseFine, noiseWarp } = noiseRefs;

    // 1. Structural Torso Geometry (Global gradients)
    const dx = Math.abs(su * 2 - 1); // Distance from central sternum line
    const dy = sv;
    
    // Smooth Gaussian sternum valley (Eliminates sharp creases)
    const sternum = (1.0 - Math.exp(-dx * dx * 16.0)) * 0.52; 
    
    // Organic pectoral mounding (Softened mass)
    const pectoral = Math.exp(-Math.pow(dx - 0.45, 2) * 20.0) * Math.exp(-Math.pow(dy - 0.45, 2) * 10.0) * 0.7;
    
    // Smooth Shoulders (Deltoids)
    const deltoid  = Math.exp(-Math.pow(dx - 0.9, 2) * 16.0) * Math.exp(-Math.pow(dy - 0.25, 2) * 14.0) * 0.45;

    // Organic Neck (Top center)
    const neck = Math.exp(-(dx * dx) * 40.0) * Math.max(0, 1.0 - dy * 7.0) * 0.35;

    // Soft V-Clavicle (Transition between shoulders/neck)
    const clavicle = Math.max(0, 1.0 - Math.abs(dy - (0.12 + dx * 0.1)) * 14.0) * Math.exp(-dx * 1.5) * 0.16;

    // 2. Abdominals (Six-pack)
    // Rolling muscle mounds instead of sharp grid
    const absMask = Math.max(0, (dy - 0.6) * 6.0);
    const absWz = noiseFine.noise2(su * 4.0, sv * 4.0) * 0.15;
    const absRows = Math.exp(-Math.pow(Math.sin((dy + absWz) * 14.0), 2.0) * 8.0);
    const absCols = Math.exp(-Math.pow((dx + absWz) - 0.45, 2) * 14.0); 
    const abs = (absRows * 0.5 + absCols * 0.5) * absMask * 0.25;
    
    // 3. Skin Texture (Simplex FBM)
    const f = scale * 2.5; 
    const swarp = warpIntensity * 0.5;
    const wx = noiseWarp.noise2(su * 2.5, sv * 2.5) * swarp;
    const wz = noiseWarp.noise2(su * 2.5 + 5, sv * 2.5 + 2) * swarp;
    const skin = (noiseFine.fbm((su + wx) * f * aspect, (sv + wz) * f, octaves, 2.0, roughness) + 1.0) * 0.5;

    // 4. Ribcage Sides (Striations)
    // Drastic warp to break up 'linear' mechanical banding artifacts.
    const ribFreq = 30.0;
    const ribWarp = noiseFine.noise2(su * 5.5, sv * 5.5) * 2.8;
    const ribMask = Math.max(0, (dy - 0.35) * 3.0) * (1.0 - pectoral);
    const ribs = Math.sin((dy - 0.1) * ribFreq + ribWarp) * 0.08 * ribMask;

    return (pectoral + deltoid + abs + neck + (skin * 0.3) - sternum + ribs + clavicle);
  },

  /**
   * Xeno (Biomechanical) 🛠️👽👾
   * Segmented central spine, overlapping chitinous plates, and neural vein details.
   */
  xeno: (su, sv, aspect, params, noiseRefs) => {
    const { scale, octaves, roughness, warpIntensity } = params;
    const { noiseFine, noiseWarp } = noiseRefs;

    const dx = Math.abs(su * 2 - 1);
    const dy = sv;

    // 0. Seed-derived structural modifiers (using noiseWarp at fixed points as seed proxies)
    const pFreq = 8.0 + noiseWarp.noise2(11.1, 11.1) * 4.0; 
    const cFreq = 20.0 + noiseWarp.noise2(22.2, 22.2) * 15.0;
    const rFreq = 28.0 + noiseWarp.noise2(33.3, 33.3) * 14.0;
    const pShift = noiseWarp.noise2(44.4, 44.4) * 6.28;

    // 1. Irregular Etched Rift (Variably-width canyon to avoid "two lines" effect)
    const sDrift = noiseWarp.noise2(su * 2, sv * 2) * 0.12 * warpIntensity;
    const dxWarped = Math.abs(su * 2 - 1 + sDrift);
    // Modulate width with noise so it's not a constant-width slot
    const spineWidth = 0.12 + 0.08 * noiseFine.noise2(su*5, sv*5);
    
    const craterBase = Math.sin(dy * cFreq + pShift + noiseFine.noise2(su*4, sv*4)*4.0);
    const craterOsc = Math.pow(Math.max(0, 0.5 + 0.5 * craterBase), 2.5);
    // Softer falloff (1.2 power) to avoid sharp vertical edges
    const spine = -Math.pow(Math.max(0, 1.0 - dxWarped / spineWidth), 1.2) * craterOsc * 0.6;

    // 2. Terraced Plateaus (Artifact Style - Breaking Mirrored Centrification)
    // Use SU (linear) instead of DX (mirrored) for the slant to avoid a 'centered fold' line
    const plateRaw = Math.sin((dy + su * 0.25) * pFreq + pShift + (noiseFine.noise2(su*3, sv*3)*0.5));
    const plateBlend = 0.5 + 0.5 * plateRaw;
    
    const tier1 = Math.min(1.0, Math.max(0, (plateBlend - 0.3) / 0.15)) * 0.5;
    const tier2 = Math.min(1.0, Math.max(0, (plateBlend - 0.6) / 0.15)) * 0.5;
    const plates = (tier1 + tier2) * 0.48;

    // 3. Geologic stratification 
    const strat = Math.sin(dy * 75.0 + noiseFine.noise2(su*3, sv*3)*10.0) * 0.04;
    const pitting = Math.pow(Math.max(0, noiseFine.noise2(su*65, sv*65)), 4.0) * 0.1;

    // Mask for detail layering
    const plateauMask = Math.pow(tier1 + tier2, 2.0); 
    const riftMask = 1.0 - plateauMask;

    // 4. Shattered Earth Detail (Break up the rift base)
    const tWarp = noiseWarp.noise2(su * 3, sv * 3) * 0.5 * warpIntensity;
    const vScale = 25.0 + scale * 5.0;
    const cracks = (noiseFine.fractalRidge2((su + tWarp) * vScale * aspect, (sv + tWarp) * vScale, 2) + 1.0) * 0.18 * riftMask;

    // 5. Angular Architecture
    const ribRhythm = Math.pow(Math.abs(Math.sin(dy * rFreq + dxWarped * 15.0)), 0.6);
    const ribs = ribRhythm * dxWarped * 0.12;

    return (plates + spine + cracks + ribs + (pitting + strat) * plateauMask);
  }
};

/**
 * Metadata for each noise type (multipliers, category, etc.)
 */
export const NoiseMetadata = {
  simplex:    { cMultiplier: 2.5 },
  sculptural: { cMultiplier: 1.5 },
  hetero:     { cMultiplier: 3.7 },
  basalt:     { cMultiplier: 3.7 },
  artifact:   { cMultiplier: 3.0 },
  chest:      { cMultiplier: 1.8 },
  xeno:       { cMultiplier: 2.3 },
  cracked:    { cMultiplier: 2.5 },
};
