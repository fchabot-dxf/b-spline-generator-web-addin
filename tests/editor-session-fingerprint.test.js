/**
 * F35 item 25: the editor-session fingerprint (main/app-init.js) decides whether [3D] needs the Apply rebuild. It
 * must see a change made ANYWHERE in the editor -- the drawing, the frame (its own undo, not the editor's), the
 * brick settings, the photo -- not just the editor's undo stack.
 */
import { describe, it, expect } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { editorSessionFingerprint } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

describe('editorSessionFingerprint', () => {
  it.each([
    ['the drawing', () => { P.editorSvg = '<svg><rect/></svg>'; }],
    ['the frame record (a Frame-tab edit)', () => { P.frame = { ...(P.frame || {}), templateId: 'template_3' }; }],
    ['a brick setting', () => { P.brickSettings = { ...P.brickSettings, pattern: 'herringbone' }; }],
    ['the photo', () => { P.photoEdits = [{ op: 'blur', params: { radius: 1 } }]; }],
  ])('changes when %s changes; an unchanged session gives the same string', (_n, change) => {
    const before = editorSessionFingerprint();
    expect(editorSessionFingerprint()).toBe(before);
    change();
    expect(editorSessionFingerprint()).not.toBe(before);
  });
});
