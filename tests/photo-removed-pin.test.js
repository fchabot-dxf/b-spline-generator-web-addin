/**
 * Fred 2026-11-23 ("Remove photo"): the photo (Surface > Photo, the editor's Photo tab, the terrain's photo layer) is
 * removed. AGENTS.md rule 3: a saved board must load and build as before -- the DOCUMENTED removal is MIGRATIONS
 * 'photo-removed' (main/app-init.js): a board saved with its photo layer ON now builds exactly as main 9c3f6618 built the
 * same board with its photo layer OFF; a board without a photo builds byte-identically to main. Its photo keys stay in
 * its data, untouched.
 *
 * Real shapes: three of Fred's cloud boards (tests/fixtures/photo-removed-boards.json, their P as saved; editorSvg left
 * out -- the node build has no editor layers), loaded the way a project load does (snapshot-manager.js applySnapshot:
 * a key the save lacks reads as DEFAULT, then runMigrations), built by the real rebuild; digests = FNV-1a over the
 * heights' and the back's bytes (tests/layer-stack.test.js fnv). The pinned digests were MEASURED on main 9c3f6618 with
 * this same build: 'claude 14' as saved, 'Armor' and 'claude 18' after P.photoLayer = false.
 *   'claude 14' -- no photo (its photo keys are the defaults);
 *   'Armor'     -- the photo layer ON (rusty_grate, Mirror X, "Filter shows through" 99 %);
 *   'claude 18' -- saved on the old Photo FILTER (noiseType 'photo': MIGRATIONS 'photo-filter-to-layer' -> simplex).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, DEFAULT, lastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { rebuild, _forgetHeights } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { MIGRATIONS, runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

const BOARDS = JSON.parse(readFileSync('tests/fixtures/photo-removed-boards.json', 'utf8'));
const fnv = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

// main 9c3f6618, the same build (heights / back)
const MAIN = {
  'claude 14': { heights: '9c672c69', back: '6e8935d9' },
  'Armor': { heights: 'fff93c3e', back: '90b8f878' }, // its photo layer OFF
  'claude 18': { heights: '2ad64b81', back: 'c0fce10a' }, // its photo layer OFF
};

const saved = { ...P };
afterEach(() => {
  for (const k of Object.keys(P)) delete P[k];
  Object.assign(P, saved);
  window.svgEditor = null;
  _forgetHeights();
});

/** A project load of board `name` (applySnapshot's 'load' merge), its migrations, then the real rebuild. */
async function load(name) {
  const snapP = clone(BOARDS[name].P);
  for (const k of Object.keys(DEFAULT)) if (!(k in snapP)) P[k] = clone(DEFAULT[k]);
  Object.assign(P, snapP);
  runMigrations(P);
  return snapP;
}
async function build() {
  window.svgEditor = { _layers: [] };
  _forgetHeights();
  await rebuild({ update() {}, setStlGhosts() {} }, () => {}, () => {});
  return { heights: fnv(lastResult.heights), back: fnv(lastResult.thickenData.offsetPts) };
}

describe("MIGRATIONS 'photo-removed': the documented removal", () => {
  it('declared once, after the photo-filter one (whose noiseType it keeps), before the removed-filter default', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids.filter((id) => id === 'photo-removed')).toHaveLength(1);
    expect(ids.indexOf('photo-filter-to-layer')).toBeLessThan(ids.indexOf('photo-removed'));
    expect(ids.indexOf('photo-removed')).toBeLessThan(ids.indexOf('removed-noise-type-to-default'));
    for (const gone of ['photo-orientation', 'photo-mirror-mode', 'photo-edge']) expect(ids).not.toContain(gone);
  });

  it("a board with its photo on: its photo keys stay in its data, untouched (AGENTS.md rule 3)", async () => {
    const before = clone(BOARDS.Armor.P);
    await load('Armor');
    for (const k of Object.keys(before).filter((k) => k.startsWith('photo'))) expect(P[k], k).toEqual(before[k]);
    expect(P.filterTweaks.photo).toEqual(before.filterTweaks.photo);
    expect(P.photoLayer).toBe(true);
  });
});

describe('pin: every saved board builds as main 9c3f6618 did (heights + back)', () => {
  it("'claude 14' (no photo): byte-identical to main", async () => {
    await load('claude 14');
    expect(await build()).toEqual(MAIN['claude 14']);
  }, 60000);

  it("'Armor' (the photo layer ON): exactly main's build of it with the photo layer OFF", async () => {
    await load('Armor');
    expect(P.photoLayer).toBe(true);
    expect(await build()).toEqual(MAIN.Armor);
  }, 60000);

  it("'claude 18' (the old Photo filter): simplex, exactly main's build of it with the photo layer OFF", async () => {
    await load('claude 18');
    expect(P.noiseType).toBe('simplex');
    expect(await build()).toEqual(MAIN['claude 18']);
  }, 60000);
});
