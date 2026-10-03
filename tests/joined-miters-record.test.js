/**
 * F31 item 2c (Fred: "on the Flask the side can sometimes be one piece, I'd want a manual toggle"):
 * the frame record's own `joinedMiters` field -- a list of joint ids from the CURRENT template's
 * own declared `regions.joinable` (T14/T15/T16/T17 each declare two, one per side, Fusion-side
 * mechanics in fb_engine/joined_miters.py). This file covers the record normalization + payload
 * shape only (same split inset-window.test.js's own header describes: 2D rendering/drag UI are
 * DOM-coupled, not unit tested here).
 */
import { describe, it, expect } from 'vitest';
import { normalizeFrameRecord, defaultFrameRecord, framePayload, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';

const T15 = FRAME_DEFS.templates.find((t) => t.id === 'template_15');
const T16 = FRAME_DEFS.templates.find((t) => t.id === 'template_16');

describe('frame-record.js: joinedMiters', () => {
  it('declares exactly the 4 joinable templates, each with 2 mirrored joints', () => {
    const joinableIds = ['template_14', 'template_15', 'template_16', 'template_17'];
    for (const t of FRAME_DEFS.templates) {
      if (joinableIds.includes(t.id)) {
        expect(t.regions.joinable, t.id).toHaveLength(2);
        const [a, b] = t.regions.joinable;
        expect(a.mirror).toBe(b.id);
        expect(b.mirror).toBe(a.id);
      } else {
        expect(t.regions.joinable ?? [], t.id).toEqual([]);
      }
    }
  });

  it('defaults to every joint split (empty array)', () => {
    expect(defaultFrameRecord().joinedMiters).toEqual([]);
    expect(normalizeFrameRecord({ templateId: 'template_15' }).joinedMiters).toEqual([]);
  });

  it('a declared id round-trips exactly', () => {
    const [j] = T15.regions.joinable;
    const out = normalizeFrameRecord({ templateId: 'template_15', joinedMiters: [j.id] });
    expect(out.joinedMiters).toEqual([j.id]);
  });

  it('both declared ids round-trip, in the order given', () => {
    const ids = T15.regions.joinable.map((j) => j.id);
    const out = normalizeFrameRecord({ templateId: 'template_15', joinedMiters: [...ids].reverse() });
    expect(out.joinedMiters).toEqual([...ids].reverse());
  });

  it('a stale id from a template swap (or a hand-edited save) is silently dropped, never crashes', () => {
    const out = normalizeFrameRecord({ templateId: 'template_15', joinedMiters: ['waistR', 'neckBottomR', 'not-a-real-id'] });
    expect(out.joinedMiters).toEqual(['neckBottomR']); // waistR is T16's own id, not T15's
  });

  it('garbage (non-array, non-string entries) normalizes back to empty, never a half-valid record', () => {
    expect(normalizeFrameRecord({ templateId: 'template_15', joinedMiters: 'neckBottomR' }).joinedMiters).toEqual([]);
    expect(normalizeFrameRecord({ templateId: 'template_15', joinedMiters: [1, null, {}] }).joinedMiters).toEqual([]);
  });

  it('a template with no declared joinable joints (e.g. Template 1) always normalizes to empty', () => {
    const out = normalizeFrameRecord({ templateId: 'template_1', joinedMiters: ['anything'] });
    expect(out.joinedMiters).toEqual([]);
  });

  it('no template at all (templateId null/unknown) normalizes to empty, same as every other per-template field', () => {
    expect(normalizeFrameRecord({ joinedMiters: ['neckBottomR'] }).joinedMiters).toEqual([]);
    expect(normalizeFrameRecord({ templateId: 'not-a-template', joinedMiters: ['neckBottomR'] }).joinedMiters).toEqual([]);
  });

  it('framePayload carries joinedMiters for every template, empty by default (byte-identical path when unset)', () => {
    for (const tpl of FRAME_DEFS.templates) {
      const rec = normalizeFrameRecord({ templateId: tpl.id });
      expect(framePayload(FRAME_DEFS, rec).joinedMiters).toEqual([]);
    }
  });

  it('framePayload carries a real joined set through exactly', () => {
    const [j] = T16.regions.joinable;
    const rec = normalizeFrameRecord({ templateId: 'template_16', joinedMiters: [j.id] });
    expect(framePayload(FRAME_DEFS, rec).joinedMiters).toEqual([j.id]);
  });

  describe('setFrameRecord: a template change resets joinedMiters (ids are template-specific)', () => {
    it('switching from T15 to T16 drops T15\'s own joined ids', () => {
      P.widthIn = 7; P.heightIn = 9;
      setFrameRecord({ templateId: 'template_15', joinedMiters: [T15.regions.joinable[0].id] });
      expect(setFrameRecord({ templateId: 'template_15' }).joinedMiters).toEqual([T15.regions.joinable[0].id]); // same template: untouched
      const after = setFrameRecord({ templateId: 'template_16' });
      expect(after.joinedMiters).toEqual([]);
    });
  });
});
