// H23 item 78c: Fred's final call on the narrow-head+arch shape -- it's a NEW template (Template 18
// "Arched Head"), not a replacement for Template 10 (which this branch now reverts to exactly its
// original, live shape -- see WORK-LOG.md). Keeps Fred's own exact head proportions (topInset,
// archRise, waistReach, waistCenterY, waistRadius, cornerRadiusBottom) from the approved fit; only
// the shoulder (cornerRadiusTop) uses the rounder, Fred-approved 0.9in value from H23 item 78b step 1
// (clears the undercut guard; his exact 0.343in sketch value doesn't, at frame_thickness=0.75in).
//
// Diagram only, same discipline as every step so far: no template_18 Fusion scaffold exists yet (no
// sketches/template_18/ folder, nothing registered in frame-defs.json) -- this renders the PROPOSED
// shape directly via generateSilhouette, the same way the very first H23 item 78b diagram did before
// any template existed. Stop for Fred's OK before building the real Fusion scaffold.
//
// Usage: node tools/repro/h23_item78c_template18_proposal.mjs <repoRoot> [outDir]
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const [ROOT_ARG, OUT_DIR_ARG] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG ?? process.cwd()).href.replace(/\/$/, '');
const ROOT_PATH = ROOT_ARG ?? process.cwd();
const OUT_DIR = path.resolve(OUT_DIR_ARG ?? `${ROOT_PATH}/bspline-frame-builder/scratch/h23_item78c`);
const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const G = await import(appRoot + 'editor/editor-shape-lattice-generator.js');

mkdirSync(OUT_DIR, { recursive: true });

const W = 7, H = 9, BBO = 0.25;
const hw = (W - 2 * BBO) / 2, hh = (H - 2 * BBO) / 2;
const region = { x: 0, y: 0, w: W - 2 * BBO, h: H - 2 * BBO };

// --- TEMPLATE 18 PROPOSAL: Fred's exact head proportions, rounder (Fred-approved) shoulder ------
const t18Params = {
  waistReach: 0.77292, cornerRadiusTop: 0.27692, cornerRadiusBottom: 0.39705,
  waistCenterY: 0.27784, waistRadius: 0.21726, topInset: 0.41092, archRise: 0.19419,
};
const t18Out = G.generateSilhouette(region, { preset: 'hourglass', params: t18Params });
console.log('Template 18 proposal params:', JSON.stringify(t18Params));
console.log('Template 18 proposal outline defects:', JSON.stringify(G.outlineDefects(t18Out.primitives, { requireTangency: false })));

// --- Fred's exact hand reconstruction (unchanged, same dump-derived build as every prior step) ---
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

// --- render both as SVG panels, side by side -----------------------------------------------------
function svgFor(primitives, label) {
  const d = G.joinSegmentPathsIntoClosedD(primitives.map((p) => G.primitiveToPathD(p)));
  const pad = 0.5;
  const vbX = -BBO - pad, vbY = -BBO - pad, vbW = W + 2 * pad, vbH = H + 2 * pad;
  const RENDER_W = 460, renderH = Math.round(RENDER_W * vbH / vbW);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RENDER_W}" height="${renderH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">
    <rect x="${-BBO}" y="${-BBO}" width="${W}" height="${H}" fill="#f7f7f7" stroke="#e05050" stroke-width="0.02" stroke-dasharray="0.08 0.06"/>
    <path d="${d}" fill="#d9b48a" stroke="#5a3a28" stroke-width="0.04"/>
    <text x="${W / 2 - BBO}" y="${vbY + 0.22}" font-size="0.22" text-anchor="middle" fill="#333">${label}</text>
  </svg>`;
  return { svg, width: RENDER_W, height: renderH };
}
const t18Svg = svgFor(t18Out.primitives, 'Template 18 "Arched Head" proposal (7x9) -- 0.9in shoulder');
const targetSvg = svgFor(targetPrims, "Fred's exact sketch (7x9) -- 0.343in shoulder");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}
  .row{display:flex;gap:24px;padding:24px;}
  .cap{padding:0 24px;color:#555;max-width:900px;}
</style></head><body>
<p class="cap">H23 item 78c -- NEW Template 18 "Arched Head" proposal vs Fred's exact sketch, both at 7x9.
Template 10 is UNCHANGED (reverted to its live shape, see WORK-LOG.md). Diagram only -- no Fusion
scaffold built yet; stopping here for Fred's OK.</p>
<div class="row">${t18Svg.svg}${targetSvg.svg}</div>
</body></html>`;
const htmlPath = `${OUT_DIR}/h23_item78c_template18_proposal.html`;
writeFileSync(htmlPath, html);
console.log('wrote', htmlPath);

// --- screenshot via headless Chrome's own `--screenshot` CLI flag --------------------------------
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileDir = `${OUT_DIR}/chrome-item78c`;
mkdirSync(profileDir, { recursive: true });
const totalW = t18Svg.width + targetSvg.width + 24 * 3, totalH = Math.max(t18Svg.height, targetSvg.height) + 24 * 2 + 90;
const pngPath = `${OUT_DIR}/h23_item78c_template18_proposal.png`;
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profileDir}`, `--screenshot=${pngPath}`, `--window-size=${totalW},${totalH}`,
  pathToFileURL(htmlPath).href,
], { stdio: 'pipe' });
console.log('screenshotted', pngPath);

try {
  const sharedDir = `${os.homedir()}/.bspline-status/shots/seatA`;
  mkdirSync(sharedDir, { recursive: true });
  copyFileSync(pngPath, `${sharedDir}/h23_item78c_template18_proposal.png`);
  console.log('published to', `${sharedDir}/h23_item78c_template18_proposal.png`);
} catch (e) { console.log('shared-status publish skipped:', e.message); }
