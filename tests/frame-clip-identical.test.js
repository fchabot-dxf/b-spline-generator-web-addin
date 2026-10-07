/**
 * 2026-10-07 (seat A): _trianglePolygonPieces skips outline segments whose bounding box misses the triangle's (the
 * frame-3d-sweep's slowest step was clipping the WHOLE outline against every crossed triangle). The skip must not
 * change a single byte: MEASURED over all 747 frame-3d-sweep applies (19 templates x 5 boards x 3 frame bottoms x 3
 * sculpts), every returned mesh + the panel's re-index hashed identical before / after, apply CPU 49.8 -> 39.5 ms.
 * This file pins a subset (every template at 7x9) to the digests of the code BEFORE the skip.
 * A deliberate geometry change re-pins them: PIN=1 npx vitest run tests/frame-clip-identical.test.js
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameSolidSpec } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { applyFrameToPanel } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { FakeTHREE, carvedPanel } from './helpers/drawn-panel.js';

const PINNED = 'tests/fixtures/frame-clip-digests.json';
const BOARDS = [[7, 9]];
const waves = (x, y) => 0.4 + 0.3 * Math.sin(1.7 * x) * Math.cos(1.3 * y) + 0.6; // frame-3d-sweep's 'waves' panel

function digests() {
  const out = {};
  for (const [W, H] of BOARDS) {
    const { mesh, grid } = carvedPanel(W, H, Math.round(W / 0.1) + 1, Math.round(H / 0.1) + 1, waves, 0.6);
    for (const t of FRAME_DEFS.templates) {
      const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: t.id, frameBottomZ: -1 }), { widthIn: W, heightIn: H });
      if (!spec || !spec.innerPrimitives) continue;
      const h = createHash('sha1');
      for (const m of applyFrameToPanel(FakeTHREE, mesh, grid, spec)) {
        h.update(m.name || '?');
        const g = m.geometry;
        for (const k of Object.keys(g.attributes).sort()) h.update(k).update(Buffer.from(g.attributes[k].array.buffer));
        if (g.index) h.update(JSON.stringify(g.index.array));
      }
      h.update(JSON.stringify(mesh.geometry.index ? mesh.geometry.index.array : null)); // the panel's own re-index
      out[`${t.id} ${W}x${H}`] = h.digest('hex');
    }
  }
  return out;
}

describe('the frame clip is byte-identical to the pinned (pre-skip) output', () => {
  it('every template, 7x9, frame bottom -1, the waves panel', () => {
    const got = digests();
    if (process.env.PIN === '1') writeFileSync(PINNED, JSON.stringify(got, null, 1) + '\n');
    const want = JSON.parse(readFileSync(PINNED, 'utf8'));
    expect(Object.keys(got).length).toBeGreaterThan(15);
    expect(got).toEqual(want);
  });
});
