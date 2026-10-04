// T86 item 1: preview renders for the header_band preset (F35 item 8's own header pattern, routed
// through band-course.js, not primitive-ribbon.js -- the last of the dispatch's own 6 FRAME_PRESETS).
//
// Usage: node tools/repro/t86_item1_header_band_preview.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const bricksRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/core/bricks/`;
const imp = (p) => import(bricksRoot + p);
const { bandCourseBricks } = await imp('band-course.js');
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

const PALETTE = ['#c0392b', '#2980b9', '#27ae60', '#d35400', '#8e44ad', '#16a085', '#c0392b', '#2980b9'];
const RENDER_W = 900;

function svgFor(primitives, bricks, viewBox, title) {
  const outline = primitives.map((p) => (p.type === 'line' ? `${p.p0.x},${p.p0.y}` : null)).filter(Boolean).join(' ');
  const pieces = bricks.map((b, i) => {
    const pts = b.polygon.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
    return `<polygon points="${pts}" fill="${PALETTE[i % PALETTE.length]}" fill-opacity="0.55" stroke="#222" stroke-width="0.012"/>`;
  }).join('\n');
  const [x, y, w, h] = viewBox;
  const renderH = Math.round(RENDER_W * h / w);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${RENDER_W}" height="${renderH}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>
  <polygon points="${outline}" fill="none" stroke="#999" stroke-width="0.03" stroke-dasharray="0.1,0.08"/>
  ${pieces}
  <text x="${x + 0.1}" y="${y + 0.25}" font-size="${Math.max(0.15, w * 0.03)}" fill="#111">${title}</text>
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

const renders = [];

{
  const primitives = squarePrimitives(10);
  const { bricks } = bandCourseBricks(primitives, FRAME_PRESETS.header_band, SET, { seed: 1, startDepth: 0 });
  renders.push({ name: 'square', render: svgFor(primitives, bricks, bbox(primitives), 'header_band -- square (band-course.js)') });
}

{
  const primitives = templatePrimitives('template_1', 7, 9);
  const { bricks } = bandCourseBricks(primitives, FRAME_PRESETS.header_band, SET, { seed: 1, startDepth: 0 });
  renders.push({ name: 'template_1', render: svgFor(primitives, bricks, bbox(primitives), 'header_band -- template_1 (true mitre corners, incl. waist fillets)') });
}

{
  const primitives = squarePrimitives(10);
  const { bricks } = bandCourseBricks(primitives, FRAME_PRESETS.header_band, SET, { seed: 1, startDepth: 0 });
  renders.push({ name: 'square_corner_closeup', render: svgFor(primitives, bricks, [8.5, -0.5, 2, 2.5], 'header_band -- 1:1 closeup (bottom-right)') });
}

for (const r of renders) writeFileSync(`${OUT_DIR}/t86_item1_header_${r.name}.svg`, r.render.svg);
console.log('wrote', renders.length, 'SVGs to', OUT_DIR);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9460;
mkdirSync(`${OUT_DIR}/chrome-header-preview`, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT_DIR}/chrome-header-preview`,
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
  const svgPath = `${OUT_DIR}/t86_item1_header_${r.name}.svg`;
  await send('Page.navigate', { url: pathToFileURL(svgPath).href });
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  writeFileSync(`${OUT_DIR}/t86_item1_header_${r.name}.png`, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshotted', r.name);
}
ws.close();
chrome.kill();
