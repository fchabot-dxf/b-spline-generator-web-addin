// T86 item 17: the fieldstone `largeStones` slider, preview strip at 0 / 0.5 / 1 -- White rocks,
// template_1 7x9, seed 1. Same headless-Chrome pattern as the item 6/14/15 preview tools.
//
// Usage: node tools/repro/t86_item17_large_stones_preview.mjs <repoRoot> <outDir>
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
const { fieldstoneLayout } = await imp('layouts/fieldstone.js');

const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const { frameContourSilhouette } = await import(appRoot + 'editor/contour-from-frame.js');
const { normalizeFrameRecord } = await import(appRoot + 'core/frame-record.js');
const FRAME_DEFS = (await import(appRoot + 'data/frame-defs.js')).default;

mkdirSync(OUT_DIR, { recursive: true });

function templatePrimitives(templateId, W, H) {
  const record = normalizeFrameRecord({ templateId });
  const frame = { defs: FRAME_DEFS, record, board: { widthIn: W, heightIn: H } };
  const sil = frameContourSilhouette(frame, 0, 0);
  return sil.primitives.map((prim, i) => {
    if (prim.type === 'L') {
      const next = sil.primitives[(i + 1) % sil.primitives.length];
      const p1 = next.type === 'L' ? next.p0 : { x: next.cx + next.rx * Math.cos(next.theta1), y: next.cy + next.ry * Math.sin(next.theta1) };
      return { type: 'line', p0: prim.p0, p1 };
    }
    return { type: 'arc', cx: prim.cx, cy: prim.cy, r: prim.rx, theta1: prim.theta1, theta2: prim.theta1 + prim.dTheta };
  });
}

const RENDER_W = 900;
function svgFor(innerPath, cells, viewBox, title) {
  const outline = innerPath.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
  const colorFor = (tier) => ({ large: '#8a5a3c', medium: '#b98b5e', small: '#ddc49a' }[tier] || '#999');
  const pieces = cells.map((c) => {
    const pts = c.polygon.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
    return `<polygon points="${pts}" fill="${colorFor(c.tier)}" fill-opacity="0.95" stroke="#333" stroke-width="0.015"/>`;
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

const SET = BRICK_SETS[2]; // White rocks
const primitives = templatePrimitives('template_1', 7, 9);
const { innerPath } = bricksContourBands(primitives, FRAME_PRESETS.single_soldier, { set: SET, seed: 1 });
const xs = innerPath.map((p) => p.x), ys = innerPath.map((p) => p.y);
const pad = 0.3;
const viewBox = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2];

const renders = [];
for (const largeStones of [0, 0.5, 1]) {
  const { cells } = fieldstoneLayout(innerPath, SET, null, 1, largeStones);
  let largeArea = 0, totalArea = 0;
  const signedArea2 = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };
  for (const c of cells) { const a = Math.abs(signedArea2(c.polygon)); totalArea += a; if (c.tier === 'large') largeArea += a; }
  const pct = totalArea > 0 ? (largeArea / totalArea) * 100 : 0;
  renders.push({ name: `largeStones_${largeStones}`, render: svgFor(innerPath, cells, viewBox, `largeStones=${largeStones} -- ${cells.length} stones, large=${pct.toFixed(0)}% of area`) });
}

for (const r of renders) writeFileSync(`${OUT_DIR}/t86_item17_${r.name}.svg`, r.render.svg);
console.log('wrote', renders.length, 'SVGs to', OUT_DIR);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9466;
const userDataDir = `${process.cwd()}/${OUT_DIR}/chrome-item17-preview`.replace(/\\/g, '/');
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
  const svgPath = `${OUT_DIR}/t86_item17_${r.name}.svg`;
  await send('Page.navigate', { url: pathToFileURL(svgPath).href });
  await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  const pngPath = `${OUT_DIR}/t86_item17_${r.name}.png`;
  writeFileSync(pngPath, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshotted', r.name);
  try {
    const sharedDir = `${os.homedir()}/.bspline-status/shots/seatB`;
    mkdirSync(sharedDir, { recursive: true });
    copyFileSync(pngPath, `${sharedDir}/t86_item17_${r.name}.png`);
  } catch (e) { console.log('shared-status publish skipped:', e.message); }
}
ws.close();
chrome.kill();
