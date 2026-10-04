// H23 item 79: Template 9 "I Shape" -- Fred wants taller flanges than the current default
// (flangeHeightOfHh = 0.4, template_9/template_data.py's own FRAME_PROVISIONAL_SHAPE). The default
// sits close to the FLOOR of the feasible range (frame-handles.js's own opening-rule narrowing), not
// its middle -- MEASURED: 0.365-0.40 (7x9/6x9) to 0.735 (their own ceiling), 0.270-0.804 at 9x12. Lots
// of headroom above the current default.
//
// Diagram only, same discipline as every proposal so far: no template_data.py edit yet. A few
// candidate values across the available room (not one guess), at 7x9, so Fred can pick (or ask for a
// different one). Stop here for his OK.
//
// Usage: node tools/repro/h23_item79_template9_taller_flanges_proposal.mjs <repoRoot> [outDir]
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const [ROOT_ARG, OUT_DIR_ARG] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG ?? process.cwd()).href.replace(/\/$/, '');
const ROOT_PATH = ROOT_ARG ?? process.cwd();
const OUT_DIR = path.resolve(OUT_DIR_ARG ?? `${ROOT_PATH}/bspline-frame-builder/scratch/h23_item79`);
const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const G = await import(appRoot + 'editor/editor-shape-lattice-generator.js');

mkdirSync(OUT_DIR, { recursive: true });

const W = 7, H = 9, BBO = 0.25;
const region = { x: 0, y: 0, w: W - 2 * BBO, h: H - 2 * BBO };

// Template 9's own current default (template_9/template_data.py's own FRAME_PROVISIONAL_SHAPE).
const STEM = 0.45;
const FLANGE_HEIGHTS = [0.4, 0.5, 0.6, 0.7]; // current, then 3 taller options across the room to 0.735 (7x9's own ceiling)

const outs = FLANGE_HEIGHTS.map((fh) => {
  const params = { stemHalfWidth: STEM, flangeHeight: fh };
  const out = G.generateSilhouette(region, { preset: 'iShape', params });
  console.log(`flangeHeight=${fh}:`, JSON.stringify(G.outlineDefects(out.primitives, { requireTangency: false })));
  return out;
});

function svgFor(primitives, label) {
  const d = G.joinSegmentPathsIntoClosedD(primitives.map((p) => G.primitiveToPathD(p)));
  const pad = 0.5;
  const vbX = -BBO - pad, vbY = -BBO - pad, vbW = W + 2 * pad, vbH = H + 2 * pad;
  const RENDER_W = 360, renderH = Math.round(RENDER_W * vbH / vbW);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RENDER_W}" height="${renderH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">
    <rect x="${-BBO}" y="${-BBO}" width="${W}" height="${H}" fill="#f7f7f7" stroke="#e05050" stroke-width="0.02" stroke-dasharray="0.08 0.06"/>
    <path d="${d}" fill="#d9b48a" stroke="#5a3a28" stroke-width="0.04"/>
    <text x="${W / 2 - BBO}" y="${vbY + 0.22}" font-size="0.22" text-anchor="middle" fill="#333">${label}</text>
  </svg>`;
  return { svg, width: RENDER_W, height: renderH };
}
const labels = FLANGE_HEIGHTS.map((fh, i) => i === 0 ? `Template 9 (shipped, 7x9) -- flangeHeight ${fh}` : `proposal -- flangeHeight ${fh}`);
const svgs = outs.map((out, i) => svgFor(out.primitives, labels[i]));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}
  .row{display:flex;gap:20px;padding:24px;}
  .cap{padding:0 24px;color:#555;max-width:1200px;}
</style></head><body>
<p class="cap">H23 item 79 -- Template 9 "I Shape", taller flanges than the shipped default (0.4), at
7x9. The default sits near the feasible range's own floor (0.365-0.40 here); 3 taller options shown
across the room to its own ceiling (0.735). Diagram only -- no template change yet; stopping here for
Fred's OK on which value (or a different one).</p>
<div class="row">${svgs.map((s) => s.svg).join('')}</div>
</body></html>`;
const htmlPath = `${OUT_DIR}/h23_item79_template9_taller_flanges_proposal.html`;
writeFileSync(htmlPath, html);
console.log('wrote', htmlPath);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileDir = `${OUT_DIR}/chrome-item79`;
mkdirSync(profileDir, { recursive: true });
const totalW = svgs.reduce((s, v) => s + v.width, 0) + 24 * (svgs.length + 1), totalH = Math.max(...svgs.map((s) => s.height)) + 24 * 2 + 90;
const pngPath = `${OUT_DIR}/h23_item79_template9_taller_flanges_proposal.png`;
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profileDir}`, `--screenshot=${pngPath}`, `--window-size=${totalW},${totalH}`,
  pathToFileURL(htmlPath).href,
], { stdio: 'pipe' });
console.log('screenshotted', pngPath);

try {
  const sharedDir = `${os.homedir()}/.bspline-status/shots/seatA`;
  mkdirSync(sharedDir, { recursive: true });
  copyFileSync(pngPath, `${sharedDir}/h23_item79_template9_taller_flanges_proposal.png`);
  console.log('published to', `${sharedDir}/h23_item79_template9_taller_flanges_proposal.png`);
} catch (e) { console.log('shared-status publish skipped:', e.message); }
