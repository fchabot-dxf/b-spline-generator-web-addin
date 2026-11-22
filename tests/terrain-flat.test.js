/**
 * TERRAIN-FLAT (Fred 2026-11-22, TERRAIN-FLAT-DESIGN.md): the Skeleton / Filter panels reorganised and renamed TERRAIN SHAPE /
 * TERRAIN TEXTURE (labels only: the section ids 'skeleton' / 'filter' stay), each with its own Flat switch:
 *   - Shape 'Flat (no hills)' = P.shapeFlat + P.surfaceHeightIn: a flat base at the surface height, the texture on top
 *     (final height = surfaceHeightIn + (isolateSkeleton ? 0 : fine * LOW * carveZ));
 *   - Texture 'Flat (no texture)' = the existing isolateSkeleton switch, moved + relabelled.
 * Pinned here: a board without shapeFlat lays byte-identically (sha measured on the code BEFORE the change); both Flat on =
 * exactly the surface height; Flat (no hills) alone = the grain above the surface, within LOW * carveZ; every moved control
 * keeps the job-timeline step that locks it (computed with the app's own setSectionReadOnly, on main's markup and now); the
 * Shape rows that no longer act grey (and exactly those: checked against the real heightmap).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { setSectionReadOnly } from '../bspline-frame-builder/b-spline-gen/html/core/ui-utils.js';
import { JOB_STEP_KINDS } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';
import { P, DEFAULT, updateP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { heightsInputDigest, rebuildInputDigest } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';

const PALETTE = 'bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const bodyOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
const BODY = bodyOf(readFileSync(PALETTE, 'utf8'));
const $ = (id) => document.getElementById(id);
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
// the new module, loaded per test (a missing module fails those tests, not the whole file)
const FLAT_UI = '../bspline-frame-builder/b-spline-gen/html/main/terrain-shape-flat.js';
const flatUi = () => import(/* @vite-ignore */ FLAT_UI);
const LOW = 0.22; // core/terrain.js: the valley share of the fine value (h = lerp(fine * LOW, ..., coarse))

// ── 1. saved boards: no shapeFlat = byte-identical ─────────────────────────────────────────────────────────────────────
const GRID = { nx: 61, nz: 81, edgeMargin: 0 };
const SETS = {
  defaults: { ...DEFAULT, ...GRID },
  'defaults, isolateSkeleton': { ...DEFAULT, ...GRID, isolateSkeleton: true },
  'eroded, radial, gated, faded, smoothed': { ...DEFAULT, ...GRID, noiseType: 'eroded', symmetry: 'radial', symOffsetX: 0.05,
    density: 0.4, clustering: 0.3, peakShape: 3, edgeMargin: 0.15, smoothIntensity: 0.6, smoothRadius: 0.8, detailDensity: 0.7 },
};
// sha256 (16 hex) of generateHeightmap(set).heights, measured on 18af1d97 (BEFORE shapeFlat existed); a missing entry fails
const PIN = {
  'defaults': '99fc53af7620453d',
  'defaults | shapeFlat false': '99fc53af7620453d',
  'defaults | shapeFlat false, surface 0.4': '99fc53af7620453d',
  'defaults, isolateSkeleton': 'ec88e03bc2335c97',
  'defaults, isolateSkeleton | shapeFlat false': 'ec88e03bc2335c97',
  'defaults, isolateSkeleton | shapeFlat false, surface 0.4': 'ec88e03bc2335c97',
  'eroded, radial, gated, faded, smoothed': 'b87b3c699ec87529',
  'eroded, radial, gated, faded, smoothed | shapeFlat false': 'b87b3c699ec87529',
  'eroded, radial, gated, faded, smoothed | shapeFlat false, surface 0.4': 'b87b3c699ec87529',
};

