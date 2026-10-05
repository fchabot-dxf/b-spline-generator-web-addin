/**
 * editor/editor-clear.js -- F35 item 28 (Fred: "Clear should be a drop down in header with all clear options,
 * all, frame, art etc"): the EDITOR-side clears, one kind each, no commit of their own (the caller,
 * main/editor-clear-menu.js, makes the ONE undo commit). Editor-level only: no app state (core/state.js) here.
 *
 *   clearArtworkLayers(editor) -- every art layer and its content goes (lattice / shape-lattice pattern state
 *     lives on the layers, so it goes with them); the Bricks layer and its bricks stay; a fresh Layer 1 is made
 *     active, as on a new board.
 *   clearBrickElements(editor) -- every brick element (Wall, Frame, Brush bricks and the strokes' spines) goes;
 *     the Bricks layer stays, its laid key (brickLaidKey) set to null: nothing is laid any more.
 */
import { addLayer, setActiveLayer, isBricksLayer } from './layers.js';

const _layerIdOf = (child) => String(child.attr ? child.attr('data-layer') : child.node?.getAttribute?.('data-layer'));

function _removeChildrenOf(editor, layerIds, keep) {
  const children = editor._sketchLayer.children().toArray ? editor._sketchLayer.children().toArray() : [...editor._sketchLayer.children()];
  let removed = 0;
  for (const ch of children) {
    if (layerIds.has(_layerIdOf(ch)) !== keep) { ch.remove(); removed++; }
  }
  return removed;
}

export function clearArtworkLayers(editor) {
  if (typeof editor._deselect === 'function') editor._deselect();
  const bricksLayers = (editor._layers || []).filter(isBricksLayer);
  _removeChildrenOf(editor, new Set(bricksLayers.map((l) => String(l.id))), true); // keep only the bricks' content
  editor._layers = bricksLayers;
  editor._activeLayer = null;
  // a new board's first art layer (its default name counts every layer, the Bricks one too); the caller's commit
  // makes it one undo step
  const layer = addLayer(editor, { skipUndo: true, name: 'Layer 1' });
  editor._layers = [layer, ...bricksLayers.filter((l) => l !== layer)]; // the art layer back in front of the Bricks layer, as before the clear
  setActiveLayer(editor, layer.id);
}

export function clearBrickElements(editor) {
  if (typeof editor._deselect === 'function') editor._deselect();
  const bricksLayers = (editor._layers || []).filter(isBricksLayer);
  _removeChildrenOf(editor, new Set(bricksLayers.map((l) => String(l.id))), false);
  for (const l of bricksLayers) l.brickLaidKey = null;
}
