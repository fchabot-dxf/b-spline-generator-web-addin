/**
 * T86 item 23 (Fred: the Weathered style's Wear amount wears rocks too -- worn edges + pits): stone sets declare
 * heightProfile.wearWholeFace (height-profile.js), so the edge wear reaches a stone's whole face, not just its small
 * shape share (the Weathered style makes a stone face mostly photo detail). The pits already scale with Wear through
 * the photo detail (brick-surface-styles.js pitGain), stones included. Through the app's own styling (styledSet +
 * styleAtWear) and the engine's brickTopHeight, with a fixed detail stub: Wear 0 = exactly today's stones; Wear 1 wears a
 * stone's edge about as much as a brick's; bricks are untouched.
 */
import { describe, it, expect } from 'vitest';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { brickTopHeight } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/height-profile.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { surfaceStyleById, styledSet, styleAtWear } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-surface-styles.js';

const board = [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }];
const DETAIL = () => 0.4; // a fixed photo-detail value: the face is a raised share above its shoulder
const without = (set) => ({ ...set, heightProfile: { ...set.heightProfile, wearWholeFace: undefined } });

/** heights over one mid-board brick, styled Weathered at `wear` */
function heights(set, wear) {
  const b = generateBricks({ boardOutline: board, set, seed: 3, scale: 1, suppression: 0, clumping: 0 }).bricks;
  const brick = b[Math.floor(b.length / 2)];
  const styled = styledSet(set, styleAtWear(surfaceStyleById('weathered'), wear));
  const xs = brick.polygon.map((p) => p.x), ys = brick.polygon.map((p) => p.y);
  const out = [];
  for (let i = 0; i <= 50; i++) for (let j = 0; j <= 50; j++) {
    const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * i / 50, y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * j / 50;
    if (pointInPolygon(x, y, brick.polygon)) out.push(brickTopHeight(x, y, brick, styled, 3, DETAIL));
  }
  return out;
}
const maxDiff = (a, b) => a.reduce((m, v, k) => Math.max(m, Math.abs(v - b[k])), 0);

describe('wear on rocks (T86 item 23)', () => {
  for (const id of [3, 5]) {
    const set = brickSetById(id);
    it(`${set.name} declares wearWholeFace`, () => expect(set.heightProfile.wearWholeFace).toBe(true));
    it(`${set.name}: Wear 0 = today's stones exactly`, () => {
      expect(heights(set, 0)).toEqual(heights(without(set), 0));
    });
    it(`${set.name}: Wear 1 wears the stone's edge about as much as a brick's`, () => {
      const stone = maxDiff(heights(set, 0), heights(set, 1));
      const before = maxDiff(heights(without(set), 0), heights(without(set), 1));
      const brick = maxDiff(heights(brickSetById(1), 0), heights(brickSetById(1), 1));
      expect(stone).toBeGreaterThan(2 * before); // the face now wears, not just the shape share
      expect(stone).toBeGreaterThan(0.5 * brick);
    });
  }
  it('bricks are untouched (no wearWholeFace on a brick set)', () => {
    const red = brickSetById(1);
    expect(red.heightProfile.wearWholeFace).toBeUndefined();
    expect(heights(red, 1)).toEqual(heights(without(red), 1));
  });
});
