// H23 item 78b: Template 10 = Fred's reconstruction (narrow head + arched top).
//
// Renders the CURRENT app T10 default shape at 7x9 (via the real production functions,
// generateSilhouette + paramsFromShapeModel against the committed frame-defs.json shapeModel --
// the SAME path the live app's own Frame tab preview uses) side by side with Fred's own hand-
// reconstructed TARGET outline (narrow vertical head, arched top, deep round waist), built directly
// from the exact point/arc data in
// ~/.bspline-status/shots/fred/t10_fred_reconstructed_sketch_dump_2026-10-01.txt (fractions of
// widthIn/heightIn, origin = board centre, y UP).
//
// Diagram only -- no template code is changed here. Per the dispatch (H23 item 78b): render this,
// then STOP for Fred's OK before touching app geometry or Fusion phases.
//
// Coordinate note: `generateSilhouette`'s own convention (confirmed by running it, not assumed) is
// origin at the SAFE-ZONE box's top-left corner (board minus BBO on every side), x right, y DOWN,
// extent (w,h) = (widthIn-2*BBO, heightIn-2*BBO). The dump's own convention is board-CENTRE origin,
// y UP, fractions of the FULL widthIn/heightIn. Converting a dump fraction (fx,fy) to this script's
// frame: x = fx*W + hw, y = hh - fy*H, where hw=(W-2*BBO)/2, hh=(H-2*BBO)/2 -- verified against the
// real generateSilhouette output below (bottom_edge's two dump corners land exactly on (w,h) and
// (0,h), the same two keypoints the real T10 call produces for its own bottom edge).
//
// Usage: node tools/repro/h23_item78b_t10_target_vs_current.mjs <repoRoot> [outDir]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const [ROOT_ARG, OUT_DIR_ARG] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG ?? process.cwd()).href.replace(/\/$/, '');
const ROOT_PATH = ROOT_ARG ?? process.cwd();
// Chrome launched via child_process (execFileSync) on this session's Windows/Node combo fails
// (exit 21, no stderr) when `--user-data-dir`/`--screenshot` are relative paths -- confirmed by
// isolating it (identical flags work from bash job control, and work here once made absolute).
// Resolving against cwd up front avoids re-discovering that for every path this script hands to
// chrome.exe below.
const OUT_DIR = path.resolve(OUT_DIR_ARG ?? `${ROOT_PATH}/bspline-frame-builder/scratch/h23_item78b`);
const appRoot = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const { generateSilhouette, paramsFromShapeModel, outlineDefects, primitiveToPathD, joinSegmentPathsIntoClosedD } =
  await import(appRoot + 'editor/editor-shape-lattice-generator.js');

mkdirSync(OUT_DIR, { recursive: true });

const W = 7, H = 9, BBO = 0.25;
const hw = (W - 2 * BBO) / 2, hh = (H - 2 * BBO) / 2;
const region = { x: 0, y: 0, w: W - 2 * BBO, h: H - 2 * BBO };

// --- CURRENT T10, via the real production path -----------------------------------------------
const defs = JSON.parse(readFileSync(`${ROOT_PATH}/bspline-frame-builder/b-spline-gen/html/data/frame-defs.json`, 'utf8'));
const t10 = defs.templates.find((t) => t.name.includes('Template 10'));
const currentParams = paramsFromShapeModel('hourglass', t10.shapeModel, region);
const currentOut = generateSilhouette(region, { preset: 'hourglass', params: currentParams });
console.log('current T10 resolved params:', JSON.stringify(currentParams));
console.log('current T10 outline defects:', JSON.stringify(outlineDefects(currentOut.primitives, { requireTangency: false })));

