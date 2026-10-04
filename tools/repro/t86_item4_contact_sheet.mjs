// T86 item 4: a contact sheet, one thumbnail per template, soldier_stretcher at 7x9, so the whole
// stress-matrix test set is visible at a glance.
//
// Usage: node tools/repro/t86_item4_contact_sheet.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { tessellate, templatePrimitives as buildTemplatePrimitives } from './t86_item4_matrix_lib.mjs';

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
mkdirSync(OUT_DIR, { recursive: true });

const appRoot = new URL(`file:///${ROOT_ARG.replace(/\\/g, '/').replace(/\/$/, '')}/bspline-frame-builder/b-spline-gen/html/`);
const { frameCutProfile } = await import(appRoot + 'editor/editor-frame-profile.js');
const { normalizeFrameRecord } = await import(appRoot + 'core/frame-record.js');
const FRAME_DEFS = (await import(appRoot + 'data/frame-defs.js')).default;
const { bricksContourBands } = await import(appRoot + 'core/bricks/contour-bands.js');
const { BRICK_SETS, FRAME_PRESETS } = await import(appRoot + 'core/bricks/library.js');

const SET = BRICK_SETS[0];
const TEMPLATE_IDS = FRAME_DEFS.templates.map((t) => t.id).sort((a, b) => {
  const na = parseInt(a.split('_')[1], 10), nb = parseInt(b.split('_')[1], 10);
  return na - nb;
});

// T86 item 4 harness bug fix: was its own duplicate `templatePrimitives`, sourced from
// `frameContourSilhouette(frame, 0, 0)` -- confirmed wrong for template_16/17 (see
// t86_item4_matrix_lib.mjs's own header on `templatePrimitives` for the measured root cause: a
// genuine `outline-offset.js` collapse bug at distance=0, not a harness-only issue). Reuses the
// SAME corrected, `frameCutProfile`-sourced function the matrix runner uses now, declared ONCE
// rather than duplicated a second time in this file.
function templatePrimitives(templateId, W, H) {
  const { primitives, error } = buildTemplatePrimitives(FRAME_DEFS, normalizeFrameRecord, frameCutProfile, templateId, W, H);
  if (error) throw new Error(error);
  return primitives;
}

const PALETTE = ['#c0392b', '#2980b9', '#27ae60', '#d35400', '#8e44ad', '#16a085'];
const CELL = 260;
const COLS = 5;
const rows = Math.ceil(TEMPLATE_IDS.length / COLS);
const cells = [];
for (let i = 0; i < TEMPLATE_IDS.length; i++) {
  const templateId = TEMPLATE_IDS[i];
  const col = i % COLS, row = Math.floor(i / COLS);
  let bodySvg = '', statusText = '', fill = '#111';
  try {
    const primitives = templatePrimitives(templateId, 7, 9);
    const { bricks } = bricksContourBands(primitives, FRAME_PRESETS.soldier_stretcher, { set: SET, seed: 7 });
    const outline = tessellate(primitives);
    const xs = outline.map((p) => p.x), ys = outline.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 0.3;
    const vbX = minX - pad, vbY = minY - pad, vbW = maxX - minX + 2 * pad, vbH = maxY - minY + 2 * pad;
    const scale = Math.min((CELL - 10) / vbW, (CELL - 10) / vbH);
    const tx = col * CELL + (CELL - vbW * scale) / 2 - vbX * scale;
    const ty = row * CELL + 24 + (CELL - 24 - vbH * scale) / 2 - vbY * scale;
    const outlinePts = outline.map((p) => `${p.x},${p.y}`).join(' ');
    const pieces = bricks.map((b, bi) => {
      const pts = b.polygon.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
      return `<polygon points="${pts}" fill="${PALETTE[bi % PALETTE.length]}" fill-opacity="0.55" stroke="#222" stroke-width="${0.02 / scale}"/>`;
    }).join('');
    bodySvg = `<g transform="translate(${tx},${ty}) scale(${scale})"><polygon points="${outlinePts}" fill="none" stroke="#999" stroke-width="${0.04 / scale}"/>${pieces}</g>`;
    statusText = `${bricks.length} pieces`;
  } catch (e) {
    statusText = 'ERROR: ' + String(e && e.message || e).slice(0, 40);
    fill = '#c0392b';
  }
  cells.push(`<text x="${col * CELL + 6}" y="${row * CELL + 16}" font-size="13" fill="#111">${templateId}</text>${bodySvg}<text x="${col * CELL + 6}" y="${row * CELL + CELL - 4}" font-size="10" fill="${fill}">${statusText}</text>`);
}
const svgW = COLS * CELL, svgH = rows * CELL;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">
<rect x="0" y="0" width="${svgW}" height="${svgH}" fill="white"/>
${Array.from({ length: COLS + 1 }, (_, i) => `<line x1="${i * CELL}" y1="0" x2="${i * CELL}" y2="${svgH}" stroke="#eee"/>`).join('')}
${Array.from({ length: rows + 1 }, (_, i) => `<line x1="0" y1="${i * CELL}" x2="${svgW}" y2="${i * CELL}" stroke="#eee"/>`).join('')}
<text x="6" y="${svgH - 6}" font-size="11" fill="#666">T86 item 4 -- all 17 templates, soldier_stretcher, 7x9</text>
${cells.join('\n')}
</svg>`;
const svgPath = `${OUT_DIR}/t86_item4_templates.svg`;
writeFileSync(svgPath, svg);
console.log('wrote', svgPath);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9463;
mkdirSync(`${OUT_DIR}/chrome-contact-sheet`, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT_DIR}/chrome-contact-sheet`,
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
await send('Emulation.setDeviceMetricsOverride', { width: svgW, height: svgH, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(svgPath).href });
await sleep(400);
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: svgW, height: svgH, scale: 1 } });
const pngPath = `${OUT_DIR}/t86_item4_templates.png`;
writeFileSync(pngPath, Buffer.from(shot.result.data, 'base64'));
console.log('wrote', pngPath);
try {
  const sharedDir = `${os.homedir()}/.bspline-status/shots/seatB`;
  mkdirSync(sharedDir, { recursive: true });
  copyFileSync(pngPath, `${sharedDir}/t86_item4_templates.png`);
} catch (e) { console.log('shared-status publish skipped:', e.message); }
ws.close();
chrome.kill();
