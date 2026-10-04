// T86 item 6: fieldstone void-filling before/after. "before" reproduces the pre-item-6 single-pass
// algorithm inline (not imported -- the live module now has item 6's own multi-pass rewrite), "after"
// imports the live fieldstoneLayout. Renders both sets (Red brick / White rocks) on template_1 7x9 so
// the comparison shows the SAME board under each set's own declared grout/spacing.
//
// Usage: node tools/repro/t86_item6_fieldstone_preview.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const bricksRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/core/bricks/`;
const imp = (p) => import(bricksRoot + p);
const { bricksContourBands } = await imp('contour-bands.js');
const { FRAME_PRESETS, BRICK_SETS } = await imp('library.js');
const { pointInPolygon, clipToHalfPlane, clipPolygonToBoard, offsetPathInward, inwardSignFor, roundPolygonCorners, isSimplePolygon } = await imp('geometry.js');
const { mulberry32, seedFor } = await imp('rng.js');
const { fieldstoneLayout: fieldstoneLayoutAfter } = await imp('layouts/fieldstone.js');
const { radialSignAt } = await imp('arc-voussoir.js');

const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const { frameContourSilhouette } = await import(appRoot + 'editor/contour-from-frame.js');
const { normalizeFrameRecord } = await import(appRoot + 'core/frame-record.js');
const FRAME_DEFS = (await import(appRoot + 'data/frame-defs.js')).default;

mkdirSync(OUT_DIR, { recursive: true });

// ---- BEFORE: the pre-item-6 single-pass algorithm, copied verbatim from git HEAD (not imported) ----
const POISSON_ATTEMPTS = 30, MAX_POINTS = 4000, NEIGHBOR_RADIUS_FACTOR = 3, CORNER_RADIUS_FACTOR = 0.12;
function poissonDiscSampleBefore(polygon, minDist, seed) {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  if (w < 1e-6 || h < 1e-6 || minDist < 1e-6) return [];
  const rng = mulberry32(seedFor(seed, 'fieldstone-poisson', 0));
  const cellSize = minDist / Math.SQRT2;
  const gw = Math.max(1, Math.ceil(w / cellSize)), gh = Math.max(1, Math.ceil(h / cellSize));
  const grid = new Array(gw * gh).fill(-1);
  const points = [];
  const gridIndexOf = (p) => ({ gx: Math.min(gw - 1, Math.max(0, Math.floor((p.x - minX) / cellSize))), gy: Math.min(gh - 1, Math.max(0, Math.floor((p.y - minY) / cellSize))) });
  const farEnough = (p) => {
    const { gx, gy } = gridIndexOf(p);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
      const idx = grid[ny * gw + nx];
      if (idx < 0) continue;
      const q = points[idx];
      if (Math.hypot(p.x - q.x, p.y - q.y) < minDist) return false;
    }
    return true;
  };
  const place = (p) => { const { gx, gy } = gridIndexOf(p); grid[gy * gw + gx] = points.length; points.push(p); };
  let first = null;
  for (let tries = 0; tries < 200 && !first; tries++) {
    const cand = { x: minX + rng() * w, y: minY + rng() * h };
    if (pointInPolygon(cand.x, cand.y, polygon)) first = cand;
  }
  if (!first) return [];
  place(first);
  const active = [0];
  while (active.length && points.length < MAX_POINTS) {
    const ai = Math.floor(rng() * active.length);
    const p = points[active[ai]];
    let found = false;
    for (let k = 0; k < POISSON_ATTEMPTS; k++) {
      const r = minDist * (1 + rng()), angle = rng() * Math.PI * 2;
      const cand = { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r };
      if (cand.x < minX || cand.x > maxX || cand.y < minY || cand.y > maxY) continue;
      if (!pointInPolygon(cand.x, cand.y, polygon)) continue;
      if (!farEnough(cand)) continue;
      place(cand); active.push(points.length - 1); found = true; break;
    }
    if (!found) active.splice(ai, 1);
  }
  return points;
}
function voronoiCellBefore(point, allPoints, boxPoly) {
  let poly = boxPoly;
  for (const other of allPoints) {
    if (other === point || poly.length < 3) continue;
    const mid = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
    const dx = other.x - point.x, dy = other.y - point.y, len = Math.hypot(dx, dy) || 1;
    poly = clipToHalfPlane(poly, { point: mid, dirX: -dy / len, dirY: dx / len }, point);
  }
  return poly;
}
function fieldstoneLayoutBefore(boardOutline, set, _zones, seed) {
  const spacing = set.brickLengthIn, shrink = (set.grout?.widthIn ?? 0) / 2;
  const points = poissonDiscSampleBefore(boardOutline, spacing, seed ?? 0);
  if (!points.length) return { cells: [] };
  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const margin = spacing * NEIGHBOR_RADIUS_FACTOR;
  const box = [{ x: minX - margin, y: minY - margin }, { x: maxX + margin, y: minY - margin }, { x: maxX + margin, y: maxY + margin }, { x: minX - margin, y: maxY + margin }];
  const neighborRadius = spacing * NEIGHBOR_RADIUS_FACTOR;
  const cells = []; let nextId = 0;
  for (const point of points) {
    const nearby = points.filter((q) => q !== point && Math.hypot(q.x - point.x, q.y - point.y) <= neighborRadius);
    let poly = voronoiCellBefore(point, nearby, box);
    if (poly.length < 3) continue;
    poly = clipPolygonToBoard(poly, boardOutline, point);
    if (poly.length < 3) continue;
    if (shrink > 1e-9) {
      poly = offsetPathInward(poly, shrink, inwardSignFor(poly));
      if (poly.length < 3 || !isSimplePolygon(poly)) continue;
    }
    poly = roundPolygonCorners(poly, spacing * CORNER_RADIUS_FACTOR);
    if (poly.length < 3) continue;
    cells.push({ id: nextId++, polygon: poly, courseIndex: Math.max(0, Math.round((point.y - minY) / spacing)), cx: point.x, cy: point.y, neighbors: {} });
  }
  return { cells };
}

