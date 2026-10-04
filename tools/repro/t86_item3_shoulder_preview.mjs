// T86 item 3: shoulder-transition closeups for `buildPatch`'s own pitch/sequence fix. The convex
// shoulder arc (r=0.623in at template_1's own 7x9) drops out of the soldier band (depth up to
// 1.15in) -- `buildPatch`'s kite-fan patch fills that gap. Before this item, the patch's own pieces
// were sliced by boundary POINT COUNT, not length, producing irregular sizes; now it plans the
// patch's own true arc length with the band's declared sequence, same as every other run.
//
// Usage: node tools/repro/t86_item3_shoulder_preview.mjs <repoRoot> <outDir>
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
const { inwardSignFor } = await imp('geometry.js');
const { radialSignAt } = await imp('arc-voussoir.js');

const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const { frameContourSilhouette } = await import(appRoot + 'editor/contour-from-frame.js');
const { normalizeFrameRecord } = await import(appRoot + 'core/frame-record.js');
const FRAME_DEFS = (await import(appRoot + 'data/frame-defs.js')).default;

mkdirSync(OUT_DIR, { recursive: true });
const SET = BRICK_SETS[0];

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
    return `<polygon points="${pts}" fill="${PALETTE[i % PALETTE.length]}" fill-opacity="0.55" stroke="#222" stroke-width="0.008"/>`;
  }).join('\n');
  const [x, y, w, h] = viewBox;
  const renderH = Math.round(RENDER_W * h / w);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${RENDER_W}" height="${renderH}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>
  <polygon points="${outline}" fill="none" stroke="#999" stroke-width="0.02" stroke-dasharray="0.08,0.06"/>
  ${pieces}
  <text x="${x + 0.05}" y="${y + 0.18}" font-size="${Math.max(0.1, w * 0.03)}" fill="#111">${title}</text>
</svg>`;
  return { svg, width: RENDER_W, height: renderH };
}

const renders = [];
// shoulder closeup: the right-side, bottom-of-waist shoulder on template_1 7x9 -- MEASURED directly
// (scratch/debug_soldier_patch.mjs) as where the soldier band's own kiteFan patch pieces sit.
const SHOULDER_VIEWBOX = [5.2, 2.75, 1.5, 1.5];

{
  const primitives = templatePrimitives('template_1', 7, 9);
  const { bricks } = bricksContourBands(primitives, FRAME_PRESETS.single_soldier, { set: SET, seed: 7 });
  renders.push({ name: 'single_soldier_shoulder_closeup', render: svgFor(primitives, bricks, SHOULDER_VIEWBOX, 'single_soldier -- shoulder 1:1 (buildPatch fix)') });
}
{
  const primitives = templatePrimitives('template_1', 7, 9);
  const { bricks } = bricksContourBands(primitives, FRAME_PRESETS.mixed_bands, { set: SET, seed: 7 });
  renders.push({ name: 'mixed_bands_shoulder_closeup', render: svgFor(primitives, bricks, SHOULDER_VIEWBOX, 'mixed_bands -- shoulder 1:1 (buildPatch fix)') });
}

for (const r of renders) writeFileSync(`${OUT_DIR}/t86_item3_${r.name}.svg`, r.render.svg);
console.log('wrote', renders.length, 'SVGs to', OUT_DIR);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9462;
mkdirSync(`${OUT_DIR}/chrome-shoulder-preview`, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT_DIR}/chrome-shoulder-preview`,
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
  const svgPath = `${OUT_DIR}/t86_item3_${r.name}.svg`;
  await send('Page.navigate', { url: pathToFileURL(svgPath).href });
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  const pngPath = `${OUT_DIR}/t86_item3_${r.name}.png`;
  writeFileSync(pngPath, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshotted', r.name);
  try {
    const sharedDir = `${os.homedir()}/.bspline-status/shots/seatB`;
    mkdirSync(sharedDir, { recursive: true });
    copyFileSync(pngPath, `${sharedDir}/t86_item3_${r.name}.png`);
  } catch (e) { console.log('shared-status publish skipped:', e.message); }
}
ws.close();
chrome.kill();
