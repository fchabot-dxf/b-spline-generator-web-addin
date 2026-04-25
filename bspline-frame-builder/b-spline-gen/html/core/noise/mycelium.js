/**
 * Mycelium (Fungal Web) 🍄🕸️
 * Branching network of raised tendrils across a substrate, with rare
 * fruiting-body nodules at intersections. Reads as natural growth
 * sprawling over a surface — opposite of `cracked` (which sinks
 * boundaries into the surface).
 *
 * Composition:
 *   1. Substrate      — gentle FBM bumpiness (the host surface).
 *   2. Main tendrils  — fractal-ridge branches, narrow and raised.
 *   3. Fine branches  — second-frequency ridges fork off the main net.
 *   4. Fruiting nodes — sparse Worley-driven bumps, masked to appear
 *                       only where main tendrils exist.
 */
export const id = 'mycelium';
export const label = 'Mycelial Web';
export const cMultiplier = 2.4;

export const tweaks = [
  { key: 'tendrilStrength', label: 'Tendril Strength', default: 0.45, min: 0.00, max: 1.00, step: 0.05, desc: 'Main branch raised height' },
  { key: 'branchStrength',  label: 'Branch Strength',  default: 0.20, min: 0.00, max: 0.60, step: 0.02, desc: 'Fine secondary branches' },
  { key: 'nodeStrength',    label: 'Node Strength',    default: 0.10, min: 0.00, max: 0.40, step: 0.02, desc: 'Fruiting-body bump amplitude' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const tendrilStrength = t.tendrilStrength ?? 0.45;
  const branchStrength  = t.branchStrength  ?? 0.20;
  const nodeStrength    = t.nodeStrength    ?? 0.10;

  // Domain warp for organic curvature (no straight branches)
  const wx = noiseWarp.fbm(su * 1.4, sv * 1.4, 3) * (warpIntensity * 1.2);
  const wy = noiseWarp.fbm(su * 1.4 + 3, sv * 1.4 + 8, 3) * (warpIntensity * 1.2);

  // ── 1. SUBSTRATE ───────────────────────────────────────────────────
  const sub = (noiseFine.fbm(su * scale * 0.7 * aspect, sv * scale * 0.7, 3, 2.0, 0.5) + 1) * 0.5 * 0.14;

  // ── 2. MAIN TENDRILS ───────────────────────────────────────────────
  const mainF = scale * 2.2;
  const mainRaw = noiseFine.fractalRidge2((su + wx) * mainF * aspect, (sv + wy) * mainF, 4);
  const mainMask = Math.max(0, mainRaw);
  const mainCore = Math.pow(Math.max(0, mainRaw - 0.40), 2.5);

  // ── 3. FINE BRANCHES ───────────────────────────────────────────────
  const secF = scale * 4.5;
  const secRaw = noiseFine.fractalRidge2((su + wx * 0.5) * secF * aspect + 7.7, (sv + wy * 0.5) * secF + 1.3, 3);
  const secCore = Math.pow(Math.max(0, secRaw - 0.35), 2.5);

  // ── 4. FRUITING NODES ──────────────────────────────────────────────
  const nodeF = scale * 3.2;
  const nodeD = noiseFine.worleyNoise2(su * nodeF * aspect + 2.2, sv * nodeF + 5.5);
  const nodeBumps = Math.pow(Math.max(0, 0.10 - nodeD), 1.4) * 1.5 * Math.min(1, mainMask);

  return sub + mainCore * tendrilStrength + secCore * branchStrength + nodeBumps * nodeStrength;
};
