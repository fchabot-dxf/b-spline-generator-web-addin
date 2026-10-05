/**
 * Grey sets (88's T86 items 24/25): a COURSED RUBBLE Wall pattern that picks Set 5 (Grey stone) the way Fieldstone
 * picks Set 3 -- declared once (BRICK_PATTERNS, family fieldstone), the set implied by the pattern (patternSetId).
 */
import { describe, it, expect } from 'vitest';
import { BRICK_PATTERNS, BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { elementSetId, patternSetId, wallLayoutFor, BRICK_SET_IDS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bandCanLay } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';

const rubble = BRICK_SETS.find((s) => s.layout === 'coursed_rubble');

describe('Coursed rubble wall pattern', () => {
  it('declared: a Wall pattern in the Fieldstone family, not band-capable, not in the Set row', () => {
    expect(BRICK_PATTERNS.coursed_rubble).toEqual({ kind: 'tile2d', family: 'fieldstone' });
    expect(bandCanLay(BRICK_PATTERNS.coursed_rubble)).toBe(false);
    expect(BRICK_SET_IDS).not.toContain(rubble.id);
  });
  it('the pattern picks the Grey stone set for the wall (as Fieldstone picks White Rocks); bricks keep their set', () => {
    expect(patternSetId('coursed_rubble')).toBe(rubble.id);
    expect(patternSetId('fieldstone')).toBe(BRICK_SETS.find((s) => s.layout === 'fieldstone').id);
    expect(patternSetId('stretcher')).toBe(null);
    expect(elementSetId({ pattern: 'coursed_rubble', setIds: { wall: 1 } }, 'wall')).toBe(rubble.id);
    expect(elementSetId({ pattern: 'coursed_rubble', setIds: { frame: 1 } }, 'frame')).toBe(1);
    expect(elementSetId({ pattern: 'stretcher', setIds: { wall: 1 } }, 'wall')).toBe(1);
    expect(wallLayoutFor({ pattern: 'coursed_rubble' })).toBe('coursed_rubble');
  });
  it('the engine lays it: a coursed rubble wall in the Grey stone set', () => {
    const board = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
    const r = generateBricks({ boardOutline: board, set: { ...rubble, layout: 'coursed_rubble' }, seed: 1, scale: 1 });
    expect(r.bricks.length).toBeGreaterThan(5);
  });
});