describe('saved boards: a board without shapeFlat lays exactly as before', () => {
  it('the heights of real parameter sets match the pins measured before the change (absent, false, false + a surface height)', () => {
    const got = {};
    for (const [name, p] of Object.entries(SETS)) {
      got[name] = sha(generateHeightmap(p).heights);
      got[`${name} | shapeFlat false`] = sha(generateHeightmap({ ...p, shapeFlat: false }).heights);
      got[`${name} | shapeFlat false, surface 0.4`] = sha(generateHeightmap({ ...p, shapeFlat: false, surfaceHeightIn: 0.4 }).heights);
    }
    if (process.env.PRINT_PINS) console.log('PIN=' + JSON.stringify(got, null, 2));
    expect(got).toEqual(PIN);
  });
  it('the new keys are declared, off by default (absent = false = today), and are heights inputs (in both digests)', () => {
    expect(DEFAULT.shapeFlat).toBe(false);
    expect(DEFAULT.surfaceHeightIn).toBe(0);
    const keep = { shapeFlat: P.shapeFlat, surfaceHeightIn: P.surfaceHeightIn };
    try {
      P.shapeFlat = false; P.surfaceHeightIn = 0;
      const h0 = heightsInputDigest(61, 81), r0 = rebuildInputDigest(null, 61, 81);
      P.shapeFlat = true;
      expect(heightsInputDigest(61, 81)).not.toBe(h0);
      expect(rebuildInputDigest(null, 61, 81)).not.toBe(r0);
      P.shapeFlat = false; P.surfaceHeightIn = 0.4;
      expect(heightsInputDigest(61, 81)).not.toBe(h0);
      expect(rebuildInputDigest(null, 61, 81)).not.toBe(r0);
    } finally { Object.assign(P, keep); }
  });
  it('the switch is a boolean param and a typed surface height is stored as typed (no clamp)', () => {
    const keep = { shapeFlat: P.shapeFlat, surfaceHeightIn: P.surfaceHeightIn };
    try {
      updateP('shapeFlat', true); expect(P.shapeFlat).toBe(true);
      updateP('shapeFlat', false); expect(P.shapeFlat).toBe(false);
      updateP('surfaceHeightIn', 2.75); expect(P.surfaceHeightIn).toBe(2.75); // above carveZ: kept
      updateP('surfaceHeightIn', -0.2); expect(P.surfaceHeightIn).toBe(-0.2);
    } finally { Object.assign(P, keep); }
  });
});

// ── 2. the two Flat switches ───────────────────────────────────────────────────────────────────────────────────────
const range = (h) => { let lo = Infinity, hi = -Infinity; for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; } return { lo, hi }; };

describe('Flat (no hills) + Flat (no texture): exactly the surface height', () => {
  for (const s of [0, 0.4]) {
    for (const [name, p] of Object.entries(SETS)) {
      it(`${name}, surface ${s} in, carveZ 1.5: every height === the surface height (float32), smoothing and the flat border included`, () => {
        const { heights } = generateHeightmap({ ...p, carveZ: 1.5, shapeFlat: true, isolateSkeleton: true, surfaceHeightIn: s });
        const want = Math.fround(s);
        let off = 0;
        for (const v of heights) if (v !== want) off++;
        expect(off).toBe(0);
      });
    }
  }
});

describe('Flat (no hills) alone: the texture rises from the surface height, at its valley amplitude', () => {
  for (const s of [0, 0.4]) {
    for (const name of ['defaults', 'eroded, radial, gated, faded, smoothed']) {
      it(`${name}, surface ${s} in: min >= surface, span <= LOW * carveZ, and it varies`, () => {
        const { heights } = generateHeightmap({ ...SETS[name], carveZ: 1.5, shapeFlat: true, surfaceHeightIn: s });
        const { lo, hi } = range(heights);
        expect(lo).toBeGreaterThanOrEqual(s - 1e-9);
        expect(hi - lo).toBeLessThanOrEqual(LOW * 1.5 + 1e-6);
        expect(hi - lo).toBeGreaterThan(0.01);
      });
    }
  }
  it('the Flat Border fades the grain toward the surface height: the board edge is exactly the surface', () => {
    const { heights, nx, nz } = generateHeightmap({ ...SETS.defaults, carveZ: 1.5, shapeFlat: true, surfaceHeightIn: 0.4, edgeMargin: 0.2 });
    for (let j = 0; j < nz; j++) { expect(heights[j * nx]).toBe(Math.fround(0.4)); expect(heights[j * nx + nx - 1]).toBe(Math.fround(0.4)); }
    for (let i = 0; i < nx; i++) { expect(heights[i]).toBe(Math.fround(0.4)); expect(heights[(nz - 1) * nx + i]).toBe(Math.fround(0.4)); }
  });
  it('the hills are gone: the same board with its hills spans far more than the flat one', () => {
    const hills = range(generateHeightmap({ ...SETS.defaults, carveZ: 1.5 }).heights);
    const flat = range(generateHeightmap({ ...SETS.defaults, carveZ: 1.5, shapeFlat: true }).heights);
    expect(hills.hi - hills.lo).toBeGreaterThan(2 * (flat.hi - flat.lo));
  });
});

