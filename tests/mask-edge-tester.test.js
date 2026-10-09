/**
 * 2026-10-08 (seat A; the phone map, loaded board): maskEdgeSource tested every grid point against every edge of the
 * panel's trim outline with pointInPolygon -- 2.2 s of a 0.03 in spacing change, ~0.9 s of a board-size nudge. It now uses
 * polygonPointTester (pointInPolygon's own answer, edges bucketed by y; tests/polygon-point-tester.test.js). Here the
 * whole maskEdgeSource output is compared with the old per-point pointInPolygon (switched in through the mock below) on
 * the real frame templates' trim loops and random star polygons.
 */
import { describe, it, expect, vi } from 'vitest';

const sw = vi.hoisted(() => ({ old: false }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, polygonPointTester: (poly) => (sw.old ? (x, y) => actual.pointInPolygon(x, y, poly) : actual.polygonPointTester(poly)) };
});

import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameSolidSpec } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameLoopsWorld } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { maskEdgeSource } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/mask-edge.js';

const same = (outline, nx, nz, W, H) => {
  sw.old = true; const a = maskEdgeSource(outline, nx, nz, W, H);
  sw.old = false; const b = maskEdgeSource(outline, nx, nz, W, H);
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
};

describe('maskEdgeSource with polygonPointTester: the same sources as per-point pointInPolygon', () => {
  it('every frame template trim loop, 2 boards, 2 grid spacings', () => {
    let n = 0;
    for (const [W, H] of [[7, 9], [9, 12]]) for (const sp of [0.1, 0.05]) {
      const nx = Math.round(W / sp) + 1, nz = Math.round(H / sp) + 1;
      for (const t of FRAME_DEFS.templates) {
        const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: t.id }), { widthIn: W, heightIn: H });
        if (!spec || !spec.outerPrimitives) continue;
        const loop = frameLoopsWorld(spec, { W, H, nx, nz }).panel;
        const outline = loop.map((p) => ({ x: p.x + W / 2, y: H / 2 - p.y }));
        expect(same(outline, nx, nz, W, H), `${t.id} ${W}x${H} @${sp}`).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(60);
  }, 120000);

  it('random star polygons (many vertices, concave)', () => {
    let seed = 9;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let k = 0; k < 20; k++) {
      const m = 20 + Math.floor(rnd() * 300), outline = [];
      for (let i = 0; i < m; i++) { const a = (i / m) * Math.PI * 2, r = 2 + rnd() * 2.5; outline.push({ x: 4.5 + r * Math.cos(a), y: 6 + r * Math.sin(a) }); }
      expect(same(outline, 91, 121, 9, 12), `star ${k}`).toBe(true);
    }
  });
});
