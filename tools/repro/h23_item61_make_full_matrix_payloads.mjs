// H23 item 61 (1): the PERMANENT every-template x every-declared-handle x {min, default, max}
// payload generator, promoted from item 60(C)'s own one-off probe
// (h23_item60_make_all_handle_payloads.mjs, which only covered 2 templates). Generic across all
// 13 templates: reads T.handles dynamically, resolves a real `resolved` object via
// paramsFromShapeModel first (the item-60 fix -- frameParamRanges silently returns NaN/null
// without it), then writes one payload per template (the shared default) plus one payload per
// handle per range end (min/max) with every OTHER handle held at ITS OWN template default.
//
// Usage: node tools/repro/h23_item61_make_full_matrix_payloads.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const root = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const imp = (p) => import(root + p);
const { frameCutProfile } = await imp('editor/editor-frame-profile.js');
const { frameSeedGeometry, frameParamRanges } = await imp('editor/frame-handles.js');
const { paramsFromShapeModel } = await imp('editor/editor-shape-lattice-generator.js');
const { normalizeFrameRecord } = await imp('core/frame-record.js');
const { default: FRAME_DEFS } = await imp('data/frame-defs.js');

mkdirSync(OUT_DIR, { recursive: true });
const W = 7, H = 9;
const manifest = [];

function writePayload(templateId, T, seeds, name) {
  const rec = normalizeFrameRecord({ templateId, seeds });
  const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
  const seedGeometry = frameSeedGeometry(T, prof, W, H);
  const payload = {
    recordVersion: 1, templateId,
    params: Object.fromEntries(T.params.filter((p) => p.owner === 'frame').map((p) => [p.name, p.default])),
    seeds, frameBottomZ: null, panelLip: null, appearance: null, insetWindow: null,
    seedGeometry, widthIn: W, heightIn: H,
  };
  writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(payload, null, 2));
  return { name, defects: prof.defects };
}

for (const T of FRAME_DEFS.templates) {
  const templateId = T.id;
  const baseRec = normalizeFrameRecord({ templateId, seeds: {} });
  const region = frameCutProfile(FRAME_DEFS, baseRec, { widthIn: W, heightIn: H }).region;
  const t = (T.params.find((p) => p.name === 'frame_thickness') || {}).default ?? 0.75;
  const resolved = paramsFromShapeModel(T.silhouettePreset, T.shapeModel, region);
  const ranges = frameParamRanges(T, region, resolved, t);

  const info = writePayload(templateId, T, {}, `${templateId}_default_${W}x${H}`);
  manifest.push({ templateId, handle: null, tag: 'default', case: info.name, defects: info.defects });
  if (info.defects.length) console.log('WARN default already has JS defects:', templateId, JSON.stringify(info.defects));

  for (const h of T.handles) {
    const range = ranges[h.key];
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      console.log('SKIP (no finite range)', templateId, h.key, JSON.stringify(range));
      continue;
    }
    for (const [tag, val] of [['min', range.min], ['max', range.max]]) {
      const name = `${templateId}_${h.key}_${tag}_${W}x${H}`;
      const r = writePayload(templateId, T, { [h.key]: val }, name);
      manifest.push({ templateId, handle: h.key, tag, value: val, case: name, defects: r.defects });
    }
  }
}

writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log('wrote', manifest.length, 'payloads to', OUT_DIR);
console.log('cases with JS-side defects:', JSON.stringify(manifest.filter((m) => m.defects.length)));
