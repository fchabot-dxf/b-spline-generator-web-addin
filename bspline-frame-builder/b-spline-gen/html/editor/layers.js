import { el, on } from './dom.js';

export function getElementLayer(el) {
  if (!el) return '0';
  const layer = el.attr('data-layer');
  return layer == null ? '0' : String(layer);
}

export function getActiveLayer(editor) {
  return editor._activeLayer === undefined ? '0' : String(editor._activeLayer);
}

export function setActiveLayer(editor, layerId) {
  const normalized = layerId == null ? '0' : String(layerId);
  const layerSel = el('editorLayerSelect');
  if (layerSel) layerSel.value = normalized;

  editor._activeLayer = normalized;
  applyLayerState(editor);
  return normalized;
}

export function isEditableByLayer(editor, el) {
  return getElementLayer(el) === getActiveLayer(editor);
}

export function applyLayerState(editor) {
  if (!editor._sketchLayer) return;
  const activeLayer = getActiveLayer(editor);

  editor._sketchLayer.children().forEach(child => {
    const isActive = getElementLayer(child) === activeLayer;
    child.toggleClass('inactive-layer', !isActive);
  });

  if (editor._selectedElement && !isEditableByLayer(editor, editor._selectedElement)) {
    editor._deselect();
  }
}

export function initLayerControls(editor) {
  const layerSel = el('editorLayerSelect');
  if (!layerSel) return;

  on(layerSel, 'change', () => setActiveLayer(editor, layerSel.value));

  const initial = layerSel.value || '0';
  setActiveLayer(editor, initial);
}
