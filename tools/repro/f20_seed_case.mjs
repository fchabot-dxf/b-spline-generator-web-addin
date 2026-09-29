// F20 SHOULDER-HIP live parity, app side: a T1 frame record with the Shoulder and/or Hip seeded -> the seed
// geometry [Send frame] sends, plus the app's own expected outline arcs (every seedMap arc: shoulder, waist, hip)
// in Fusion sketch coordinates (inches, centred, y up). f20_live.py (in Fusion) builds it and compares.
//   node tools/repro/f20_seed_case.mjs <out.json> <W> <H> <shoulder|-> <hip|-> [topInset|-] [waistCenterYLeft|-] [waistReachLeft|-]
//   ("-" = not seeded)
// T3: TEMPLATE=template_3 (env; default template_1) builds the case for that template instead; `topInset` (the
// Template 3 "Top width" handle, a fraction of hw) is only declared (seeded) by Template 3. T4: TEMPLATE=template_4, the
// 7th / 8th args = its "Left waist position" (fraction of hh, y down) / "Left waist reach" (fraction of hw).
import { writeFileSync } from 'node:fs';
import FRAME_DEFS from '../../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameSeedGeometry } from '../../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';

const [OUT, Ws, Hs, S = '-', P = '-', T = '-', YL = '-', DL = '-'] = process.argv.slice(2);
const TID = process.env.TEMPLATE || 'template_1';
const W = Number(Ws), H = Number(Hs);
const tpl = FRAME_DEFS.templates.find((t) => t.id === TID);
const seeds = {};
if (S !== '-') seeds.cornerRadiusTop = Number(S);
if (P !== '-') seeds.cornerRadiusBottom = Number(P);
if (T !== '-') seeds.topInset = Number(T);
if (YL !== '-') seeds.waistCenterYLeft = Number(YL);
if (DL !== '-') seeds.waistReachLeft = Number(DL);
const rec = normalizeFrameRecord({ templateId: TID, seeds }); // the real gate: only declared seeded keys
const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
const F = (p) => [p.x - W / 2, H / 2 - p.y];
const arcs = {};
for (const e of tpl.seedMap.filter((m) => m.kind === 'arc')) {
  const a = prof.primitives[e.prim];
  arcs[e.id] = { center: F({ x: a.cx, y: a.cy }), radius: a.rx };
}
const out = { templateId: TID, W, H, seeds: rec.seeds, defects: prof.defects, arcs, seedGeometry: frameSeedGeometry(tpl, prof, W, H) };
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ seeds: rec.seeds, defects: prof.defects,
  radii: Object.fromEntries(Object.entries(arcs).map(([k, v]) => [k, +v.radius.toFixed(4)])) }));
