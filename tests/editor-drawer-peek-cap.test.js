/**
 * Phone held sideways (844x390): the Brick tab's pinned essentials made the PEEK drawer the whole screen (canvas 0 px).
 * Peek may be raised to the essentials, but never past half the viewport.
 */
import { describe, it, expect } from 'vitest';
import { peekHeightPx, drawerHeightPx } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-drawer.js';

describe('peek drawer height', () => {
  it('a short viewport caps the essentials floor at half the height', () => {
    expect(peekHeightPx(390, 380)).toBe(drawerHeightPx('half', 390));
    expect(peekHeightPx(390, 380)).toBeLessThanOrEqual(195);
  });
  it('a tall viewport keeps the essentials floor unchanged', () => {
    expect(peekHeightPx(844, 375)).toBe(375);
    expect(peekHeightPx(915, 375)).toBe(375);
  });
  it('no essentials: the plain peek height', () => {
    expect(peekHeightPx(844, 0)).toBe(96);
  });
});
