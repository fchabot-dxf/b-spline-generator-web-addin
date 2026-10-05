/**
 * Item 33: the Frame element's CORNERS (mitre / butt / quoin / lapped) -- declared once (FRAME_CORNERS), applied to
 * every band the element lays (frameBandsOf), the preset's own corner by default; the old corner-variant presets
 * folded into Soldier + a corner, a saved board on one mapping to the SAME bands.
 */
import { describe, it, expect } from 'vitest';
import {
  FRAME_CORNERS, FOLDED_FRAME_PRESETS, frameCornerOf, frameBandsOf, frameCornerBricks, frameCornerIconSvg,
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

describe('item 33: the corner-variant presets fold into Soldier + a corner', () => {
  it('a saved board on a folded preset migrates to the SAME bands it laid before', () => {
    for (const [old, f] of Object.entries(FOLDED_FRAME_PRESETS)) {
      const p = { brickSettings: { frameBandPreset: old, frameBandPatterns: [], setIds: {}, groutByElement: {} } };
      runMigrations(p);
      expect(p.brickSettings, old).toMatchObject({ frameBandPreset: f.preset, frameCorner: f.corner });
      expect(frameBandsOf(p.brickSettings), old).toEqual(FRAME_PRESETS[old]);
    }
  });
  it('a board on any other preset is untouched', () => {
    const p = { brickSettings: { frameBandPreset: 'double_course', frameBandPatterns: [], setIds: {}, groutByElement: {} } };
    runMigrations(p);
    expect(p.brickSettings.frameBandPreset).toBe('double_course');
    expect(p.brickSettings.frameCorner).toBeUndefined();
  });
});
