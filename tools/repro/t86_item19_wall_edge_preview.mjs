// T86 item 19 (seat 88's measurement, T1 7x9, Red Brick 0.75, Wall only, no Frame bands): the
// geometry.js pointInPolygon/polygonIntersection boundary-tolerance fix. "before" reproduces the
// pre-fix bondLayout directly (same template contour, same set, no fix applied -- the clip itself,
// not bondLayout's own course-stacking, carried the bug), "after" uses the live, fixed module.
//
// Usage: node tools/repro/t86_item19_wall_edge_preview.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const bricksRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/core/bricks/`;
const imp = (p) => import(bricksRoot + p);
const { BRICK_SETS } = await imp('library.js');
const { rectPolygon } = await imp('geometry.js');
const { bondLayout: bondLayoutAfter } = await imp('layouts/bond.js');

const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const { frameContourSilhouette } = await import(appRoot + 'editor/contour-from-frame.js');
const { normalizeFrameRecord } = await import(appRoot + 'core/frame-record.js');
const FRAME_DEFS = (await import(appRoot + 'data/frame-defs.js')).default;

mkdirSync(OUT_DIR, { recursive: true });

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
  const pts = [];
  for (const prim of raw) {
    if (prim.type === 'arc') {
      for (let k = 0; k <= 24; k++) {
        const t = prim.theta1 + ((prim.theta2 - prim.theta1) * k) / 24;
        pts.push({ x: prim.cx + prim.r * Math.cos(t), y: prim.cy + prim.r * Math.sin(t) });
      }
    } else pts.push(prim.p0);
  }
  return pts;
}

