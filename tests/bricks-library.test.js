/**
 * H23 item 72 BRICK ENGINE -- library.js declared data: the piece catalogue (A1-A6/B1-B9, read
 * directly off brick_piece_catalog.png's own labels), the brick-sample sets (max 3, Set 1 = the
 * red-brick swap, Set 2 = b2_* unaffected), and FRAME_PRESETS.
 */
import { describe, it, expect } from 'vitest';
import {
  PIECE_CATALOGUE, BRICK_SETS, FRAME_PRESETS, brickSetById, enabledPieces,
} from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { bandCourseBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/band-course.js';
import { inwardSignFor } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

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
  it('has the declared sets, ids 1..5 in order (T86 items 24/25 added Grey brick and Grey stone)', () => {
    expect(BRICK_SETS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('every declared sample image is on disk (data/bricks)', async () => {
    const { existsSync } = await import('node:fs');
    const missing = BRICK_SETS.flatMap((s) => s.samples.map((x) => x.image)).filter((img) => !existsSync(`bspline-frame-builder/b-spline-gen/html/${img}`));
    expect(missing).toEqual([]);
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
  it('declares exactly the 9 named presets, each (except the declared-empty "none") a non-empty band list with widthIn > 0', () => {
    // T86 item 1: butt_frame, quoin_corners, double_course and header_band join the 3 original
    // mitre-only presets -- the dispatch's own full 6 corner-style/pattern presets plus the original 3.
    // T86 item 2: mixed_bands (header/flemish/soldier) joins as the declared sequence-based preview combo.
    // F35 item 12 follow-up: 'none' joins as the Frame band preset's own OFF switch -- an empty band
    // list is its ENTIRE point (no frame bands at all), not a bug this test should flag.
    expect(Object.keys(FRAME_PRESETS).sort()).toEqual(['butt_frame', 'double_course', 'header_band', 'mixed_bands', 'none', 'quoin_corners', 'single_soldier', 'soldier_stretcher', 'three_band'].sort());
    expect(FRAME_PRESETS.none).toEqual([]);
    for (const [name, bands] of Object.entries(FRAME_PRESETS)) {
      if (name === 'none') continue;
      expect(bands.length).toBeGreaterThan(0);
      for (const b of bands) expect(b.widthIn).toBeGreaterThan(0);
    }
  });

  it('butt_frame/quoin_corners/double_course declare their own cornerStyle; every mitre-only preset (header_band included) stays silent', () => {
    expect(FRAME_PRESETS.butt_frame.every((b) => b.cornerStyle === 'butt')).toBe(true);
    expect(FRAME_PRESETS.quoin_corners.every((b) => b.cornerStyle === 'block')).toBe(true);
    expect(FRAME_PRESETS.double_course.every((b) => b.cornerStyle === 'lapped')).toBe(true);
    expect(FRAME_PRESETS.double_course.length).toBeGreaterThanOrEqual(2); // the minimum that shows the alternation at all
    for (const name of ['single_soldier', 'soldier_stretcher', 'three_band', 'header_band']) {
      expect(FRAME_PRESETS[name].every((b) => b.cornerStyle === undefined)).toBe(true);
    }
  });

  it('header_band uses the header pattern, routed through band-course.js not along-path.js', () => {
    expect(FRAME_PRESETS.header_band.every((b) => b.pattern === 'header')).toBe(true);
  });

  it('header_band actually builds through bandCourseBricks (F35 item 8) -- geometric correctness of the "header" pattern itself is tests/bricks-band-course.test.js\'s own territory, not re-derived here', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const inwardSign = inwardSignFor(pts);
    const line = (p0, p1) => {
      const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy);
      return { type: 'line', p0, p1, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign };
    };
    const primitives = [line(pts[0], pts[1]), line(pts[1], pts[2]), line(pts[2], pts[3]), line(pts[3], pts[0])];
    const { bricks } = bandCourseBricks(primitives, FRAME_PRESETS.header_band, BRICK_SETS[0], { seed: 1 });
    expect(bricks.length).toBeGreaterThan(0);
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
