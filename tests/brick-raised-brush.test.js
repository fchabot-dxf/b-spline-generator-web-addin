/**
 * F35 item 16 (turn 201): the RAISED BRUSH -- a Brush variant whose strokes are laid proud by their own
 * Level (frozen per stroke), and whose mode 2 (grout cut, seat B's T86 item 10) lays no bricks (stub,
 * hidden until the engine lists 'groutCut').
 */
import { describe, it, expect } from 'vitest';
import { bricksForStroke } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const stroke = [{ x: 1, y: 4 }, { x: 5, y: 4 }];

describe('bricksForStroke', () => {
  it('a plain stroke = the brush bricks, unchanged', () => {
    const plain = bricksForStroke(stroke, { ...P.brickSettings });
    expect(plain.length).toBeGreaterThan(2);
  });
  it('a Raised stroke lifts every brick by its Level (and only that stroke)', () => {
    const plain = bricksForStroke(stroke, { ...P.brickSettings });
    const raised = bricksForStroke(stroke, { ...P.brickSettings, levelIn: 0.0625, strokeMode: 'bricks' });
    expect(raised.length).toBe(plain.length);
    raised.forEach((b, i) => expect(b.heightOffset - (plain[i].heightOffset || 0)).toBeCloseTo(0.0625, 12));
  });
  it('a grout-mode stroke lays no bricks (stub until the engine cut)', () => {
    expect(bricksForStroke(stroke, { ...P.brickSettings, levelIn: 0.0625, strokeMode: 'grout' })).toEqual([]);
  });
});
