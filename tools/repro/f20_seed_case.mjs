// F20 SHOULDER-HIP live parity, app side: a T1 frame record with the Shoulder and/or Hip seeded -> the seed
// geometry [Send frame] sends, plus the app's own expected outline arcs (every seedMap arc: shoulder, waist, hip)
// in Fusion sketch coordinates (inches, centred, y up). f20_live.py (in Fusion) builds it and compares.
//   node tools/repro/f20_seed_case.mjs <out.json> <W> <H> <shoulder|-> <hip|-> [topInset|-] [waistCenterYLeft|-] [waistReachLeft|-]
//     [topDipDepth|-] [topDipWidth|-] [tabWidth|-] [tabHeight|-] [waveHeight|-] [waveReach|-] [t8TopDipWidth|-]
//     [topDipPosition|-] [t8TopDipDepth|-]
//   ("-" = not seeded)
// T3: TEMPLATE=template_3 (env; default template_1) builds the case for that template instead; `topInset` (the
// Template 3 "Top width" handle, a fraction of hw) is only declared (seeded) by Template 3. T4: TEMPLATE=template_4, the
// 7th / 8th args = its "Left waist position" (fraction of hh, y down) / "Left waist reach" (fraction of hw). T5:
// TEMPLATE=template_5, the 9th / 10th args = its "Top dip depth" (fraction of hh) / "Top dip width" (half width,
// fraction of hw). T6: TEMPLATE=template_6, the 11th / 12th args = its "Tab width" (half width, fraction of hw) /
// "Tab height" (fraction of hh); its outline is all lines, so the case also carries every seedMap LINE's expected
// ends (`lines`), which f20_live_parity.py compares too. T8: TEMPLATE=template_8, the 13th-17th args = its own 5
// seeds "Left wave height" (fraction of hh) / "Left wave reach" (fraction of hw) / "Top dip width" (half width,
// fraction of hw) / "Top dip position" (fraction of hw, shift right of centre) / "Top dip depth" (fraction of hh)
// -- named t8TopDipWidth/t8TopDipDepth here (args 15/17) only to stay distinct from T5's own topDipWidth/
// topDipDepth (args 10/9): both templates declare a key with that exact name, but each only reads its OWN.
import { writeFileSync } from 'node:fs';
import FRAME_DEFS from '../../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameSeedGeometry } from '../../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';

const [OUT, Ws, Hs, S = '-', P = '-', T = '-', YL = '-', DL = '-', TD = '-', TW = '-', AW = '-', AH = '-',
  WH = '-', WR = '-', T8TW = '-', T8TP = '-', T8TD = '-'] = process.argv.slice(2);
const TID = process.env.TEMPLATE || 'template_1';
const W = Number(Ws), H = Number(Hs);
const tpl = FRAME_DEFS.templates.find((t) => t.id === TID);
const seeds = {};
if (S !== '-') seeds.cornerRadiusTop = Number(S);
if (P !== '-') seeds.cornerRadiusBottom = Number(P);
if (T !== '-') seeds.topInset = Number(T);
if (YL !== '-') seeds.waistCenterYLeft = Number(YL);
if (DL !== '-') seeds.waistReachLeft = Number(DL);
if (TD !== '-') seeds.topDipDepth = Number(TD);
if (TW !== '-') seeds.topDipWidth = Number(TW);
if (AW !== '-') seeds.tabWidth = Number(AW);
if (AH !== '-') seeds.tabHeight = Number(AH);
if (WH !== '-') seeds.waveHeight = Number(WH);
if (WR !== '-') seeds.waveReach = Number(WR);
if (T8TW !== '-') seeds.topDipWidth = Number(T8TW);
if (T8TP !== '-') seeds.topDipPosition = Number(T8TP);
if (T8TD !== '-') seeds.topDipDepth = Number(T8TD);
const rec = normalizeFrameRecord({ templateId: TID, seeds }); // the real gate: only declared seeded keys
const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
const F = (p) => [p.x - W / 2, H / 2 - p.y];
const arcs = {};
for (const e of tpl.seedMap.filter((m) => m.kind === 'arc')) {
  const a = prof.primitives[e.prim];
  arcs[e.id] = { center: F({ x: a.cx, y: a.cy }), radius: a.rx };
}
const lines = {};
for (const e of tpl.seedMap.filter((m) => m.kind === 'line')) {
  const l = prof.primitives[e.prim], ends = [F(l.p0), F(l.p1)];
  lines[e.id] = e.reverse ? ends.reverse() : ends;
}
const out = { templateId: TID, W, H, seeds: rec.seeds, defects: prof.defects, arcs, lines, seedGeometry: frameSeedGeometry(tpl, prof, W, H) };
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ seeds: rec.seeds, defects: prof.defects,
  radii: Object.fromEntries(Object.entries(arcs).map(([k, v]) => [k, +v.radius.toFixed(4)])) }));
