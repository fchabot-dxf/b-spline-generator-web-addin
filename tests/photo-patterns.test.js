/**
 * F34 item 1 — core/photo/patterns.js: the pure settings<->internal-shape
 * converters (settingsToPhotoEdits/settingsToTweaks), plus loadPhotoPatterns'
 * own graceful-failure behavior. No canvas, no real fetch of the real data
 * file -- data/photo-patterns.json's own content is a live-maintained
 * collection (tools/add_photo_pattern.py), not something a unit test should
 * pin exact values against.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  settingsToPhotoEdits, settingsToTweaks, TWEAK_KEYS, loadPhotoPatterns,
} from '../bspline-frame-builder/b-spline-gen/html/core/photo/patterns.js';
import * as photo from '../bspline-frame-builder/b-spline-gen/html/core/noise/photo.js';
import { applyPhotoEdits } from '../bspline-frame-builder/b-spline-gen/html/core/photo/ops.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('TWEAK_KEYS matches core/noise/photo.js\'s own declared schema exactly', () => {
  it('no drift between the converter\'s own key list and the real tweaks schema', () => {
    expect([...TWEAK_KEYS].sort()).toEqual(photo.tweaks.map((t) => t.key).sort());
  });
});

describe('settingsToPhotoEdits: a fully-neutral pattern produces an EMPTY edit list', () => {
  it('no straighten/crop/rotate/flip/levels/brightness/contrast/blur/invert at all -> []', () => {
    expect(settingsToPhotoEdits({})).toEqual([]);
    expect(settingsToPhotoEdits(undefined)).toEqual([]);
    expect(settingsToPhotoEdits({
      straighten: 0, crop: null, rotate: 0, flip: { h: false, v: false }, levels: null,
      brightness: 0, contrast: 0, blur: 0, invert: false,
    })).toEqual([]);
  });
});

describe('settingsToPhotoEdits: each field expands to its own declared op', () => {
  it('straighten, non-zero, becomes one straighten step -- and comes BEFORE crop (declared edit order)', () => {
    expect(settingsToPhotoEdits({ straighten: -33 })).toEqual([{ op: 'straighten', params: { degrees: -33 } }]);
    expect(settingsToPhotoEdits({ straighten: -33, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })).toEqual([
      { op: 'straighten', params: { degrees: -33 } },
      { op: 'crop', params: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
    ]);
  });

  it('crop, present, becomes one crop step', () => {
    expect(settingsToPhotoEdits({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } })).toEqual([
      { op: 'crop', params: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } },
    ]);
  });

  it('rotate expands to that many individual rotate90 steps, normalized mod 360', () => {
    expect(settingsToPhotoEdits({ rotate: 90 })).toEqual([{ op: 'rotate90', params: { dir: 1 } }]);
    expect(settingsToPhotoEdits({ rotate: 270 })).toEqual([
      { op: 'rotate90', params: { dir: 1 } }, { op: 'rotate90', params: { dir: 1 } }, { op: 'rotate90', params: { dir: 1 } },
    ]);
    expect(settingsToPhotoEdits({ rotate: 360 })).toEqual([]);
    expect(settingsToPhotoEdits({ rotate: -90 })).toEqual([
      { op: 'rotate90', params: { dir: 1 } }, { op: 'rotate90', params: { dir: 1 } }, { op: 'rotate90', params: { dir: 1 } },
    ]);
  });

  it('flip.h and flip.v each become their own step, independently', () => {
    expect(settingsToPhotoEdits({ flip: { h: true, v: false } })).toEqual([{ op: 'flip', params: { axis: 'h' } }]);
    expect(settingsToPhotoEdits({ flip: { h: false, v: true } })).toEqual([{ op: 'flip', params: { axis: 'v' } }]);
    expect(settingsToPhotoEdits({ flip: { h: true, v: true } })).toEqual([
      { op: 'flip', params: { axis: 'h' } }, { op: 'flip', params: { axis: 'v' } },
    ]);
  });

  it('levels, present, becomes one levels step with its own black/white/mid', () => {
    expect(settingsToPhotoEdits({ levels: { black: 0.1, white: 0.9, mid: 1.3 } })).toEqual([
      { op: 'levels', params: { black: 0.1, white: 0.9, mid: 1.3 } },
    ]);
  });

  it('brightness/contrast combine into ONE brightnessContrast step', () => {
    expect(settingsToPhotoEdits({ brightness: 0.1, contrast: 0.2 })).toEqual([
      { op: 'brightnessContrast', params: { brightness: 0.1, contrast: 0.2 } },
    ]);
    expect(settingsToPhotoEdits({ brightness: 0.1 })).toEqual([
      { op: 'brightnessContrast', params: { brightness: 0.1, contrast: 0 } },
    ]);
  });

  it('blur becomes one blur step with that radius', () => {
    expect(settingsToPhotoEdits({ blur: 3 })).toEqual([{ op: 'blur', params: { radius: 3 } }]);
  });

  it('invert, true, becomes one invert step', () => {
    expect(settingsToPhotoEdits({ invert: true })).toEqual([{ op: 'invert', params: {} }]);
    expect(settingsToPhotoEdits({ invert: false })).toEqual([]);
  });

  it('a fully-populated settings object expands in the declared, applyPhotoEdits-compatible order', () => {
    const edits = settingsToPhotoEdits({
      straighten: 5, crop: { x: 0, y: 0, w: 0.8, h: 0.8 }, rotate: 90, flip: { h: true, v: false },
      levels: { black: 0.05, white: 0.95, mid: 1 }, brightness: 0, contrast: 0.1, blur: 1, invert: false,
    });
    // Must be a valid BuildSequence for applyPhotoEdits -- run it on a tiny image, confirm no throw
    // and a plausible result, rather than just checking the list's own shape.
    const base = { data: Float32Array.from([0, 0.5, 1, 0.25, 0.75, 0, 1, 0.5, 0.25]), w: 3, h: 3 };
    expect(() => applyPhotoEdits(base, edits)).not.toThrow();
    const out = applyPhotoEdits(base, edits);
    expect(out.w).toBeGreaterThan(0);
    expect(out.h).toBeGreaterThan(0);
  });
});

describe('settingsToTweaks: only the declared effect-param keys, only when actually set', () => {
  it('an empty/neutral settings object yields an empty tweaks override (schema defaults apply)', () => {
    expect(settingsToTweaks({})).toEqual({});
    expect(settingsToTweaks(undefined)).toEqual({});
  });

  it('picks exactly the 6 declared keys, ignoring editor-only fields', () => {
    const out = settingsToTweaks({
      depth: 1.4, scale: 0.8, offsetX: 0.1, offsetY: -0.1, rotation: 45, repeat: 1,
      crop: { x: 0, y: 0, w: 1, h: 1 }, invert: true, // editor fields -- must NOT leak into tweaks
    });
    expect(out).toEqual({ depth: 1.4, scale: 0.8, offsetX: 0.1, offsetY: -0.1, rotation: 45, repeat: 1 });
  });

  it('a null value for a tweak key is treated as "not set" (schema default applies), not a literal null override', () => {
    expect(settingsToTweaks({ depth: null, scale: 1.5 })).toEqual({ scale: 1.5 });
  });
});

describe('loadPhotoPatterns: never throws, degrades to an empty list', () => {
  it('a 404 response yields []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    expect(await loadPhotoPatterns('data/does-not-exist.json')).toEqual([]);
  });

  it('a network error yields [] rather than rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await loadPhotoPatterns()).toEqual([]);
  });

  it('a malformed (non-array) payload yields []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ not: 'an array' }) })));
    expect(await loadPhotoPatterns()).toEqual([]);
  });

  it('a real array payload passes through unchanged', async () => {
    const list = [{ id: 'brick1', name: 'Brick 1' }];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => list })));
    expect(await loadPhotoPatterns()).toEqual(list);
  });
});
