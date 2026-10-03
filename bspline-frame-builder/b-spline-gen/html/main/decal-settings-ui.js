/**
 * H23 item 71: the "Fusion colour decal" group's one dynamic piece -- a checkbox per artwork
 * layer currently in the project (the other fields, decalEnabled/decalResolution/decalOpacity,
 * are plain `P` keys the generic auto-binder in ui-bindings.js already handles).
 *
 * `P.decalLayerIds` is keyed by layer id (stable across reorder/delete, unlike array index) and
 * written DIRECTLY here (not through updateP/applyParam, same as P.filterTweaks elsewhere) since a
 * dynamic per-layer dictionary has no single DOM element id the generic binder could match. A
 * layer is INCLUDED unless its id maps to exactly `false` -- missing/true both mean included, the
 * same "visible !== false" convention editor/layers.js already uses everywhere else, so a layer
 * added after the project was last saved defaults to included, not silently dropped.
 */
import { P, saveLastSession } from '../core/state.js';

function layerRow(layer) {
  const label = document.createElement('label');
  label.className = 'cad-label';
  label.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:2px; font-weight:400;';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = P.decalLayerIds[layer.id] !== false;
  cb.addEventListener('change', () => {
    P.decalLayerIds[layer.id] = cb.checked;
    saveLastSession();
  });
  const span = document.createElement('span');
  span.textContent = layer.name || `Layer ${layer.id}`;
  label.appendChild(cb);
  label.appendChild(span);
  return label;
}

export function renderDecalLayerCheckboxes() {
  const container = document.getElementById('decalLayersList');
  if (!container) return;
  const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
  const layers = (editor && Array.isArray(editor._layers)) ? editor._layers : [];
  container.innerHTML = '';
  for (const layer of layers) container.appendChild(layerRow(layer));
}

export function initDecalSettingsUI() {
  renderDecalLayerCheckboxes();
  if (typeof document !== 'undefined') {
    document.addEventListener('editorLayersChanged', renderDecalLayerCheckboxes);
  }
}
