/**
 * HEIGHT-PAINTER slice 3 (brush tip shapes): the PIN. A brush with tip 'round', roundness 1, angle 0 -- or with none of
 * the tip keys at all (every brush before slice 3) -- lays a stroke BYTE-IDENTICAL to the slice-2 brush. The hashes below
 * were measured on main @ ea366455 BEFORE the tip code existed (sha256 of the Float32 bytes, first 16 hex), and the panel
 * path's stored raster h on the same commit. AGENTS.md rule 3: a saved board / brush lays exactly as before.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createStroke, BRUSH_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/core/height/brush.js';
import { rectMask, featherMask } from '../bspline-frame-builder/b-spline-gen/html/core/height/selection.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, paintHeightStroke, _resetHeightPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

const hashOf = (f32) => createHash('sha256').update(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)).digest('hex').slice(0, 16);
/** The slice-2 brush keys only (no tip keys): what every brush before slice 3 was. */
const LEGACY_KEYS = ['mode', 'sizeIn', 'hardness', 'falloff', 'opacity', 'flow', 'spacing', 'amountIn', 'targetIn', 'pressureSize', 'pressureOpacity', 'customCurve'];
const legacy = (over) => { const b = { ...BRUSH_DEFAULTS, ...over }; return Object.fromEntries(LEGACY_KEYS.map((k) => [k, b[k]])); };
const TIP_ROUND = { tip: 'round', roundness: 1, angle: 0, followStroke: false };

/** A stroke on a fresh cols x rows raster (pre-filled with a ramp so smooth / set / erase have something to work on). */
function strokeHash(brush, { cols = 90, rows = 70, pxX = 100, pxY = 100, mask = null, pts }) {
  const data = new Float32Array(cols * rows);
  for (let k = 0; k < data.length; k++) data[k] = ((k % cols) / cols) * 0.05;
  const raster = { cols, rows, data };
  const s = createStroke(raster, brush, { pxPerInX: pxX, pxPerInY: pxY, mask });
  for (const [x, y, p] of pts) s.addPoint(x, y, p ?? 1);
  return { hash: hashOf(data), bbox: s.bbox, dabs: s.dabs };
}
const PATH = [[12, 15, 1], [30, 22, 0.8], [55, 40, 0.5], [70, 52, 0.9], [74, 20, 1]];

// sha256 / bbox / dab count measured on main @ ea366455 (before slice 3)
const CASES = [
  ['defaults', {}, {}, 'e47fdff52ce3a9e5', 21],
  ['hard linear set', { mode: 'set', targetIn: 0.2, hardness: 0.8, falloff: 'linear', spacing: 0.05 }, {}, '1009de447ecb3967', 41],
  ['pressure size + opacity, dome', { pressureSize: true, pressureOpacity: true, falloff: 'dome', sizeIn: 0.3, opacity: 0.6, flow: 0.5 }, {}, 'a925204bb0a783a7', 34],
  ['smooth mode', { mode: 'smooth', sizeIn: 0.4, hardness: 0.2 }, {}, 'c2c8cbe310137b38', 26],
  ['erase, plateau', { mode: 'erase', falloff: 'plateau', opacity: 0.7 }, {}, 'd4918f808b70ba8e', 21],
  ['custom ring', { mode: 'raise', falloff: 'custom', customCurve: [[0, 0.2], [0.5, 1], [1, 0]], hardness: 0.1 }, {}, 'd5f63e035943e0fb', 21],
  ['stretched patch, lower', { mode: 'lower', amountIn: 0.03, falloff: 'spike' }, { pxX: 100, pxY: 60 }, 'b2d67a8dd972c039', 28],
  ['feathered mask', { hardness: 0.5 }, { mask: 'feather' }, 'f65f17dc43171214', 21],
];

describe('round tip = the slice-2 brush, byte for byte', () => {
  for (const [name, over, opts, golden, dabs] of CASES) {
    it(name, () => {
      const o = { ...opts, pts: PATH };
      if (o.mask === 'feather') o.mask = featherMask(rectMask(90, 70, 20, 10, 60, 50), 90, 70, 3);
      const a = strokeHash(legacy(over), o);                      // a brush without the tip keys (every brush before slice 3)
      const b = strokeHash({ ...legacy(over), ...TIP_ROUND }, o);  // tip round, roundness 1, angle 0
      expect(a.hash).toBe(golden);
      expect(b.hash).toBe(golden);
      expect(a.dabs).toBe(dabs);
      expect(b.bbox).toEqual(a.bbox);
    });
  }
});

describe('the panel path: the stored raster is the one main stored', () => {
  const saved = {};
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 3; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    window.svgEditor = { _undoStack: [], pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; vi.useRealTimers(); });

  it('a stroke with the session brush (BRUSH_DEFAULTS) stores raster h 9bjt7vksnn (main @ ea366455)', async () => {
    await newHeightPatch();
    await paintHeightStroke([[-0.5, -0.4], [0.2, 0.3, 0.7], [0.6, -0.2]], { sizeIn: 0.35, hardness: 0.4 });
    expect(activeHeightLayer().raster.h).toBe('9bjt7vksnn');
  });
});
