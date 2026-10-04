/**
 * F35 item 28: the editor's Clear > Photo (main/photo-panel.js clearPhoto) -- no photo, as on a new board: the
 * image, its edits and its pattern go back to core/state.js's defaults; nothing else in P changes.
 */
import { describe, it, expect } from 'vitest';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { clearPhoto } from '../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js';

describe('clearPhoto', () => {
  it('the photo, its edits and its pattern go back to the new-board defaults; the rest of P is untouched', () => {
    P.photoImageDataUrl = 'data:image/png;base64,AAAA';
    P.photoEdits = [{ op: 'blur', params: { radius: 2 } }];
    P.photoPatternId = 'brick_wall';
    P.noiseType = 'photo';
    const widthIn = P.widthIn;
    clearPhoto();
    expect(P.photoImageDataUrl).toBe(DEFAULT.photoImageDataUrl);
    expect(P.photoEdits).toEqual(DEFAULT.photoEdits);
    expect(P.photoPatternId).toBe(DEFAULT.photoPatternId);
    expect(P.noiseType).toBe('photo'); // only the photo's own state -- the filter choice stays
    expect(P.widthIn).toBe(widthIn);
  });
});
