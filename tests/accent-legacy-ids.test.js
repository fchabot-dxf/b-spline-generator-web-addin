/**
 * Saved boards keep their accents (advisor 2026-10-14, after 0b04ee2): the per-pattern lists (PATTERN_ACCENT_PRESETS)
 * reuse some legacy ids with OTHER params (Stretcher's 'crenellation' every 2, the legacy every 3). A saved board stores
 * only the id, so the id must resolve to the LEGACY entry -- the same bricks raised as before -- whatever a pattern
 * list declares under it.
 */
import { describe, it, expect } from 'vitest';
import { ACCENT_PRESETS, PATTERN_ACCENT_PRESETS, accentPresetById } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-accents.js';

// the 10 presets a board could be saved with before 0b04ee2 (its parent's ACCENT_PRESETS)
const LEGACY = ['checker', 'staircase', 'doubleStaircase', 'pyramid', 'zigzag', 'courseBand', 'doubleBand', 'crenellation', 'sparseDots', 'random'];

describe('a saved accent id lays what it laid before the per-pattern presets', () => {
  it('every legacy id still resolves, to its own ACCENT_PRESETS entry', () => {
    for (const id of LEGACY.filter((i) => ACCENT_PRESETS.some((p) => p.id === i))) {
      expect(accentPresetById(id), id).toBe(ACCENT_PRESETS.find((p) => p.id === id));
    }
  });
  it('a pattern list that reuses a legacy id never shadows it', () => {
    const reused = Object.values(PATTERN_ACCENT_PRESETS).flat().filter((p) => LEGACY.includes(p.id));
    expect(reused.length).toBeGreaterThan(0); // the case this pins exists (Stretcher: staircase, pyramid, zigzag, crenellation, checker)
    for (const p of reused) expect(accentPresetById(p.id), p.id).toBe(ACCENT_PRESETS.find((q) => q.id === p.id));
  });
  it('a reused id keeps the legacy params (crenellation: every 3, though Stretcher declares every 2 under it)', () => {
    expect(PATTERN_ACCENT_PRESETS.stretcher.find((p) => p.id === 'crenellation').params.every).toBe(2);
    expect(accentPresetById('crenellation').params.every).toBe(3);
  });
  it('all 10 legacy ids are still declared', () => {
    for (const id of LEGACY) expect(ACCENT_PRESETS.some((p) => p.id === id), id).toBe(true);
  });
});
