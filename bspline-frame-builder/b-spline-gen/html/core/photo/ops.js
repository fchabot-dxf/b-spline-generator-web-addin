/**
 * photo/ops.js — F34 item 1: the Photo filter's own edit steps, DECLARED as
 * data (an ordered list of {op, params}) and applied by ONE pure function,
 * per the dispatch's own ask ("so it's testable and undo-able").
 *
 * Every op takes and returns the SAME plain shape: { data: Float32Array,
 * w, h }, a single-channel greyscale image, values 0..1 (0 = black/low,
 * 1 = white/high — "light = high" is applied by the Photo filter itself,
 * core/noise/photo.js, not here; these ops are generic image edits, not
 * terrain-specific). No canvas, no DOM — pure array math, so every op is
 * directly unit-testable on a tiny synthetic image (tests/photo-ops.test.js)
 * without the real <canvas> this repo's own test environment (happy-dom)
 * cannot execute (see tests/decal-png.test.js's own documented finding).
 *
 * Undo = pop the last step off the declared list and re-run
 * applyPhotoEdits(baseImage, steps) from the (unedited) base image — there
 * is no other state to roll back, by construction.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

function cropOp(img, { x = 0, y = 0, w = 1, h = 1 } = {}) {
  const { data, w: W, h: H } = img;
  const x0 = clampInt(clamp01(x) * W, 0, W - 1);
  const y0 = clampInt(clamp01(y) * H, 0, H - 1);
  const x1 = clampInt(x0 + Math.max(1, clamp01(w) * W), x0 + 1, W);
  const y1 = clampInt(y0 + Math.max(1, clamp01(h) * H), y0 + 1, H);
  const outW = x1 - x0, outH = y1 - y0;
  const out = new Float32Array(outW * outH);
  for (let j = 0; j < outH; j++) {
    for (let i = 0; i < outW; i++) out[j * outW + i] = data[(y0 + j) * W + (x0 + i)];
  }
  return { data: out, w: outW, h: outH };
}

// dir: 1 = clockwise, -1 = counter-clockwise. Output dims are swapped (W,H) -> (H,W),
// same convention any image editor's "rotate 90" button uses.
function rotate90Op(img, { dir = 1 } = {}) {
  const { data, w: W, h: H } = img;
  const out = new Float32Array(W * H);
  const cw = dir >= 0;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const v = data[j * W + i];
      const newI = cw ? (H - 1 - j) : j;
      const newJ = cw ? i : (W - 1 - i);
      out[newJ * H + newI] = v; // output width == H
    }
  }
  return { data: out, w: H, h: W };
}

// Bilinear sample at a continuous (x, y), or `fill` outside the image's own
// bounds -- shared by straightenOp below.
function bilinearSample(data, W, H, x, y, fill) {
  if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return fill;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const v00 = data[y0 * W + x0], v10 = data[y0 * W + x1];
  const v01 = data[y1 * W + x0], v11 = data[y1 * W + x1];
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

// A free-angle rotate (Fred/advisor: "straightening a photo is part of the
// prepare step" -- rotate90 alone can't line up a diagonal subject, e.g. a
// curved brick edging shot at an angle). `degrees`: positive = clockwise,
// same sense as rotate90's own dir:1 (confirmed by
// tests/photo-ops.test.js's own "approximates rotate90 at exactly 90deg"
// check, not just derived and trusted). Canvas EXPANDS to fit the fully
// rotated source (nothing is clipped) -- the declared edit ORDER is
// straighten, then crop, so the straighten step is never responsible for
// framing, only for levelling the subject; corners the rotated source
// doesn't cover fill with a neutral 0.5 (mid-grey), on the assumption the
// very next crop step removes them anyway. Bilinear, not bicubic -- simpler
// and sufficient for a height-source prepare step, not a photographic export.
function straightenOp(img, { degrees = 0 } = {}) {
  if (!degrees) return img;
  const { data, w: W, h: H } = img;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const outW = Math.max(1, Math.round(Math.abs(W * cos) + Math.abs(H * sin)));
  const outH = Math.max(1, Math.round(Math.abs(W * sin) + Math.abs(H * cos)));
  const out = new Float32Array(outW * outH).fill(0.5);
  const cx0 = W / 2, cy0 = H / 2;
  const cx1 = outW / 2, cy1 = outH / 2;
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const dx = ox - cx1, dy = oy - cy1;
      // Inverse of the forward clockwise-by-`degrees` rotation (dest -> source).
      const sx = dx * cos + dy * sin + cx0;
      const sy = -dx * sin + dy * cos + cy0;
      out[oy * outW + ox] = bilinearSample(data, W, H, sx, sy, 0.5);
    }
  }
  return { data: out, w: outW, h: outH };
}

function flipOp(img, { axis = 'h' } = {}) {
  const { data, w: W, h: H } = img;
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const si = axis === 'h' ? (W - 1 - i) : i;
      const sj = axis === 'v' ? (H - 1 - j) : j;
      out[j * W + i] = data[sj * W + si];
    }
  }
  return { data: out, w: W, h: H };
}

// Standard Levels: normalize [black, white] to [0,1], then a gamma curve
// anchored at `mid` (the usual Photoshop-style midtone slider: 1 = no
// change, <1 brightens midtones, >1 darkens them).
function levelsOp(img, { black = 0, white = 1, mid = 1 } = {}) {
  const { data, w, h } = img;
  const range = Math.max(1e-6, white - black);
  const gamma = Math.max(0.01, mid);
  const out = new Float32Array(data.length);
  for (let k = 0; k < data.length; k++) {
    out[k] = Math.pow(clamp01((data[k] - black) / range), 1 / gamma);
  }
  return { data: out, w, h };
}

// Linear brightness/contrast, both roughly -1..1: contrast scales deviation
// from mid-grey, brightness shifts the result afterward.
function brightnessContrastOp(img, { brightness = 0, contrast = 0 } = {}) {
  const { data, w, h } = img;
  const factor = Math.max(0, 1 + contrast);
  const out = new Float32Array(data.length);
  for (let k = 0; k < data.length; k++) {
    out[k] = clamp01((data[k] - 0.5) * factor + 0.5 + brightness);
  }
  return { data: out, w, h };
}

// Separable box blur ("light blur / smooth" per the dispatch), edge-clamped
// so the image doesn't darken/lighten at its own border. radius in pixels.
function blurOp(img, { radius = 1 } = {}) {
  const r = clampInt(radius, 0, 64);
  if (r === 0) return img;
  const { data, w: W, h: H } = img;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const span = 2 * r + 1;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += data[j * W + clampInt(i + k, 0, W - 1)];
      tmp[j * W + i] = sum / span;
    }
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[clampInt(j + k, 0, H - 1) * W + i];
      out[j * W + i] = sum / span;
    }
  }
  return { data: out, w: W, h: H };
}

function invertOp(img) {
  const { data, w, h } = img;
  const out = new Float32Array(data.length);
  for (let k = 0; k < data.length; k++) out[k] = 1 - data[k];
  return { data: out, w, h };
}

const OPS = {
  crop: cropOp,
  rotate90: rotate90Op,
  straighten: straightenOp,
  flip: flipOp,
  levels: levelsOp,
  brightnessContrast: brightnessContrastOp,
  blur: blurOp,
  invert: invertOp,
};

/** One declared edit step's own default params — the UI seeds a step with
 * these the first time an adjustable op (levels/brightnessContrast/blur) is
 * touched, and OPS_ORDER documents every supported op id in one place. */
export const OP_DEFAULTS = {
  crop: { x: 0, y: 0, w: 1, h: 1 },
  rotate90: { dir: 1 },
  straighten: { degrees: 0 },
  flip: { axis: 'h' },
  levels: { black: 0, white: 1, mid: 1 },
  brightnessContrast: { brightness: 0, contrast: 0 },
  blur: { radius: 1 },
  invert: {},
};

/** Apply a declared, ordered list of {op, params} steps to a base image, in
 * one pure pass. Unknown op ids are a no-op (forward-compat with a future
 * retired op name in an old saved project), not a throw. */
export function applyPhotoEdits(baseImage, steps) {
  let img = baseImage;
  for (const step of steps || []) {
    const apply = OPS[step && step.op];
    if (apply) img = apply(img, step.params || {});
  }
  return img;
}
