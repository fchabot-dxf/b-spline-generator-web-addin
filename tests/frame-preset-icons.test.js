/**
 * Item 74c (Fred: "Frame band preset and corner icon are too similar" -- both rows drew a red corner close-up; he picked
 * the whole frame): a band PRESET's icon is drawn in the declared PRESET_ICON_STYLE ('ring': the preset's bands laid by
 * the engine round a small square board, drawn whole); the Corners row keeps its corner close-ups.
 */
import { describe, it, expect } from 'vitest';
import {
  FRAME_CORNERS, framePresetIconSvg, frameCornerIconSvg, PRESET_ICON_STYLES, PRESET_ICON_STYLE,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const PRESETS = Object.keys(FRAME_PRESETS).filter((id) => FRAME_PRESETS[id].length);
const side = (svg) => Number(svg.match(/viewBox="0 0 ([\d.]+) /)[1]);
const polygons = (svg) => [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1].split(' ').map((q) => q.split(',').map(Number)));
const centroid = (pts) => pts.reduce(([x, y], [a, b]) => [x + a / pts.length, y + b / pts.length], [0, 0]);

describe('item 74c: the preset icon style is declared', () => {
  it('the pick names a declared style, and it is the whole frame', () => {
    expect(Object.keys(PRESET_ICON_STYLES)).toContain(PRESET_ICON_STYLE);
    expect(PRESET_ICON_STYLES[PRESET_ICON_STYLE].whole).toBe(true);
  });
});

describe('item 74c: every FRAME_PRESET gets its icon from the declared renderer', () => {
  it.each(PRESETS)('%s: the whole frame -- the declared ring board, bricks on all four sides', (id) => {
    const style = PRESET_ICON_STYLES[PRESET_ICON_STYLE];
    const depth = FRAME_PRESETS[id].reduce((a, b) => a + b.widthIn, 0);
    const svg = framePresetIconSvg(id, 30);
    expect(side(svg)).toBeCloseTo(2 * depth + Math.max(style.innerMinIn, depth * style.innerShare), 3);
    const w = side(svg), c = polygons(svg).map(centroid);
    const sides = { top: c.filter(([, y]) => y < w / 3).length, bottom: c.filter(([, y]) => y > (2 * w) / 3).length,
      left: c.filter(([x]) => x < w / 3).length, right: c.filter(([x]) => x > (2 * w) / 3).length };
    for (const [k, n] of Object.entries(sides)) expect(n, `${id} ${k}`).toBeGreaterThan(0);
  });
  it('None stays the struck-through tile', () => {
    expect(framePresetIconSvg('none', 30)).toMatch(/<line /);
  });
});

describe('item 74c: no preset icon is shared with the corner set', () => {
  it('every preset icon differs from every Corners-row icon (double_course drew the Lapped corner exactly before)', () => {
    const corners = new Set(FRAME_CORNERS.map((c) => frameCornerIconSvg(c.id, 30)));
    for (const id of PRESETS) expect(corners.has(framePresetIconSvg(id, 30)), id).toBe(false);
  });
  it('the corner icons are still the corner close-up (unchanged by the preset style)', () => {
    for (const c of FRAME_CORNERS) expect(side(frameCornerIconSvg(c.id, 30)), c.id).toBeCloseTo(1.5 + 0.4, 3);
  });
});
