/**
 * noise.js — Classic Perlin noise (2D/3D) + fractal Brownian motion
 * ES module, no dependencies.
 */

// Permutation table seeded via hash
function buildPerm(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Shuffle via simple LCG seeded hash
  let s = (seed ^ 0xDEADBEEF) >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

const GRAD3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
];

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }
function dot2(g, x, y) { return g[0] * x + g[1] * y; }

export class PerlinNoise {
  /**
   * @param {number} seed  — integer seed
   */
  constructor(seed = 0) {
    this._perm = buildPerm(seed | 0);
  }

  /**
   * 2D Perlin noise in range approximately [−1, 1].
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  noise2(x, y) {
    const p = this._perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = p[p[X]     + Y];
    const ab = p[p[X]     + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];

    const g = GRAD3;
    return lerp(
      lerp(dot2(g[aa & 11], xf,     yf    ), dot2(g[ba & 11], xf - 1, yf    ), u),
      lerp(dot2(g[ab & 11], xf,     yf - 1), dot2(g[bb & 11], xf - 1, yf - 1), u),
      v
    );
  }

  /**
   * Fractal Brownian Motion — sums `octaves` layers of noise.
   * @param {number} x
   * @param {number} y
   * @param {number} octaves     — number of octave layers (1–8)
   * @param {number} lacunarity  — frequency multiplier per octave (default 2.0)
   * @param {number} gain        — amplitude multiplier per octave (default 0.5)
   * @returns {number}  range approximately [−1, 1]
   */
  fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let val = 0, amp = 1, freq = 1, maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      val   += this.noise2(x * freq, y * freq) * amp;
      maxAmp += amp;
      amp  *= gain;
      freq *= lacunarity;
    }
    return val / maxAmp;  // normalize to ~[−1, 1]
  }

  /**
   * 2-pass "Organic" (Metaball) noise with a "Pit & Rim" profile.
   * Returns a signed sum where each point creates a central mound or pit
   * surrounded by a displaced rim, mimicking hand-sculpted clay.
   */
  blobNoise2(x, y) {
    const p = this._perm;
    const X = Math.floor(x);
    const Y = Math.floor(y);

    let total = 0.0;

    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const nX = (X + i) & 255;
        const nY = (Y + j) & 255;
        
        const hash = p[p[nX] + nY];
        const px = p[hash] / 255;
        const py = p[(hash + 1) & 511] / 255;

        const dx = (X + i + px) - x;
        const dy = (Y + j + py) - y;
        const d2 = dx * dx + dy * dy;

        // Displaced-Rim Profile: (1-r^2)^3 * (1 - k*r^2)
        // k=2.2 creates a broad central feature with a soft rim.
        if (d2 < 1.0) {
          const w = (1.0 - d2);
          const profile = (w * w * w) * (1.0 - 2.2 * d2);
          
          const sign = (hash & 0x1) ? 1.0 : -1.0;
          total += profile * sign;
        }
      }
    }

    return total * 1.25;
  }

  /**
   * 2D Ridged Multi-fractal noise.
   * Creates sharp ridges and broad plateaus (Elven armor style).
   */
  fractalRidge2(x, y, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      // 1.0 - abs(noise) creates the ridge
      let n = 1.0 - Math.abs(this.noise2(x * frequency, y * frequency));
      
      // Square it to sharpen the ridges
      n = n * n;
      
      total += n * amplitude;
      maxValue += amplitude;
      
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }

  /**
   * 2D Heterogeneous Multi-fractal noise.
   * Varies the detail density across the surface, creating "eroded" or "fibrous" 
   * patches. Signal strength modulates subsequent layers.
   */
  heteroFractal2(x, y, octaves = 6, persistence = 0.5, lacunarity = 2.0) {
    let frequency = 1.0;
    let amplitude = persistence;

    // First layer: base elevation
    let value = this.noise2(x, y) + 1.0; // range [0, 2]
    let signal = value;

    for (let i = 1; i < octaves; i++) {
      frequency *= lacunarity;
      // High-frequency detail is weighted by the existing signal strength
      // Areas with high signal get more detail, low signal stays smooth.
      let n = this.noise2(x * frequency, y * frequency) + 1.0;
      value += signal * n * amplitude;
      
      // Update signal for next layer
      signal *= n * 0.5;
      amplitude *= persistence;
    }

    // Rough normalization back towards [-1, 1]
    return (value / 2.0) - 1.0;
  }

  /**
   * 2D Worley (Cellular) Noise.
   * Returns the distance to the nearest feature point.
   */
  worleyNoise2(x, y) {
    const p = this._perm;
    const X = Math.floor(x);
    const Y = Math.floor(y);

    let minDist = 1.0;

    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const nX = (X + i) & 255;
        const nY = (Y + j) & 255;
        
        // Pseudo-random feature point in this cell
        const hash = p[p[nX] + nY];
        const fx = (X + i) + (p[hash] / 255.0);
        const fy = (Y + j) + (p[(hash + 1) & 511] / 255.0);

        const dx = fx - x;
        const dy = fy - y;
        const d2 = dx * dx + dy * dy;
        
        if (d2 < minDist) minDist = d2;
      }
    }

    return Math.sqrt(minDist);
  }
}