// ── 3. the two panels ──────────────────────────────────────────────────────────────────────────────────────────────
// the declared order of each panel (Fred 2026-11-22); ids are the number fields / checkboxes / selects (one per control)
const SHAPE_ORDER = ['shapeFlat', 'surfaceHeightIn', 'macroScale', 'peakShape', 'density', 'clustering', 'mapZoom', 'seedOffsetX',
  'seedOffsetY', 'symmetry', 'symOffsetX', 'symOffsetY', 'edgeMarginIn', 'smoothIntensity', 'smoothRadius', 'smoothRespectSymmetry'];
const TEXTURE_ORDER = ['isolateSkeleton', 'noiseType', 'scale', 'detailDensity', 'detailStrength'];
// every control that sits in the two panels, the sliders included (the job-lock check walks each)
const EXISTING = ['macroSlider', 'macroScale', 'peakShapeSlider', 'peakShape', 'densitySlider', 'density', 'clusteringSlider', 'clustering',
  'mapZoomSlider', 'mapZoom', 'seedOffsetX', 'seedOffsetY', 'symmetry', 'symOffsetXSlider', 'symOffsetX', 'symOffsetYSlider', 'symOffsetY',
  'edgeMarginInSlider', 'edgeMarginIn', 'smoothIntensitySlider', 'smoothIntensity', 'smoothRadiusSlider', 'smoothRadius',
  'smoothRespectSymmetry', 'isolateSkeleton', 'noiseType', 'scaleSlider', 'scale', 'detailDensitySlider', 'detailDensity',
  'detailStrengthSlider', 'detailStrength', 'detailDensityRespectSymmetry', 'filterTweaksReset'];
const NEW = ['shapeFlat', 'surfaceHeightInSlider', 'surfaceHeightIn'];

beforeEach(() => { document.body.innerHTML = BODY; });

