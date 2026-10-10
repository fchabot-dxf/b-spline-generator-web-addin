// MOCKUP (not shipped): "Coursed ashlar" wall layout, seeded, rendered to PNG via headless Chrome.
// Reuses the engine's own rng.js (hashedRandom) and geometry.js (clip / intersection / area / rounding).
// Coordinates: inches, y DOWN (top course first), same as the layouts' own SVG previews.
//
// Usage: node tools/repro/ashlar_mock/ashlar.mjs <outDir>
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(HERE, '../../../bspline-frame-builder/b-spline-gen/html');
const imp = (p) => import(pathToFileURL(path.join(HTML, p)).href);
const { hashedRandom } = await imp('core/bricks/rng.js');
const { clipPolygonToBoard, polygonIntersection, signedArea, roundPolygonCorners, inwardSignFor } = await imp('core/bricks/geometry.js');
const { MIN_PIECE_FRACTION } = await imp('core/bricks/library.js');

// ---------------------------------------------------------------- declared variants (all lengths x H unless "In")
export const ASHLAR_VARIANTS = Object.freeze({
  A_regular: { mode: 'courses', heights: { sizes: [0.8, 1.0, 1.3], weights: [1, 2, 1] }, lengths: [1.5, 3.0], minOverlap: 0.4 },
  B_random: { mode: 'courses', heights: { range: [0.7, 1.6] }, lengths: [1.0, 3.5], minOverlap: 0.4 },
  C_window: {
    mode: 'courses', heights: { sizes: [0.8, 1.0, 1.3], weights: [1, 2, 1] }, lengths: [1.5, 3.0], minOverlap: 0.4,
    opening: { x0In: 2.6, x1In: 4.4, fromCourse: 2, toCourse: 5 }, // the window spans these courses (whole courses)
    jamb: { long: 1.6, short: 0.9 }, // alternating, long first, both sides in phase
    minEnd: 0.8, // a gap beside a fixed block narrower than this (x H) is not laid: the fixed block grows over it
    lintel: { bearing: 0.6 }, sill: { bearing: 0.4 }, // one block over / under the opening, overhanging each side
  },
  D_broken: {
    mode: 'bands', lengths: [1.0, 2.5], minOverlap: 0.4,
    // a band is either one tall block or a stack of short courses; tall = the band's full height (stack + its joint)
    bands: [
      { stacks: [[1, 1]], weight: 2 }, // tall 2h+J  beside  h over h
      { stacks: [[1, 1.5], [1.5, 1]], weight: 1 }, // tall 2.5h+J  beside  h over 1.5h (or 1.5h over h)
    ],
    tallRate: 0.4, tallLengths: [1.0, 2.0], zoneLengths: [2.0, 5.0],
  },
  E_rough: {
    mode: 'bands', lengths: [1.0, 2.5], minOverlap: 0.4,
    bands: [{ stacks: [[1, 1]], weight: 2 }, { stacks: [[1, 1.5], [1.5, 1]], weight: 1 }],
    tallRate: 0.4, tallLengths: [1.0, 2.0], zoneLengths: [2.0, 5.0],
    rough: { cornerJitter: [0.03, 0.06], edgeWave: 0.025, cornerRound: 0.06 }, // x the block's shorter side, inward only
  },
});
export const FLOOR_SHARE = MIN_PIECE_FRACTION; // a clipped block under this share of H x H is dropped (risk list)

