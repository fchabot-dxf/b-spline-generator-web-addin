// H23 item 60 (C): generate live-verification payloads at EVERY declared handle's own range
// ends (+ default) for T1/T2 (and T12/T13's shared geometry handles, same keys plus taperAngle),
// at 7x9 -- the first probe (hand-picked near-extreme values, not the real computed range) missed
// most handles and, for the ones it did cover, used values far from the true range end for 2 of 4
// keys (frameParamRanges needs a REAL `resolved` object, not {}, or it silently returns
// {min:null,max:null} and JSON.stringify(NaN) prints as null). This one calls
// paramsFromShapeModel first, like the production taper sweep already does, and sweeps every
// OTHER handle too (one handle moved to its own range end at a time, the rest at template default).
//
// Usage: node tools/repro/h23_item60_make_all_handle_payloads.mjs <repoRoot> <outDir>
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

for (const templateId of ['template_1', 'template_2']) {
  const T = FRAME_DEFS.templates.find((t) => t.id === templateId);
  const baseRec = normalizeFrameRecord({ templateId, seeds: {} });
  const region = frameCutProfile(FRAME_DEFS, baseRec, { widthIn: W, heightIn: H }).region;
  const t = (T.params.find((p) => p.name === 'frame_thickness') || {}).default ?? 0.75;
  const resolved = paramsFromShapeModel(T.silhouettePreset, T.shapeModel, region);
  const ranges = frameParamRanges(T, region, resolved, t);
  console.log(templateId, 'resolved defaults:', JSON.stringify(resolved));

  for (const h of T.handles) {
    const range = ranges[h.key];
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      console.log(' SKIP', h.key, '-- no finite range:', JSON.stringify(range));
      continue;
    }
    for (const [tag, val] of [['min', range.min], ['default', resolved[h.key]], ['max', range.max]]) {
      if (val == null) continue;
      const rec = normalizeFrameRecord({ templateId, seeds: { [h.key]: val } });
      const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
      const seedGeometry = frameSeedGeometry(T, prof, W, H);
      const payload = {
        recordVersion: 1, templateId,
        params: Object.fromEntries(T.params.filter((p) => p.owner === 'frame').map((p) => [p.name, p.default])),
        seeds: { [h.key]: val },
        frameBottomZ: null, panelLip: null, appearance: null, insetWindow: null,
        seedGeometry, widthIn: W, heightIn: H,
      };
      const name = `${templateId}_${h.key}_${tag}_${W}x${H}.json`;
      writeFileSync(`${OUT_DIR}/${name}`, JSON.stringify(payload, null, 2));
      console.log('wrote', name, h.key, '=', val.toFixed(4), 'range:', JSON.stringify(range), 'defects:', JSON.stringify(prof.defects));
    }
  }
}