describe('TERRAIN SHAPE / TERRAIN TEXTURE: the controls in their new panels', () => {
  const header = (cls) => document.querySelector(`.${cls} > .panel-header`).textContent.trim();
  it('the panels are renamed (labels only: the section classes stay panel-skeleton / panel-filter)', () => {
    expect(header('panel-skeleton')).toBe('⛰️ TERRAIN SHAPE');
    expect(header('panel-filter')).toBe('🎨 TERRAIN TEXTURE');
  });
  it('each control exists once, inside its new panel, in the declared order', () => {
    for (const [cls, ids] of [['panel-skeleton', SHAPE_ORDER], ['panel-filter', TEXTURE_ORDER]]) {
      for (const id of ids) {
        expect(document.querySelectorAll(`#${id}`).length, id).toBe(1);
        expect($(id).closest('.panel')?.classList.contains(cls), `${id} in ${cls}`).toBe(true);
      }
      const inDoc = [...document.querySelector(`.${cls} > .panel-body`).querySelectorAll('input, select')].map((e) => e.id).filter((id) => ids.includes(id));
      expect(inDoc, cls).toEqual(ids);
    }
  });
  it('the Texture\'s own Flat switch: the existing isolateSkeleton checkbox, relabelled Flat (no texture)', () => {
    expect($('isolateSkeleton').closest('label').textContent.trim()).toBe('Flat (no texture)');
  });
  it('the labels: Flat (no hills), Surface height (in), Pan X / Pan Y', () => {
    expect($('shapeFlat').closest('label').textContent.trim()).toBe('Flat (no hills)');
    const labelBefore = (id) => {
      let n = $(id).closest('.cad-slider-row') || $(id).closest('.cad-stepper');
      while (n && n.tagName !== 'LABEL') n = n.previousElementSibling;
      return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
    };
    expect(labelBefore('surfaceHeightIn')).toBe('Surface height (in)');
    expect(labelBefore('seedOffsetX')).toMatch(/^Pan X\b/);
    expect(labelBefore('seedOffsetY')).toMatch(/^Pan Y\b/);
    expect(document.querySelector('.panel-skeleton').textContent).not.toMatch(/Offset X \(screens\)/);
  });
  it('the surface height: no min / max on the typed field (no clamp), its slider travels 0 .. carveZ', async () => {
    const { syncShapeFlatUI } = await flatUi();
    expect($('surfaceHeightIn').hasAttribute('min')).toBe(false);
    expect($('surfaceHeightIn').hasAttribute('max')).toBe(false);
    const keep = { carveZ: P.carveZ, surfaceHeightIn: P.surfaceHeightIn };
    try {
      P.carveZ = 2.25; P.surfaceHeightIn = 1.9;
      syncShapeFlatUI(document);
      expect($('surfaceHeightInSlider').min).toBe('0');
      expect($('surfaceHeightInSlider').max).toBe('2.25');
      expect($('surfaceHeightInSlider').value).toBe('1.9'); // re-set after the travel moved (a range input clips to its old max)
    } finally { Object.assign(P, keep); }
  });
});

// ── 4. the job-timeline lock of every moved control ─────────────────────────────────────────────────────────────────
/** control id -> the 'section' steps whose lock disables it, by the app's own rule (core/ui-utils.js setSectionReadOnly). */
function lockMap(body, ids) {
  const out = {};
  for (const [step, k] of Object.entries(JOB_STEP_KINDS)) {
    if (k.readOnly !== 'section') continue;
    document.body.innerHTML = body;
    setSectionReadOnly(step, true);
    for (const id of ids) if ($(id) && $(id).disabled) (out[id] ||= []).push(step);
  }
  return out;
}
// computed with lockMap on 18af1d97's markup (the test below recomputes it from git and checks this copy)
const LOCK_BEFORE = {
  macroSlider: ['filter'], macroScale: ['filter'], mapZoomSlider: ['filter'], mapZoom: ['filter'],
  seedOffsetX: ['seed'], seedOffsetY: ['seed'],
  peakShapeSlider: ['skeleton'], peakShape: ['skeleton'], densitySlider: ['skeleton'], density: ['skeleton'],
  clusteringSlider: ['skeleton'], clustering: ['skeleton'], symmetry: ['skeleton'], symOffsetXSlider: ['skeleton'],
  symOffsetX: ['skeleton'], symOffsetYSlider: ['skeleton'], symOffsetY: ['skeleton'], edgeMarginInSlider: ['skeleton'],
  edgeMarginIn: ['skeleton'], smoothIntensitySlider: ['skeleton'], smoothIntensity: ['skeleton'], smoothRadiusSlider: ['skeleton'],
  smoothRadius: ['skeleton'], smoothRespectSymmetry: ['skeleton'],
  isolateSkeleton: ['filter'], noiseType: ['filter'], scaleSlider: ['filter'], scale: ['filter'], detailDensitySlider: ['filter'],
  detailDensity: ['filter'], detailStrengthSlider: ['filter'], detailStrength: ['filter'], detailDensityRespectSymmetry: ['filter'],
  filterTweaksReset: ['filter'],
};

