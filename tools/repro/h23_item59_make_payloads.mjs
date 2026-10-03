// H23 item 59: generate T10 ("Arched + taper") live-verification payloads for the dispatch's own
// required cases -- taper in {-15,-8,0,8,15} at 7x9, taper in {-15,8} at 6x9 and 9x12 -- each with
// seeds: {taperAngle} (archRise/waistReach/waistCenterY left at their own template default) and
// the matching seedGeometry, same shape as tools/repro/fusion_t11/item40_all_template_payloads'
// own template_10_default_7x9.json.
//
// Usage: node tools/repro/h23_item59_make_payloads.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const root = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const imp = (p) => import(root + p);
const { frameCutProfile } = await imp('editor/editor-frame-profile.js');
const { frameSeedGeometry } = await imp('editor/frame-handles.js');
const { normalizeFrameRecord } = await imp('core/frame-record.js');
const { default: FRAME_DEFS } = await imp('data/frame-defs.js');
const T10 = FRAME_DEFS.templates.find((t) => t.id === 'template_10');

mkdirSync(OUT_DIR, { recursive: true });

const CASES = [
  [7, 9, -15], [7, 9, -8], [7, 9, 0], [7, 9, 8], [7, 9, 15],
  [6, 9, -15], [6, 9, 8],
  [9, 12, -15], [9, 12, 8],
];

for (const [W, H, taper] of CASES) {
  const rec = normalizeFrameRecord({ templateId: 'template_10', seeds: { taperAngle: taper } });
  const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
  const seedGeometry = frameSeedGeometry(T10, prof, W, H);
  const payload = {
    recordVersion: 1,
    templateId: 'template_10',
    params: {
      boundingboxoffset: 0.25, ck_arc_shoulder_weld: 1, ck_arc_hip_weld: 1,
      ck_skel_shoulder_equal: 1, ck_skel_waist_equal: 1, frame_thickness: 0.75,
    },
    seeds: { taperAngle: taper },
    frameBottomZ: null, panelLip: null, appearance: null, insetWindow: null,
    seedGeometry,
    widthIn: W, heightIn: H,
  };
  const name = `template_10_taper${taper}_${W}x${H}.json`;
  writeFileSync(`${OUT_DIR}/${name}`, JSON.stringify(payload, null, 2));
  console.log('wrote', name, 'defects:', JSON.stringify(prof.defects), 'minLen:',
    Math.min(...prof.primitives.map((p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta)))).toFixed(4));
}
