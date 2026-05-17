/**
 * editor-bridge.js — wire the b-spline-gen VectorEditor against a
 * stamp-editor layer.
 *
 * stamp-editor stores N layers, each with its own SVG document. The
 * editor itself only knows about one in-flight document at a time, so
 * when the user clicks "Edit SVG…" on a layer we:
 *
 *   1. Snapshot the layer's current SVG (so Cancel can restore).
 *   2. Show the modal (display:flex) and open the editor with that SVG.
 *   3. Wire onChange → write the saved SVG back to the layer + schedule
 *      an engine rebuild for live preview.
 *   4. Wire onCommit → Apply keeps; Cancel restores the snapshot;
 *      either way the modal closes.
 *
 * The canvas size matches the first captured face's mm extent — so
 * what the user draws lives in the same coord space the engine will
 * eventually stamp onto. Python ships the face's trim outline along
 * with that mm size, and we render it as a faint backdrop guide on
 * the editor's bgLayer so the user can see what falls inside / outside
 * the face's actual outline.
 *
 * VectorEditor's internal layer selector is hidden — stamp-editor
 * handles layer multiplicity at the outer level.
 */

import { VectorEditor }    from '../editor/index.js';
import { updateLayer }      from './layers.js';
import { renderLayerList }  from './layers.js';
import { pyLog }            from '../core/runtime.js';

// Fallback canvas dimensions when no face has been captured yet.
const FALLBACK_W_MM = 100;
const FALLBACK_H_MM = 100;

let _editor    = null;
let _active    = null;   // { id, prevSvg } — restored on Cancel
let _scheduleEngine = null;
let _state          = null;

/** One-time wiring at boot. The first call to openEditorFor() will
 *  lazily construct the underlying VectorEditor. */
export function initEditorBridge(state, scheduleEngine) {
  _state          = state;
  _scheduleEngine = scheduleEngine;
  pyLog('editor bridge ready');
}

/** Open the modal against `layer` (from layers.js). The layer's svg
 *  is loaded into the editor; edits flow back via onChange. */
export function openEditorFor(layer) {
  if (!layer) return;
  ensureEditor();

  _active = { id: layer.id, prevSvg: layer.svg };

  // Use the first captured face to size the canvas + draw the
  // outline guide. If no face is captured yet (user opened the editor
  // before picking a face), fall back to a square 100×100 mm canvas.
  const face = _state.faces && _state.faces.length ? _state.faces[0] : null;
  const widthMm  = (face && face.canvasWMm) || FALLBACK_W_MM;
  const heightMm = (face && face.canvasHMm) || FALLBACK_H_MM;

  // Set the header label so the user knows which layer they're editing
  // and what the canvas dimensions represent.
  const headLabel = document.getElementById('editorLayerName');
  if (headLabel) {
    const suffix = face
      ? `  (${widthMm.toFixed(1)}×${heightMm.toFixed(1)} mm)`
      : '';
    headLabel.textContent = `Editing: ${layer.name}${suffix}`;
  }

  const modal = document.getElementById('svgEditorModal');
  if (modal) modal.style.display = 'flex';

  // The editor's `open` method parses the SVG and populates
  // _sketchLayer. Run it next tick so the modal has laid out and the
  // SVG.js canvas can size correctly. w/h are in inches — editor's
  // internal coordinate system uses inches throughout.
  const wIn = widthMm  / 25.4;
  const hIn = heightMm / 25.4;
  requestAnimationFrame(() => {
    try {
      _editor.open(layer.svg, wIn, hIn);
      // After open(), draw the face outline as a backdrop guide.
      if (face && face.outline && face.outline.length) {
        renderFaceBackdrop(face.outline, widthMm, heightMm);
      }
    } catch (e) {
      pyLog(`editor.open threw: ${e.message}`);
    }
  });
}

/** Draw the face's trim outline as a non-editable backdrop on the
 *  editor's bgLayer. Coords are in canvas mm (matching the open()
 *  width/height); the editor renders the bgLayer behind the user's
 *  sketch so the outline shows through without interfering with
 *  selection / hit-testing. The outline is cleared every time a new
 *  face is opened (we put it on the bgLayer which open() clears).
 */
function renderFaceBackdrop(loops, widthMm, heightMm) {
  if (!_editor || !_editor._bgLayer) return;
  // Clear any prior backdrop. The bgLayer also hosts other editor
  // chrome (rulers etc.) — we tag our path so we can find it again.
  try {
    _editor._bgLayer.find('.stamp-face-outline').forEach(n => n.remove());
  } catch (_) { /* SVG.js find may not match in some builds */ }

  // Build a "Mx,y Lx,y …Z" path per loop, in INCHES (the editor's
  // internal unit). The editor uses Y-down in its canvas, same as
  // the engine's V axis — no axis flip needed.
  const MM_PER_INCH = 25.4;
  const parts = [];
  for (const loop of loops) {
    if (!loop || loop.length < 2) continue;
    let s = '';
    for (let i = 0; i < loop.length; i++) {
      const x = loop[i][0] / MM_PER_INCH;
      const y = loop[i][1] / MM_PER_INCH;
      s += (i === 0 ? 'M' : 'L') + x.toFixed(4) + ' ' + y.toFixed(4);
    }
    s += 'Z';
    parts.push(s);
  }
  if (!parts.length) return;

  try {
    const path = _editor._bgLayer.path(parts.join(' '));
    path.addClass('stamp-face-outline');
    path.fill({ color: '#000', opacity: 0.04 });   // very faint fill
    path.stroke({ color: '#888', width: 0.01, dasharray: '0.05,0.05' });
  } catch (e) {
    pyLog(`face outline draw failed: ${e.message}`);
  }
}

function ensureEditor() {
  if (_editor) return;
  _editor = new VectorEditor();
  window.svgEditor = _editor;  // editor-symbol-keyboard.js reaches for it

  _editor.initEditor(
    'editorSVGContainer',
    'svgEditorTopView',
    // onChange — fires per edit. Persist the SVG back to the active
    // layer and trigger a preview rebuild.
    async () => {
      if (!_active) return;
      try {
        const svg = _editor.save();
        if (!svg) return;
        updateLayer(_state, _active.id, { svg });
        if (_scheduleEngine) _scheduleEngine();
      } catch (e) {
        pyLog(`editor onChange threw: ${e.message}`);
      }
    },
    // onCommit — fires from Apply (svg truthy) or Cancel (svg null).
    async (svg) => {
      if (svg === 'push') return;
      if (svg) {
        // Apply: take the editor's saved SVG, write to the layer.
        updateLayer(_state, _active.id, { svg });
      } else if (_active) {
        // Cancel: restore the snapshot we captured at open time.
        updateLayer(_state, _active.id, { svg: _active.prevSvg });
      }
      _active = null;
      const modal = document.getElementById('svgEditorModal');
      if (modal) modal.style.display = 'none';
      renderLayerList(_state);
      if (_scheduleEngine) _scheduleEngine();
    },
  );
}
