/**
 * UX refine (Fred, 2026-10-10): the 3D view's 10-15 overlapping "thin 0.09"" tags become ONE corner badge
 * ("N thin spots"); a tap steps through them one at a time (core/preview/leader-lines.js THIN_SPOT_BADGE).
 * The detector (build-thicken-data.js) is unchanged -- the badge counts exactly the list it is handed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LeaderLineOverlay, THIN_SPOT_BADGE, thinBadgeText, stepThinIndex } from '../bspline-frame-builder/b-spline-gen/html/core/preview/leader-lines.js';
import { buildThickenData } from '../bspline-frame-builder/b-spline-gen/html/core/engine/build-thicken-data.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { generateHeightmap, resolveGrid } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';

// a projection stand-in: world (x, y) inches -> NDC, never behind the camera
class Vector3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } project() { this.x /= 10; this.y /= 10; this.z = 0; return this; } }
const camera = {}, canvas = { clientWidth: 600, clientHeight: 400 };

let parent, overlay;
beforeEach(() => {
  window.THREE = { Vector3 };
  parent = document.createElement('div');
  document.body.appendChild(parent);
  overlay = new LeaderLineOverlay(parent);
});
afterEach(() => { overlay.close(); parent.remove(); delete window.THREE; });

const badge = () => parent.querySelector('.thin-spot-badge');
const countBtn = () => parent.querySelector('.thin-spot-count');
const svg = () => parent.querySelector('svg');
const tags = () => [...svg().querySelectorAll('text')].map((t) => t.textContent);
const spots = (n) => Array.from({ length: n }, (_, i) => ({ x: i * 0.3, y: 0, z: 0, actual: 0.05 + i * 0.001 }));

describe('the thin-spot badge counts the detector list', () => {
  it("the count is the detector's own worstPts on a real thickened board", () => {
    const W = 7, H = 9;
    const { nx, nz } = resolveGrid(W, H, 0.1);
    const p = { ...P, widthIn: W, heightIn: H, seed: 42, smoothIntensity: 0.4, thickenEnabled: true, thickness: 0.6 };
    const { heights } = generateHeightmap({ ...p, nx, nz }, { mask: null });
    const pts = buildThickenData(heights, nx, nz, p, {}).data.worstPts;
    expect(pts.length).toBeGreaterThan(1); // the case under test has spots
    overlay.setData(pts, true);
    expect(overlay.count).toBe(pts.length);
    expect(countBtn().textContent).toBe(thinBadgeText(pts.length));
    expect(countBtn().textContent).toBe(`${pts.length} thin spots`);
    expect(badge().style.display).toBe('flex');
  });

  it('one spot reads singular', () => {
    overlay.setData(spots(1), true);
    expect(countBtn().textContent).toBe(THIN_SPOT_BADGE.text.one);
  });

  it('0 spots = no badge (and none while the leaders are switched off)', () => {
    overlay.setData([], true);
    expect(badge().style.display).toBe('none');
    overlay.setData(spots(4), false);
    expect(badge().style.display).toBe('none');
    expect(overlay.count).toBe(0);
  });

  it('the badge sits in the declared corner', () => {
    const { corner, insetPx } = THIN_SPOT_BADGE.position;
    const [v, h] = corner.split('-');
    expect(badge().style[v]).toBe(`${insetPx}px`);
    expect(badge().style[h]).toBe(`${insetPx}px`);
  });
});

describe('the old per-spot tags are not drawn by default', () => {
  it('drawAllTags is declared off; a frame with 12 spots draws no tag until the badge is opened', () => {
    expect(THIN_SPOT_BADGE.drawAllTags).toBe(false);
    overlay.setData(spots(12), true);
    overlay.update(camera, canvas);
    expect(svg().children.length).toBe(0);
  });

  it('declared on, every spot is tagged (the old view, kept reachable as data)', () => {
    const all = new LeaderLineOverlay(parent, { ...THIN_SPOT_BADGE, drawAllTags: true });
    all.setData(spots(5), true);
    all.update(camera, canvas);
    expect(all._svg.querySelectorAll('text').length).toBe(5);
  });
});

describe('stepping', () => {
  it('a tap opens on the first spot: one dot + one label', () => {
    overlay.setData(spots(3), true);
    overlay.update(camera, canvas);
    countBtn().click();
    expect(overlay.index).toBe(0);
    expect(svg().querySelectorAll('circle').length).toBe(1);
    expect(tags()).toEqual(['thin 0.050"']);
    expect(countBtn().textContent).toBe('1 / 3 thin');
  });

  it('next steps through every spot and wraps; prev goes back', () => {
    const n = 7;
    overlay.setData(spots(n), true);
    overlay.update(camera, canvas);
    countBtn().click();
    const seen = [];
    for (let k = 0; k < n; k++) { seen.push(tags()[0]); parent.querySelector('.thin-spot-next').click(); }
    expect(new Set(seen).size).toBe(n);
    expect(overlay.index).toBe(0); // wrapped
    parent.querySelector('.thin-spot-prev').click();
    expect(overlay.index).toBe(n - 1);
    expect(stepThinIndex(0, -1, n)).toBe(n - 1);
    expect(stepThinIndex(n - 1, 1, n, { step: { wrap: false } })).toBe(n - 1);
  });

  it('Esc closes; a tap outside closes; a tap on the arrows does not', () => {
    overlay.setData(spots(3), true);
    overlay.update(camera, canvas);
    countBtn().click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(overlay.isOpen).toBe(false);
    expect(svg().children.length).toBe(0);

    countBtn().click();
    parent.querySelector('.thin-spot-next').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(overlay.isOpen).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(overlay.isOpen).toBe(false);
    expect(countBtn().textContent).toBe('3 thin spots');
  });

  it('a spot near the right edge gets its tag on the left, inside the view (phone width)', () => {
    overlay.setData([{ x: 9.5, y: 0, z: 0, actual: 0.07 }], true);
    overlay.update(camera, canvas);
    overlay.open();
    const rect = svg().querySelector('rect');
    expect(Number(rect.getAttribute('x')) + Number(rect.getAttribute('width'))).toBeLessThanOrEqual(canvas.clientWidth);
  });

  it('a new list with fewer spots keeps the index in range; an empty one closes', () => {
    overlay.setData(spots(5), true);
    overlay.open();
    overlay.step(4);
    overlay.setData(spots(2), true);
    expect(overlay.index).toBe(1);
    overlay.setData([], true);
    expect(overlay.isOpen).toBe(false);
  });
});
