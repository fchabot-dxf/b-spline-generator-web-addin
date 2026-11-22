/**
 * core/stamp/target.js -- WHAT the Stamp settings edit (DRAW-STAMP worker U, advisor 2026-11-22). Every stamp control
 * (the editor's Draw > Stamp branch: main/stamp/*, and the generic applyParam path for the P.stamp* keys,
 * core/state.js) reads and writes through stampTarget(), and the sidebar's one-line summary is computed through it.
 *
 * Today the target is the SELECTED layer: editor._layers[P.activeLayerIdx] (main/stamp/layer.js keeps that index in
 * step with the editor's active layer), or -- before the editor has a roster -- the legacy P.stampLayers entry (the
 * tooling-only fallback object). The coming per-stroke step swaps the target here, in this one place.
 *
 * `set` keeps the exact write the two old paths made: the target record's field, then -- when it is an editor layer --
 * the editor's 'tooling' change (serialize + persist; core/state.js layerToolingChanged).
 */
import { P, layerToolingChanged } from '../state.js';
import { getProfile } from './profiles/index.js';

/** The editor's live layer roster, or null (no editor yet, or an empty roster). */
function _editorLayers() {
  try {
    const ed = typeof window !== 'undefined' ? window.svgEditor : null;
    const layers = ed && Array.isArray(ed._layers) ? ed._layers : null;
    return layers && layers.length ? layers : null;
  } catch (_) { return null; }
}

/** A target over one layer record. `editorLayer` = the same record when it is an editor layer (it then reaches the
 *  saved drawing), else null. Exported so a caller holding its own layer accessors keeps the one write rule. */
export function layerStampTarget(layer, editorLayer = null) {
  return {
    kind: 'layer',
    layer: layer || null,
    editorLayer: editorLayer || null,
    get: (key) => (layer ? layer[key] : undefined),
    set(key, value) {
      if (layer) layer[key] = value;
      if (editorLayer) { if (editorLayer !== layer) editorLayer[key] = value; layerToolingChanged(); }
    },
  };
}

/** The Stamp settings' target: the selected layer (or layer index `idx`, for the per-row summary). */
export function stampTarget(idx = P.activeLayerIdx) {
  const layers = _editorLayers();
  const editorLayer = layers ? (layers[idx] || null) : null;
  const layer = editorLayer || (P.stampLayers ? P.stampLayers[idx] : null) || null;
  return layerStampTarget(layer, editorLayer);
}

/** A height for the summary: up to 3 decimals, no trailing zeros ("0.25", "0.1", "0.125"). */
const _inches = (v) => String(Number(Math.abs(v).toFixed(3)));

/** The sidebar's one-line, read-only summary of a target: "Raised 0.25 in · V-bit 90°" / "Carved 0.1 in · Ballnose";
 *  a zero height reads "Flat". The tool's word comes from its profile's declared `summary`; the angle shows only for a
 *  profile that declares the angle field (its `uiParams`, the same rule the V-Bit Angle row follows). */
export function stampSummaryText(target) {
  const depth = Number(target.get('depth')) || 0;
  if (depth === 0) return 'Flat';
  const profile = getProfile(target.get('profile'));
  const angle = (profile.uiParams || []).includes('stampVBitAngle') && Number.isFinite(Number(target.get('angle')))
    ? ` ${Number(target.get('angle'))}°` : '';
  return `${depth < 0 ? 'Carved' : 'Raised'} ${_inches(depth)} in · ${profile.summary || profile.label}${angle}`;
}
