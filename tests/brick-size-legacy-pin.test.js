/**
 * Per-pattern defaults (Fred 2026-10-11): a board saved with the ONE global brick size and board-wide joint depth /
 * profile lays BYTE-IDENTICAL after the 'brick-size-per-element' migration made them every element's overrides. The
 * digests were taken on the code before the change (PIN=1 on that commit writes them): the same legacy-shaped boards,
 * through the app's own lay input (brickLayInput) and the engine, across sizes x frame presets x element sets.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import { brickLayInput, buildRibbonPrimitives, frameBandsOf } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const FIXTURE = 'tests/fixtures/brick-size-legacy-digests.json';
const editor = { _mW: 7, _mH: 9 };
const SIZES = [null, 0.75, 1.25, 3]; // null = a save from before the size key (laid at scale 1)
const PRESETS = ['single_soldier', 'mixed_bands', 'arch_keystone', 'three_band_quoin'];
const SETS = [{ wall: 1, frame: 1, brush: 1, raisedBrush: 1 }, { wall: 2, frame: 3, brush: 1, raisedBrush: 1 }];
const SIZE_KEYS = ['brickLengthIn', 'sizeByElement', 'groutDepthByElement', 'groutProfileByElement', 'scale', 'frameBrickLengthIn'];

/** A board as saved before the change: its settings with the one size + the board-wide joint depth / profile. */
function legacyBoard(size, preset, setIds) {
  const b = JSON.parse(JSON.stringify(P.brickSettings));
  for (const k of SIZE_KEYS) delete b[k];
  Object.assign(b, { seed: 7, suppression: 0.3, pattern: 'stretcher', frameBandPreset: preset, frameBandPatterns: [], setIds,
    windowSurround: { preset: 'none' }, grout: { depthIn: 0.07, profile: 'flush' }, groutByElement: { wall: null, frame: 0.05, brush: null } });
  if (size != null) b.brickLengthIn = size;
  const p = { brickSettings: b };
  runMigrations(p); // on the old code: its own migrations; on this branch: + brick-size-per-element
  return p.brickSettings;
}
const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const geom = (s) => ({ primitives: buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: 7, y2: 9 })), bands: frameBandsOf(s) });
const digest = (s) => {
  const r = generateBricks(brickLayInput(editor, s, geom(s)));
  return fnv(JSON.stringify([r.bricks, r.frameBricks, r.archBricks || null, r.surroundBricks || null]));
};

describe('a saved board lays byte-identical through the per-element size migration', () => {
  it('sizes x frame presets x element sets: the digests taken before the change', () => {
    const now = {};
    for (const size of SIZES) for (const preset of PRESETS) for (const [i, setIds] of SETS.entries()) {
      now[`${size ?? 'none'} ${preset} sets${i}`] = digest(legacyBoard(size, preset, setIds));
    }
    if (process.env.PIN === '1') { writeFileSync(FIXTURE, JSON.stringify(now, null, 1)); return; }
    const pinned = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    expect(Object.keys(now).length).toBe(SIZES.length * PRESETS.length * SETS.length);
    expect(now).toEqual(pinned);
  }, HEAVY_TEST_MS);
});
