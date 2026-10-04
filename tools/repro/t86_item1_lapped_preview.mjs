// T86 item 1: preview renders for the LAPPED corner style -- a square, template_1, and a 1:1
// close-up of one corner -- requested by the dispatch alongside the engine build itself.
//
// Usage: node tools/repro/t86_item1_lapped_preview.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const bricksRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/core/bricks/`;
const imp = (p) => import(bricksRoot + p);
const { ribbonPieces } = await imp('primitive-ribbon.js');
const { FRAME_PRESETS, BRICK_SETS } = await imp('library.js');
const { inwardSignFor } = await imp('geometry.js');
const { radialSignAt } = await imp('arc-voussoir.js');

const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const { frameContourSilhouette } = await import(appRoot + 'editor/contour-from-frame.js');
const { normalizeFrameRecord } = await import(appRoot + 'core/frame-record.js');
const FRAME_DEFS = (await import(appRoot + 'data/frame-defs.js')).default;

mkdirSync(OUT_DIR, { recursive: true });
const SET = BRICK_SETS[0];

function squarePrimitives(size) {
  const pts = [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }];
  const inwardSign = inwardSignFor(pts);
  const line = (p0, p1) => {
    const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy);
    return { type: 'line', p0, p1, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign };
  };
  return [line(pts[0], pts[1]), line(pts[1], pts[2]), line(pts[2], pts[3]), line(pts[3], pts[0])];
}

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

// band-indexed colours so the alternation (the whole point of this preview) is immediately
// readable -- band 0 pieces warm, band 1 pieces cool, regardless of per-piece sample id.
const BAND_PALETTE = ['#c0392b', '#2980b9'];

const RENDER_W = 900;

function svgFor(primitives, bandPieces, viewBox, title) {
  const outline = primitives.map((p) => (p.type === 'line' ? `${p.p0.x},${p.p0.y}` : null)).filter(Boolean).join(' ');
  const pieces = bandPieces.map(({ bricks, bandIndex }) => bricks.map((b) => {
    const pts = b.polygon.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
    return `<polygon points="${pts}" fill="${BAND_PALETTE[bandIndex % BAND_PALETTE.length]}" fill-opacity="0.55" stroke="#222" stroke-width="0.015"/>`;
  }).join('\n')).join('\n');
  const [x, y, w, h] = viewBox;
  const renderH = Math.round(RENDER_W * h / w);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${RENDER_W}" height="${renderH}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>
  <polygon points="${outline}" fill="none" stroke="#999" stroke-width="0.03" stroke-dasharray="0.1,0.08"/>
  ${pieces}
  <text x="${x + 0.1}" y="${y + 0.25}" font-size="${Math.max(0.15, w * 0.03)}" fill="#111">${title}</text>
  <text x="${x + 0.1}" y="${y + 0.25 + Math.max(0.15, w * 0.03) * 1.3}" font-size="${Math.max(0.12, w * 0.022)}" fill="#c0392b">band 0 (red)</text>
  <text x="${x + 0.1 + Math.max(0.12, w * 0.022) * 7}" y="${y + 0.25 + Math.max(0.15, w * 0.03) * 1.3}" font-size="${Math.max(0.12, w * 0.022)}" fill="#2980b9">band 1 (blue)</text>
</svg>`;
  return { svg, width: RENDER_W, height: renderH };
}

function bbox(primitives) {
  const pts = tessellate(primitives.map((p) => p));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 0.3;
  return [minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad];
}

// bricksContourBands's own row loop, called directly (ribbonPieces, not the wrapper) so each
// band's own pieces can be kept separate for colouring -- same depth bookkeeping, same cornerStyle/
// bandIndex threading contour-bands.js itself does; this is NOT a re-derivation of the real depth
// math, it's the SAME loop, just split so this preview can tag pieces by band.
function perBand(primitives, bands) {
  const out = [];
  let depthSoFar = 0, nextId = 0;
  bands.forEach((band, bandIndex) => {
    const pattern = band.pattern || 'stretcher';
    const cornerStyle = band.cornerStyle || 'mitre';
    const naturalWidth = pattern === 'soldier' ? SET.brickLengthIn : SET.brickHeightIn;
    const pitch = pattern === 'soldier' ? SET.brickHeightIn : SET.brickLengthIn;
    const rows = Math.max(1, Math.round(band.widthIn / naturalWidth));
    const bandBricks = [];
    for (let row = 0; row < rows; row++) {
      const d0 = depthSoFar + naturalWidth * row, d1 = depthSoFar + naturalWidth * (row + 1);
      const { pieces, nextId: afterId } = ribbonPieces(
        primitives, d0, d1, SET, pattern, pitch, SET.grout.widthIn,
        1 ^ (bandIndex * 0x1000193) ^ (row * 0x01000000), 'frame', nextId, cornerStyle, bandIndex,
      );
      bandBricks.push(...pieces);
      nextId = afterId;
    }
    out.push({ bandIndex, bricks: bandBricks });
    depthSoFar += naturalWidth * rows;
  });
  return out;
}

const renders = [];

// (a) a plain square, double_course (2 bands, the alternation visible)
{
  const primitives = squarePrimitives(10);
  const bandPieces = perBand(primitives, FRAME_PRESETS.double_course);
  renders.push({ name: 'square', render: svgFor(primitives, bandPieces, bbox(primitives), 'lapped corner -- square (2 bands alternate)') });
}

// (b) template_1 at 7x9
{
  const primitives = templatePrimitives('template_1', 7, 9);
  const bandPieces = perBand(primitives, FRAME_PRESETS.double_course);
  renders.push({ name: 'template_1', render: svgFor(primitives, bandPieces, bbox(primitives), 'lapped corner -- template_1 (arcs fall back to mitre)') });
}

// (c) a 1:1 (true-scale) close-up of one corner of the square
{
  const primitives = squarePrimitives(10);
  const bandPieces = perBand(primitives, FRAME_PRESETS.double_course);
  renders.push({ name: 'square_corner_closeup', render: svgFor(primitives, bandPieces, [7, -1.5, 3.5, 4.5], 'lapped corner -- 1:1 closeup (bottom-right, both bands)') });
}

for (const r of renders) writeFileSync(`${OUT_DIR}/t86_item1_lapped_${r.name}.svg`, r.render.svg);
console.log('wrote', renders.length, 'SVGs to', OUT_DIR);

// screenshot each SVG via headless Chrome (file:// load + Page.captureScreenshot)
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9458;
mkdirSync(`${OUT_DIR}/chrome-lapped-preview`, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT_DIR}/chrome-lapped-preview`,
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
  const svgPath = `${OUT_DIR}/t86_item1_lapped_${r.name}.svg`;
  await send('Page.navigate', { url: pathToFileURL(svgPath).href });
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  writeFileSync(`${OUT_DIR}/t86_item1_lapped_${r.name}.png`, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshotted', r.name);
}
ws.close();
chrome.kill();
