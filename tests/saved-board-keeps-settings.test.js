/**
 * Fred's rule for every changed default ("new boards only; saved boards keep theirs"), pinned:
 *  - a saved board keeps its OWN brick size through the session load + migrations (the real pre-item-22 fixture,
 *    saved at 1 in, must not pick up today's 1 1/4 in default);
 *  - a board saved BEFORE a field existed reads that field's OLD behaviour (brickSettings is restored whole; an
 *    absent field is never filled from today's defaults): no brickLengthIn = the set's own 3/4 in, no brickTopMode
 *    = Organic, no grout.profile = Flush joints (no recess), no accent = none.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// the brick photo detail is fetched over the network; these tests read heights only
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({ preloadSetDetail: vi.fn(async () => {}), sampleDetailAtFor: vi.fn(() => undefined) }));
import { readFileSync } from 'node:fs';
import { P, DEFAULT, loadLastSession } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { scaleFor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';
import { DEFAULT_ACCENT } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-accents.js';

const FIXTURE = readFileSync('tools/brick-matrix/fixtures/pre-item22-board.splineGenLastSession.json', 'utf-8');

beforeEach(() => { localStorage.clear(); });

describe('a saved board keeps its own settings', () => {
  it('the pre-item-22 fixture (saved at 1 in) loads at 1 in, not the new-board default', () => {
    expect(DEFAULT.brickSettings.brickLengthIn).toBe(1.25); // the new-board default it must NOT pick up
    localStorage.setItem('splineGenLastSession', FIXTURE);
    expect(loadLastSession()).toBe(true);
    runMigrations();
    expect(P.brickSettings.brickLengthIn).toBe(1);
    expect(P.brickSettings.brickTopMode).toBe(JSON.parse(FIXTURE).P.brickSettings.brickTopMode);
  });
});

describe('a field the save predates reads its OLD behaviour', () => {
  it('no brickLengthIn: the set’s own 3/4 in (scale 1)', () => {
    expect(scaleFor({ setId: 1 })).toBe(1);
    expect(brickSetById(1).brickLengthIn).toBe(0.75);
  });

  it('no brickTopMode: Organic (no flat-top planes); no grout.profile: Flush (no joint recess)', async () => {
    const root = document.createElement('div');
    const brick = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    for (const [k, v] of [['points', '1,1 3,1 3,2 1,2'], ['data-layer', 'L'], ['data-brick-gen', '1'], ['data-brick-set', '1'], ['data-brick-seed', '1'], ['data-brick-relief', '0.125'], ['data-brick', 'wall']]) brick.setAttribute(k, v);
    root.appendChild(brick);
    document.body.appendChild(root);
    const legacy = {}; // what a pre-field save passes: topMode / groutProfile undefined
    const m = await rasterizeBrickHeightMask({ _sketchLayer: { node: root } }, { id: 'L', depth: 0.125 }, 41, 21, 4, 3, legacy);
    expect(m.flatTop).toBeUndefined();
    expect(Math.min(...m.body)).toBeGreaterThanOrEqual(0); // nothing recessed below the ground
    const recessed = await rasterizeBrickHeightMask({ _sketchLayer: { node: root } }, { id: 'L', depth: 0.125 }, 41, 21, 4, 3, { groutProfile: 'recessed', groutDepthIn: 0.05, groutWidthIn: 0.1 });
    expect(Math.min(...recessed.body)).toBeLessThan(0); // control: the recess shows when asked for
    root.remove();
  });

  it('no accent: none (the panel reads DEFAULT_ACCENT under a missing one; the mask lifts nothing)', async () => {
    expect(DEFAULT_ACCENT.preset).toBe('none');
    const root = document.createElement('div');
    for (let i = 0; i < 4; i++) {
      const b = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      for (const [k, v] of [['points', `${0.5 + i * 2},1.2 ${2.3 + i * 2},1.2 ${2.3 + i * 2},1.8 ${0.5 + i * 2},1.8`], ['data-layer', 'L'], ['data-brick-gen', '1'], ['data-brick-set', '1'], ['data-brick-seed', '1'], ['data-brick-relief', '0.125'], ['data-brick', 'wall'], ['data-brick-id', `w${i}`]]) b.setAttribute(k, v);
      root.appendChild(b);
    }
    document.body.appendChild(root);
    const ed = { _sketchLayer: { node: root } };
    const absent = await rasterizeBrickHeightMask(ed, { id: 'L', depth: 0.125 }, 81, 41, 8, 4, {});
    const none = await rasterizeBrickHeightMask(ed, { id: 'L', depth: 0.125 }, 81, 41, 8, 4, { accent: { ...DEFAULT_ACCENT } });
    const checker = await rasterizeBrickHeightMask(ed, { id: 'L', depth: 0.125 }, 81, 41, 8, 4, { accent: { preset: 'custom', levelIn: 0.0625, clicks: [{ x: 1.4, y: 1.5 }] } });
    expect([...absent.body]).toEqual([...none.body]);
    expect([...checker.body]).not.toEqual([...none.body]); // control: an accent (a clicked brick) does lift
    root.remove();
  });
});
