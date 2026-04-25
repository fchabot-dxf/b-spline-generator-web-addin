/**
 * Xeno (Biomechanical) 🛠️👽👾
 * Giger-flavored: articulated vertebral spine, curved bowed ribs,
 * overlapping chitinous carapace scales, and warped neural conduits.
 *
 * Composition (centerline → flanks):
 *   1. Vertebrae      — periodic raised lobes with cleft notches on the
 *                       spine column. THE biomechanical signature.
 *   2. Bowed ribs     — curved tube ridges that arc downward as they
 *                       move outward from the spine (ribcage geometry,
 *                       not horizontal slats).
 *   3. Carapace scales — directionally-stretched Worley cells with
 *                       beveled edges → overlapping armor plates.
 *   4. Neural conduits — domain-warped fractal ridges → long organic
 *                       tubes running diagonally across the surface.
 *   5. Carapace pitting — fine sparse pits, edge-recessive (negative).
 */
export const id = 'xeno';
export const label = 'Biomechanical';
export const cMultiplier = 2.3;

export const tweaks = [
  { key: 'spineStrength',   label: 'Spine Strength',   default: 0.55, min: 0.00, max: 1.00, step: 0.05, desc: 'Vertebral lobe height' },
  { key: 'plateStrength',   label: 'Plate Strength',   default: 0.32, min: 0.00, max: 0.60, step: 0.02, desc: 'Carapace scale lift' },
  { key: 'conduitStrength', label: 'Conduit Strength', default: 0.20, min: 0.00, max: 0.40, step: 0.02, desc: 'Neural-tube vein height' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const spineStrength   = t.spineStrength   ?? 0.55;
  const plateStrength   = t.plateStrength   ?? 0.32;
  const conduitStrength = t.conduitStrength ?? 0.20;

  // Mirrored coords (dx) for symmetric anatomy; a small organic warp
  // breaks dead-center symmetry so the spine doesn't read as a CAD axis.
  const wxAnat = noiseWarp.noise2(su * 3, sv * 3) * 0.05 * warpIntensity;
  const wyAnat = noiseWarp.noise2(su * 3 + 5, sv * 3 + 1) * 0.05 * warpIntensity;
  const dxW = Math.abs((su + wxAnat) * 2 - 1);
  const dyW = sv + wyAnat;

  // Seed-derived structural variation (consistent across the surface,
  // varies between seeds via noiseWarp's offset).
  const vertCount = 13.0 + noiseWarp.noise2(7.7, 7.7) * 4.0;   // 9–17 vertebrae
  const ribCount  = 17.0 + noiseWarp.noise2(11.1, 11.1) * 4.0;

  // ── 1. SEGMENTED VERTEBRAL SPINE ────────────────────────────────────
  const segPhase = dyW * vertCount + noiseFine.noise2(0.5, dyW * 5) * 0.25;
  const vertLobe = Math.pow(Math.max(0, Math.cos(segPhase * Math.PI)), 1.4);
  const cleftCut = Math.pow(Math.abs(Math.sin(segPhase * Math.PI)), 12.0) * 0.18;
  const spineMask = Math.exp(-dxW * dxW * 28.0);
  const spine = (vertLobe * spineStrength - cleftCut) * spineMask;

  // ── 2. BOWED RIBS (curved tubes radiating from spine) ──────────────
  const ribCurve = dxW * dxW * 2.2;
  const ribPhase = (dyW + ribCurve) * ribCount + noiseFine.noise2(su * 3, sv * 3) * 0.4;
  const ribProf  = Math.pow(Math.abs(Math.sin(ribPhase)), 5.0);
  const ribBand  = Math.max(0, dxW - 0.10) * Math.max(0, 0.85 - dxW);
  const ribs     = ribProf * ribBand * 0.45;

  // ── 3. CARAPACE SCALES (overlapping chitinous plates) ──────────────
  const plateScale = 5.5 + scale * 0.4;
  const plateU = (su + wxAnat * 0.5) * plateScale * aspect * 1.6;
  const plateV = (sv + wyAnat * 0.5) * plateScale;
  const plateD = noiseFine.worleyNoise2(plateU, plateV);
  const plateLift = Math.pow(Math.max(0, plateD), 0.4);
  const plateMask = Math.max(0, dxW - 0.16);
  const plates = plateLift * plateMask * plateStrength;

  // ── 4. NEURAL CONDUITS (warped tube veins) ─────────────────────────
  const condFreq = scale * 1.3;
  const cwx = noiseWarp.fbm(su * 1.6, sv * 1.6, 3) * 1.8 * warpIntensity;
  const cwy = noiseWarp.fbm(su * 1.6 + 4, sv * 1.6 + 7, 3) * 1.8 * warpIntensity;
  const condRaw = noiseFine.fractalRidge2(
    (su + cwx) * condFreq * aspect,
    (sv + cwy) * condFreq * 0.65,
    3
  );
  const conduits = Math.pow(Math.max(0, condRaw), 2.6) * conduitStrength;

  // ── 5. CARAPACE PITTING (fine pore texture, negative) ──────────────
  const pitN = noiseFine.noise2(su * 55, sv * 55);
  const pitting = -Math.pow(Math.max(0, pitN), 5.0) * 0.10 * plateMask;

  return spine + ribs + plates + conduits + pitting;
};