describe('moving a control never changes the job-timeline step that locks it', () => {
  it('LOCK_BEFORE is what the app computes on main\'s markup (18af1d97)', () => {
    const before = execFileSync('git', ['show', `18af1d97:${PALETTE}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(lockMap(bodyOf(before), EXISTING)).toEqual(LOCK_BEFORE);
  });
  it('every moved control is locked by the same step now; the new Shape controls by the Shape step (skeleton)', () => {
    const now = lockMap(BODY, [...EXISTING, ...NEW]);
    for (const id of EXISTING) expect(now[id], id).toEqual(LOCK_BEFORE[id]);
    for (const id of NEW) expect(now[id], id).toEqual(['skeleton']);
  });
  it('the Seed step opens the panel its Pan X / Y now sit in', () => {
    expect($('seedOffsetX').closest('.panel').classList.contains('panel-skeleton')).toBe(true);
    expect(JOB_STEP_KINDS.seed.opens.sidebar).toBe('panel-skeleton');
  });
});

// ── 5. Flat (no hills) greys the Shape rows that no longer act ──────────────────────────────────────────────────────
// a board where every Shape control acts: radial symmetry, smoothing on, a flat border
const LIVE = { ...DEFAULT, nx: 41, nz: 53, carveZ: 1.5, symmetry: 'radial', symOffsetX: 0.04, symOffsetY: -0.03, smoothIntensity: 0.6,
  smoothRadius: 0.8, smoothRespectSymmetry: true, edgeMargin: 0.15, shapeFlat: true, surfaceHeightIn: 0.3 };
const ALT = { macroScale: 1.3, peakShape: 4, density: 0.35, clustering: 0.6, mapZoom: 1.7, seedOffsetX: 0.21, seedOffsetY: -0.17,
  symmetry: 'x', symOffsetX: 0.2, symOffsetY: 0.2, edgeMargin: 0.3, smoothIntensity: 0.1, smoothRadius: 2.5,
  smoothRespectSymmetry: false, surfaceHeightIn: 0.5 };
// the Shape panel's P keys (edgeMarginIn reaches terrain.js as edgeMargin, core/engine/rebuild.js)
const SHAPE_KEYS = ['surfaceHeightIn', 'macroScale', 'peakShape', 'density', 'clustering', 'mapZoom', 'seedOffsetX', 'seedOffsetY',
  'symmetry', 'symOffsetX', 'symOffsetY', 'edgeMargin', 'smoothIntensity', 'smoothRadius', 'smoothRespectSymmetry'];

describe('Flat (no hills): the Shape rows that no longer act are greyed, not hidden', () => {
  it('the greyed rows are exactly the Shape keys the flat heightmap no longer reads (measured, each key moved alone)', async () => {
    const { SHAPE_FLAT_ROWS } = await flatUi();
    const greyedOn = SHAPE_FLAT_ROWS.filter((r) => r.greysWhen === true).flatMap((r) => r.params);
    const base = sha(generateHeightmap(LIVE).heights);
    const inert = SHAPE_KEYS.filter((k) => sha(generateHeightmap({ ...LIVE, [k]: ALT[k] }).heights) === base);
    expect(greyedOn.sort()).toEqual(inert.sort());
    expect(inert.sort()).toEqual(['clustering', 'density', 'macroScale', 'peakShape']);
  });
  it('switching it on greys those rows (the app\'s greyed style) and keeps them shown; the surface height greys while it is off', async () => {
    const { SHAPE_FLAT_ROWS, syncShapeFlatUI } = await flatUi();
    const keep = P.shapeFlat;
    try {
      for (const on of [false, true, false]) {
        P.shapeFlat = on;
        syncShapeFlatUI(document);
        for (const r of SHAPE_FLAT_ROWS) {
          const rows = document.querySelectorAll(`[data-shape-flat-row="${r.row}"]`);
          expect(rows.length, r.row).toBe(1);
          const row = rows[0];
          for (const k of r.params) expect(row.contains($(k)), `${k} in row ${r.row}`).toBe(true);
          expect(row.classList.contains('shape-flat-greyed'), `${r.row} with the switch ${on}`).toBe(on === r.greysWhen);
          expect(row.style.display, r.row).not.toBe('none');
          expect(row.hidden, r.row).toBe(false);
        }
      }
    } finally { P.shapeFlat = keep; }
  });
  it('the greyed style is the photo section\'s own (styles/layout-app.css)', () => {
    const css = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf8');
    expect(css).toMatch(/\.photo-layer-needs-on,\s*\.shape-flat-greyed\s*\{\s*opacity:\s*0\.45;/);
  });
});
