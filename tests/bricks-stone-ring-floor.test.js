// A stone ring keeps its stones where the board clip and the medial-line yield trim them (seat E, 2026-10-08). Both
// steps (contour-bands.js clipPiecesToBoard / yieldAtMedialLine) dropped every piece under a QUARTER BRICK; a stone
// ring's "brick" is the stone spacing, so at 3 in that was 2.25 sq in and whole sections of the ring went. MEASURED on
// every template 7x9, White rocks + Grey stone, 0.75 / 1 / 1.25 / 2 / 3 in: 32 of 190 lays laid more stone with the
// ring's own floor (+76.6 sq in in all, none lost), worst T5 White rocks at 3 in, 13 -> 17 stones, +7.1 sq in.
// NOT this floor: T11 at 3 in still leaves ~0.9 sq in bare -- the band is narrowed to 0.75 in (item 28 fit) and the
// fieldstone ring layout seeds no stone on one diagonal; nothing is dropped there (traced: yield 0, clip 0).
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const sd = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };
const near = (p, Q, d) => pointInPolygon(p.x, p.y, Q) || Q.some((a, i) => sd(p, a, Q[(i + 1) % Q.length]) <= d);
const ringOf = (prims) => prims.flatMap((p) => (p.type === 'line' ? [p.p0] : Array.from({ length: 24 }, (_, k) => { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / 24; return { x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }; })));
// the corner wedges a 3 in stone ring leaves by design (measured 0 - 0.33 sq in on these four); the quarter-brick floor
// opened 3.9 - 8.3 sq in on them (whole stones of 1.5 - 2.3 sq in each)
const BARE_MAX_SQIN = 0.5;

describe('a stone ring keeps its stones under the band clip / yield (the ring\'s own floor, piece-floor.js)', () => {
  it.each([['template_5', 3], ['template_19', 5], ['template_10', 3], ['template_18', 5]])('%s, set %i, at 3 in: no ring stretch bare, no overlap', (tpl, id) => {
    const set = BRICK_SETS.find((s) => s.id === id), L = 3;
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: 7, heightIn: 9 } }, 0, 0);
    const prims = buildRibbonPrimitives(sil.primitives), board = ringOf(prims);
    const r = bricksContourBands(prims, FRAME_PRESETS.single_soldier, { set, seed: 1, scale: L / set.brickLengthIn });
    const J = scaledSet(set, L / set.brickLengthIn).grout.widthIn, polys = r.bricks.map((b) => b.polygon);
    // bare: board inside the ring (outside the wall's inner path) farther than a joint from every stone
    let bare = 0; const h = 0.05;
    for (let x = 0; x < 7; x += h) for (let y = 0; y < 9; y += h) {
      const p = { x, y };
      if (!pointInPolygon(x, y, board) || (r.innerPath.length > 2 && pointInPolygon(x, y, r.innerPath))) continue;
      if (!polys.some((Q) => near(p, Q, J))) bare += h * h;
    }
    expect(bare).toBeLessThanOrEqual(BARE_MAX_SQIN);
    const over = [];
    for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) { const a = Math.abs(signedArea(polygonIntersection(polys[i], polys[j])) || 0); if (a > 1e-4) over.push(a); }
    expect(over).toEqual([]);
  });
});
