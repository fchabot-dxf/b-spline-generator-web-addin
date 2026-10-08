/**
 * F35 item 15: RAISED ACCENTS (editor/brick-accents.js) -- 10 declared presets (a motif + params + a zone,
 * the whole wall since F35 item 57) and Custom "Click bricks" (stored points, re-mapped after a re-lay). The height mask
 * lifts exactly the accented Wall bricks by the accent Level; the picker icons are drawn by the real engine.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({
  preloadSetDetail: vi.fn(async () => {}),
  sampleDetailAtFor: vi.fn(() => undefined),
}));

import {
  ACCENT_PRESETS, ACCENT_MOTIFS, ACCENT_ZONES, accentGrid, accentedBrickIndices, toggleAccentClick,
} from '../bspline-frame-builder/b-spline-gen/html/editor/brick-accents.js';
import { accentIconSvg, BRICK_GEN_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';
import { generateBricks, polygonCentroid } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const W = 7, H = 9;
function wall(scale = 1) {
  return generateBricks({
    boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
    set: brickSetById(1), scale, suppression: 0, clumping: 0, seed: 1, zones: [{ pattern: 'stretcher' }],
  }).bricks;
}
// the zone is measured over the wall's own extent (its bricks' lowest to highest point)
const extentOf = (bricks) => { const ys = bricks.flatMap((b) => b.polygon.map((p) => p.y)); return [Math.min(...ys), Math.max(...ys)]; };
const upIn = (bricks) => { const [t, btm] = extentOf(bricks); return (b) => (btm - polygonCentroid(b.polygon).y) / (btm - t); };

describe('the course/column grid, derived from brick positions', () => {
  const bricks = wall();
  const grid = accentGrid(bricks, [0, 1 / 3]);
  const up = upIn(bricks);
  it('bricks in the lower third (of the wall) get a grid cell, the rest null', () => {
    bricks.forEach((b, k) => expect(grid[k] === null, `brick ${k}`).toBe(up(b) > 1 / 3));
  });
  it('course 0 is the bottom course, and courses step by one per brick height', () => {
    const cells = bricks.map((b, k) => [polygonCentroid(b.polygon).y, grid[k]]).filter(([, g]) => g);
    const courses = [...new Set(cells.map(([, g]) => g.course))].sort((a, b) => a - b);
    expect(courses[0]).toBe(0);
    expect(courses).toEqual(courses.map((_, k) => k)); // 0,1,2,... with no gaps
    const bottomY = Math.max(...cells.map(([y]) => y));
    for (const [y, g] of cells) if (Math.abs(y - bottomY) < 1e-6) expect(g.course).toBe(0);
  });
  it('a running bond: no two bricks of one course share a column', () => {
    const seen = new Set();
    for (const g of grid.filter(Boolean)) {
      const key = `${g.course}:${g.column}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });
});

describe('the 10 presets', () => {
  const bricks = wall();
  const up = upIn(bricks);
  it('10 presets, unique ids, each naming a declared motif', () => {
    expect(ACCENT_PRESETS).toHaveLength(10);
    expect(new Set(ACCENT_PRESETS.map((p) => p.id)).size).toBe(10);
    for (const p of ACCENT_PRESETS) expect(ACCENT_MOTIFS[p.motif], p.id).toBeTypeOf('function');
  });
  it.each(ACCENT_PRESETS.map((p) => [p.id]))('%s raises some bricks, all inside its zone', (id) => {
    const raised = accentedBrickIndices(bricks, { preset: id }, { seed: 1 });
    expect(raised.size).toBeGreaterThan(0);
    const [from, to] = ACCENT_PRESETS.find((p) => p.id === id).zone;
    for (const k of raised) expect(up(bricks[k])).toBeGreaterThanOrEqual(from - 1e-9);
    for (const k of raised) expect(up(bricks[k])).toBeLessThanOrEqual(to + 1e-9);
  });
  // F35 item 57 (Fred: "always puts them at the bottom, never higher"): the presets cover the whole wall, as the
  // icons show. Pyramid is the one motif anchored on course 0 by its own rule (a pyramid stands on the bottom).
  it.each(ACCENT_PRESETS.filter((p) => p.motif !== 'pyramid').map((p) => [p.id]))('%s also raises bricks in the TOP third of the wall', (id) => {
    const raised = [...accentedBrickIndices(bricks, { preset: id }, { seed: 1 })];
    expect(raised.filter((k) => up(bricks[k]) > 2 / 3).length).toBeGreaterThan(0);
  });
  it('every preset raises a different set of bricks', () => {
    const sets = ACCENT_PRESETS.map((p) => [...accentedBrickIndices(bricks, { preset: p.id }, { seed: 1 })].join(','));
    expect(new Set(sets).size).toBe(10);
  });
  it('Course bands raise WHOLE courses: every brick of course 0, none of course 1', () => {
    const grid = accentGrid(bricks);
    const raised = accentedBrickIndices(bricks, { preset: 'courseBand' }, { seed: 1 });
    grid.forEach((g, k) => {
      if (g && g.course === 0) expect(raised.has(k)).toBe(true);
      if (g && g.course === 1) expect(raised.has(k)).toBe(false);
    });
  });
  it('the zone follows the WALL, not the board: a wall in the board\'s upper half still gets its own lower third', () => {
    const shifted = bricks.filter((b) => polygonCentroid(b.polygon).y < H / 2); // the top half of the board only
    const raised = accentedBrickIndices(shifted, { preset: 'courseBand' }, { seed: 1, zone: ACCENT_ZONES.LOWER_THIRD });
    expect(raised.size).toBeGreaterThan(0);
    const upS = upIn(shifted);
    for (const k of raised) expect(upS(shifted[k])).toBeLessThanOrEqual(1 / 3 + 1e-9);
  });
  it("'none', an unknown preset and no accent raise nothing", () => {
    for (const a of [{ preset: 'none' }, { preset: 'nope' }, null]) expect(accentedBrickIndices(bricks, a).size).toBe(0);
  });
});

describe('Custom: Click bricks (stored points, re-mapped after a re-lay)', () => {
  it('a click raises the brick under it; a second click on that brick lowers it; grout changes nothing', () => {
    const bricks = wall();
    const c = polygonCentroid(bricks[5].polygon);
    let clicks = toggleAccentClick([], c, bricks);
    expect(accentedBrickIndices(bricks, { preset: 'custom', clicks })).toEqual(new Set([5]));
    clicks = toggleAccentClick(clicks, { x: c.x + 0.01, y: c.y }, bricks);
    expect(clicks).toEqual([]);
    expect(toggleAccentClick([], { x: -1, y: -1 }, bricks)).toEqual([]);
  });
  it('after a re-lay at another brick size, each stored point raises whichever brick now lies under it', () => {
    const before = wall();
    const after = wall(1.6);
    const inside = (p, b) => accentedBrickIndices([b], { preset: 'custom', clicks: [p] }).size === 1;
    // a point that is on a brick in BOTH layouts (a click on grout after the re-lay raises nothing, by design)
    const target = after.findIndex((b, k) => k > 10 && before.some((o) => inside(polygonCentroid(b.polygon), o)));
    const pt = polygonCentroid(after[target].polygon);
    const clicks = toggleAccentClick([], pt, before);
    expect(clicks).toHaveLength(1);
    expect(accentedBrickIndices(after, { preset: 'custom', clicks })).toEqual(new Set([target]));
  });
});

describe('picker icons, drawn by the real engine', () => {
  it('every preset gets an icon with raised (dark) bricks; all distinct; None draws none raised', () => {
    const icons = ACCENT_PRESETS.map((p) => accentIconSvg(p.id));
    for (const svg of icons) {
      // REAL parsed elements: the wall bricks (light) and the raised ones (dark group)
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(doc.querySelectorAll('g[fill="#d07a5c"] > polygon').length).toBeGreaterThan(10);
      expect(doc.querySelectorAll('g[fill="#8e2f1c"] > polygon').length).toBeGreaterThan(0);
    }
    expect(new Set(icons).size).toBe(10);
    expect(accentIconSvg('none')).toMatch(/<g fill="#8e2f1c"><\/g>/);
  });
});

describe('the height mask lifts exactly the accented Wall bricks by the accent Level', () => {
  const MW = 8, MH = 4, NX = 65, NZ = 33;
  const K = (x, y) => Math.round((1 - y / MH) * (NZ - 1)) * NX + Math.round((x / MW) * (NX - 1));
  async function run(opts) {
    const root = document.createElement('div');
    for (const [id, pts] of [['left', '0.5,0.5 3.875,0.5 3.875,3.5 0.5,3.5'], ['right', '4.125,0.5 7.5,0.5 7.5,3.5 4.125,3.5']]) {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      for (const [k, v] of [['points', pts], ['data-layer', 'L'], [BRICK_GEN_ATTR, '1'], ['data-brick-set', '1'], ['data-brick-seed', '1'],
        ['data-brick-relief', '0.125'], ['data-brick-id', id], ['data-brick', 'wall']]) poly.setAttribute(k, v);
      root.appendChild(poly);
    }
    document.body.appendChild(root);
    const m = await rasterizeBrickHeightMask({ _sketchLayer: { node: root } }, { id: 'L', depth: 0.125 }, NX, NZ, MW, MH, opts);
    root.remove();
    return m;
  }
  it('a clicked brick sits proud by levelIn; its neighbour is unchanged', async () => {
    const flat = await run({});
    const acc = await run({ accent: { preset: 'custom', levelIn: 0.0625, clicks: [{ x: 2, y: 2 }] } });
    expect((acc.body[K(2, 2)] - flat.body[K(2, 2)]) * 0.125).toBeCloseTo(0.0625, 6);
    expect(acc.body[K(6, 2)]).toBe(flat.body[K(6, 2)]);
  });
  it('the mask also returns each piece’s FACE height under its download id (the SVG’s grey): the clicked brick by levelIn', async () => {
    const flat = await run({});
    const acc = await run({ accent: { preset: 'custom', levelIn: 0.0625, clicks: [{ x: 2, y: 2 }] } });
    expect([flat.nx, flat.nz]).toEqual([NX, NZ]);
    expect(Object.keys(acc.faces).sort()).toEqual(['wall:left', 'wall:right']);
    expect(acc.faces['wall:left'] - flat.faces['wall:left']).toBeCloseTo(0.0625, 9);
    expect(acc.faces['wall:right']).toBe(flat.faces['wall:right']);
    // the joints' height (the SVG grout grey): Flush (the default) fills up to the lowest face
    expect(flat.jointIn).toBe(Math.min(...Object.values(flat.faces)));
    const rec = await run({ groutProfile: 'recessed', groutDepthIn: 0.05 });
    expect(rec.jointIn).toBeCloseTo(-0.05, 9);
  });
  it("preset 'none' (and a saved session without the key) is byte-identical", async () => {
    const a = await run({});
    const b = await run({ accent: { preset: 'none', levelIn: 0.0625, clicks: [] } });
    expect(Array.from(b.body)).toEqual(Array.from(a.body));
  });
});
