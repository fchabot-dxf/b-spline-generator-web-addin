// T86 item 15: the empty course at the top of a Wall fill, now filled with a cut course. "before"
// reproduces the pre-fix bondLayout inline (no cut-course step after the declared course stack),
// "after" imports the live module. Straight-top (a sized zone, residual = 0.5 x brickHeightIn) and
// arched-top (apex = 0.6 x brickHeightIn above the springing line) boards, same construction as
// tests/bricks-bond-cut-course.test.js.
//
// Usage: node tools/repro/t86_item15_cut_course_preview.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const bricksRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/core/bricks/`;
const imp = (p) => import(bricksRoot + p);
const { BRICK_SETS, BRICK_PATTERNS } = await imp('library.js');
const { rectPolygon, clipPolygonToBoard } = await imp('geometry.js');
const { bondLayout: bondLayoutAfter } = await imp('layouts/bond.js');

mkdirSync(OUT_DIR, { recursive: true });

const SET = BRICK_SETS[0];
const { brickLengthIn: L, brickHeightIn: H, grout } = SET;
const J = grout.widthIn;
const N_WHOLE_COURSES = 3;

// ---- BEFORE: the pre-item-15 bondLayout, copied verbatim (no cut-course step) ----
function uniformRowBefore(courseIndex, pattern, minX, maxX, courseCy, cH) {
  const cL = L; // stretcher-only in this preview
  const colPitch = cL + J;
  const colCount = Math.ceil((maxX - minX + colPitch) / colPitch) + 1;
  const row = [];
  for (let i = -1; i < colCount; i++) {
    const cx = minX + i * colPitch + cL / 2;
    if (cx + cL / 2 < minX - 1e-6 || cx - cL / 2 > maxX + 1e-6) continue;
    row.push({ courseIndex, colIndex: row.length, cx, cy: courseCy, polygon: rectPolygon(cx, courseCy, cL / 2, cH / 2) });
  }
  return row;
}
function bondLayoutBefore(boardOutline) {
  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const maxDim = Math.max(L, H);
  const courses = [];
  let cy = minY;
  for (let c = 0; c < N_WHOLE_COURSES; c++) {
    const cH = H, coursePitch = cH + J, courseCy = cy + cH / 2;
    courses.push(uniformRowBefore(c, null, minX, maxX, courseCy, cH));
    cy += coursePitch;
    if (cy > maxY + maxDim) break;
  }
  const cells = [];
  let nextId = 0;
  for (let c = 0; c < courses.length; c++) {
    for (const cell of courses[c]) {
      const clipped = clipPolygonToBoard(cell.polygon, boardOutline, { x: cell.cx, y: cell.cy });
      if (clipped.length < 3) continue;
      cells.push({ id: nextId++, polygon: clipped });
    }
  }
  return { cells };
}

function rectBoardWithResidual(fraction) {
  const width = 6, height = N_WHOLE_COURSES * (H + J) + fraction * H;
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
}
function archBoardWithApex(apexFraction) {
  const width = 6, springY = N_WHOLE_COURSES * (H + J);
  const apexY = springY + apexFraction * H;
  const r = (width / 2) ** 2 / (2 * (apexY - springY)) + (apexY - springY) / 2;
  const cy = springY + (apexY - springY) - r;
  const pts = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: springY }];
  const STEPS = 24;
  for (let i = 0; i <= STEPS; i++) {
    const x = width - (width * i) / STEPS;
    const dx = x - width / 2;
    const y = cy + Math.sqrt(Math.max(0, r * r - dx * dx));
    pts.push({ x, y });
  }
  pts.push({ x: 0, y: springY });
  return pts;
}

const RENDER_W = 900;
function svgFor(board, cells, title) {
  const xs = board.map((p) => p.x), ys = board.map((p) => p.y);
  const pad = 0.3;
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2, h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  // board-inch y grows UP (courses stack from minY toward maxY); SVG y grows DOWN -- flip within the
  // viewBox's own bounds so the board's own top (larger y) renders at the top of the image.
  const flipY = (v) => 2 * y + h - v;
  const outline = board.map((p) => `${p.x.toFixed(4)},${flipY(p.y).toFixed(4)}`).join(' ');
  const pieces = cells.map((c, i) => {
    const pts = c.polygon.map((p) => `${p.x.toFixed(4)},${flipY(p.y).toFixed(4)}`).join(' ');
    const hue = (i * 29) % 360;
    return `<polygon points="${pts}" fill="hsl(${hue},55%,55%)" fill-opacity="0.9" stroke="#333" stroke-width="0.01"/>`;
  }).join('\n');
  const renderH = Math.round(RENDER_W * h / w);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${RENDER_W}" height="${renderH}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#444"/>
  <polygon points="${outline}" fill="none" stroke="#ff2d2d" stroke-width="0.04"/>
  ${pieces}
  <text x="${x + 0.1}" y="${y + 0.4}" font-size="${Math.max(0.18, w * 0.04)}" fill="#fff" stroke="#000" stroke-width="0.01">${title}</text>
</svg>`;
  return { svg, width: RENDER_W, height: renderH };
}

const SIZED_ZONE = [{ pattern: 'stretcher', rows: N_WHOLE_COURSES }];
void BRICK_PATTERNS;
const renders = [];

{
  const board = rectBoardWithResidual(0.5);
  const before = bondLayoutBefore(board);
  renders.push({ name: 'straight_before', render: svgFor(board, before.cells, `BEFORE -- straight top (${before.cells.length} bricks, gap at top)`) });
  const after = bondLayoutAfter(board, SET, SIZED_ZONE);
  renders.push({ name: 'straight_after', render: svgFor(board, after.cells, `AFTER -- straight top (${after.cells.length} bricks, cut course added)`) });
}
{
  const board = archBoardWithApex(0.6);
  const before = bondLayoutBefore(board);
  renders.push({ name: 'arched_before', render: svgFor(board, before.cells, `BEFORE -- arched top (${before.cells.length} bricks, gap under the arch)`) });
  const after = bondLayoutAfter(board, SET, SIZED_ZONE);
  renders.push({ name: 'arched_after', render: svgFor(board, after.cells, `AFTER -- arched top (${after.cells.length} bricks, cut course fills it)`) });
}

for (const r of renders) writeFileSync(`${OUT_DIR}/t86_item15_${r.name}.svg`, r.render.svg);
console.log('wrote', renders.length, 'SVGs to', OUT_DIR);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9465;
const userDataDir = `${process.cwd()}/${OUT_DIR}/chrome-item15-preview`.replace(/\\/g, '/');
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
  const svgPath = `${OUT_DIR}/t86_item15_${r.name}.svg`;
  await send('Page.navigate', { url: pathToFileURL(svgPath).href });
  await sleep(800);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  const pngPath = `${OUT_DIR}/t86_item15_${r.name}.png`;
  writeFileSync(pngPath, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshotted', r.name);
  try {
    const sharedDir = `${os.homedir()}/.bspline-status/shots/seatB`;
    mkdirSync(sharedDir, { recursive: true });
    copyFileSync(pngPath, `${sharedDir}/t86_item15_${r.name}.png`);
  } catch (e) { console.log('shared-status publish skipped:', e.message); }
}
ws.close();
chrome.kill();