// ---------------------------------------------------------------- generator
export function ashlarLayout(region, P, { H, J, seed }) {
  const rnd = (purpose, k) => hashedRandom(seed, `ashlar-${purpose}`, k);
  const xs = region.map((p) => p.x), ys = region.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const lo = P.lengths[0] * H, hi = P.lengths[1] * H, minOv = P.minOverlap * H;
  const rects = []; // { x0, x1, y0, y1, kind }
  let opening = null, rowCount = 0;

  // the region's x span across a horizontal band (a template's curved sides narrow it)
  const spanAt = (y0, y1) => {
    const q = polygonIntersection([{ x: minX - 1, y: y0 }, { x: maxX + 1, y: y0 }, { x: maxX + 1, y: y1 }, { x: minX - 1, y: y1 }], region);
    if (q.length < 3) return null;
    const qx = q.map((p) => p.x);
    return [Math.min(...qx), Math.max(...qx)];
  };
  // lay xa..xb with blocks of lo..hi; every new vertical joint at least minOv from the row above's joints
  const fill = (xa, xb, avoid, key) => {
    const out = []; let x = xa, k = 0;
    if (xb - xa <= 0) return out;
    for (;;) {
      const rem = xb - x;
      if (rem <= hi) { out.push([x, xb]); break; }
      const top = Math.max(lo, Math.min(hi, rem - J - lo));
      let len, t = 0;
      do { len = lo + rnd('len', key * 7919 + k * 101 + t) * (top - lo); t++; }
      while (t < 16 && avoid.some((a) => Math.abs(x + len + J / 2 - a) < minOv));
      out.push([x, x + len]); x += len + J; k++;
    }
    return out;
  };
  const jointsOf = (blocks) => blocks.slice(0, -1).map((b) => b[1] + J / 2);
  // heights top -> bottom summing to the span; a short remainder spreads over all rows (no thin last row)
  const planHeights = (draw, minH, maxH) => {
    const hs = []; let used = 0;
    for (let i = 0; ; i++) {
      const rem = (maxY - minY) - used - (hs.length ? J : 0);
      if (rem <= maxH) {
        if (rem >= minH) hs.push(rem);
        else { const extra = rem + J; const tot = hs.reduce((a, b) => a + b, 0); for (let k = 0; k < hs.length; k++) hs[k] += extra * hs[k] / tot; }
        return hs;
      }
      const h = draw(i); hs.push(h); used += (hs.length > 1 ? J : 0) + h;
    }
  };

  if (P.mode === 'courses') {
    const { sizes, weights, range } = P.heights;
    const pick = (i) => {
      if (range) return H * (range[0] + rnd('course', i) * (range[1] - range[0]));
      const w = weights.reduce((a, b) => a + b, 0); let r = rnd('course', i) * w;
      for (let k = 0; k < sizes.length; k++) { r -= weights[k]; if (r < 0) return sizes[k] * H; }
      return sizes[sizes.length - 1] * H;
    };
    const hMin = range ? range[0] : Math.min(...sizes), hMax = range ? range[1] : Math.max(...sizes);
    const hs = planHeights(pick, hMin * H * 0.85, hMax * H);
    rowCount = hs.length;
    const O = P.opening;
    let y = minY, above = [];
    const courseY = [];
    for (let c = 0; c < hs.length; c++) { courseY.push(y); y += hs[c] + J; }
    if (O) opening = { x0: O.x0In, x1: O.x1In, y0: courseY[O.fromCourse], y1: courseY[O.toCourse] + hs[O.toCourse] };
    for (let c = 0; c < hs.length; c++) {
      const y0 = courseY[c], y1 = y0 + hs[c];
      const span = spanAt(y0, y1);
      if (!span) { above = []; continue; }
      // fixed blocks this course (jambs / lintel / sill), the rest filled around them
      const fixed = [];
      if (O && c >= O.fromCourse && c <= O.toCourse) {
        const len = ((c - O.fromCourse) % 2 === 0 ? P.jamb.long : P.jamb.short) * H;
        fixed.push({ x0: O.x0In - len, x1: O.x0In, kind: 'jamb' }, { x0: O.x1In, x1: O.x1In + len, kind: 'jamb' });
      } else if (O && c === O.fromCourse - 1) fixed.push({ x0: O.x0In - P.lintel.bearing * H, x1: O.x1In + P.lintel.bearing * H, kind: 'lintel' });
      else if (O && c === O.toCourse + 1) fixed.push({ x0: O.x0In - P.sill.bearing * H, x1: O.x1In + P.sill.bearing * H, kind: 'sill' });
      // a sliver gap at the region's edge (under minEnd) is taken by the fixed block beside it
      const minEnd = (P.minEnd || 0) * H;
      if (fixed.length && fixed[0].x0 - J - span[0] < minEnd) fixed[0].x0 = span[0];
      if (fixed.length && span[1] - (fixed[fixed.length - 1].x1 + J) < minEnd) fixed[fixed.length - 1].x1 = span[1];
      const blocks = []; let x = span[0];
      const gaps = [];
      for (const f of fixed) { gaps.push([x, f.x0 - J]); x = f.x1 + J; }
      gaps.push([x, span[1]]);
      // a jamb sits against the opening (no joint at the opening side): the gap between two jambs IS the opening
      const realGaps = gaps.filter(([a, b]) => !(O && a >= O.x0In + J - 1e-9 && b <= O.x1In - J + 1e-9 && c >= O.fromCourse && c <= O.toCourse));
      for (const [a, b] of realGaps) for (const blk of fill(a, b, above, c * 13 + Math.round(a * 10))) blocks.push({ x0: blk[0], x1: blk[1], kind: 'block' });
      for (const f of fixed) blocks.push(f);
      blocks.sort((p, q) => p.x0 - q.x0);
      for (const b of blocks) rects.push({ ...b, y0, y1, row: c });
      above = blocks.slice(0, -1).map((b) => b.x1 + J / 2);
    }
  } else { // 'bands': broken course
    const wsum = P.bands.reduce((a, b) => a + b.weight, 0);
    const bandPick = (i) => { let r = rnd('band', i) * wsum; for (const b of P.bands) { r -= b.weight; if (r < 0) return b; } return P.bands[0]; };
    const chosen = [];
    const bandH = (b) => (b.stacks[0][0] + b.stacks[0][1]) * H + J;
    const hs = planHeights((i) => { const b = bandPick(i); chosen[i] = b; return bandH(b); }, 2 * H + J, 2.5 * H + J);
    rowCount = hs.length;
    let y = minY, above = [];
    for (let bi = 0; bi < hs.length; bi++) {
      const band = chosen[bi] || P.bands[0], bh = hs[bi], y0 = y, y1 = y + bh;
      const span = spanAt(y0, y1);
      y = y1 + J;
      if (!span) { above = []; continue; }
      const scale = bh / bandH(band); // the band stretched by planHeights' remainder spread
      const segs = []; let x = span[0], k = 0, lastTall = false;
      while (x < span[1] - 1e-9) {
        const tall = !lastTall && rnd('tall', bi * 977 + k) < P.tallRate;
        const [a, b] = tall ? P.tallLengths : P.zoneLengths;
        let w, t = 0;
        do { w = H * (a + rnd('seg', bi * 977 + k * 31 + t) * (b - a)); t++; }
        while (t < 16 && above.some((q) => Math.abs(x + w + J / 2 - q) < minOv));
        if (span[1] - (x + w + J) < lo) w = span[1] - x; // no sliver at the band's end
        segs.push({ x0: x, x1: Math.min(x + w, span[1]), tall }); x += w + J; k++; lastTall = tall;
      }
      const topJ = [], botJ = [];
      for (const [si, s] of segs.entries()) {
        if (si < segs.length - 1) { topJ.push(s.x1 + J / 2); botJ.push(s.x1 + J / 2); }
        if (s.tall) { rects.push({ x0: s.x0, x1: s.x1, y0, y1, kind: 'tall', row: bi }); continue; }
        const stack = band.stacks[Math.floor(rnd('stack', bi * 977 + si) * band.stacks.length)];
        const hTop = stack[0] * H * scale;
        const top = fill(s.x0, s.x1, above, bi * 2 * 977 + si);
        const bot = fill(s.x0, s.x1, jointsOf(top), (bi * 2 + 1) * 977 + si);
        for (const [a, b] of top) rects.push({ x0: a, x1: b, y0, y1: y0 + hTop, kind: 'block', row: bi });
        for (const [a, b] of bot) rects.push({ x0: a, x1: b, y0: y0 + hTop + J, y1, kind: 'block', row: bi });
        topJ.push(...jointsOf(top)); botJ.push(...jointsOf(bot));
      }
      above = botJ;
    }
  }

  // polygons: optional rough edges, then clipped to the region, under the floor dropped
  const floor = FLOOR_SHARE * H * H;
  const blocks = []; let dropped = 0, clippedCount = 0;
  for (const [i, r] of rects.entries()) {
    let poly = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
    if (P.rough) poly = roughen(poly, r, P.rough, (k) => rnd('rough', i * 64 + k));
    const fullArea = Math.abs(signedArea(poly));
    const clipped = clipPolygonToBoard(poly, region, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
    const area = clipped.length >= 3 ? Math.abs(signedArea(clipped)) : 0;
    if (area < fullArea - 1e-6) clippedCount++;
    if (area < floor) { if (area > 0) dropped++; continue; }
    blocks.push({ polygon: clipped, kind: r.kind, row: r.row, tone: rnd('tone', i) });
  }
  return { blocks, opening, stats: { rows: rowCount, blocks: blocks.length, clipped: clippedCount, droppedUnderFloor: dropped, floorSqIn: floor } };
}

// corners pulled IN (never out: no overlap), each edge bowed in at 1/3 and 2/3, corners filleted
function roughen(rect, r, R, rnd) {
  const short = Math.min(r.x1 - r.x0, r.y1 - r.y0);
  const j = (k) => short * (R.cornerJitter[0] + rnd(k) * (R.cornerJitter[1] - R.cornerJitter[0])) * (rnd(k + 20) < 0.5 ? 0.3 : 1);
  const sx = [1, -1, -1, 1], sy = [1, 1, -1, -1]; // inward per corner (y down)
  const c = rect.map((p, k) => ({ x: p.x + sx[k] * j(2 * k), y: p.y + sy[k] * j(2 * k + 1) }));
  const sign = inwardSignFor(c);
  const out = [];
  for (let k = 0; k < 4; k++) {
    const a = c[k], b = c[(k + 1) % 4], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const nx = (-dy / len) * sign, ny = (dx / len) * sign; // inward normal
    out.push(a);
    for (const [m, t] of [[0, 1 / 3], [1, 2 / 3]]) {
      const d = short * R.edgeWave * rnd(40 + k * 2 + m);
      out.push({ x: a.x + dx * t + nx * d, y: a.y + dy * t + ny * d });
    }
  }
  return roundPolygonCorners(out, short * R.cornerRound);
}

// ---------------------------------------------------------------- render
const COLORS = { joint: '#56585a', stone: [154, 155, 150], outside: '#ffffff', opening: '#d9dee2', openingFrame: '#3b4044' };
function svgOf(region, lay, { W, Hb, title }) {
  const PX = 90, M = 0.25, cap = 0.45;
  const wPx = Math.round((W + 2 * M) * PX), hPx = Math.round((Hb + 2 * M + cap) * PX);
  const pts = (poly) => poly.map((p) => `${((p.x + M) * PX).toFixed(2)},${((p.y + M) * PX).toFixed(2)}`).join(' ');
  const shade = (t) => { const f = 0.9 + 0.2 * t; return `rgb(${COLORS.stone.map((v) => Math.round(v * f)).join(',')})`; };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${wPx} ${hPx}">`;
  s += `<rect width="100%" height="100%" fill="${COLORS.outside}"/>`;
  s += `<polygon points="${pts(region)}" fill="${COLORS.joint}"/>`;
  for (const b of lay.blocks) s += `<polygon points="${pts(b.polygon)}" fill="${shade(b.tone)}"/>`;
  if (lay.opening) {
    const o = lay.opening;
    s += `<rect x="${(o.x0 + M) * PX}" y="${(o.y0 + M) * PX}" width="${(o.x1 - o.x0) * PX}" height="${(o.y1 - o.y0) * PX}" fill="${COLORS.opening}" stroke="${COLORS.openingFrame}" stroke-width="3"/>`;
  }
  s += `<text x="${M * PX}" y="${(Hb + 2 * M + 0.3) * PX}" font-family="Segoe UI, Arial" font-size="20" fill="#333">${title}</text></svg>`;
  return { svg: s, wPx, hPx };
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
function toPng(svg, wPx, hPx, outPng, tmpDir) {
  const html = path.join(tmpDir, path.basename(outPng, '.png') + '.html');
  writeFileSync(html, `<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`);
  const prof = path.join(tmpDir, 'chrome-profile');
  // spawnSync's timeout kills only the PID it started
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${prof}`,
    `--window-size=${wPx},${hPx}`, `--screenshot=${outPng}`, pathToFileURL(html).href], { timeout: 60000 });
  if (r.status !== 0) console.log('chrome status', r.status, String(r.stderr).slice(0, 400));
}

// ---------------------------------------------------------------- template region (template_1), as t86_item6 does
async function templateInnerPath(templateId, W, Hb, set) {
  const { frameContourSilhouette } = await imp('editor/contour-from-frame.js');
  const { normalizeFrameRecord } = await imp('core/frame-record.js');
  const FRAME_DEFS = (await imp('data/frame-defs.js')).default;
  const { bricksContourBands } = await imp('core/bricks/contour-bands.js');
  const { FRAME_PRESETS } = await imp('core/bricks/library.js');
  const { radialSignAt } = await imp('core/bricks/arc-voussoir.js');
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId }), board: { widthIn: W, heightIn: Hb } }, 0, 0);
  const raw = sil.primitives.map((prim, i) => {
    if (prim.type === 'L') {
      const next = sil.primitives[(i + 1) % sil.primitives.length];
      const p1 = next.type === 'L' ? next.p0 : { x: next.cx + next.rx * Math.cos(next.theta1), y: next.cy + next.ry * Math.sin(next.theta1) };
      return { type: 'line', p0: prim.p0, p1 };
    }
    return { type: 'arc', cx: prim.cx, cy: prim.cy, r: prim.rx, theta1: prim.theta1, theta2: prim.theta1 + prim.dTheta };
  });
  const tess = [];
  for (const p of raw) {
    if (p.type === 'arc') for (let k = 0; k < 16; k++) { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / 16; tess.push({ x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }); }
    else tess.push(p.p0);
  }
  const inwardSign = inwardSignFor(tess);
  const prims = raw.map((p) => {
    if (p.type === 'line') { const dx = p.p1.x - p.p0.x, dy = p.p1.y - p.p0.y, len = Math.hypot(dx, dy); return { ...p, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign }; }
    const m = (p.theta1 + p.theta2) / 2, dir = Math.sign(p.theta2 - p.theta1) || 1;
    return { ...p, radialSign: radialSignAt({ tx: -Math.sin(m) * dir, ty: Math.cos(m) * dir }, p.cx + p.r * Math.cos(m), p.cy + p.r * Math.sin(m), p.cx, p.cy, inwardSign) };
  });
  const { innerPath } = bricksContourBands(prims, FRAME_PRESETS.single_soldier, { set, seed: 1 });
  return innerPath;
}

// ---------------------------------------------------------------- main
const OUT = process.argv[2] || path.join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const TMP = path.join(HERE, '_tmp'); mkdirSync(TMP, { recursive: true });
const W = 7, Hb = 10, SEED = 7;
const board = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: Hb }, { x: 0, y: Hb }];
const runs = [
  { file: 'mock_A_regular.png', v: 'A_regular', H: 1, J: 0.034 },
  { file: 'mock_B_random.png', v: 'B_random', H: 1, J: 0.034 },
  { file: 'mock_C_window.png', v: 'C_window', H: 1, J: 0.034 },
  { file: 'mock_A_075.png', v: 'A_regular', H: 0.75, J: 0.034 },
  { file: 'mock_D_broken.png', v: 'D_broken', H: 1, J: 0.034 },
  { file: 'mock_E_rough.png', v: 'E_rough', H: 1, J: 0.05 },
  { file: 'mock_A_template1.png', v: 'A_regular', H: 1, J: 0.034, template: 'template_1' },
];
const report = [];
for (const r of runs) {
  let region = board;
  if (r.template) {
    const { BRICK_SETS } = await imp('core/bricks/library.js');
    const set = Object.values(BRICK_SETS)[0];
    region = await templateInnerPath(r.template, W, Hb, set);
    const xs = region.map((p) => p.x), ys = region.map((p) => p.y);
    const dx = -Math.min(...xs), dy = -Math.min(...ys); // shift into the board's frame for drawing
    region = region.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  const lay = ashlarLayout(region, ASHLAR_VARIANTS[r.v], { H: r.H, J: r.J, seed: SEED });
  const xs = region.map((p) => p.x), ys = region.map((p) => p.y);
  const { svg, wPx, hPx } = svgOf(region, lay, { W: Math.max(...xs), Hb: Math.max(...ys), title: `${r.v}  H ${r.H} in  joint ${r.J} in  seed ${SEED}${r.template ? '  ' + r.template : ''}` });
  toPng(svg, wPx, hPx, path.join(OUT, r.file), TMP);
  report.push({ file: r.file, ...lay.stats });
}
console.table(report);
rmSync(TMP, { recursive: true, force: true });
