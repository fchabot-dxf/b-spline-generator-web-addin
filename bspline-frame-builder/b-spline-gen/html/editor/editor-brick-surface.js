/**
 * editor/editor-brick-surface.js — F35 item 5: the adapter's own canvas/image
 * half of core/bricks/'s declared "real photo surface" plan. height-profile.js's
 * own header is explicit that this is the adapter's job: core/bricks/ stays
 * zero-canvas/zero-DOM, and takes an OPTIONAL `sampleDetailAt(x,y,brick)`
 * callback returning a de-lit, normalised [-1,1] value. Two consumers share the
 * same loaded-image cache here:
 *   - sampleDetailAtFor(setId): feeds engine.js's sampleHeight (see
 *     editor-brick-height-mask.js), the terrain HEIGHT side.
 *   - brickFillPaint(...): an SVG <pattern> paint for drawBrick's own 2D fill,
 *     the visible COLOUR side.
 * Both map a brick's own declared sampleId/flip (already on every brick
 * core/bricks/ generates -- nothing new there) into the brick's own LOCAL
 * frame and CENTRE-CROP the sample to the set's nominal brickLengthIn:
 * brickHeightIn aspect, per the dispatch's own "never stretched -- centre-crop
 * to the piece aspect".
 */
import { brickSetById } from '../core/bricks/index.js';

const IMAGE_CACHE = new Map(); // url -> Promise<HTMLImageElement>
const DETAIL_PROMISE_CACHE = new Map(); // `${setId}:${sampleId}` -> Promise
const DETAIL_RESOLVED = new Map(); // `${setId}:${sampleId}` -> {w,h,data:Float32Array} | null
const PATTERN_IDS = new Map(); // `${setId}:${sampleId}:${flip}` -> pattern element id

const DETAIL_GRID = 48; // working resolution for the de-lit detail field -- a subtle surface
// bump needs far less resolution than the sample photo's own native size.

function loadImageElement(url) {
  if (!IMAGE_CACHE.has(url)) {
    IMAGE_CACHE.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`brick sample failed to load: ${url}`));
      img.src = url;
    }));
  }
  return IMAGE_CACHE.get(url);
}

/** Separable box blur, edge-clamped -- the same technique core/photo/ops.js's
 *  own blurOp uses, written fresh here rather than imported: that file's own
 *  array/stride contract is tied to the Photo filter's own greyscale buffer
 *  shape, and importing it would couple two independent features for ~10
 *  lines with no real sharing. */
function boxBlur(src, w, h, radius) {
  if (radius < 1) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += src[y * w + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (radius * 2 + 1);
      const addX = Math.max(0, Math.min(w - 1, x + radius + 1));
      const subX = Math.max(0, Math.min(w - 1, x - radius));
      acc += src[y * w + addX] - src[y * w + subX];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (radius * 2 + 1);
      const addY = Math.max(0, Math.min(h - 1, y + radius + 1));
      const subY = Math.max(0, Math.min(h - 1, y - radius));
      acc += tmp[addY * w + x] - tmp[subY * w + x];
    }
  }
  return out;
}

/** The grey (Rec. 601 luma, 0..1) of an RGBA image's crop (sx, sy, sw, sh) averaged down to a `grid` x `grid` field:
 *  each cell is the plain mean of the source pixels whose CENTRES fall inside it (at least the nearest one). Pure
 *  arithmetic on the decoded pixels -- the same field on every browser, backend and page load (item 37). */
