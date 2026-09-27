/**
 * T80 item 4 (Fred's screenshot): after reopening the Shape Lattice tool the
 * layer list had a NEW Ties/Contour/Rails set on top of the existing one, and
 * both lattices drew. Fred had turned 3D off on the existing layers (eye on).
 *
 * Reproduced through a real save + reopen: save() writes the layer roster to
 * data-editor-layers and the active layer to data-editor-active-layer; open()
 * restores the roster by spreading each saved entry and re-activates the saved
 * layer -- mirrored here exactly (open() itself needs a real svg.js canvas).
 * Reopening the tool = the panel's currentPattern() + Generate.
 */
import { describe, it, expect } from 'vitest';
import { generatePattern, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { regenerateSilhouette, currentPattern } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { save } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';

function makeMockEditor(mW, mH) {
  let elements = [];
  function makeElement(type, initial) {
    const store = { ...initial };
    const elObj = {
      type,
      node: { getAttribute: (k) => (store[k] !== undefined ? store[k] : null), hasAttribute: (k) => store[k] !== undefined },
      attr(k, ...rest) { if (rest.length === 0) return store[k]; const v = rest[0]; if (v === null || v === undefined) delete store[k]; else store[k] = v; return elObj; },
      stroke(v) { if (typeof v === 'object' && v !== null) { if ('color' in v) store.stroke = v.color; if ('width' in v) store['stroke-width'] = v.width; } return elObj; },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      clone() { return makeElement(type, { ...store }); },
      addClass() { return elObj; }, removeClass() { return elObj; }, hasClass() { return false; },
      remove() { elements = elements.filter((e) => e !== elObj); },
    };
    elements.push(elObj);
    return elObj;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { return makeElement('line', { x1, y1, x2, y2 }); },
    circle(d) { return makeElement('circle', { r: d / 2 }); },
    path(d) { return makeElement('path', { d }); },
    add(e) { elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: { innerHTML: '' },
  };
  return {
    _mW: mW, _mH: mH, _draw: {}, _sketchLayer: sketchLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0', _nextLayerId: 1,
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [],
    pushState() {}, _notifyChange() {},
  };
}

/** Generate a Shape Lattice hourglass through the panel's own path. */
async function generateShapeLattice(editor) {
  const p = currentPattern(editor);
  Object.assign(p, {
    seed: 17, spacing: 0.25, extent: { mode: 'boundary' },
    shape: { source: 'generated', preset: 'hourglass', seed: 17, params: {}, segments: null },
  });
  regenerateSilhouette(editor, p);
  await generatePattern(editor, p);
  return p;
}

/** Close + reopen: save(), then restore the roster the way open() does. */
function saveAndReopen(editor) {
  const svg = save(editor);
  const layersJson = svg.match(/data-editor-layers="([^"]*)"/)[1].replace(/&quot;/g, '"');
  const active = (svg.match(/data-editor-active-layer="([^"]*)"/) || [])[1];
  const reopened = makeMockEditor(editor._mW, editor._mH);
  reopened._layers = JSON.parse(layersJson).map((l) => ({ ...l, id: String(l.id), name: l.name || 'Layer', visible: l.visible !== false }));
  reopened._activeLayer = reopened._layers.some((l) => l.id === active) ? active : reopened._layers[0].id;
  reopened._nextLayerId = Math.max(...reopened._layers.map((l) => Number(l.id)).filter((n) => !Number.isNaN(n))) + 1;
  return reopened;
}

async function reopenTool(editor) {
  const p = currentPattern(editor);
  regenerateSilhouette(editor, p);
  await generatePattern(editor, p);
  return p;
}

const byId = (editor, id) => editor._layers.find((l) => l.id === id);

describe('T80 item 4: reopening Shape Lattice adopts its existing layers, never a second set', () => {
  it("Fred's case: 3D off on its layers (eye on), a sibling layer active, close, reopen -> still exactly one set", async () => {
    const editor = makeMockEditor(7, 9);
    const p = await generateShapeLattice(editor);
    const kinds = { ...p.layers };
    expect(Object.keys(kinds).sort()).toEqual(['contour', 'nodes', 'rails', 'ties']);
    const layerCount = editor._layers.length;
    for (const id of Object.values(kinds)) byId(editor, id).carve = false;
    editor._activeLayer = kinds.ties;

    const reopened = saveAndReopen(editor);
    const p2 = await reopenTool(reopened);

    expect(reopened._layers.length).toBe(layerCount);
    expect(p2.layers).toEqual(kinds);
    expect(p2.seed).toBe(17);
    expect(p2.shape.preset).toBe('hourglass');
  });

  for (const activeKind of ['contour', 'nodes', 'rails']) {
    it(`same with the ${activeKind} layer active`, async () => {
      const editor = makeMockEditor(7, 9);
      const p = await generateShapeLattice(editor);
      const layerCount = editor._layers.length;
      editor._activeLayer = p.layers[activeKind];
      const reopened = saveAndReopen(editor);
      const p2 = await reopenTool(reopened);
      expect(reopened._layers.length).toBe(layerCount);
      expect(p2.layers).toEqual(p.layers);
    });
  }

  it('the identity survives the eye hidden, renamed layers and a reordered list', async () => {
    const editor = makeMockEditor(7, 9);
    const p = await generateShapeLattice(editor);
    const layerCount = editor._layers.length;
    byId(editor, p.layers.ties).visible = false;
    byId(editor, p.layers.contour).visible = false;
    byId(editor, p.layers.ties).name = 'My ties';
    byId(editor, p.layers.rails).name = 'Frame rails';
    editor._layers.reverse();
    editor._activeLayer = p.layers.ties;

    const reopened = saveAndReopen(editor);
    const p2 = await reopenTool(reopened);

    expect(reopened._layers.length).toBe(layerCount);
    expect(p2.layers).toEqual(p.layers);
    expect(byId(reopened, p.layers.ties).name).toBe('My ties');
  });

  it('a document that already has two sets is left alone: reopening adds no third and merges nothing', async () => {
    const editor = makeMockEditor(7, 9);
    const first = await generateShapeLattice(editor);
    editor._layers.push({ id: String(editor._nextLayerId), name: 'Layer 2', visible: true });
    editor._activeLayer = String(editor._nextLayerId);
    editor._nextLayerId += 1;
    const second = await generateShapeLattice(editor);
    expect(second.layers.rails).not.toBe(first.layers.rails);
    const layerCount = editor._layers.length;
    editor._activeLayer = second.layers.ties;

    const reopened = saveAndReopen(editor);
    const p2 = await reopenTool(reopened);

    expect(reopened._layers.length).toBe(layerCount);
    expect(p2.layers).toEqual(second.layers);
    expect(byId(reopened, first.layers.rails).pattern.layers).toEqual(first.layers);
  });
});

describe('T80 item 4: the defaults the repro relies on', () => {
  it('a fresh Shape Lattice pattern starts with no kind-layers of its own', () => {
    expect(PATTERN_DEFAULTS.layers).toBeUndefined();
  });
});