// ---- BEFORE: pre-item-19 pointInPolygon (zero boundary tolerance) + the SAME bondLayout course
// stack (unchanged by item 19) -- isolates exactly what the fix changed.
function pointInPolygonBefore(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y, xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function signedAreaLocal(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
function polygonIntersectionBefore(subject, clip) {
  // faithful port of the pre-fix algorithm (subject[0] seed, no on-edge tolerance)
  const n = subject.length, m = clip.length;
  if (n < 3 || m < 3) return [];
  const onSubject = subject.map(() => []), onClip = clip.map(() => []);
  let anyHit = false;
  const segInt = (p1, p2, p3, p4) => {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y, d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-12) return null;
    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
    const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
    if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
    return { t, u, x: p1.x + t * d1x, y: p1.y + t * d1y };
  };
  for (let i = 0; i < n; i++) {
    const a1 = subject[i], a2 = subject[(i + 1) % n];
    for (let j = 0; j < m; j++) {
      const b1 = clip[j], b2 = clip[(j + 1) % m];
      const hit = segInt(a1, a2, b1, b2);
      if (!hit) continue;
      anyHit = true;
      onSubject[i].push({ t: hit.t, x: hit.x, y: hit.y });
      onClip[j].push({ t: hit.u, x: hit.x, y: hit.y });
    }
  }
  if (!anyHit) return pointInPolygonBefore(subject[0].x, subject[0].y, clip) ? subject.slice() : [];
  for (const list of onSubject) list.sort((p, q) => p.t - q.t);
  for (const list of onClip) list.sort((p, q) => p.t - q.t);
  const EPS = 1e-7, keyOf = (p) => `${Math.round(p.x / EPS)}_${Math.round(p.y / EPS)}`;
  const nodesSubject = [];
  for (let i = 0; i < n; i++) { nodesSubject.push({ x: subject[i].x, y: subject[i].y, isect: false }); for (const hit of onSubject[i]) nodesSubject.push({ x: hit.x, y: hit.y, isect: true }); }
  const nodesClip = [];
  for (let j = 0; j < m; j++) { nodesClip.push({ x: clip[j].x, y: clip[j].y, isect: false }); for (const hit of onClip[j]) nodesClip.push({ x: hit.x, y: hit.y, isect: true }); }
  for (let i = 0; i < nodesSubject.length; i++) nodesSubject[i].next = nodesSubject[(i + 1) % nodesSubject.length];
  for (let j = 0; j < nodesClip.length; j++) nodesClip[j].next = nodesClip[(j + 1) % nodesClip.length];
  const clipByKey = new Map();
  for (const node of nodesClip) if (node.isect) { const k = keyOf(node); if (!clipByKey.has(k)) clipByKey.set(k, []); clipByKey.get(k).push(node); }
  for (const node of nodesSubject) { if (!node.isect) continue; const candidates = clipByKey.get(keyOf(node)); const match = candidates && candidates.find((c) => !c.twin); if (match) { node.twin = match; match.twin = node; } }
  let inside = pointInPolygonBefore(subject[0].x, subject[0].y, clip);
  for (const node of nodesSubject) if (node.isect) { inside = !inside; node.entry = inside; }
  const loops = [], maxSteps = (nodesSubject.length + nodesClip.length) * 2 + 10;
  for (const startNode of nodesSubject) {
    if (!startNode.isect || !startNode.entry || startNode.visited) continue;
    const loop = []; let cur = startNode, steps = 0;
    do {
      loop.push({ x: cur.x, y: cur.y }); cur.visited = true;
      if (cur.isect && cur.twin) cur.twin.visited = true;
      let nxt = cur.next; cur = (nxt.isect && nxt.twin) ? nxt.twin : nxt; steps++;
    } while (cur !== startNode && cur !== startNode.twin && steps < maxSteps);
    if (loop.length >= 3) loops.push(loop);
  }
  if (!loops.length) return [];
  let best = loops[0], bestArea = Math.abs(signedAreaLocal(best));
  for (let i = 1; i < loops.length; i++) { const area = Math.abs(signedAreaLocal(loops[i])); if (area > bestArea) { best = loops[i]; bestArea = area; } }
  const subjectArea = Math.abs(signedAreaLocal(subject));
  if (bestArea > subjectArea * 1.0001 + 1e-9) return [];
  return best;
}
function clipPolygonToBoardBefore(poly, boardOutline) { return polygonIntersectionBefore(poly, boardOutline); }
function bondLayoutBefore(boardOutline, set) {
  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const L = set.brickLengthIn, H = set.brickHeightIn, J = set.grout.widthIn;
  const cH = H, coursePitch = cH + J, maxDim = Math.max(L, H);
  const cells = []; let nextId = 0, cy = minY, courseIndex = 0;
  while (cy <= maxY + maxDim) {
    const courseCy = cy + cH / 2;
    const colPitch = L + J, colCount = Math.ceil((maxX - minX + colPitch) / colPitch) + 1;
    for (let i = -1; i < colCount; i++) {
      const cx = minX + i * colPitch + L / 2;
      if (cx + L / 2 < minX - 1e-6 || cx - L / 2 > maxX + 1e-6) continue;
      const rect = rectPolygon(cx, courseCy, L / 2, cH / 2);
      const clipped = clipPolygonToBoardBefore(rect, boardOutline);
      if (clipped.length < 3) continue;
      cells.push({ id: nextId++, polygon: clipped });
    }
    cy += coursePitch; courseIndex++;
    if (courseIndex > 60) break;
  }
  return { cells };
}

const RENDER_W = 900;
function svgFor(contour, cells, title) {
  const xs = contour.map((p) => p.x), ys = contour.map((p) => p.y);
  const pad = 0.3;
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2, h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  const flipY = (v) => 2 * y + h - v;
  const outline = contour.map((p) => `${p.x.toFixed(4)},${flipY(p.y).toFixed(4)}`).join(' ');
  const pieces = cells.map((c, i) => {
    const pts = c.polygon.map((p) => `${p.x.toFixed(4)},${flipY(p.y).toFixed(4)}`).join(' ');
    const hue = (i * 29) % 360;
    return `<polygon points="${pts}" fill="hsl(${hue},55%,55%)" fill-opacity="0.9" stroke="#333" stroke-width="0.01"/>`;
  }).join('\n');
  const renderH = Math.round(RENDER_W * h / w);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${RENDER_W}" height="${renderH}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#444"/>
  <polygon points="${outline}" fill="none" stroke="#ff2d2d" stroke-width="0.03"/>
  ${pieces}
  <text x="${x + 0.1}" y="${y + 0.4}" font-size="${Math.max(0.18, w * 0.04)}" fill="#fff" stroke="#000" stroke-width="0.01">${title}</text>
</svg>`;
  return { svg, width: RENDER_W, height: renderH };
}

const SET = { ...BRICK_SETS[0], brickLengthIn: 0.75 };
const contour = templateContourPoly('template_1', 7, 9);

const renders = [];
const before = bondLayoutBefore(contour, SET);
renders.push({ name: 'before', render: svgFor(contour, before.cells, `BEFORE -- Wall only, no bands (${before.cells.length} bricks; course 0 + other seams corrupted)`) });

const after = bondLayoutAfter(contour, SET, [{ pattern: 'stretcher' }]);
renders.push({ name: 'after', render: svgFor(contour, after.cells, `AFTER -- Wall only, no bands (${after.cells.length} bricks, clean)`) });

for (const r of renders) writeFileSync(`${OUT_DIR}/t86_item19_${r.name}.svg`, r.render.svg);
console.log('wrote', renders.length, 'SVGs to', OUT_DIR);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9467;
const userDataDir = `${process.cwd()}/${OUT_DIR}/chrome-item19-preview`.replace(/\\/g, '/');
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
  const svgPath = `${OUT_DIR}/t86_item19_${r.name}.svg`;
  await send('Page.navigate', { url: pathToFileURL(svgPath).href });
  await sleep(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  const pngPath = `${OUT_DIR}/t86_item19_${r.name}.png`;
  writeFileSync(pngPath, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshotted', r.name);
  try {
    const sharedDir = `${os.homedir()}/.bspline-status/shots/seatB`;
    mkdirSync(sharedDir, { recursive: true });
    copyFileSync(pngPath, `${sharedDir}/t86_item19_${r.name}.png`);
  } catch (e) { console.log('shared-status publish skipped:', e.message); }
}
ws.close();
chrome.kill();
