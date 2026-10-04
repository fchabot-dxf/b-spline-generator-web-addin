/**
 * H23 item 72 BRICK ENGINE -- library.js declared data: the piece catalogue (A1-A6/B1-B9, read
 * directly off brick_piece_catalog.png's own labels), the brick-sample sets (max 3, Set 1 = the
 * red-brick swap, Set 2 = b2_* unaffected), and FRAME_PRESETS.
 */
import { describe, it, expect } from 'vitest';
import {
  PIECE_CATALOGUE, BRICK_SETS, FRAME_PRESETS, brickSetById, enabledPieces,
} from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

describe('PIECE_CATALOGUE', () => {
  it('has exactly 1 single + 6 two-brick (A) + 9 three-brick (B) pieces = 16 total', () => {
    expect(PIECE_CATALOGUE.length).toBe(16);
    expect(PIECE_CATALOGUE.filter((p) => p.bricks === 1).length).toBe(1);
    expect(PIECE_CATALOGUE.filter((p) => p.bricks === 2).length).toBe(6);
    expect(PIECE_CATALOGUE.filter((p) => p.bricks === 3).length).toBe(9);
  });

  it('every piece\'s own offsets array length matches its declared `bricks` count, and offsets[0] is always 0 (the anchor brick)', () => {
    for (const p of PIECE_CATALOGUE) {
      expect(p.offsets.length).toBe(p.bricks);
      expect(p.offsets[0]).toBe(0);
    }
  });

  it('A5 is the standard 1/2-shift running bond and B3 is the 1/2-stair (the catalogue\'s own most-recognizable entries)', () => {
    const a5 = PIECE_CATALOGUE.find((p) => p.id === 'A5');
    expect(a5.offsets).toEqual([0, 1 / 2]);
    const b3 = PIECE_CATALOGUE.find((p) => p.id === 'B3');
    expect(b3.offsets).toEqual([0, 1 / 2, 1]);
  });

  it('every piece starts enabled (Fred still picking, nothing silently excluded)', () => {
    for (const p of PIECE_CATALOGUE) expect(p.enabled).toBe(true);
  });

  it('enabledPieces() round-trips the full catalogue while all are enabled, and actually filters when one is disabled', () => {
    expect(enabledPieces(PIECE_CATALOGUE).length).toBe(PIECE_CATALOGUE.length);
    const withOneDisabled = PIECE_CATALOGUE.map((p, i) => (i === 0 ? { ...p, enabled: false } : p));
    expect(enabledPieces(withOneDisabled).length).toBe(PIECE_CATALOGUE.length - 1);
  });
});

describe('BRICK_SETS', () => {
  it('has exactly 3 slots (a fixed max, no open-ended library machinery)', () => {
    expect(BRICK_SETS.length).toBe(3);
  });

  it('Set 1 is the red-brick swap: 47 samples, 4 flagged odd, no leftover b1_* garden-edging ids', () => {
    const set1 = BRICK_SETS[0];
    expect(set1.samples.length).toBe(47);
    expect(set1.samples.filter((s) => s.odd).length).toBe(4);
    expect(set1.samples.every((s) => /^r[cw]_\d+$/.test(s.id))).toBe(true);
    expect(set1.samples.some((s) => s.id.startsWith('b1_'))).toBe(false);
  });

  it('Set 2 keeps its original b2_* samples, untouched by the Set 1 swap', () => {
    const set2 = BRICK_SETS[1];
    expect(set2.samples.map((s) => s.id)).toEqual(['b2_01', 'b2_02', 'b2_03', 'b2_04', 'b2_05']);
  });

  it('Set 3 is "White rocks" (H23 item 74b): fieldstone layout, 10 samples, a wider grout than Set 1', () => {
    const set3 = BRICK_SETS[2];
    expect(set3.name).toBe('White rocks');
    expect(set3.layout).toBe('fieldstone');
    expect(set3.samples.length).toBe(10);
    expect(set3.grout.widthIn).toBeGreaterThan(BRICK_SETS[0].grout.widthIn);
  });

  it('every non-empty set declares a relief budget with reliefIn <= reliefMaxIn <= 0.25', () => {
    for (const set of BRICK_SETS) {
      if (!set.samples.length) continue;
      expect(set.reliefIn).toBeLessThanOrEqual(set.reliefMaxIn);
      expect(set.reliefMaxIn).toBeLessThanOrEqual(0.25);
    }
  });

  it('brickSetById finds each declared set by id, and null for an unknown id', () => {
    expect(brickSetById(1)).toBe(BRICK_SETS[0]);
    expect(brickSetById(2)).toBe(BRICK_SETS[1]);
    expect(brickSetById(999)).toBeNull();
  });
});

describe('FRAME_PRESETS', () => {
  it('declares exactly the 4 named presets, each a non-empty band list with widthIn > 0', () => {
    // T86 item 1: butt_frame joins the 3 original mitre-only presets, declaring the FIRST non-mitre
    // cornerStyle; lapped/block each add their own preset(s) here in their own later items.
    expect(Object.keys(FRAME_PRESETS).sort()).toEqual(['butt_frame', 'single_soldier', 'soldier_stretcher', 'three_band'].sort());
    for (const bands of Object.values(FRAME_PRESETS)) {
      expect(bands.length).toBeGreaterThan(0);
      for (const b of bands) expect(b.widthIn).toBeGreaterThan(0);
    }
  });

  it('butt_frame declares cornerStyle "butt"; every other preset stays silent (defaults to mitre)', () => {
    expect(FRAME_PRESETS.butt_frame.every((b) => b.cornerStyle === 'butt')).toBe(true);
    for (const name of ['single_soldier', 'soldier_stretcher', 'three_band']) {
      expect(FRAME_PRESETS[name].every((b) => b.cornerStyle === undefined)).toBe(true);
    }
  });
});

describe('bundled sample assets (H23 item 73(b))', () => {
  it('every declared sample image file actually exists, and every file on disk totals <=3MB', async () => {
    const { readdirSync, statSync, existsSync } = await import('node:fs');
    const path = await import('node:path');
    const dataDir = path.resolve(process.cwd(), 'bspline-frame-builder/b-spline-gen/html/data/bricks') + path.sep;

    // every declared sample's own image path resolves to a real file (catches a stale .png
    // reference after the q85/480px JPEG re-encode -- MEASURED to fail before the library.js
    // extension update that went with it).
    for (const set of BRICK_SETS) {
      for (const sample of set.samples) {
        const fileName = sample.image.replace(/^data\/bricks\//, '');
        expect(existsSync(dataDir + fileName), `${set.name}: ${sample.image} does not exist on disk`).toBe(true);
      }
    }

    // the WHOLE directory (not just declared samples -- catches an orphaned large file too)
    // stays within the item 73(b) budget: re-encoded from ~10MB (PNG) to JPEG q85/480px long side.
    const totalBytes = readdirSync(dataDir).reduce((sum, f) => sum + statSync(dataDir + f).size, 0);
    expect(totalBytes, `data/bricks/ total size (${(totalBytes / 1024 / 1024).toFixed(2)}MB)`).toBeLessThanOrEqual(3 * 1024 * 1024);
  });
});
