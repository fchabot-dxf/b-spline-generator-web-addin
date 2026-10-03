// H23 item 60 (C): generate live-verification payloads for T12/T13 (already-shipped taper
// templates) at their OWN declared taperAngle range ends + default, at 7x9 -- does Fusion already
// build the WRONG (untapered) shape for these SHIPPED templates too, the same way T10 does?
//
// Usage: node tools/repro/h23_item60_make_shipped_payloads.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const root = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const imp = (p) => import(root + p);
const { frameCutProfile } = await imp('editor/editor-frame-profile.js');
const { frameSeedGeometry, frameParamRanges } = await imp('editor/frame-handles.js');
const { normalizeFrameRecord } = await imp('core/frame-record.js');
const { default: FRAME_DEFS } = await imp('data/frame-defs.js');

mkdirSync(OUT_DIR, { recursive: true });

const W = 7, H = 9;

for (const templateId of ['template_12', 'template_13']) {
  const T = FRAME_DEFS.templates.find((t) => t.id === templateId);
  const baseRec = normalizeFrameRecord({ templateId, seeds: {} });
  const region = frameCutProfile(FRAME_DEFS, baseRec, { widthIn: W, heightIn: H }).region;
  const t = (T.params.find((p) => p.name === 'frame_thickness') || {}).default ?? 0.75;
  const range = frameParamRanges(T, region, {}, t).taperAngle;
  console.log(templateId, 'declared taperAngle range:', JSON.stringify(range));
  for (const [tag, taper] of [['min', range.min], ['default', 8], ['max', range.max]]) {
    const rec = normalizeFrameRecord({ templateId, seeds: { taperAngle: taper } });
    const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
    const seedGeometry = frameSeedGeometry(T, prof, W, H);
    const payload = {
      recordVersion: 1, templateId,
      params: Object.fromEntries(T.params.filter((p) => p.owner === 'frame').map((p) => [p.name, p.default])),
      seeds: { taperAngle: taper },
      frameBottomZ: null, panelLip: null, appearance: null, insetWindow: null,
      seedGeometry, widthIn: W, heightIn: H,
    };
    const name = `${templateId}_taper${tag}_${W}x${H}.json`;
    writeFileSync(`${OUT_DIR}/${name}`, JSON.stringify(payload, null, 2));
    console.log('wrote', name, 'taper=', taper.toFixed(2), 'defects:', JSON.stringify(prof.defects));
  }
}
