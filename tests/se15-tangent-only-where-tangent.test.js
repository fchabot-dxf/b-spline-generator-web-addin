/**
 * H23 item 94: every Send of a 7x9 T16 (Arched Funnel) board with a CUT frame-offset lattice contour logged 5
 * '[ERROR] CONSTRAINT FAIL ... VCS_SKETCH_SOLVING_FAILED' lines, and the parametric lattice sketches came out wrong
 * (seat A, rebuilt live from the Send's own manifests, 2026-10-06: contour ends up to 208 in off, an arc's radius
 * doubled; rails/ties/nodes off by up to 6.9 in). Cause: the manifest declared Tangent at the contour's MITER
 * corners (turns of 74 / 94 / 43 deg) -- a cut contour drops the frame contour's `corners` list, and every
 * arc-adjacent joint then got a Tangent the drawn geometry does not have; on the loose chain Fusion bends the shape
 * to satisfy it. A Tangent is now declared only where the joint IS tangent (the same isTangentJoint test
 * outlineDefects validates silhouettes with), and never between two pieces of the same circle (a cut arc).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { isTangentJoint } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { PATTERN_DEFAULTS, CONTOUR_HIT_TOL_IN } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { buildSketchManifest } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { boardRegion } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { splitContourPrimitive } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-contour-cut.js';

const W = 7, H = 9, DIST = 0.25;
const frame = { defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_16' }), board: { widthIn: W, heightIn: H } };
const pattern = () => {
    const p = { ...JSON.parse(JSON.stringify(PATTERN_DEFAULTS)), extent: { mode: 'boundary' },
        contour: { ...PATTERN_DEFAULTS.contour, fromFrame: { on: true, distance: DIST } } };
    p.shape.source = 'generated';
    return p;
};
const region = boardRegion({ _mW: W, _mH: H });

/** the sil with its first ARC cut into two at mid-sweep (the editor's own cut) */
function cutContour() {
    const sil = frameContourSilhouette(frame, DIST, PATTERN_DEFAULTS.widths.rails);
    const index = sil.primitives.findIndex((q) => q.type === 'A');
    const prim = sil.primitives[index];
    const th = prim.theta1 + prim.dTheta / 2;
    const [a, b] = splitContourPrimitive(prim, { x: prim.cx + prim.rx * Math.cos(th), y: prim.cy + prim.ry * Math.sin(th) });
    return { sil, index, drawn: [...sil.primitives.slice(0, index), a, b, ...sil.primitives.slice(index + 1)] };
}

const segTangents = (m) => m.constraints.filter((c) => c.type === 'Tangent' && c.targets.every((t) => /^seg\d+$/.test(t)))
    .map((c) => c.targets.map((t) => Number(t.slice(3))));

describe('SE15 contour: Tangent only where the drawn joint is tangent (H23 item 94)', () => {
    it('fixture is non-vacuous: the T16 contour has miter corners (non-tangent arc joints) and the cut adds a piece', () => {
        const { sil, drawn } = cutContour();
        expect(drawn.length).toBe(sil.primitives.length + 1);
        const n = drawn.length;
        const cornerArcJoints = drawn.map((p, i) => [p, drawn[(i + 1) % n]])
            .filter(([p, q]) => (p.type === 'A' || q.type === 'A') && !isTangentJoint(p, q));
        expect(cornerArcJoints.length).toBeGreaterThan(0);
    });

    it('a CUT T16 contour declares no Tangent at a non-tangent joint', () => {
        const { drawn } = cutContour();
        const m = buildSketchManifest(pattern(), region, { frame, drawnContour: drawn });
        const n = drawn.length;
        for (const [i, j] of segTangents(m)) {
            expect(j).toBe((i + 1) % n);
            expect(isTangentJoint(drawn[i], drawn[j]), `Tangent seg${i}/seg${j}`).toBe(true);
        }
    });

    it('the cut joint (two pieces of ONE circle) gets no Tangent -- Coincident only (measured exact)', () => {
        // live, the board's own manifests: with the 4 co-circular Tangents the loop failed the one next to a miter
        // corner ('failed to create offset: VCS_SKETCH_SOLVING_FAILED') and a later arc's radius doubled (5.98 ->
        // 11.45 in); with Coincident only every layer built exact. Isolated pairs/chains build fine either way.
        const { index, drawn } = cutContour();
        const m = buildSketchManifest(pattern(), region, { frame, drawnContour: drawn });
        expect(m.constraints.some((c) => c.type === 'Coincident' && c.targets[0] === `seg${index}:E` && c.targets[1] === `seg${index + 1}:S`)).toBe(true);
        expect(segTangents(m).some(([i, j]) => i === index && j === index + 1)).toBe(false);
    });

    it('an UNCUT frame contour declares the same Tangents as before (its corners were already excluded)', () => {
        const sil = frameContourSilhouette(frame, DIST, PATTERN_DEFAULTS.widths.rails);
        const m = buildSketchManifest(pattern(), region, { frame });
        const n = sil.primitives.length;
        const expected = sil.primitives.map((p, i) => i)
            .filter((i) => (sil.primitives[i].type === 'A' || sil.primitives[(i + 1) % n].type === 'A') && !sil.corners.includes(i));
        expect(segTangents(m).map(([i]) => i).sort((a, b) => a - b)).toEqual(expected);
    });
});

