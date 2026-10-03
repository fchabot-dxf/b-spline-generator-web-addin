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
// T11 HOURGLASS ROOF: its own seed expressions use `abs`/`sqrt` directly (p02_02_loop.py's own min/max-
// unsupported substitution, `min(a,b) = (a+b-|a-b|)/2`, verified live against Fusion's own evaluateExpression --
// see that phase file's own doc comment) -- no earlier template's seed expressions needed either function, so
// this sandbox never had to supply them until now.
const evalIn = (e) => {
  const s = String(e).replace(/(\d*\.?\d+)\s*in\b/g, '($1)');
  if (/^[-+]?\d*\.?\d+$/.test(s.trim())) return Number(s) / CM;
  return Function('widthIn', 'heightIn', 'boundingboxoffset', 'abs', 'sqrt',
    `return (${s});`)(W, H, BBOX, Math.abs, Math.sqrt);
};
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe.each(['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6', 'template_11'])('%s seed map', (id) => {
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

  // T11 HOURGLASS ROOF: no seed Radius dimension at all (p02_02_loop.py, item 2) -- each of its 6 arcs is seeded
  // by its three points alone, the middle one its TRUE midpoint (frameSeedGeometry's own `at(p, 0.5)`, generic
  // for any arc). No earlier template in this list has an EMPTY radius-kind subset, so nothing above exercises
  // that branch of the seed-map convention -- asserted explicitly here instead.
  if (id === 'template_11') {
    it('has no radius-kind seed entries (every arc seeded by 3 points alone)', () => {
      expect(tpl.seedMap.filter((e) => e.kind === 'radius')).toHaveLength(0);
    });
  }
});

describe('nudgeX moves only the middle point (H23 item 48)', () => {
  it("template_5's own arc_top_dip keeps its two ends exactly mirror-symmetric, nudging only the bulge", () => {
    // MEASURED LIVE: nudging the two END points too (not just the middle) broke the dip's own exact
    // mirror-symmetry against the shoulder arcs' own shared endpoints -- the Y-axis-centering constraint
    // then resolved that asymmetry by moving the WHOLE tangent chain ~0.1-0.3 in instead of ~0.01 in, the
    // "preview != build" gap item 46's own sweep first found (WORK-LOG H23 item 48). This is the one
    // pure-JS property whose absence let that live bug ship: an un-nudged end pair is EXACTLY mirrored.
    const tpl = tplOf('template_5');
    const entry = tpl.seedMap.find((e) => e.id === 'arc_top_dip');
    expect(entry.nudgeX).toBeTruthy();
    const prof = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_5' }), { widthIn: W, heightIn: H });
    const geo = frameSeedGeometry(tpl, prof, W, H);
    const [s, m, t] = geo.arc_top_dip.points;
    expect(s[1]).toBeCloseTo(t[1], 9);
    expect(s[0]).toBeCloseTo(-t[0], 9); // exact mirror symmetry -- the ends must NOT carry the nudge
    expect(m[0]).toBeCloseTo(entry.nudgeX, 9); // the nudge is still applied, to the middle point alone
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
