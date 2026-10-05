/**
 * F35 item 23 (Fred: "a frame of fieldstone and a wall of soldier"; then "so white rocks and fieldstone is
 * different?" -> folded): the brick SET is per element, and the ROCK set is implied by the Fieldstone pattern --
 * one source of truth, each set's declared `layout` (editor-brick-tool.js ROCK_SET_ID / BRICK_SET_IDS /
 * elementSetId). Saved boards on the old single `setId` migrate (main/app-init.js MIGRATIONS).
 */
import { describe, it, expect } from 'vitest';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { ROCK_SET_ID, BRICK_SET_IDS, elementSetId, elementSettings, elementGroutWidth, isRockFrame } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { MIGRATIONS, runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

describe('rock vs brick sets, from the declared layouts', () => {
  it('ROCK = the set laid as fieldstone; the BRICK sets = those laid as bond (White Rocks is not a brick set)', () => {
    expect(BRICK_SETS.find((s) => s.id === ROCK_SET_ID).layout).toBe('fieldstone');
    expect(BRICK_SET_IDS).toEqual(BRICK_SETS.filter((s) => s.layout === 'bond').map((s) => s.id));
    expect(BRICK_SET_IDS).not.toContain(ROCK_SET_ID);
  });
});

describe('elementSetId', () => {
  const base = { pattern: 'stretcher', frameBandPatterns: [], setIds: { wall: 1, frame: 5, brush: 6, raisedBrush: 7 } };
  it('each element its own set', () => {
    expect(['wall', 'frame', 'brush', 'raisedBrush'].map((k) => elementSetId(base, k))).toEqual([1, 5, 6, 7]);
  });
  it('the Fieldstone pattern makes the WALL rock (only the wall)', () => {
    const s = { ...base, pattern: 'fieldstone' };
    expect(elementSetId(s, 'wall')).toBe(ROCK_SET_ID);
    expect(elementSetId(s, 'frame')).toBe(5);
  });
  it('fieldstone on EVERY band makes the FRAME rock; one brick band keeps it bricks', () => {
    expect(isRockFrame({ frameBandPatterns: ['fieldstone', 'fieldstone'] })).toBe(true);
    expect(isRockFrame({ frameBandPatterns: ['fieldstone', 'soldier'] })).toBe(false);
    expect(isRockFrame({ frameBandPatterns: [] })).toBe(false);
    expect(elementSetId({ ...base, frameBandPatterns: ['fieldstone'] }, 'frame')).toBe(ROCK_SET_ID);
    expect(elementSetId({ ...base, frameBandPatterns: ['fieldstone'] }, 'wall')).toBe(1);
  });
  it('a pre-item-23 settings object (one setId) still resolves; elementSettings carries the element\'s set', () => {
    expect(elementSetId({ setId: 1, pattern: 'stretcher' }, 'frame')).toBe(1);
    // + its own joint (grout per element): none set -> the element's set's declared one
    expect(elementSettings(base, 'frame')).toEqual({ ...base, setId: 5, grout: { ...(base.grout || {}), widthIn: elementGroutWidth(base, 'frame') } });
  });
});

describe("migration 'brick-set-per-element'", () => {
  const migrate = (brickSettings) => { const p = { brickSettings }; runMigrations(p); return p.brickSettings; };
  it('is declared after the size migration (which still reads the old setId)', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids.indexOf('brick-set-per-element')).toBeGreaterThan(ids.indexOf('brick-scale-to-brickLengthIn'));
  });
  it('a board on Red Brick: every element Red, nothing else changes', () => {
    const b = migrate({ setId: 1, pattern: 'herringbone', frameBandPreset: 'three_band', brickLengthIn: 1 });
    expect(b.setIds).toEqual({ wall: 1, frame: 1, brush: 1, raisedBrush: 1 });
    expect(b.pattern).toBe('herringbone');
    expect(b.frameBandPatterns).toBeUndefined();
    expect('setId' in b).toBe(false);
  });
  it('a board on White Rocks: the Fieldstone pattern on the wall, fieldstone on every band, brick sets for the rest', () => {
    const b = migrate({ setId: ROCK_SET_ID, pattern: 'stretcher', frameBandPreset: 'three_band', brickLengthIn: 1 });
    expect(b.pattern).toBe('fieldstone');
    expect(b.frameBandPatterns).toEqual(FRAME_PRESETS.three_band.map(() => 'fieldstone'));
    expect(b.setIds).toEqual({ wall: 1, frame: 1, brush: 1, raisedBrush: 1 });
    expect(elementSetId(b, 'wall')).toBe(ROCK_SET_ID);
    expect(elementSetId(b, 'frame')).toBe(ROCK_SET_ID);
  });
  it('a board already per element is left alone', () => {
    const b = migrate({ setIds: { wall: 1, frame: 1, brush: 1, raisedBrush: 1 }, pattern: 'stack' });
    // (the later 'grout-per-element' migration adds its own field; this one changes nothing)
    expect(b).toEqual({ setIds: { wall: 1, frame: 1, brush: 1, raisedBrush: 1 }, pattern: 'stack', groutByElement: { wall: null, frame: null, brush: null } });
  });
});