/** distance from `pt` to a manifest contour piece (Slot/Line: segment; Arc3Point*: its own arc span, sweep-aware --
 *  the pieces of a cut arc share ONE circle, so a radius-only test would accept the wrong piece) */
function distToPiece(pt, e) {
    const [x, y] = pt;
    if (e.type === 'Slot' || e.type === 'Line') {
        const [x1, y1] = e.p1, [x2, y2] = e.p2, dx = x2 - x1, dy = y2 - y1;
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
    }
    const [ax, ay] = e.p1, [bx, by] = e.pMid, [cx, cy] = e.p2;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r = Math.hypot(ax - ux, ay - uy);
    const side = (px, py) => Math.sign((cx - ax) * (py - ay) - (cy - ay) * (px - ax));
    const atEnd = Math.min(Math.hypot(x - ax, y - ay), Math.hypot(x - cx, y - cy));
    const onSpan = side(x, y) === side(bx, by) || atEnd < 1e-9;
    return onSpan ? Math.abs(Math.hypot(x - ux, y - uy) - r) : atEnd;
}

describe('SE15 cut contour: a rail/tie end coincides with the contour piece it is ON (H23 item 94)', () => {
    it('every piece-end -> contour Coincident names the drawn piece the end lies on', () => {
        const { drawn } = cutContour();
        const m = buildSketchManifest(pattern(), region, { frame, drawnContour: drawn });
        const byId = new Map(m.entities.map((e) => [e.id, e]));
        const ends = m.constraints.filter((c) => c.type === 'Coincident'
            && c.targets.some((t) => /^seg\d+/.test(t)) && c.targets.some((t) => /^(rail|tie)\d+:[SE]$/.test(t)));
        expect(ends.length).toBeGreaterThan(0); // non-vacuous: the fill ends on the contour
        for (const c of ends) {
            const [pid, suf] = c.targets.find((t) => /^(rail|tie)/.test(t)).split(':');
            const seg = c.targets.find((t) => /^seg/.test(t)).split(':')[0];
            const piece = byId.get(pid);
            const pt = suf === 'S' ? piece.p1 : piece.p2;
            expect(distToPiece(pt, byId.get(seg)), `${pid}:${suf} -> ${seg}`).toBeLessThan(CONTOUR_HIT_TOL_IN);
        }
        // and none is lost: the cut changes WHICH piece an end names, never whether it has one
        const uncut = buildSketchManifest(pattern(), region, { frame });
        const uncutEnds = uncut.constraints.filter((c) => c.type === 'Coincident'
            && c.targets.some((t) => /^seg\d+/.test(t)) && c.targets.some((t) => /^(rail|tie)\d+:[SE]$/.test(t)));
        expect(ends.length).toBe(uncutEnds.length);
    });

    it('an UNCUT contour keeps its manifest byte-identical (the re-resolve runs only for a cut)', () => {
        const sil = frameContourSilhouette(frame, DIST, PATTERN_DEFAULTS.widths.rails);
        const plain = buildSketchManifest(pattern(), region, { frame });
        const same = buildSketchManifest(pattern(), region, { frame, drawnContour: sil.primitives });
        expect(JSON.stringify(same)).toBe(JSON.stringify(plain));
    });
});
