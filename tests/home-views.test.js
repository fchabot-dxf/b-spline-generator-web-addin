/**
 * F35 item 51 (Fred, a screenshot of the view he wants): the 3D Home button CYCLES through the declared HOME_VIEWS --
 * iso (today's Home, the first press after load) -> face (the board face-on and upright, a slight yaw, filling the
 * view) -> iso ... -- and its tooltip names them. Pure: the declaration + the press sequence + the fit.
 */
import { describe, it, expect } from 'vitest';
import {
  HOME_VIEWS, nextHomeIndex, homeViewRadius, HOME_BUTTON_TITLE, FRUSTUM_SCALE, HOME_BOARD_FIT_MARGIN,
} from '../bspline-frame-builder/b-spline-gen/html/core/preview/orbit-controller.js';

describe('item 51: the Home views', () => {
  it('declares iso (today’s Home) then face', () => {
    expect(HOME_VIEWS.map((v) => v.id)).toEqual(['iso', 'face']);
    expect(HOME_VIEWS[0].euler).toEqual([0.955, 0, Math.PI / 4]);
    const [x, yaw, z] = HOME_VIEWS[1].euler;
    expect([x, z]).toEqual([0, 0]); // camera on +Z, Y up
    expect(yaw * 180 / Math.PI).toBeGreaterThanOrEqual(15);
    expect(yaw * 180 / Math.PI).toBeLessThanOrEqual(20);
  });
  it('each press goes to the next view: the first press = iso, then face, iso, face', () => {
    const seq = [];
    let i;
    for (let k = 0; k < 4; k++) { i = nextHomeIndex(i); seq.push(HOME_VIEWS[i].id); }
    expect(seq).toEqual(['iso', 'face', 'iso', 'face']);
  });
  it('face fills the view: the frustum holds the board with the declared margin, at any aspect', () => {
    const face = HOME_VIEWS[1];
    for (const [W, H, aspect] of [[7, 9, 1.6], [9, 12, 1.0], [12, 9, 0.6]]) {
      const half = homeViewRadius(face, W, H, aspect) * FRUSTUM_SCALE; // the frustum's half-height
      expect(Math.max(H / (2 * half), W / (2 * half * aspect))).toBeCloseTo(1 / HOME_BOARD_FIT_MARGIN, 6);
    }
  });
  it('iso keeps today’s fit exactly', () => {
    const W = 7, H = 9, a = 1.6;
    expect(homeViewRadius(HOME_VIEWS[0], W, H, a)).toBeCloseTo(Math.max(H / 0.8, W / (0.8 * a), Math.sqrt(W * W + H * H) * 1.5) * 1.25, 9);
  });
  it('the button tooltip names the views', () => expect(HOME_BUTTON_TITLE).toBe('Home view: iso / face'));
});
