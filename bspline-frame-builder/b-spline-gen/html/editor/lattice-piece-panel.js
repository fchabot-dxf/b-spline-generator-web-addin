/**
 * lattice-piece-panel.js — UI5 items 1/3/4 (Fred, via advisor): the
 * "Selected piece" override panel — shows the CURRENT colour + width of
 * whichever single rail/tie/node is selected (via either the lattice
 * Select icon or the main Select tool), each with an override control and
 * a reset back to the layer's own kind default. Shared by both
 * properties-lattice.js and properties-shape-lattice.js (each calls
 * `mountSelectedPiecePanel(editor, bodyEl)` with its own panel body) —
 * one implementation, not two near-duplicates.
 *
 * Built via runtime DOM creation, same "no edits to bspline_gen_palette.
 * html" constraint lattice-side-column.js's own icon row already follows
 * (seat B owns that markup) — `data-no-collapse` so lattice-side-column.js's
 * own section-collapsing sweep leaves it alone, exactly like the icon row.
 *
 * Rails/ties/nodes read/write overrides ONLY through editor-piece-
 * override.js (the declared schema module — "no second source" per the
 * UI5 dispatch). H2 (SEG-COLOR-PANEL) extends this same panel to a Shape
 * Lattice CONTOUR SEGMENT too, colour-only — but a segment's colour is an
 * OLDER, differently-persisted mechanism (T73/SE14b's own
 * `PATTERN.contour.segmentColors[i]`, survives Regenerate, unlike an
 * override which Regenerate clears), so it goes through THAT storage
 * instead (editor.js's `setColor`/`_storeContourSegmentColor`, plus this
 * file's own `clearContourSegmentColor`/`hasContourSegmentColor` — still
 * one storage path each, just not the SAME one as rails/ties/nodes).
 * Reacts to `editorSelectionChanged` (editor-ui.js's _afterSelectionChange
 * / editor.js's _deselect), the one selection-changed signal that feature
 * added.
 */
import {
  pieceKindOf, hasColorOverride, hasWidthOverride,
  applyColorOverride, applyWidthOverride, clearColorOverride, clearWidthOverride,
} from './editor-piece-override.js';
import { openColorMosaic } from './editor-color.js';
import {
  PATTERN_DEFAULTS, resolvePatternLayer,
  CONTOUR_SEG_INDEX_ATTR, hasContourSegmentColor, clearContourSegmentColor,
} from './editor-lattice-pattern.js';
import { getElementLayer } from './layers.js';
import { attachFormula } from '../core/formula-field.js';

const KIND_LABEL = { rails: 'Rail', ties: 'Tie', nodes: 'Node', contour: 'Contour segment' };

// H2 (SEG-COLOR-PANEL, Fred: "only color" — a contour segment has no width
// control here): a segment carries no `data-lattice` value at all
// (pieceKindOf's own vocabulary is rails/ties/nodes only, by that file's
// own documented scope decision — a segment's colour already has an OLDER,
// differently-persisted mechanism, `PATTERN.contour.segmentColors[i]`, not
// the override-attribute schema), so it's recognized here by its own
// `CONTOUR_SEG_INDEX_ATTR` marker instead.
function _isContourSegment(el) {
  return !!(el && el.node && el.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR));
}

/** The layer's own declared default colour/width for `kind` — exactly
 *  what recolorOwnedKind/rewidthOwnedKind would apply to a non-overridden
 *  piece of this kind right now (same defaults-merge every other reader of
 *  PATTERN.colors/widths in this app already uses). `resolvePatternLayer`
 *  (T76 SE17), not a direct `.pattern` read off `layerId` — the selected
 *  piece's own layer may be any one of a pattern's FOUR kind-layers, and
 *  only one of them actually holds `.pattern`. */
function _kindDefaults(editor, layerId, kind) {
  const patternLayer = resolvePatternLayer(editor, layerId);
  const pattern = (patternLayer && patternLayer.pattern) || {};
  const colors = { ...PATTERN_DEFAULTS.colors, ...pattern.colors };
  const widths = { ...PATTERN_DEFAULTS.widths, ...pattern.widths };
  const widthField = kind === 'nodes' ? 'nodeDiameter' : kind;
  return { color: colors[kind], width: widths[widthField] };
}

function _currentWidth(el, kind) {
  return kind === 'nodes' ? parseFloat(el.attr('r')) * 2 : parseFloat(el.attr('stroke-width'));
}
function _currentColor(el, kind) {
  return kind === 'nodes' ? el.attr('fill') : el.attr('stroke');
}

