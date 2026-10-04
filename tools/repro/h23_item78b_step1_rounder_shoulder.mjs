// H23 item 78b, Step 1 (Fred OK'd a rounder shoulder, ~0.9in, to clear the undercut guard): renders
// the NEW T10 (this worktree's own frame-defs.json, cornerRadiusTopOfHw 0.27692 = 0.9in at 7x9) next
// to Fred's own EXACT hand-reconstructed sketch (unchanged from the diagram step) and the OLD T10
// shape still live on main (archRise 0.35, taperAngle 8, no topInset -- the shape this branch
// replaces), all at 7x9, plus the undercut/no-hook guard status for the NEW shape.
//
// Builds on tools/repro/h23_item78b_t10_target_vs_current.mjs (same dump-based target
// reconstruction, same coordinate-frame derivation, same screenshot approach -- see that script's
// own header for the full reasoning); kept as its own file rather than editing that one, since that
// one is the durable record of the original diagram-first step.
//
// Usage: node tools/repro/h23_item78b_step1_rounder_shoulder.mjs <repoRoot> [outDir]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const [ROOT_ARG, OUT_DIR_ARG] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG ?? process.cwd()).href.replace(/\/$/, '');
const ROOT_PATH = ROOT_ARG ?? process.cwd();
const OUT_DIR = path.resolve(OUT_DIR_ARG ?? `${ROOT_PATH}/bspline-frame-builder/scratch/h23_item78b_step1`);
const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const G = await import(appRoot + 'editor/editor-shape-lattice-generator.js');
const { outlineHasUndercut, frameCutProfile } = await import(appRoot + 'editor/editor-frame-profile.js');
const { normalizeFrameRecord } = await import(appRoot + 'core/frame-record.js');

mkdirSync(OUT_DIR, { recursive: true });

const W = 7, H = 9, BBO = 0.25;
const hw = (W - 2 * BBO) / 2, hh = (H - 2 * BBO) / 2;
const region = { x: 0, y: 0, w: W - 2 * BBO, h: H - 2 * BBO };

// --- NEW T10 (this worktree's own frame-defs.json: rounder shoulder, Fred-approved) -------------
const defs = JSON.parse(readFileSync(`${ROOT_PATH}/bspline-frame-builder/b-spline-gen/html/data/frame-defs.json`, 'utf8'));
const t10 = defs.templates.find((t) => t.name.includes('Template 10'));
const newParams = G.paramsFromShapeModel('hourglass', t10.shapeModel, region);
const newOut = G.generateSilhouette(region, { preset: 'hourglass', params: newParams });
console.log('NEW T10 resolved params:', JSON.stringify(newParams));
console.log('NEW T10 outline defects:', JSON.stringify(G.outlineDefects(newOut.primitives, { requireTangency: false })));
const rec = normalizeFrameRecord({ templateId: 'template_10' });
const cutProfile = frameCutProfile(defs, rec, { widthIn: W, heightIn: H });
const isUndercut = outlineHasUndercut(cutProfile.primitives);
console.log('NEW T10 undercut guard:', isUndercut ? 'STILL BROKEN' : 'clear');
// no-hook guard needs happy-dom (frame-panel.js touches `document`); only probe it if available, so
// this script still runs (minus that one line) somewhere happy-dom isn't installed.
let hookStatus = 'not probed (happy-dom unavailable)';
try {
  const { Window } = await import(`${ROOT}/node_modules/happy-dom/lib/index.js`);
  const w = new Window();
  for (const k of ['document', 'window', 'navigator', 'localStorage', 'DOMParser', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'CustomEvent', 'Event']) {
    try { if (!(k in globalThis) || k === 'navigator') Object.defineProperty(globalThis, k, { value: w[k] ?? w, configurable: true, writable: true }); } catch { /* ignore */ }
  }
  const { _frameRecordBreaksNoHookRule } = await import(appRoot + 'main/frame-panel.js');
  hookStatus = _frameRecordBreaksNoHookRule(rec) ? 'STILL BROKEN' : 'clear';
} catch (e) { console.log('hook-rule probe skipped:', e.message); }
console.log('NEW T10 no-hook guard:', hookStatus);

