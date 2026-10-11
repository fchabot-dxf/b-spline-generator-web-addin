/**
 * Fred 2026-10-10 ("the bounding box doesn't follow the scale"; his phone: the strokes grew past the board, the dashed box
 * + its handles stayed). MEASURED live (claude_15, a real touch drag of the box's corner): during the drag the box kept its
 * start rect while the pieces' union grew; at the release it caught up. A move already redrew the box every tick
 * (translateSelection -> _updateHandles); a scale and a rotate did not. Now every tick redraws it -- updateHandles derives
 * the box from the CURRENT transformed geometry (the union of worldBbox).
 */
import { describe, it, expect } from 'vitest';
import { beginTransform, applyTransformDrag } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-transform-handles.js';

function rectEl(attrs) {
  const state = { ...attrs };
  const el = {
    type: 'rect', _state: state,
    attr(a, v) { if (typeof a === 'string') { if (v === undefined) return state[a]; state[a] = v; return el; } Object.assign(state, a); return el; },
    matrix: () => null,
    bbox: () => ({ x: +state.x, y: +state.y, w: +state.width, h: +state.height, x2: +state.x + +state.width, y2: +state.y + +state.height }),
  };
  return el;
}
// an editor whose box redraw records the geometry it is drawn from, at the moment of the call
function editorWatching(el) {
  const drawn = [];
  return { drawn, _selectedElements: [el], _grid: { visible: false, snap: false, spacing: 0.25 },
    _updateSelectionHighlight() {}, _notifyChange() {}, _updateHandles() { drawn.push({ ...el.bbox(), transform: el._state.transform }); } };
}

describe('the selection box follows a scale / rotate DURING the drag', () => {
  it('scale x2: the box is redrawn on the tick, from the already-scaled geometry', () => {
    const el = rectEl({ x: 0, y: 0, width: 2, height: 1 });
    const ed = editorWatching(el);
    const state = beginTransform(ed, { kind: 'scale', id: 'e', sx: true, sy: false, hitR: 1 }, { x: 2, y: 0.5 });
    applyTransformDrag(ed, state, { x: 4, y: 0.5 }, {});
    expect(ed.drawn.length).toBe(1);
    expect(ed.drawn[0]).toMatchObject({ x: 0, w: 4, x2: 4 }); // the box spans the scaled piece, not the start rect
  });
  it('rotate: the box is redrawn on the tick, after the rotation is written', () => {
    const el = rectEl({ x: 0, y: 0, width: 2, height: 1 });
    const ed = editorWatching(el);
    const state = { handle: { kind: 'rotate' }, els: [{ el, m0: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }], anchor: { x: 1, y: 0.5 }, initAngle: 0 };
    applyTransformDrag(ed, state, { x: 1, y: 2 }, {}); // a quarter turn
    expect(ed.drawn.length).toBe(1);
    expect(ed.drawn[0].transform).toBeTruthy(); // drawn after the transform was applied
  });
});