export function mountSelectedPiecePanel(editor, bodyEl, scope) {
  if (!bodyEl) return;

  const section = document.createElement('div');
  section.dataset.noCollapse = '';
  section.className = 'lattice-piece-panel';
  section.style.display = 'none';
  section.innerHTML = `
    <span style="font-weight:600; display:block; margin-bottom:6px;">Selected piece</span>
    <div class="lattice-piece-panel-kind" style="font-size:11px; color:#666; margin-bottom:6px;"></div>
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
      <label style="font-size:11px; flex:1;">Colour</label>
      <button type="button" class="panel-color-swatch lattice-piece-color" title="Piece colour"
        style="width:32px; height:22px; border:1px solid #ccc; border-radius:3px; cursor:pointer; padding:0;"></button>
      <button type="button" class="lattice-piece-color-reset" title="Reset to layer colour"
        style="font-size:10px; padding:2px 6px; cursor:pointer;">Reset</button>
    </div>
    <div class="lattice-piece-width-row" style="display:flex; gap:8px; align-items:center;">
      <label style="font-size:11px; flex:1;">Width</label>
      <input type="number" class="lattice-piece-width" min="0" step="0.01"
        style="width:60px; height:22px; font-size:11px; text-align:center;">
      <button type="button" class="lattice-piece-width-reset" title="Reset to layer width"
        style="font-size:10px; padding:2px 6px; cursor:pointer;">Reset</button>
    </div>`;
  bodyEl.insertBefore(section, bodyEl.firstChild);

  const kindEl = section.querySelector('.lattice-piece-panel-kind');
  const colorBtn = section.querySelector('.lattice-piece-color');
  const colorResetBtn = section.querySelector('.lattice-piece-color-reset');
  const widthRow = section.querySelector('.lattice-piece-width-row');
  const widthInput = section.querySelector('.lattice-piece-width');
  const widthResetBtn = section.querySelector('.lattice-piece-width-reset');
  // R5: the override width field is formula-capable too, over the SAME
  // scope its host panel declares (`scope` — a caller-supplied thunk, so
  // it reads live off whichever layer/pattern is active, same as the
  // panel's own fields).
  if (scope) attachFormula(widthInput, scope);

  let current = null; // { el, kind, layerId }

  function refresh() {
    if (!current) { section.style.display = 'none'; return; }
    const { el, kind, layerId } = current;
    const defaults = _kindDefaults(editor, layerId, kind);
    const color = _currentColor(el, kind) || defaults.color;
    kindEl.textContent = KIND_LABEL[kind] || kind;
    colorBtn.style.background = color;
    if (kind === 'contour') {
      // H2: "only color" -- no width control for a contour segment.
      colorResetBtn.style.visibility = hasContourSegmentColor(editor, el) ? 'visible' : 'hidden';
      widthRow.style.display = 'none';
    } else {
      widthInput.value = _currentWidth(el, kind) || defaults.width;
      colorResetBtn.style.visibility = hasColorOverride(el) ? 'visible' : 'hidden';
      widthResetBtn.style.visibility = hasWidthOverride(el) ? 'visible' : 'hidden';
      widthRow.style.display = 'flex';
    }
    section.style.display = '';
  }

  document.addEventListener('editorSelectionChanged', (e) => {
    if (!e.detail || e.detail.editor !== editor) return;
    const { primary, selected } = e.detail;
    const kind = selected && selected.length === 1
      ? (pieceKindOf(primary) || (_isContourSegment(primary) ? 'contour' : null))
      : null;
    current = kind ? { el: primary, kind, layerId: getElementLayer(primary) } : null;
    refresh();
  });

  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!current) return;
    openColorMosaic(colorBtn, (hex) => {
      const { el, kind } = current;
      if (kind === 'contour') {
        // H2 item 2: ONE storage path -- the same helper (setColor's own
        // internal _storeContourSegmentColor) the toolbar COLOR control
        // already drives, not a second write into segmentColors[i].
        // setColor already pushes state / notifies on its own.
        editor.setColor(hex);
      } else {
        applyColorOverride(el, kind, hex);
        if (typeof editor.pushState === 'function') editor.pushState();
        if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
      }
      refresh();
    });
  });

  colorResetBtn.addEventListener('click', () => {
    if (!current) return;
    const { el, kind, layerId } = current;
    if (kind === 'contour') {
      // H2: NOT pushState()+_notifyChange('commit') (the rails/ties/nodes
      // branch's own idiom, below) -- editor.js's own 'commit' hook calls
      // refreshBoundaryPatterns, which REBUILDS a Shape Lattice's contour
      // segment elements (rails/ties/nodes never trigger this rebuild, so
      // that branch never hits it), invalidating THIS segment's own
      // selection out from under the very reset that just ran. setColor's
      // own commit path (_commitStyleChange, no boundary refresh) is what
      // the toolbar COLOR control already relies on for a plain segment
      // recolor — Reset is the same kind of change, so it uses the same
      // commit primitive, confirmed live: the rails/ties/nodes idiom
      // deselects the segment (found building this turn's own CDP check).
      clearContourSegmentColor(editor, el, _kindDefaults(editor, layerId, kind).color);
      if (typeof editor._commitStyleChange === 'function') editor._commitStyleChange();
    } else {
      clearColorOverride(el, kind, _kindDefaults(editor, layerId, kind).color);
      if (typeof editor.pushState === 'function') editor.pushState();
      if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
    }
    refresh();
  });

  widthInput.addEventListener('change', () => {
    if (!current || current.kind === 'contour') return;
    const { el, kind, layerId } = current;
    const value = parseFloat(widthInput.value) || _kindDefaults(editor, layerId, kind).width;
    applyWidthOverride(el, kind, value);
    if (typeof editor.pushState === 'function') editor.pushState();
    if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
    refresh();
  });

  widthResetBtn.addEventListener('click', () => {
    if (!current || current.kind === 'contour') return;
    const { el, kind, layerId } = current;
    clearWidthOverride(el, kind, _kindDefaults(editor, layerId, kind).width);
    if (typeof editor.pushState === 'function') editor.pushState();
    if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
    refresh();
  });
}
