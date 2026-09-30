/**
 * FB-APP F11, option B (Fred: "simply seed it in position"): seeded shape
 * handles reach Fusion as the template's OWN seed geometry (frame-defs
 * `seedMap` = template_data.py FRAME_SEED_MAP), computed from the app's
 * seeded outline (frameSeedGeometry). The declared map's primitive + S/E
 * orientation is checked against the template's own literal seeds, so a
 * wrong entry can't hide.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameSeedGeometry } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';

const W = 7, H = 9, CM = 2.54;
const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
/** The template's own seed steps (sketch 2), by ID / seed-dim Name. */
function literalSteps(tpl) {
  const out = {};
  for (const sk of tpl.sketches) for (const b of sk.Blocks || []) for (const st of b.BuildSequence || []) {
    if (st.Type === 'Line' || st.Type === 'Arc3Point') out[st.ID] = st;
    if (st.Type === 'Radius') out[st.Name] = st;
  }
  return out;
}
/** A literal seed expression in inches: widthIn/heightIn/boundingboxoffset and "N in" are inches; a bare
 * number is cm (BuildContext). F14: the seeds sit on the seed board (fb_engine/seed_basis.py). */
const BBOX = 0.25; // the template default the records use
const evalIn = (e) => {
  const s = String(e).replace(/(\d*\.?\d+)\s*in\b/g, '($1)');
  if (/^[-+]?\d*\.?\d+$/.test(s.trim())) return Number(s) / CM;
  return Function('widthIn', 'heightIn', 'boundingboxoffset', `return (${s});`)(W, H, BBOX);
};
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe.each(['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6'])('%s seed map', (id) => {
  const tpl = tplOf(id);
  const prof = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id }), { widthIn: W, heightIn: H });
  const geo = frameSeedGeometry(tpl, prof, W, H);
  const lit = literalSteps(tpl);

  it('names only seeds the template declares, every declared outline arc included', () => {
    expect(tpl.seedMap.length).toBeGreaterThan(id === 'template_6' ? 7 : 8); // T6: 8 straight pieces, no arcs or pins
    for (const e of tpl.seedMap) expect(lit[e.id], e.id).toBeTruthy();
    const arcs = Object.values(lit).filter((st) => st.Type === 'Arc3Point').map((st) => st.ID).sort();
    expect(tpl.seedMap.filter((e) => e.kind === 'arc').map((e) => e.id).sort()).toEqual(arcs);
  });

  it('every point lands near the template’s own literal seed, in the declared S/E orientation', () => {
    for (const e of tpl.seedMap) {
      if (e.kind === 'radius') { expect(geo[e.id].radius).toBeGreaterThan(0); continue; }
      const mine = geo[e.id].points, theirs = lit[e.id].Points.map(([x, y]) => [evalIn(x), evalIn(y)]);
      expect(mine.length, e.id).toBe(theirs.length);
      const straight = mine.reduce((s, p, i) => s + d(p, theirs[i]), 0);
      const swapped = mine.reduce((s, p, i) => s + d(p, theirs[theirs.length - 1 - i]), 0);
      expect(straight, `${e.id}: orientation`).toBeLessThan(swapped);
      for (let i = 0; i < mine.length; i++) expect(d(mine[i], theirs[i]), `${e.id}[${i}]`).toBeLessThan(0.75);
    }
  });
});

describe('the geometry follows the seeds', () => {
  it('a seeded waist moves the waist arc seeds (and nothing is added outside the map)', () => {
    const base = normalizeFrameRecord({ templateId: 'template_1' });
    const seeded = normalizeFrameRecord({ templateId: 'template_1', seeds: { waistReach: 0.5 } });
    const g0 = frameSeedGeometry(tplOf('template_1'), frameCutProfile(FRAME_DEFS, base, { widthIn: W, heightIn: H }), W, H);
    const g1 = frameSeedGeometry(tplOf('template_1'), frameCutProfile(FRAME_DEFS, seeded, { widthIn: W, heightIn: H }), W, H);
    expect(Object.keys(g1).sort()).toEqual(tplOf('template_1').seedMap.map((e) => e.id).sort());
    expect(g1.arc_waist_R.points[1][0]).toBeLessThan(g0.arc_waist_R.points[1][0] - 0.2); // a deeper pinch
  });
});