// --- OLD T10, still live on main (archRise 0.35, taperAngle 8, no topInset) ----------------------
// Hardcoded from main's own committed frame-defs.json shapeModel (post-revert, 2026-10-04) -- this
// worktree no longer has the old shape anywhere in its own tree to read it from live.
const OLD_SHAPE_MODEL = {
  features: {
    archRise: { hh: 0, hw: 0.35 }, cornerR: { hh: 0.134309, hw: 0.01741 }, depth: { hh: -0.052481, hw: 0.38866 },
    notch: { hh: 0.232589, hw: 0.09041 }, taperAngle: { const: 8, hh: 0, hw: 0 },
    waistCy: { hh: 0.000101, hw: 0.00008 }, waistR: { hh: 0.200276, hw: -0.0517 },
  },
};
const oldParams = G.paramsFromShapeModel('hourglass', OLD_SHAPE_MODEL, region);
const oldOut = G.generateSilhouette(region, { preset: 'hourglass', params: oldParams });
console.log('OLD T10 (live on main) resolved params:', JSON.stringify(oldParams));

// --- Fred's exact hand reconstruction (unchanged from the diagram step) --------------------------
const pt = (fx, fy) => ({ x: fx * W + hw, y: hh - fy * H });
function mkLine(p0, p1) { return { type: 'L', p0, p1 }; }
function arcPrim(fs, fc, fe, fm) {
  const s = pt(...fs), c = pt(...fc), e = pt(...fe), m = pt(...fm);
  const r1 = Math.hypot(s.x - c.x, s.y - c.y), r2 = Math.hypot(e.x - c.x, e.y - c.y);
  const th0 = Math.atan2(s.y - c.y, s.x - c.x), th1 = Math.atan2(e.y - c.y, e.x - c.x), thMid = Math.atan2(m.y - c.y, m.x - c.x);
  let dTheta = th1 - th0;
  while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
  while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
  const onSweep = (d) => { const u = (((thMid - th0) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) / d; return u > 0 && u < 1; };
  if (!onSweep(dTheta)) dTheta += dTheta > 0 ? -2 * Math.PI : 2 * Math.PI;
  return { type: 'A', cx: c.x, cy: c.y, rx: (r1 + r2) / 2, ry: (r1 + r2) / 2, phi: 0, theta1: th0, dTheta };
}
function linePrim(f0, f1) { return mkLine(pt(...f0), pt(...f1)); }
const TR_top = [0.2735, 0.2523], TR_bot = [0.2735, -0.0154];
const shoulderR_c = [0.2245, -0.0154], shoulderR_s = [0.2185, -0.0533], shoulderR_m = [0.257, -0.044];
const waistR_c = [0.2063, -0.1312], waistR_s = [0.2323, -0.207], waistR_m = [0.1057, -0.1366];
const hipR_c = [0.2799, -0.3455], hipR_s = [0.4643, -0.3455], hipR_m = [0.3922, -0.2318];
const base_BR = [0.4643, -0.4722];
const archC = [0, 0.0515], archApex = [0, 0.344];
const mirror = ([x, y]) => [-x, y];
const shoulderR = arcPrim(TR_bot, shoulderR_c, shoulderR_s, shoulderR_m);
const waistR_ = arcPrim(shoulderR_s, waistR_c, waistR_s, waistR_m);
const hipR = arcPrim(waistR_s, hipR_c, hipR_s, hipR_m);
const shoulderL = arcPrim(mirror(shoulderR_s), mirror(shoulderR_c), mirror(TR_bot), mirror(shoulderR_m));
const waistL = arcPrim(mirror(waistR_s), mirror(waistR_c), mirror(shoulderR_s), mirror(waistR_m));
const hipL = arcPrim(mirror(hipR_s), mirror(hipR_c), mirror(waistR_s), mirror(hipR_m));
const arch = arcPrim(mirror(TR_top), archC, TR_top, archApex);
const targetPrims = [
  linePrim(TR_top, TR_bot), shoulderR, waistR_, hipR, linePrim(hipR_s, base_BR), linePrim(base_BR, mirror(base_BR)),
  linePrim(mirror(base_BR), mirror(hipR_s)), hipL, waistL, shoulderL, linePrim(mirror(TR_bot), mirror(TR_top)), arch,
];

// --- render all 3 as SVG panels, side by side -----------------------------------------------------
function svgFor(primitives, label) {
  const d = G.joinSegmentPathsIntoClosedD(primitives.map((p) => G.primitiveToPathD(p)));
  const pad = 0.5;
  const vbX = -BBO - pad, vbY = -BBO - pad, vbW = W + 2 * pad, vbH = H + 2 * pad;
  const RENDER_W = 420, renderH = Math.round(RENDER_W * vbH / vbW);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RENDER_W}" height="${renderH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">
    <rect x="${-BBO}" y="${-BBO}" width="${W}" height="${H}" fill="#f7f7f7" stroke="#e05050" stroke-width="0.02" stroke-dasharray="0.08 0.06"/>
    <path d="${d}" fill="#d9b48a" stroke="#5a3a28" stroke-width="0.04"/>
    <text x="${W / 2 - BBO}" y="${vbY + 0.22}" font-size="0.2" text-anchor="middle" fill="#333">${label}</text>
  </svg>`;
  return { svg, width: RENDER_W, height: renderH };
}
const oldSvg = svgFor(oldOut.primitives, 'OLD T10 (live on main) -- full-width dome');
const newSvg = svgFor(newOut.primitives, `NEW T10 (branch) -- rounder shoulder ~0.9in (undercut:${isUndercut ? 'BROKEN' : 'clear'}, hook:${hookStatus === 'clear' ? 'clear' : 'BROKEN'})`);
const targetSvg = svgFor(targetPrims, "Fred's exact sketch -- shoulder 0.343in");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}
  .row{display:flex;gap:20px;padding:24px;}
  .cap{padding:0 24px;color:#555;max-width:1100px;}
</style></head><body>
<p class="cap">H23 item 78b, Step 1 -- Template 10: old (live) vs new (rounder shoulder, this branch) vs
Fred's exact sketch, all at 7x9. NEW's own guard status: undercut ${isUndercut ? 'STILL BROKEN' : 'clear'},
no-hook ${hookStatus}. Not merged to main yet (t10-reconstruction branch).</p>
<div class="row">${oldSvg.svg}${newSvg.svg}${targetSvg.svg}</div>
</body></html>`;
const htmlPath = `${OUT_DIR}/h23_item78b_step1_rounder_shoulder.html`;
writeFileSync(htmlPath, html);
console.log('wrote', htmlPath);

// --- screenshot via headless Chrome's own `--screenshot` CLI flag (see the diagram script's own
// header for why this, not the CDP/WebSocket pattern, on this session) ---------------------------
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileDir = `${OUT_DIR}/chrome-step1`;
mkdirSync(profileDir, { recursive: true });
const totalW = oldSvg.width + newSvg.width + targetSvg.width + 20 * 4, totalH = Math.max(oldSvg.height, newSvg.height, targetSvg.height) + 24 * 2 + 90;
const pngPath = `${OUT_DIR}/h23_item78b_step1_rounder_shoulder.png`;
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profileDir}`, `--screenshot=${pngPath}`, `--window-size=${totalW},${totalH}`,
  pathToFileURL(htmlPath).href,
], { stdio: 'pipe' });
console.log('screenshotted', pngPath);

try {
  const sharedDir = `${os.homedir()}/.bspline-status/shots/seatA`;
  mkdirSync(sharedDir, { recursive: true });
  copyFileSync(pngPath, `${sharedDir}/h23_item78b_step1_rounder_shoulder.png`);
  console.log('published to', `${sharedDir}/h23_item78b_step1_rounder_shoulder.png`);
} catch (e) { console.log('shared-status publish skipped:', e.message); }
