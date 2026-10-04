// H23 item 80: Template 19 "Arched Head - Tapered sides" proposal -- the SAME precedent T12/T13 set
// (F30 item 3, "Hourglass - Tapered sides" / "Narrow Neck - Tapered sides"): no new geometry at all,
// just Template 18's own exact params with `taperAngle` activated, the SAME shared `hourglassConstruction`
// T18 already uses (its own `topTaper` branch already accounts for `topInset`/`archRise` together --
// confirmed live here, not assumed: both the untapered and tapered builds report zero outline defects).
// Positive taperAngle leans the head's own sides INWARD going up (narrower toward the arch), per
// `_taperedCorner`'s own doc comment -- exactly "the head narrows toward the arch" the dispatch asks for.
//
// Diagram only, same discipline as every step so far: no template_19 Fusion scaffold exists yet. Stop
// for Fred's OK before building it.
//
// Usage: node tools/repro/h23_item80_template19_proposal.mjs <repoRoot> [outDir]
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const [ROOT_ARG, OUT_DIR_ARG] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG ?? process.cwd()).href.replace(/\/$/, '');
const ROOT_PATH = ROOT_ARG ?? process.cwd();
const OUT_DIR = path.resolve(OUT_DIR_ARG ?? `${ROOT_PATH}/bspline-frame-builder/scratch/h23_item80`);
const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const G = await import(appRoot + 'editor/editor-shape-lattice-generator.js');

mkdirSync(OUT_DIR, { recursive: true });

const W = 7, H = 9, BBO = 0.25;
const region = { x: 0, y: 0, w: W - 2 * BBO, h: H - 2 * BBO };

// Template 18's own exact shipped defaults (template_18/template_data.py's own FRAME_PROVISIONAL_SHAPE).
const t18Params = {
  waistReach: 0.77292, cornerRadiusTop: 0.27692, cornerRadiusBottom: 0.39705,
  waistCenterY: 0.27784, waistRadius: 0.21726, topInset: 0.41092, archRise: 0.19419,
};
// Template 19 proposal: the SAME params, taperAngle activated -- T12/T13's own default (8 deg, Fred's
// own call) is the starting point, PLUS the declared band's own outer end (15 deg, editor-shape-
// lattice-generator.js's own `_range(-15, 15, ...)`) so Fred can see the actual range, not one guess.
const TAPER_DEGS = [0, 8, 15];
const outs = TAPER_DEGS.map((deg) => {
  const params = deg === 0 ? t18Params : { ...t18Params, taperAngle: deg };
  const out = G.generateSilhouette(region, { preset: 'hourglass', params });
  console.log(`taperAngle=${deg} defects:`, JSON.stringify(G.outlineDefects(out.primitives, { requireTangency: false })));
  return out;
});

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
const labels = TAPER_DEGS.map((deg) => deg === 0
  ? 'Template 18 "Arched Head" (shipped, 7x9) -- taper 0 deg'
  : `Template 19 proposal "Arched Head - Tapered sides" -- taper ${deg} deg`);
const svgs = outs.map((out, i) => svgFor(out.primitives, labels[i]));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}
  .row{display:flex;gap:24px;padding:24px;}
  .cap{padding:0 24px;color:#555;max-width:1200px;}
</style></head><body>
<p class="cap">H23 item 80 -- Template 19 "Arched Head - Tapered sides" proposal next to the shipped
Template 18, all at 7x9. Same shape, sides leaning inward toward the arch -- 0 deg (shipped T18), 8 deg
(T12/T13's own default), and 15 deg (the declared band's own outer end) so the actual range is visible,
not one guess. T12/T13's own precedent: no new geometry, taperAngle activated on T18's own existing
construction. Diagram only -- no Fusion scaffold built yet; stopping here for Fred's OK.</p>
<div class="row">${svgs.map((s) => s.svg).join('')}</div>
</body></html>`;
const htmlPath = `${OUT_DIR}/h23_item80_template19_proposal.html`;
writeFileSync(htmlPath, html);
console.log('wrote', htmlPath);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileDir = `${OUT_DIR}/chrome-item80`;
mkdirSync(profileDir, { recursive: true });
const totalW = svgs.reduce((s, v) => s + v.width, 0) + 24 * (svgs.length + 1), totalH = Math.max(...svgs.map((s) => s.height)) + 24 * 2 + 90;
const pngPath = `${OUT_DIR}/h23_item80_template19_proposal.png`;
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profileDir}`, `--screenshot=${pngPath}`, `--window-size=${totalW},${totalH}`,
  pathToFileURL(htmlPath).href,
], { stdio: 'pipe' });
console.log('screenshotted', pngPath);

try {
  const sharedDir = `${os.homedir()}/.bspline-status/shots/seatA`;
  mkdirSync(sharedDir, { recursive: true });
  copyFileSync(pngPath, `${sharedDir}/h23_item80_template19_proposal.png`);
  console.log('published to', `${sharedDir}/h23_item80_template19_proposal.png`);
} catch (e) { console.log('shared-status publish skipped:', e.message); }
