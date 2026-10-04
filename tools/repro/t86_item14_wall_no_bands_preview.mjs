// T86 item 14: Wall with no Frame bands now fills to the template's own true contour instead of
// the plain bounding rectangle. "before" reproduces the pre-fix behavior directly (Wall bricks laid
// over the bounding rectangle, same as engine.js's own old `interiorOutline = boardOutline`
// fallback), "after" uses the real template contour (engine.js's own fixed behavior, `frame.primitives`
// honoured even with bands: []). Same board/set/seed both sides so only the outline differs.
//
// Usage: node tools/repro/t86_item14_wall_no_bands_preview.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const bricksRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/core/bricks/`;
const imp = (p) => import(bricksRoot + p);
const { BRICK_SETS } = await imp('library.js');
const { inwardSignFor } = await imp('geometry.js');
const { bondLayout } = await imp('layouts/bond.js');

const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const { frameContourSilhouette } = await import(appRoot + 'editor/contour-from-frame.js');
const { normalizeFrameRecord } = await import(appRoot + 'core/frame-record.js');
const FRAME_DEFS = (await import(appRoot + 'data/frame-defs.js')).default;

mkdirSync(OUT_DIR, { recursive: true });

// templatePrimitives/tessellate copied from t86_item6_fieldstone_preview.mjs's own local
// reimplementation (editor-brick-tool.js's buildRibbonPrimitives pulls in editor-ui.js, which
// touches `document` at module load, so it cannot be imported in a plain node script).
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
function templateContourPoly(templateId, W, H) {
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
  void inwardSignFor; // kept for parity with the fieldstone preview's own helper shape, unused here
  return tessellate(raw);
}

const RENDER_W = 900;
function svgFor(contour, cells, viewBox, title) {
  const outline = contour.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
  const pieces = cells.map((c, i) => {
    const pts = c.polygon.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
    const hue = (i * 23) % 360;
    return `<polygon points="${pts}" fill="hsl(${hue},55%,55%)" fill-opacity="0.9" stroke="#333" stroke-width="0.01"/>`;
  }).join('\n');
  const [x, y, w, h] = viewBox;
  const renderH = Math.round(RENDER_W * h / w);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${RENDER_W}" height="${renderH}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#444"/>
  <polygon points="${outline}" fill="none" stroke="#ff2d2d" stroke-width="0.04"/>
  ${pieces}
  <text x="${x + 0.1}" y="${y + 0.4}" font-size="${Math.max(0.18, w * 0.04)}" fill="#fff" stroke="#000" stroke-width="0.01">${title}</text>
</svg>`;
  return { svg, width: RENDER_W, height: renderH };
}

const SET = BRICK_SETS[0];
const [TEMPLATE, W, H] = ['template_1', 7, 9];
const contour = templateContourPoly(TEMPLATE, W, H);
const xs = contour.map((p) => p.x), ys = contour.map((p) => p.y);
const pad = 0.4;
const viewBox = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2];

const renders = [];
// BEFORE: the plain bounding rectangle, exactly what `boardPolygon(editor)` always sends and what
// the pre-fix engine.js fell back to the instant `frame.bands` was empty.
const rectOutline = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const before = bondLayout(rectOutline, SET, [{ pattern: 'stretcher' }]);
renders.push({ name: 'before', render: svgFor(contour, before.cells, viewBox, `BEFORE -- Wall fills boardOutline (${before.cells.length} bricks, red = template's true contour)`) });

// AFTER: the template's own true contour (what frame.primitives now always provides, per the fix).
const after = bondLayout(contour, SET, [{ pattern: 'stretcher' }]);
renders.push({ name: 'after', render: svgFor(contour, after.cells, viewBox, `AFTER -- Wall fills frame.primitives (${after.cells.length} bricks)`) });

for (const r of renders) writeFileSync(`${OUT_DIR}/t86_item14_${r.name}.svg`, r.render.svg);
console.log('wrote', renders.length, 'SVGs to', OUT_DIR);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9464;
const userDataDir = `${process.cwd()}/${OUT_DIR}/chrome-item14-preview`.replace(/\\/g, '/');
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
  const svgPath = `${OUT_DIR}/t86_item14_${r.name}.svg`;
  await send('Page.navigate', { url: pathToFileURL(svgPath).href });
  await sleep(800);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  const pngPath = `${OUT_DIR}/t86_item14_${r.name}.png`;
  writeFileSync(pngPath, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshotted', r.name);
  try {
    const sharedDir = `${os.homedir()}/.bspline-status/shots/seatB`;
    mkdirSync(sharedDir, { recursive: true });
    copyFileSync(pngPath, `${sharedDir}/t86_item14_${r.name}.png`);
  } catch (e) { console.log('shared-status publish skipped:', e.message); }
}
ws.close();
chrome.kill();
