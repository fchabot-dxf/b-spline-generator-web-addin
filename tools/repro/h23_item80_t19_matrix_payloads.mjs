// H23 item 80 (T18's own live-matrix precedent, applied to Template 19): every declared handle at its
// own REACHABLE {min, max} (item 64's own bisection against the no-hook guard) plus the plain default,
// at 7x9 and 9x12 -- 22 cases total (5 handles x 2 ends + 1 default, x 2 sizes), written as seedGeometry
// payloads for a live Fusion build.
// Usage: node h23_item80_t19_matrix_payloads.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const root = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const imp = (p) => import(root + p);
const { frameCutProfile } = await imp('editor/editor-frame-profile.js');
const { frameSeedGeometry, frameParamRanges } = await imp('editor/frame-handles.js');
const { paramsFromShapeModel } = await imp('editor/editor-shape-lattice-generator.js');
const { normalizeFrameRecord } = await imp('core/frame-record.js');
const { default: FRAME_DEFS } = await imp('data/frame-defs.js');
const { P } = await imp('core/state.js');
const { _frameRecordBreaksNoHookRule } = await imp('main/frame-panel.js');

mkdirSync(OUT_DIR, { recursive: true });
const templateId = 'template_19';
const T = FRAME_DEFS.templates.find((t) => t.id === templateId);

function reachableEnd(safeVal, end, key) {
  const isBad = (val) => _frameRecordBreaksNoHookRule(normalizeFrameRecord({ templateId, seeds: { [key]: val } }));
  if (!isBad(end)) return end;
  let lo = safeVal, hi = end;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (isBad(mid)) hi = mid; else lo = mid;
  }
  return lo;
}

const manifest = [];
for (const [W, H] of [[7, 9], [9, 12]]) {
  P.widthIn = W; P.heightIn = H;
  const baseRec = normalizeFrameRecord({ templateId, seeds: {} });
  const region = frameCutProfile(FRAME_DEFS, baseRec, { widthIn: W, heightIn: H }).region;
  const t = (T.params.find((p) => p.name === 'frame_thickness') || {}).default ?? 0.75;
  const resolved = paramsFromShapeModel(T.silhouettePreset, T.shapeModel, region);
  const ranges = frameParamRanges(T, region, resolved, t);
  console.log(`${W}x${H} resolved:`, JSON.stringify(resolved));

  const cases = [['default', {}]];
  for (const h of T.handles) {
    const range = ranges[h.key];
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      console.log('  SKIP (no finite range)', h.key, JSON.stringify(range));
      continue;
    }
    const safeVal = resolved[h.key] ?? (range.min + range.max) / 2;
    for (const [tag, declaredEnd] of [['min', range.min], ['max', range.max]]) {
      const val = reachableEnd(safeVal, declaredEnd, h.key);
      cases.push([`${h.key}_${tag}`, { [h.key]: val }]);
    }
  }
  for (const [tag, seeds] of cases) {
    const rec = normalizeFrameRecord({ templateId, seeds });
    const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
    const seedGeometry = frameSeedGeometry(T, prof, W, H);
    const payload = {
      recordVersion: 1, templateId,
      params: Object.fromEntries(T.params.filter((p) => p.owner === 'frame').map((p) => [p.name, p.default])),
      seeds, frameBottomZ: null, panelLip: null, appearance: null, insetWindow: null,
      seedGeometry, widthIn: W, heightIn: H,
    };
    const name = `${templateId}_${tag}_${W}x${H}`;
    writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(payload, null, 2));
    manifest.push({ name, tag, W, H, seeds, jsDefects: prof.defects });
    console.log(`  ${W}x${H} ${tag}: ${prof.defects.length ? 'DEFECT ' + JSON.stringify(prof.defects) : 'ok'}`);
  }
}
writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log('wrote', manifest.length, 'payloads to', OUT_DIR);
console.log('cases with JS defects:', manifest.filter((m) => m.jsDefects.length).length);
