/**
 * F12 SHAPE-PARAMS: old patterns keep their EXACT shape. The fixture was
 * recorded from the generator BEFORE the new params existed (128 cases: both
 * presets, jitter-only / each old param pinned / random explicit params, 4
 * boards, 3 strokes, and the frames' own fitted-model inputs). The new solver
 * must reproduce every primitive to 1e-9: an old `cornerRadius` becomes both
 * corners, an absent `waistRadius` / `bodyRadius` is today's derived rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';

const FIXTURE = JSON.parse(readFileSync('tests/fixtures/shape-lattice-migration.json', 'utf-8'));
// An arc's start angle is compared modulo a full turn: atan2's +-pi branch cut
// can flip it by exactly 2pi on a last-bit difference, the SAME arc. Its sweep
// (dTheta) and every coordinate must match as they are.
const flat = (prims) => prims.flatMap((p) => (p.type === 'L'
  ? ['L', p.p0.x, p.p0.y, p.p1.x, p.p1.y]
  : ['A', p.cx, p.cy, p.rx, p.ry, p.phi, { angle: p.theta1 }, p.dTheta]));
const TAU = 2 * Math.PI;
const angleDiff = (a, b) => Math.abs(((a - b) % TAU + TAU + Math.PI) % TAU - Math.PI);

describe('old patterns keep their exact shape (recorded before SHAPE-PARAMS)', () => {
  it('has the recorded cases', () => expect(FIXTURE.cases.length).toBe(128));
  it.each(FIXTURE.cases.map((c, i) => [i, c.preset, c]))('case %i (%s)', (_i, _preset, c) => {
    const now = flat(generateSilhouette(c.region, c.shape, c.stroke / 2).primitives);
    const then = flat(c.primitives);
    expect(now.length).toBe(then.length);
    for (let k = 0; k < now.length; k++) {
      if (typeof then[k] === 'string') expect(now[k]).toBe(then[k]);
      else if (typeof then[k] === 'object') expect(angleDiff(now[k].angle, then[k].angle), `angle ${k}`).toBeLessThan(1e-9);
      else expect(Math.abs(now[k] - then[k]), `value ${k}`).toBeLessThan(1e-9);
    }
  });
});