// ---- shared board/render setup (templatePrimitives copied from t86_item3_shoulder_preview.mjs's
// own local reimplementation -- editor-brick-tool.js's buildRibbonPrimitives pulls in editor-ui.js,
// which touches `document` at module load, so it cannot be imported in a plain node script) ----
function tessellate(primitives) {
  const points = [];
  for (const prim of primitives) {
    if (prim.type === 'arc') {
      for (let k = 0; k < 16; k++) {
        const t = prim.theta1 + ((prim.theta2 - prim.theta1) * k) / 16;
        points.push({ x: prim.cx + prim.r * Math.cos(t), y: prim.cy + prim.r * Math.sin(t) });
      }
    } else points.push(prim.p0);
  }
  return points;
}
function templatePrimitives(templateId, W, H) {
  const record = normalizeFrameRecord({ templateId });
  const frame = { defs: FRAME_DEFS, record, board: { widthIn: W, heightIn: H } };
  const sil = frameContourSilhouette(frame, 0, 0);
  const raw = sil.primitives.map((prim, i) => {
    if (prim.type === 'L') {
      const next = sil.primitives[(i + 1) % sil.primitives.length];
      const p1 = next.type === 'L' ? next.p0 : { x: next.cx + next.rx * Math.cos(next.theta1), y: next.cy + next.ry * Math.sin(next.theta1) };
      return { type: 'line', p0: prim.p0, p1 };
    }
    return { type: 'arc', cx: prim.cx, cy: prim.cy, r: prim.rx, theta1: prim.theta1, theta2: prim.theta1 + prim.dTheta };
  });
  const inwardSign = inwardSignFor(tessellate(raw));
  return raw.map((prim) => {
    if (prim.type === 'line') {
      const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y, len = Math.hypot(dx, dy);
      return { ...prim, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign };
    }
    const midT = (prim.theta1 + prim.theta2) / 2;
    const mid = { x: prim.cx + prim.r * Math.cos(midT), y: prim.cy + prim.r * Math.sin(midT) };
    const direction = Math.sign(prim.theta2 - prim.theta1) || 1;
    const tangent = { tx: -Math.sin(midT) * direction, ty: Math.cos(midT) * direction };
    const radialSign = radialSignAt(tangent, mid.x, mid.y, prim.cx, prim.cy, inwardSign);
    return { ...prim, radialSign };
  });
}

