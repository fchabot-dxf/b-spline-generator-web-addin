/**
 * Item 33: the Frame element's CORNERS (mitre / butt / quoin / lapped) -- declared once (FRAME_CORNERS), applied to
 * every band the element lays (frameBandsOf), the preset's own corner by default; the old corner-variant presets
 * folded into Soldier + a corner, a saved board on one mapping to the SAME bands.
 */
import { describe, it, expect } from 'vitest';
import {
  FRAME_CORNERS, frameCornerOf, frameBandsOf, frameCornerBricks, frameCornerIconSvg, framePresetIconSvg,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

describe('item 33: the corner styles', () => {
  it('declares the engine’s four cornerStyle values, each with a name and a tooltip', () => {
    expect(FRAME_CORNERS.map((c) => c.id)).toEqual(['mitre', 'butt', 'block', 'lapped']);
    for (const c of FRAME_CORNERS) expect(c.label && c.title, c.id).toBeTruthy();
  });
  it('the default is the preset’s own corner (mitred for plain Soldier, lapped for Soldier x2); a pick overrides', () => {
    expect(frameCornerOf({ frameBandPreset: 'single_soldier' })).toBe('mitre');
    expect(frameCornerOf({ frameBandPreset: 'double_course' })).toBe('lapped');
    expect(frameCornerOf({ frameBandPreset: 'single_soldier', frameCorner: 'block' })).toBe('block');
    expect(frameCornerOf({ frameBandPreset: 'single_soldier', frameCorner: 'bogus' })).toBe('mitre');
  });
  it('the pick reaches EVERY band the element lays; no pick = the preset’s bands as declared', () => {
    expect(frameBandsOf({ frameBandPreset: 'three_band', frameCorner: 'butt' }).map((b) => b.cornerStyle)).toEqual(['butt', 'butt', 'butt']);
    expect(frameBandsOf({ frameBandPreset: 'three_band' })).toEqual(FRAME_PRESETS.three_band);
    expect(frameBandsOf({ frameBandPreset: 'soldier_stretcher', frameBandPatterns: ['header'], frameCorner: 'lapped' })[0])
      .toMatchObject({ pattern: 'header', cornerStyle: 'lapped' });
  });
  it('each corner icon is laid by the engine, and the four differ', () => {
    const icons = FRAME_CORNERS.map((c) => frameCornerIconSvg(c.id, 26));
    for (const [i, svg] of icons.entries()) expect(svg, FRAME_CORNERS[i].id).toMatch(/<polygon /);
    expect(new Set(icons).size).toBe(4);
    for (const c of FRAME_CORNERS) expect(frameCornerBricks(c.id).length, c.id).toBeGreaterThan(0);
  });
});

describe('item 33 (audit N10): the band-preset icons', () => {
  it('every listed preset has an engine-drawn icon of its band stack, all different; None is a struck tile', () => {
    const listed = Object.keys(FRAME_PRESETS).filter((id) => id !== 'none'); // every preset is listed (2026-10-11: no folded variants)
    const icons = listed.map((id) => framePresetIconSvg(id, 26));
    for (const [i, svg] of icons.entries()) expect(svg, listed[i]).toMatch(/<polygon /);
    expect(new Set(icons).size).toBe(listed.length);
    expect(framePresetIconSvg('none', 26)).toMatch(/<line /);
  });
});

// Fred 2026-10-11: a preset bundles its corner -- item 33's fold (butt_frame / quoin_corners -> Soldier + a Corners-row
// pick) and its migration ('frame-corner-presets') are retired: such a board stays on its preset and lays from its own bands
describe('the corner-variant presets are presets again (no fold, no migration)', () => {
  it('a board saved on butt_frame / quoin_corners keeps its preset and lays its own bands', () => {
    for (const old of ['butt_frame', 'quoin_corners']) {
      const p = { brickSettings: { frameBandPreset: old, frameBandPatterns: [], setIds: {}, groutByElement: {} } };
      runMigrations(p);
      expect(p.brickSettings.frameBandPreset, old).toBe(old);
      expect(p.brickSettings.frameCorner, old).toBeUndefined();
      expect(frameBandsOf(p.brickSettings), old).toEqual(FRAME_PRESETS[old]);
    }
  });
});
