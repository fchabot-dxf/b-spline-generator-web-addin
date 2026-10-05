/**
 * editor/editor-clear.js -- F35 item 28 (Fred: "Clear should be a drop down in header with all clear options,
 * all, frame, art etc"): the EDITOR-side clears, one kind each, no commit of their own (the caller,
 * main/editor-clear-menu.js, makes the ONE undo commit). Editor-level only: no app state (core/state.js) here.
 *
 *   clearArtworkLayers(editor) -- every art layer and its content goes (lattice / shape-lattice pattern state
 *     lives on the layers, so it goes with them); the Bricks layer and its bricks stay; a fresh Layer 1 is made
 *     active, as on a new board.
 *   clearBrickElements(editor) -- every brick element (Wall, Frame, Brush bricks and the strokes' spines) goes;
 *     the Bricks layer stays. The Wall/Frame element RECORDS (item 22) are on that layer, so they go too: no
 *     element is left, nothing re-lays.
 */
import { addLayer, setActiveLayer, isBricksLayer, isBrickToolNode, BRICK_RECORD_ATTR } from './layers.js';

const _layerIdOf = (child) => String(child.attr ? child.attr('data-layer') : child.node?.getAttribute?.('data-layer'));

/** F35 item 22 slice 3: a node of a brick element (a piece, a spine, a record) -- bricks live on any layer. */
const _isBrickElementNode = (ch) => {
  const n = ch && (ch.node || ch);
  return isBrickToolNode(n) || !!(n && n.hasAttribute && n.hasAttribute(BRICK_RECORD_ATTR));
};
const _childrenOf = (editor) => (editor._sketchLayer.children().toArray ? editor._sketchLayer.children().toArray() : [...editor._sketchLayer.children()]);

export function clearArtworkLayers(editor) {
  if (typeof editor._deselect === 'function') editor._deselect();
  // every non-brick node goes, on every layer; a layer that still holds brick elements stays (the legacy Bricks
  // layer, or an art layer with bricks on it), every other layer goes
  for (const ch of _childrenOf(editor)) if (!_isBrickElementNode(ch)) ch.remove();
  const holding = new Set(_childrenOf(editor).map(_layerIdOf));
  const kept = (editor._layers || []).filter((l) => isBricksLayer(l) || holding.has(String(l.id)));
  editor._layers = kept;
  editor._activeLayer = null;
  // a new board's first art layer (its default name counts every layer, the Bricks one too); the caller's commit
  // makes it one undo step
  const layer = addLayer(editor, { skipUndo: true, name: 'Layer 1' });
  editor._layers = [layer, ...kept.filter((l) => l !== layer)]; // the art layer back in front, as before the clear
  setActiveLayer(editor, layer.id);
}

export function clearBrickElements(editor) {
  if (typeof editor._deselect === 'function') editor._deselect();
  // every brick element node (pieces, spines, records), on whatever layer it is; art stays
  for (const ch of _childrenOf(editor)) if (_isBrickElementNode(ch)) ch.remove();
}