// --- TARGET: Fred's hand reconstruction, built directly from the dump's own point/arc data -----
// board-centre, y-up fraction -> this script's safe-zone-origin, y-down frame.
const pt = (fx, fy) => ({ x: fx * W + hw, y: hh - fy * H });
function mkLine(p0, p1) { return { type: 'L', p0, p1 }; }
// Builds an 'A' primitive from a start, centre, end AND a 4th point known to lie on the drawn arc
// (the dump's own 4th column) -- the mid point picks the sweep DIRECTION only (never the radius),
// same `onSweep` technique f30/f31/t84's own bulgeArc uses. Radius = mean of the start/end radii;
// logs all 3 independently-computed radii so a bad transcription shows up as a spread, not a
// silent wrong curve.
function arcPrim(fs, fc, fe, fm) {
  const s = pt(...fs), c = pt(...fc), e = pt(...fe), m = pt(...fm);
  const r1 = Math.hypot(s.x - c.x, s.y - c.y), r2 = Math.hypot(e.x - c.x, e.y - c.y), r3 = Math.hypot(m.x - c.x, m.y - c.y);
  const th0 = Math.atan2(s.y - c.y, s.x - c.x), th1 = Math.atan2(e.y - c.y, e.x - c.x), thMid = Math.atan2(m.y - c.y, m.x - c.x);
  let dTheta = th1 - th0;
  while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
  while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
  const onSweep = (d) => { const u = (((thMid - th0) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) / d; return u > 0 && u < 1; };
  if (!onSweep(dTheta)) dTheta += dTheta > 0 ? -2 * Math.PI : 2 * Math.PI;
  const r = (r1 + r2) / 2;
  console.log(`  arc radii [start,end,mid]=${r1.toFixed(4)},${r2.toFixed(4)},${r3.toFixed(4)} spread=${(Math.max(r1, r2, r3) - Math.min(r1, r2, r3)).toFixed(4)}`);
  return { type: 'A', cx: c.x, cy: c.y, rx: r, ry: r, phi: 0, theta1: th0, dTheta };
}
function linePrim(f0, f1) { return mkLine(pt(...f0), pt(...f1)); }

// Dump fractions (widthIn/heightIn), transcribed verbatim from
// ~/.bspline-status/shots/fred/t10_fred_reconstructed_sketch_dump_2026-10-01.txt. Left side = right
// side mirrored (fx negated) -- the dump's own skeleton pins at x=0 confirm the symmetry.
const TR_top = [0.2735, 0.2523], TR_bot = [0.2735, -0.0154];
const shoulderR_c = [0.2245, -0.0154], shoulderR_s = [0.2185, -0.0533], shoulderR_m = [0.257, -0.044];
const waistR_c = [0.2063, -0.1312], waistR_s = [0.2323, -0.207], waistR_m = [0.1057, -0.1366];
const hipR_c = [0.2799, -0.3455], hipR_s = [0.4643, -0.3455], hipR_m = [0.3922, -0.2318];
const base_BR = [0.4643, -0.4722];
const archC = [0, 0.0515], archApex = [0, 0.344];
const mirror = ([x, y]) => [-x, y];

console.log('--- target arc radius checks ---');
console.log('arc_shoulder_R:'); const shoulderR = arcPrim(TR_bot, shoulderR_c, shoulderR_s, shoulderR_m);
console.log('arc_waist_R:'); const waistR = arcPrim(shoulderR_s, waistR_c, waistR_s, waistR_m);
console.log('arc_hip_R:'); const hipR = arcPrim(waistR_s, hipR_c, hipR_s, hipR_m);
console.log('arc_shoulder_L:'); const shoulderL = arcPrim(mirror(shoulderR_s), mirror(shoulderR_c), mirror(TR_bot), mirror(shoulderR_m));
console.log('arc_waist_L:'); const waistL = arcPrim(mirror(waistR_s), mirror(waistR_c), mirror(shoulderR_s), mirror(waistR_m));
console.log('arc_hip_L:'); const hipL = arcPrim(mirror(hipR_s), mirror(hipR_c), mirror(waistR_s), mirror(hipR_m));
console.log('arch:'); const arch = arcPrim(mirror(TR_top), archC, TR_top, archApex);

const targetPrims = [
  linePrim(TR_top, TR_bot),                 // horn_TR
  shoulderR, waistR, hipR,                  // right side pinch
  linePrim(hipR_s, base_BR),                // horn_BR
  linePrim(base_BR, mirror(base_BR)),       // bottom_edge
  linePrim(mirror(base_BR), mirror(hipR_s)),// horn_BL
  hipL, waistL, shoulderL,                  // left side pinch
  linePrim(mirror(TR_bot), mirror(TR_top)), // horn_TL  (shoulder_L's own end -> TL_top)
  arch,                                     // top_edge (the arch)
];

console.log('target outline defects:', JSON.stringify(outlineDefects(targetPrims, { requireTangency: false })));
// Continuity: every piece's end must exactly meet the next piece's start (same check f30/f31/t84 use).
const primEnd = (p, atEnd) => (p.type === 'L' ? (atEnd ? p.p1 : p.p0) : { x: p.cx + p.rx * Math.cos(atEnd ? p.theta1 + p.dTheta : p.theta1), y: p.cy + p.ry * Math.sin(atEnd ? p.theta1 + p.dTheta : p.theta1) });
let worstGap = 0, worstAt = -1;
for (let i = 0; i < targetPrims.length; i++) {
  const a = targetPrims[i], b = targetPrims[(i + 1) % targetPrims.length];
  const gap = Math.hypot(primEnd(a, true).x - primEnd(b, false).x, primEnd(a, true).y - primEnd(b, false).y);
  if (gap > worstGap) { worstGap = gap; worstAt = i; }
}
console.log(`target continuity: worst gap ${worstGap.toFixed(5)} in, at piece index ${worstAt}`);

// --- render both as SVG panels, side by side -----------------------------------------------------
function svgFor(primitives, label) {
  const d = joinSegmentPathsIntoClosedD(primitives.map((p) => primitiveToPathD(p)));
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

const currentSvg = svgFor(currentOut.primitives, 'CURRENT T10 (7x9, default) -- full-width dome');
const targetSvg = svgFor(targetPrims, "Fred's reconstruction (7x9) -- narrow head + arch");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}
  .row{display:flex;gap:24px;padding:24px;}
  .cap{padding:0 24px;color:#555;max-width:900px;}
</style></head><body>
<p class="cap">H23 item 78b -- Template 10 target (Fred's hand reconstruction) vs the current app default,
both at 7x9. Diagram only; no code changed. Target continuity worst gap: ${worstGap.toFixed(5)} in.</p>
<div class="row">${currentSvg.svg}${targetSvg.svg}</div>
</body></html>`;
const htmlPath = `${OUT_DIR}/h23_item78b_t10_target_vs_current.html`;
writeFileSync(htmlPath, html);
console.log('wrote', htmlPath);

// --- screenshot via headless Chrome's own `--screenshot` CLI flag --------------------------------
// NOTE: the CDP/WebSocket dance t86_item3_shoulder_preview.mjs uses (spawn + Page.navigate +
// Page.captureScreenshot) reliably returns exit code 21 with no server ever coming up when launched
// from THIS session's Node (confirmed: the identical chrome.exe invocation works fine from bash job
// control, so it's specific to how this session's `child_process.spawn` hands off to chrome.exe, not
// a chrome/profile problem). `execFileSync` with the single-shot `--screenshot=<path>` flag sidesteps
// the whole WebSocket layer and was verified working directly in this session first. If a future
// session on a different machine hits the opposite problem, the CDP version above is the fallback.
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileDir = `${OUT_DIR}/chrome-h23-item78b`;
mkdirSync(profileDir, { recursive: true });
const totalW = currentSvg.width + targetSvg.width + 24 * 3, totalH = Math.max(currentSvg.height, targetSvg.height) + 24 * 2 + 90;
const pngPath = `${OUT_DIR}/h23_item78b_t10_target_vs_current.png`;
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profileDir}`, `--screenshot=${pngPath}`, `--window-size=${totalW},${totalH}`,
  pathToFileURL(htmlPath).href,
], { stdio: 'pipe' });
console.log('screenshotted', pngPath);

try {
  const sharedDir = `${os.homedir()}/.bspline-status/shots/seatA`;
  mkdirSync(sharedDir, { recursive: true });
  copyFileSync(pngPath, `${sharedDir}/h23_item78b_t10_target_vs_current.png`);
  console.log('published to', `${sharedDir}/h23_item78b_t10_target_vs_current.png`);
} catch (e) { console.log('shared-status publish skipped:', e.message); }
