import { describe, it, expect } from 'vitest';
import { exactSideView, zStepFor, zLabelled, zTicks, zLabel, ZScale, SIDE_VIEW_TOLERANCE_DEG } from '../bspline-frame-builder/b-spline-gen/html/core/preview/z-scale.js';


// A camera at (theta, phi) the way the ViewCube / orbit builds it: Euler(phi, 0, theta, 'ZXY'); view dir = -(R * +Z)
function dirOf(thetaDeg, phiDeg) {
  const t = thetaDeg * Math.PI / 180, p = phiDeg * Math.PI / 180;
  // Rx(p) then Rz(t) applied to (0,0,1)
  const x1 = 0, y1 = -Math.sin(p), z1 = Math.cos(p);
  return { x: -(x1 * Math.cos(t) - y1 * Math.sin(t)), y: -(x1 * Math.sin(t) + y1 * Math.cos(t)), z: -z1 };
}

class Obj { constructor() { this.children = []; this.position = { set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } }; this.rotation = {}; this.scale = { set() {} }; this.visible = true; }
  add(c) { this.children.push(c); c.parent = this; } remove(c) { this.children.splice(this.children.indexOf(c), 1); c.parent = null; } }
const THREE = {
  Group: Obj, Sprite: class extends Obj { constructor(m) { super(); this.material = m; this.userData = {}; } },
  LineSegments: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
  BufferGeometry: class { setAttribute(n, a) { this[n] = a; } dispose() {} },
  Float32BufferAttribute: class { constructor(a) { this.array = a; } },
  LineBasicMaterial: class { dispose() {} }, SpriteMaterial: class { constructor(o) { this.map = o.map; } dispose() {} },
  CanvasTexture: class { dispose() {} },
};
function labelsOf(group) { return group.children.filter(c => c.userData && 'text' in c.userData).map(c => c.userData.text); }

describe('exactSideView (the one display rule)', () => {
  it('the four view-cube side faces', () => {
    expect(exactSideView(dirOf(0, 90))).toBe('front');
    expect(exactSideView(dirOf(180, 90))).toBe('back');
    expect(exactSideView(dirOf(90, 90))).toBe('right');
    expect(exactSideView(dirOf(-90, 90))).toBe('left');
  });
  it('iso / top / bottom / slightly orbited are not exact', () => {
    expect(exactSideView(dirOf(45, 54.7))).toBe(null);
    expect(exactSideView(dirOf(0, 0.057))).toBe(null);   // TOP
    expect(exactSideView(dirOf(0, 179.9))).toBe(null);   // BOTTOM
    expect(exactSideView(dirOf(0 + 2, 90))).toBe(null);
    expect(exactSideView(dirOf(0, 90 + 2))).toBe(null);
    expect(exactSideView(null)).toBe(null);
  });
  it('the tolerance is declared and about half a degree', () => {
    expect(SIDE_VIEW_TOLERANCE_DEG).toBe(0.5);
    expect(exactSideView(dirOf(0.3, 90))).toBe('front');
    expect(exactSideView(dirOf(0.7, 90))).toBe(null);
  });
});

describe('step table + ticks', () => {
  it('picks the step by span', () => {
    expect([0.9, 1, 1.5, 2.5, 3, 5, 6].map(zStepFor)).toEqual([0.1, 0.1, 0.25, 0.25, 0.5, 0.5, 1]);
  });
  it('ticks span min..max and always include 0', () => {
    expect(zTicks(0, 0.9)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    expect(zTicks(-0.6, 1.4)).toEqual([-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25]);
    expect(zTicks(-0.6, 1.4)[0]).toBe(-0.5);
    expect(zTicks(2, 3)).toContain(0);
    expect(zTicks(-3, -2)).toContain(0);
    expect(zLabel(0.25)).toBe('0.25'); expect(zLabel(0)).toBe('0');
  });
});

describe('labelled ticks', () => {
  it('never labels two ticks closer than 0.2 in, always labels 0', () => {
    for (const [a, b] of [[0, 0.9], [-0.3, 0.9], [0, 2], [-1, 3], [0, 8], [-0.5, 12]]) {
      const l = zLabelled(a, b);
      expect(l).toContain(0);
      for (let i = 1; i < l.length; i++) expect(l[i] - l[i - 1]).toBeGreaterThanOrEqual(0.2 - 1e-9);
    }
  });
});

describe('ZScale group visibility', () => {
  function make() {
    const scene = new Obj();
    const z = new ZScale(THREE, scene, text => { const s = new THREE.Sprite({}); s.userData = { text }; return s; });
    z.setExtent(10, 8, -0.1, 0.9);
    return z;
  }
  it('visible only for the four exact side views', () => {
    const z = make();
    expect(z.group.visible).toBe(false);
    for (const [t, p, name] of [[0, 90, 'front'], [180, 90, 'back'], [90, 90, 'right'], [-90, 90, 'left']]) {
      expect(z.setView(dirOf(t, p))).toBe(name); expect(z.group.visible).toBe(true);
    }
    z.setView(dirOf(45, 54.7)); expect(z.group.visible).toBe(false);
    z.setView(dirOf(0, 90)); z.setView(dirOf(3, 90)); expect(z.group.visible).toBe(false);
    z.setView(dirOf(0, 0.05)); expect(z.group.visible).toBe(false);
  });
  it('the ruler sits at the near-left corner of each side view', () => {
    const z = make();
    z.setView(dirOf(0, 90));   expect([z.group.position.x, z.group.position.y]).toEqual([-5, -4]);
    z.setView(dirOf(90, 90));  expect([z.group.position.x, z.group.position.y]).toEqual([5, -4]);
  });
  it('labels span min..max and include 0', () => {
    const z = make();
    const l = labelsOf(z.group).map(Number);
    expect(l).toContain(0); expect(Math.min(...l)).toBeLessThanOrEqual(0); expect(Math.max(...l)).toBeGreaterThanOrEqual(0.8);
    expect(labelsOf(z.group)).toEqual(['0', '0.2', '0.4', '0.6', '0.8']); // ticks every 0.1, a number on every 2nd
  });
});

describe('viewDirOf: the camera quaternion -> its view direction', () => {
  it('matches the orbit camera (Euler(phi,0,theta,ZXY)) for the four side views', async () => {
    const { viewDirOf } = await import('../bspline-frame-builder/b-spline-gen/html/core/preview/z-scale.js');
    const quat = (t, p) => { // q = Rz(t) * Rx(p)
      const qz = [0, 0, Math.sin(t / 2), Math.cos(t / 2)], qx = [Math.sin(p / 2), 0, 0, Math.cos(p / 2)];
      const [ax, ay, az, aw] = qz, [bx, by, bz, bw] = qx;
      return { x: aw * bx + ax * bw + ay * bz - az * by, y: aw * by - ax * bz + ay * bw + az * bx, z: aw * bz + ax * by - ay * bx + az * bw, w: aw * bw - ax * bx - ay * by - az * bz };
    };
    const H = Math.PI / 2;
    expect(exactSideView(viewDirOf(quat(0, H)))).toBe('front');
    expect(exactSideView(viewDirOf(quat(Math.PI, H)))).toBe('back');
    expect(exactSideView(viewDirOf(quat(H, H)))).toBe('right');
    expect(exactSideView(viewDirOf(quat(-H, H)))).toBe('left');
    expect(exactSideView(viewDirOf(quat(Math.PI / 4, 0.955)))).toBe(null);
    expect(exactSideView(viewDirOf(quat(0, 0.001)))).toBe(null);
  });
});