export function areaAverageGrey(rgba, iw, sx, sy, sw, sh, grid) {
  const out = new Float32Array(grid * grid);
  const span = (lo, len, i, max) => {
    const a = lo + (i * len) / grid, b = lo + ((i + 1) * len) / grid;
    const p0 = Math.max(0, Math.ceil(a - 0.5)), p1 = Math.min(max - 1, Math.ceil(b - 0.5) - 1);
    if (p1 >= p0) return [p0, p1];
    const c = Math.max(0, Math.min(max - 1, Math.floor((a + b) / 2)));
    return [c, c];
  };
  const ih = Math.floor(rgba.length / 4 / iw);
  for (let gy = 0; gy < grid; gy++) {
    const [y0, y1] = span(sy, sh, gy, ih);
    for (let gx = 0; gx < grid; gx++) {
      const [x0, x1] = span(sx, sw, gx, iw);
      let acc = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const o = (y * iw + x) * 4;
          acc += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
        }
      }
      out[gy * grid + gx] = acc / ((y1 - y0 + 1) * (x1 - x0 + 1)) / 255;
    }
  }
  return out;
}

/** Decodes `url` onto a canvas CENTRE-CROPPED to `targetAspect` (w/h), then
 *  returns a de-lit (high-pass: grey minus a heavy blur of itself), [-1,1]-
 *  normalised detail field at DETAIL_GRID x DETAIL_GRID. */
async function computeDetailGrid(url, targetAspect) {
  const img = await loadImageElement(url);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const imgAspect = iw / ih;
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (imgAspect > targetAspect) { sw = ih * targetAspect; sx = (iw - sw) / 2; }
  else if (imgAspect < targetAspect) { sh = iw / targetAspect; sy = (ih - sh) / 2; }

  // Item 37 (seat E, measured): the photo is drawn 1:1 on a CPU canvas and downsampled HERE (areaAverageGrey), never
  // by drawImage's own scaler -- that one differs by canvas backend (GPU vs software: all 47 grids moved) and even from
  // page load to page load (7 of 47 moved under load, and stayed moved), so a reload carved a different 3D.
  const canvas = document.createElement('canvas');
  canvas.width = iw; canvas.height = ih;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data: rgba } = ctx.getImageData(0, 0, iw, ih);
  const grey = areaAverageGrey(rgba, iw, sx, sy, sw, sh, DETAIL_GRID);
  const heavyBlur = boxBlur(grey, DETAIL_GRID, DETAIL_GRID, Math.round(DETAIL_GRID / 4));
  let highPass = new Float32Array(grey.length);
  for (let k = 0; k < grey.length; k++) highPass[k] = grey[k] - heavyBlur[k];
  // F35 item 5 review (advisor): a LIGHT blur on the high-pass signal itself (not the de-lighting
  // blur above) -- the raw per-pixel detail read as fine, sharp spikes competing with the brick's
  // own shoulder/crown/grout shape instead of a soft surface grain riding on top of it. Softens
  // single-cell noise without erasing the sample's own larger texture features.
  highPass = boxBlur(highPass, DETAIL_GRID, DETAIL_GRID, 1);
  let sumSq = 0;
  for (let k = 0; k < highPass.length; k++) sumSq += highPass[k] * highPass[k];
  // RMS-based scale (2.5 sigma -> +-1), not raw max-abs: a single stray bright
  // JPEG pixel setting the whole scale made typical texture read as sharp,
  // aliased spikes rather than the photo's own soft grain (MEASURED live,
  // shots/seatC/f35item5_01_red_3d_closeup.png) -- brickTopHeight's own
  // Math.max(-1,Math.min(1,...)) clamp still catches genuine outliers.
  const rms = Math.sqrt(sumSq / highPass.length) || 1e-6;
  const scale = rms * 2.5;
  const data = new Float32Array(grey.length);
  for (let k = 0; k < grey.length; k++) data[k] = Math.max(-1, Math.min(1, highPass[k] / scale));
  return { w: DETAIL_GRID, h: DETAIL_GRID, data };
}

function detailCacheKey(setId, sampleId) { return `${setId}:${sampleId}`; }

/** Preloads + caches every sample's detail grid for one set (idempotent,
 *  memoised across calls) -- awaited once before a terrain height-mask build
 *  so the synchronous sampleDetailAt callback engine.js calls per grid point
 *  never blocks on image decode. A set with no samples (no real photos, e.g.
 *  the parked 'mc' engine) resolves immediately to nothing. */
