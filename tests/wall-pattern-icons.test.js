/**
 * F35 item 13 (advisor: engine-drawn icon grids, the long-list rule): every wall pattern's picker icon is LAID
 * by the real engine (editor-brick-tool.js wallPatternIconSvg), and the Wall pattern picker is an icon grid
 * grouped into families, icons only with the name as tooltip.
 */
import { describe, it, expect } from 'vitest';
import { BRICK_PATTERNS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { wallPatternIconSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const ids = Object.keys(BRICK_PATTERNS);

describe('wallPatternIconSvg', () => {
  it('every BRICK_PATTERNS key gets an icon laid by the engine (bricks as polygons; none = an empty board)', () => {
    for (const id of ids) {
      const svg = wallPatternIconSvg(id);
      expect(svg, id).toMatch(/^<svg[^>]*viewBox="0 0 1.8 1.2"/);
      if (id === 'none') expect(svg).not.toContain('<polygon');
      else expect((svg.match(/<polygon/g) || []).length, id).toBeGreaterThan(3);
    }
  });
  it('different layouts draw different icons', () => {
    const icons = new Set(ids.map((id) => wallPatternIconSvg(id)));
    expect(icons.size).toBe(ids.length);
  });
});
