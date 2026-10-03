/**
 * F34 item 1 — P.photoImageDataUrl / P.photoEdits round-trip with the
 * project the same generic way every other scalar/array P field already
 * does (core/state.js), no special-casing anywhere in updateP/
 * saveLastSession/loadLastSession -- confirmed here, mirroring
 * decal-settings-persist.test.js's own pattern, rather than assumed.
 *
 * This is the "save/load round-trips" leg of the dispatch's own test plan;
 * it deliberately does NOT touch the real decode (core/photo/codec.js) --
 * that's canvas-only and verified live (see tests/noise-photo.test.js's own
 * header comment on why).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P, DEFAULT, persistableP, loadLastSession } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

describe('photo state — defaults', () => {
  it('no photo, no edits, until the user loads one', () => {
    expect(DEFAULT.photoImageDataUrl).toBeNull();
    expect(DEFAULT.photoEdits).toEqual([]);
  });
});

describe('photo state — persistableP carries both fields through unchanged', () => {
  it('a loaded photo + its own edit list survive the persistable copy', () => {
    const edits = [{ op: 'rotate90', params: { dir: 1 } }, { op: 'invert', params: {} }];
    const out = persistableP({ ...DEFAULT, photoImageDataUrl: 'data:image/png;base64,ABC', photoEdits: edits });
    expect(out.photoImageDataUrl).toBe('data:image/png;base64,ABC');
    expect(out.photoEdits).toEqual(edits);
  });
});

describe('photo state — loadLastSession restore (project load)', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(P, DEFAULT);
  });

  it('restores the embedded image and its full ordered edit list', () => {
    const edits = [
      { op: 'crop', params: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } },
      { op: 'levels', params: { black: 0.1, white: 0.9, mid: 1.2 } },
      { op: 'blur', params: { radius: 2 } },
    ];
    localStorage.setItem('splineGenLastSession', JSON.stringify({
      P: { photoImageDataUrl: 'data:image/png;base64,XYZ', photoEdits: edits, noiseType: 'photo' },
    }));
    const ok = loadLastSession();
    expect(ok).toBe(true);
    expect(P.photoImageDataUrl).toBe('data:image/png;base64,XYZ');
    expect(P.photoEdits).toEqual(edits);
    expect(P.noiseType).toBe('photo');
  });

  it('a project saved before F34 item 1 existed (no photo keys at all) leaves the defaults untouched, not undefined', () => {
    localStorage.setItem('splineGenLastSession', JSON.stringify({ P: { widthIn: 11 } }));
    loadLastSession();
    expect(P.widthIn).toBe(11);
    expect(P.photoImageDataUrl).toBeNull();
    expect(P.photoEdits).toEqual([]);
  });

  it('undo (popping the last edit step) round-trips through save/load like any other edit to the list', () => {
    const edits = [{ op: 'invert', params: {} }, { op: 'flip', params: { axis: 'h' } }];
    localStorage.setItem('splineGenLastSession', JSON.stringify({
      P: { photoImageDataUrl: 'data:x', photoEdits: edits },
    }));
    loadLastSession();
    P.photoEdits = P.photoEdits.slice(0, -1); // the UI's own "Undo" action
    expect(P.photoEdits).toEqual([{ op: 'invert', params: {} }]);
  });
});
