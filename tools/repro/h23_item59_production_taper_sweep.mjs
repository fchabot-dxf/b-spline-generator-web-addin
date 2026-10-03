// H23 item 59: does the REAL production path (generateSilhouette -> _solveHourglass ->
// hourglassConstruction, with this item's own hh->hh-archRise fix) produce a CLOSED, gap-free,
// non-defective T10 outline across the full declared taper range, when taperAngle and archRise
// are BOTH resolved together in ONE call (unlike the diagram script's own hand-spliced
// reproduction, which never calls hourglassConstruction with both set at once)?
//
// Usage: node tools/repro/h23_item59_production_taper_sweep.mjs <repoRoot>
import { pathToFileURL } from 'node:url';
const [ROOT_ARG] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG ?? process.cwd()).href.replace(/\/$/, '');
const root = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const imp = (p) => import(root + p);
const { generateSilhouette, outlineDefects, paramsFromShapeModel } = await imp('editor/editor-shape-lattice-generator.js');
const { offsetOutlineInward } = await imp('editor/outline-offset.js');
const { frameMiters } = await imp('editor/editor-frame-profile.js');
const { default: FRAME_DEFS } = await imp('data/frame-defs.js');
const T10 = FRAME_DEFS.templates.find((t) => t.id === 'template_10');

const T = 0.75, BBO = 0.25;
function regionFor(W, H) {
  const hw = W / 2 - BBO, hh = H / 2 - BBO;
  return { hw, hh, region: { x: -hw, y: -hh, w: 2 * hw, h: 2 * hh } };
}
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
const primEnd = (p, atEnd) => (p.type === 'L' ? (atEnd ? p.p1 : p.p0) : { x: p.cx + p.rx * Math.cos(atEnd ? p.theta1 + p.dTheta : p.theta1), y: p.cy + p.ry * Math.sin(atEnd ? p.theta1 + p.dTheta : p.theta1) });
function continuityCheck(prims) {
  let worst = 0, worstAt = null;
  const n = prims.length;
  for (let i = 0; i < n; i++) {
    const a = prims[i], b = prims[(i + 1) % n];
    const gap = Math.hypot(primEnd(a, true).x - primEnd(b, false).x, primEnd(a, true).y - primEnd(b, false).y);
    if (gap > worst) { worst = gap; worstAt = `${i}->${(i + 1) % n}`; }
  }
  return { worstGapIn: worst, worstAt };
}

function checkProduction(taperDeg, W, H) {
  const { hw, hh, region } = regionFor(W, H);
  const resolved = paramsFromShapeModel('hourglass', T10.shapeModel, region);
  const params = { ...resolved, taperAngle: taperDeg };
  const sil = generateSilhouette(region, { preset: 'hourglass', params });
  const prims = sil.primitives;
  const outerDef = outlineDefects(prims, { requireTangency: false }).filter((d) => d.kind !== 'notTangent');
  const continuity = continuityCheck(prims);
  const inner = offsetOutlineInward(prims, T);
  const innerReal = inner.filter((p) => !p.collapsed);
  const innerDef = outlineDefects(innerReal, { requireTangency: false });
  const lens = prims.map(primLength);
  const minLen = Math.min(...lens);
  const miters = frameMiters(prims, inner);
  let oob = 0;
  for (const p of prims) {
    const pts = p.type === 'L' ? [p.p0, p.p1] : Array.from({ length: 9 }, (_, i) => ({ x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta * i / 8), y: p.cy + p.ry * Math.sin(p.theta1 + p.dTheta * i / 8) }));
    for (const q of pts) if (q.x < -hw - 1e-6 || q.x > hw + 1e-6 || q.y < -hh - 1e-6 || q.y > hh + 1e-6) oob++;
  }
  const clean = outerDef.length === 0 && innerDef.length === 0 && oob === 0 && continuity.worstGapIn < 1e-6;
  const ok = clean && minLen >= T - 1e-9;
  const flag = continuity.worstGapIn >= 1e-6 ? `  CONTINUITY GAP ${continuity.worstGapIn.toFixed(4)}in at ${continuity.worstAt}` : '';
  console.log(`PRODUCTION ${W}x${H} taper=${taperDeg.toFixed(1)}deg: outerDef=${outerDef.length} innerDef=${innerDef.length} ` +
    `minLen=${minLen.toFixed(4)} oob=${oob} miters=${miters.length} clean=${clean} OK=${ok}${flag}`);
  if (outerDef.length) console.log('  outerDef', JSON.stringify(outerDef));
  if (innerDef.length) console.log('  innerDef', JSON.stringify(innerDef));
  return { ok, clean, minLen, continuity };
}

console.log('--- T10 production path, hh->hh-archRise fix applied, 7x9 sweep ---');
let anyBad = false;
for (const d of [-15, -10, -8, -4, 0, 4, 8, 10, 15]) {
  const r = checkProduction(d, 7, 9);
  if (!r.clean) anyBad = true;
}
console.log('--- T10 production path, 6x9 sweep ---');
for (const d of [-15, -10, -8, -4, 0, 4, 8, 10, 15]) {
  const r = checkProduction(d, 6, 9);
  if (!r.clean) anyBad = true;
}
console.log('--- T10 production path, 9x12 sweep ---');
for (const d of [-15, -10, -8, -4, 0, 4, 8, 10, 15]) {
  const r = checkProduction(d, 9, 12);
  if (!r.clean) anyBad = true;
}
console.log(anyBad ? 'RESULT: at least one case NOT clean -- see above' : 'RESULT: every case clean (topologically) across all 3 board sizes');