export function preloadSetDetail(setId) {
  const set = brickSetById(setId);
  if (!set || !set.samples || !set.samples.length) return Promise.resolve();
  const targetAspect = (set.brickLengthIn || 1) / (set.brickHeightIn || 1);
  const jobs = set.samples.map((s) => {
    const key = detailCacheKey(setId, s.id);
    if (!DETAIL_PROMISE_CACHE.has(key)) {
      const p = computeDetailGrid(s.image, targetAspect)
        .then((g) => { DETAIL_RESOLVED.set(key, g); return g; })
        .catch(() => { DETAIL_RESOLVED.set(key, null); return null; });
      DETAIL_PROMISE_CACHE.set(key, p);
    }
    return DETAIL_PROMISE_CACHE.get(key);
  });
  return Promise.all(jobs);
}

/** A point's own LOCAL (u,v) in [0,1]^2 within `polygon` -- origin at the
 *  polygon's own centroid, u-axis along its own LONGEST edge (the brick's
 *  length axis whatever its rotation -- works for a mitred triangle/pentagon
 *  too, not just a plain axis-aligned rect), half-extents from the polygon's
 *  own real vertices (a cut/mitred piece gets a correspondingly smaller
 *  window, not a fixed full-brick one -- never stretched). `flip` mirrors u,
 *  core/bricks' own declared per-brick flip. */
export function brickLocalUV(polygon, x, y, flip) {
  const n = polygon.length;
  let cx = 0, cy = 0;
  for (const p of polygon) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  let bestLen = -1, ux = 1, uy = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i], b = polygon[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > bestLen) { bestLen = len; ux = dx / len; uy = dy / len; }
  }
  const vx = -uy, vy = ux;

  let halfU = 1e-6, halfV = 1e-6;
  for (const p of polygon) {
    const dx = p.x - cx, dy = p.y - cy;
    halfU = Math.max(halfU, Math.abs(dx * ux + dy * uy));
    halfV = Math.max(halfV, Math.abs(dx * vx + dy * vy));
  }

  const dx = x - cx, dy = y - cy;
  let u = ((dx * ux + dy * uy) / halfU + 1) / 2;
  const v = ((dx * vx + dy * vy) / halfV + 1) / 2;
  if (flip) u = 1 - u;
  return { u: Math.max(0, Math.min(1, u)), v: Math.max(0, Math.min(1, v)) };
}

/** Bilinear sample -- the terrain's own mesh spacing (auto-tightened to the
 *  grout width, F35 item 1) can land close to DETAIL_GRID's own per-cell
 *  size, where a nearest-neighbour lookup read as sharp, aliased ridges
 *  instead of the de-lit photo's own soft texture (MEASURED live:
 *  shots/seatC/f35item5_01_red_3d_closeup.png before this fix). */