const RENDER_W = 900;
function svgFor(innerPath, cells, viewBox, title) {
  const outline = innerPath.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
  const pieces = cells.map((c, i) => {
    const pts = c.polygon.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
    const hue = (i * 47) % 360;
    return `<polygon points="${pts}" fill="hsl(${hue},45%,62%)" fill-opacity="0.85" stroke="#333" stroke-width="0.012"/>`;
  }).join('\n');
  const [x, y, w, h] = viewBox;
  const renderH = Math.round(RENDER_W * h / w);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${RENDER_W}" height="${renderH}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#777"/>
  <polygon points="${outline}" fill="#777" stroke="#999" stroke-width="0.02"/>
  ${pieces}
  <text x="${x + 0.1}" y="${y + 0.35}" font-size="${Math.max(0.15, w * 0.035)}" fill="#fff" stroke="#000" stroke-width="0.01">${title}</text>
</svg>`;
  return { svg, width: RENDER_W, height: renderH };
}

const renders = [];
for (const [setIdx, setLabel] of [[0, 'redbrick'], [2, 'whiterocks']]) {
  const SET = BRICK_SETS[setIdx];
  const primitives = templatePrimitives('template_1', 7, 9);
  const { innerPath } = bricksContourBands(primitives, FRAME_PRESETS.single_soldier, { set: SET, seed: 1 });
  const xs = innerPath.map((p) => p.x), ys = innerPath.map((p) => p.y);
  const pad = 0.3;
  const viewBox = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2];

  const before = fieldstoneLayoutBefore(innerPath, SET, null, 1);
  renders.push({ name: `${setLabel}_before`, render: svgFor(innerPath, before.cells, viewBox, `${SET.name} -- BEFORE (${before.cells.length} stones)`) });

  const after = fieldstoneLayoutAfter(innerPath, SET, null, 1);
  renders.push({ name: `${setLabel}_after`, render: svgFor(innerPath, after.cells, viewBox, `${SET.name} -- AFTER (${after.cells.length} stones)`) });
}

for (const r of renders) writeFileSync(`${OUT_DIR}/t86_item6_${r.name}.svg`, r.render.svg);
console.log('wrote', renders.length, 'SVGs to', OUT_DIR);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9463;
const userDataDir = `${process.cwd()}/${OUT_DIR}/chrome-item6-preview`.replace(/\\/g, '/');
mkdirSync(userDataDir, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');

for (const r of renders) {
  const { width, height } = r.render;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const svgPath = `${OUT_DIR}/t86_item6_${r.name}.svg`;
  await send('Page.navigate', { url: pathToFileURL(svgPath).href });
  await sleep(2000); // the "after" renders can carry 1000+ polygons -- 300ms (fine for item3's own
  // simpler closeups) left this one racing the paint and screenshotting a still-blank frame (MEASURED)
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  const pngPath = `${OUT_DIR}/t86_item6_${r.name}.png`;
  writeFileSync(pngPath, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshotted', r.name);
  try {
    const sharedDir = `${os.homedir()}/.bspline-status/shots/seatB`;
    mkdirSync(sharedDir, { recursive: true });
    copyFileSync(pngPath, `${sharedDir}/t86_item6_${r.name}.png`);
  } catch (e) { console.log('shared-status publish skipped:', e.message); }
}
ws.close();
chrome.kill();
