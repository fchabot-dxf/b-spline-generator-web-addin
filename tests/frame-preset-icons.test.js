/**
 * Frame preset icons. Item 74c (Fred: "Frame band preset and corner icon are too similar") picked the whole frame; Fred
 * 2026-10-11 replaced it: EVERY frame preset's icon -- the chip, the sidebar grid, the editor grid -- is a simple L: one
 * corner with a short run of the band stack on both arms, nothing else (PRESET_ICON_STYLE 'cornerRun'). An arch preset's
 * L is its springer, cropped from the arch laid by the engine (PRESET_ICON_STYLES.arch).
 */
import { describe, it, expect } from 'vitest';
import {
  FRAME_CORNERS, framePresetIconSvg, framePresetTileSvg, frameCornerIconSvg, PRESET_ICON_STYLES, PRESET_ICON_STYLE,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const PRESETS = Object.keys(FRAME_PRESETS).filter((id) => FRAME_PRESETS[id].length);
const ARCHES = Object.keys(FRAME_PRESETS).filter((id) => !FRAME_PRESETS[id].length && FRAME_PRESETS[id].arch);
const viewBox = (svg) => svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
const polygons = (svg) => [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1].split(' ').map((q) => q.split(',').map(Number)));
const centroid = (pts) => pts.reduce(([x, y], [a, b]) => [x + a / pts.length, y + b / pts.length], [0, 0]);

describe('the preset icon style is declared: the L', () => {
  it('the pick names a declared style, and it is one corner + a run of the band (not the whole frame)', () => {
    expect(PRESET_ICON_STYLE).toBe('cornerRun');
    expect(PRESET_ICON_STYLES.cornerRun).toEqual({ whole: false, marginIn: expect.any(Number), clearIn: expect.any(Number) });
  });
});

describe('every FRAME_PRESET gets its L from the declared renderer', () => {
  it.each(PRESETS)('%s: one corner, the band stack running along both arms, nothing in the open square', (id) => {
    const depth = FRAME_PRESETS[id].reduce((a, b) => a + b.widthIn, 0);
    const svg = framePresetIconSvg(id, 30);
    const [x0, y0, w] = viewBox(svg);
    expect([x0, y0]).toEqual([0, 0]);
    expect(w).toBeCloseTo(depth + PRESET_ICON_STYLES.cornerRun.marginIn, 3);
    const polys = polygons(svg), c = polys.map(centroid);
    expect(c.length).toBeGreaterThan(0);
    // every piece TOUCHES an arm (a vertex within the stack depth of the top or the left edge): nothing of the far side or
    // floating in the open square -- a quoin block, bigger than its band, still sits on the corner
    for (const p of polys) expect(p.some(([x, y]) => Math.min(x, y) < depth + 0.05), id).toBe(true);
    // both arms carry bricks past the corner
    expect(c.some(([x, y]) => y < depth && x > depth), `${id} top arm`).toBe(true);
    expect(c.some(([x, y]) => x < depth && y > depth), `${id} left arm`).toBe(true);
  });
  it.each(ARCHES)('%s (an arch): its L is the springer -- a window on the arch\'s left springer', (id) => {
    const svg = framePresetIconSvg(id, 30);
    const [, , w] = viewBox(svg);
    expect(w).toBe(PRESET_ICON_STYLES.arch.windowIn);
    expect(polygons(svg).length).toBeGreaterThan(3);
  });
  it('the tile IS the icon, drawn bigger (one drawing at every size)', () => {
    for (const id of [...PRESETS, ...ARCHES]) {
      expect(framePresetTileSvg(id, 72)).toBe(framePresetIconSvg(id, 72));
      expect(viewBox(framePresetIconSvg(id, 72))).toEqual(viewBox(framePresetIconSvg(id, 30)));
    }
  });
  it('None stays the struck-through tile', () => {
    expect(framePresetIconSvg('none', 30)).toMatch(/<line /);
  });
});

describe('no preset icon is shared with the corner set', () => {
  it('every preset icon differs from every corner icon', () => {
    const corners = new Set(FRAME_CORNERS.map((c) => frameCornerIconSvg(c.id, 30)));
    for (const id of PRESETS) expect(corners.has(framePresetIconSvg(id, 30)), id).toBe(false);
  });
  it('the corner icons are still the corner close-up (unchanged by the preset style)', () => {
    for (const c of FRAME_CORNERS) expect(viewBox(frameCornerIconSvg(c.id, 30))[2], c.id).toBeCloseTo(1.5 + 0.4, 3);
  });
});
