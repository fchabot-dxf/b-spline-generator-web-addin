/**
 * F35 item 31 step 1 (the custom raised-pattern maker, mockup for Fred): the declared groundwork only -- a `tile`
 * motif (cell = course mod rows, brick mod cols), tileOf() measuring the tile a preset repeats with (the periodic
 * presets become the same tile data a user tile is), and an ad-hoc preset object accepted where a preset id was.
 * No UI is wired until Fred OKs the mockup.
 */
import { describe, it, expect } from 'vitest';
import { ACCENT_MOTIFS, ACCENT_PRESETS, tileOf, accentedBrickIndices } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-accents.js';
import { accentIconSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

// a running-bond wall: 12 courses x 16 bricks, odd courses shifted half a brick (y grows downward)
function runningBond(courses = 12, bricks = 16, w = 1, h = 0.4) {
  const out = [];
  for (let c = 0; c < courses; c++) {
    const y = (courses - 1 - c) * h, shift = (c % 2) * w / 2;
    for (let i = 0; i < bricks; i++) {
      const x = shift + i * w;
      out.push({ polygon: [{ x, y }, { x: x + w * 0.95, y }, { x: x + w * 0.95, y: y + h * 0.9 }, { x, y: y + h * 0.9 }] });
    }
  }
  return out;
}

describe('item 31: the tile motif + presets as tiles', () => {
  it('tile: cell = (course mod rows, brick mod cols), row 0 = the bottom course', () => {
    const p = { rows: 2, cols: 3, cells: [[true, false, false], [false, false, true]] };
    expect(ACCENT_MOTIFS.tile(0, 0, p)).toBe(true);
    expect(ACCENT_MOTIFS.tile(2, 3, p)).toBe(true); // repeats
    expect(ACCENT_MOTIFS.tile(1, 2, p)).toBe(true);
    expect(ACCENT_MOTIFS.tile(1, 0, p)).toBe(false);
    expect(ACCENT_MOTIFS.tile(-1, -1, p)).toBe(true); // mod is the positive one
  });

  it('tileOf: the periodic presets have a tile (smallest that reproduces them); pyramid + random have none', () => {
    const tiles = Object.fromEntries(ACCENT_PRESETS.map((p) => [p.id, tileOf(p)]));
    expect(tiles.checker).toEqual({ rows: 2, cols: 2, cells: [[true, false], [false, true]] });
    expect([tiles.staircase.rows, tiles.staircase.cols]).toEqual([6, 6]);
    expect([tiles.courseBand.rows, tiles.courseBand.cols]).toEqual([4, 1]);
    expect(tiles.pyramid).toBeNull();
    expect(tiles.random).toBeNull();
  });

  it('a preset and ITS TILE raise exactly the same bricks on a real running-bond wall (same data, two forms)', () => {
    const wall = runningBond();
    for (const p of ACCENT_PRESETS) {
      const t = tileOf(p);
      if (!t) continue;
      const asTile = { ...p, motif: 'tile', params: t };
      const a = [...accentedBrickIndices(wall, { preset: p.id }, { seed: 1 })].sort((x, y) => x - y);
      const b = [...accentedBrickIndices(wall, { preset: asTile }, { seed: 1 })].sort((x, y) => x - y);
      expect(b, p.id).toEqual(a);
      expect(a.length, p.id).toBeGreaterThan(0);
    }
  });

  it('an ad-hoc preset object (a user tile, before saving) is accepted by the rule and drawn as an engine icon', () => {
    const tile = { id: 'user:x', label: 'x', motif: 'tile', params: { rows: 2, cols: 2, cells: [[true, false], [false, false]] }, zone: [0, 1] };
    expect(accentedBrickIndices(runningBond(), { preset: tile }, {}).size).toBeGreaterThan(0);
    const svg = accentIconSvg(tile, 30);
    expect(svg).toMatch(/^<svg/);
    expect(svg).not.toBe(accentIconSvg('checker', 30));
  });
});