function sampleGrid(grid, u, v) {
  const fx = u * (grid.w - 1), fy = v * (grid.h - 1);
  const x0 = Math.max(0, Math.min(grid.w - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(grid.h - 1, Math.floor(fy)));
  const x1 = Math.min(grid.w - 1, x0 + 1), y1 = Math.min(grid.h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const v00 = grid.data[y0 * grid.w + x0], v10 = grid.data[y0 * grid.w + x1];
  const v01 = grid.data[y1 * grid.w + x0], v11 = grid.data[y1 * grid.w + x1];
  const top = v00 + (v10 - v00) * tx, bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

/** The adapter-supplied `sampleDetailAt(x,y,brick)` callback height-profile.js
 *  declares -- bound to one set so engine.js's per-grid-point calls never
 *  re-resolve the set each time. Reads ONLY the already-preloaded cache
 *  (preloadSetDetail must be awaited first); a brick with no sampleId (no
 *  real sample, e.g. the parked 'mc' engine) or a still-uncached sample is a
 *  neutral 0 (no bump either way), never a thrown error -- this runs inside a
 *  tight per-grid-point loop. */
export function sampleDetailAtFor(setId) {
  return (x, y, brick) => {
    if (!brick || !brick.sampleId) return 0;
    const grid = DETAIL_RESOLVED.get(detailCacheKey(setId, brick.sampleId));
    if (!grid) return 0;
    const { u, v } = brickLocalUV(brick.polygon, x, y, brick.flip);
    return sampleGrid(grid, u, v);
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
let patternCounter = 0;

/** Ensures a shared <pattern> exists in the sketch SVG's own <defs> and
 *  returns its paint-url string, or null when there's no real sample to show
 *  (caller falls back to the existing flat SET_COLORS fill). `patternUnits=
 *  "objectBoundingBox"` means ONE pattern per (set,sample,flip) serves every
 *  brick using it regardless of that brick's own size; `preserveAspectRatio=
 *  "xMidYMid slice"` on the nested <image> gives "centre-crop, never
 *  stretched" for free from the SVG spec -- no manual crop maths needed for
 *  the visible fill (unlike the height-detail grid above, which computes its
 *  own crop since it isn't SVG-rendered). */
//
// T86 item 16(b) (reopened: "the wall drops bricks at 1.25 in+"): the pattern tile is the brick's bounding box
// (patternUnits objectBoundingBox) but the <image> inside it is sized in the CONTENT units, which default to user
// space -- inches. A 1x1 image is a 1-inch square: it covers a 3/4 in brick, but a 1.5 x 0.4 in brick only for
// its first inch, and the board shows through the rest. MEASURED with every laid polygon drawn over the editor
// shot (T1, 1.5 in, single soldier): every grey patch lies INSIDE a wall or frame polygon. So the image square
// is `span` inches, the brick's longest side rounded UP to a quarter inch, never under 1 -- every brick up to
// 1 in keeps exactly today's pattern (id and look); larger bricks get their own, big enough to cover them.
function paintSpanIn(sizeIn) {
  return Math.max(1, Math.ceil((Number(sizeIn) || 0) * 4 - 1e-9) / 4);
}

export function brickFillPaint(editor, setId, sampleId, flip, sizeIn = 1) {
  const set = brickSetById(setId);
  const sample = set && set.samples && set.samples.find((s) => s.id === sampleId);
  if (!sample || typeof document === 'undefined') return null;

  const span = paintSpanIn(sizeIn);
  const key = span === 1 ? `${setId}:${sampleId}:${flip ? 1 : 0}` : `${setId}:${sampleId}:${flip ? 1 : 0}:${span}`;
  const svgRoot = editor._sketchLayer.node.ownerSVGElement || editor._sketchLayer.node.closest('svg');
  if (!svgRoot) return null;

  const existingId = PATTERN_IDS.get(key);
  if (existingId && svgRoot.querySelector(`#${existingId}`)) return `url(#${existingId})`;

  const id = `brickfill-${key.replace(/[^a-zA-Z0-9]/g, '_')}-${patternCounter++}`;
  let defs = svgRoot.querySelector('defs[data-brick-defs]');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    defs.setAttribute('data-brick-defs', '1');
    svgRoot.insertBefore(defs, svgRoot.firstChild);
  }
  const pattern = document.createElementNS(SVG_NS, 'pattern');
  pattern.setAttribute('id', id);
  pattern.setAttribute('patternUnits', 'objectBoundingBox');
  pattern.setAttribute('width', '1');
  pattern.setAttribute('height', '1');
  const image = document.createElementNS(SVG_NS, 'image');
  image.setAttribute('width', String(span));
  image.setAttribute('height', String(span));
  image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  image.setAttributeNS(XLINK_NS, 'href', sample.image);
  image.setAttribute('href', sample.image);
  if (flip) image.setAttribute('transform', `translate(${span},0) scale(-1,1)`);
  pattern.appendChild(image);
  defs.appendChild(pattern);
  PATTERN_IDS.set(key, id);
  return `url(#${id})`;
}
