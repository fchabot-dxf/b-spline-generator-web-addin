/**
 * lattice-piece-panel.js — UI5 items 1/3/4 (Fred, via advisor): the
 * "Selected piece" panel — shows the CURRENT colour of whichever single
 * rail/tie/node/contour-segment is selected (via either the lattice
 * Select icon or the main Select tool), with a per-piece colour override +
 * reset back to the layer's own kind default (rails/ties/nodes only — see
 * H3 below for why width isn't a per-piece thing at all). Shared by both
 * properties-lattice.js and properties-shape-lattice.js (each calls
 * `mountSelectedPiecePanel(editor, bodyEl)` with its own panel body) —
 * one implementation, not two near-duplicates.
 *
 * Built via runtime DOM creation, same "no edits to bspline_gen_palette.
 * html" constraint lattice-side-column.js's own icon row already follows
 * (seat B owns that markup) — `data-no-collapse` so lattice-side-column.js's
 * own section-collapsing sweep leaves it alone, exactly like the icon row.
 *
 * Rails/ties/nodes read/write their COLOUR override ONLY through
 * editor-piece-override.js (the declared schema module — "no second
 * source" per the UI5 dispatch). H2 (SEG-COLOR-PANEL) extends colour to a
 * Shape Lattice CONTOUR SEGMENT too — a segment's colour is an OLDER,
 * differently-persisted mechanism (T73/SE14b's own
 * `PATTERN.contour.segmentColors[i]`, survives Regenerate, unlike a
 * rail/tie/node override which Regenerate clears), so it goes through
 * THAT storage instead (editor.js's `setColor`/`_storeContourSegmentColor`,
 * plus this file's own `clearContourSegmentColor`/`hasContourSegmentColor`
 * — still one storage path each, just not the SAME one as rails/ties/
 * nodes).
 *
 * H3 (NO-PIECE-WIDTH, Fred: "changing stroke width is never per segment,
 * it's a general param"): there is no per-piece width any more. The
 * Width/size control edits the lattice's GENERAL width/node_diameter for
 * that kind directly (`rewidthOwnedKind` — the SAME function the Colors/
 * Widths panel section's own stepper already calls), so every piece of
 * that kind changes together; there is no override to reset, so no Reset
 * button for width. A contour segment stays colour-only (no width row at
 * all, unchanged from H2).
 *
 * H5 (MULTI-SELECT): the panel now reads the WHOLE selection, not just a
 * single element — "N pieces (2 rails, 1 tie)", Colour shows "mixed" when
 * they differ, one pick recolours all, Reset resets all, in one undo step
 * each. The width/size control stays exactly what H3 built (it already
 * edits every owned piece of a KIND, regardless of how many happen to be
 * individually selected) — shown only when the WHOLE selection is a
 * single, non-contour kind, since there is no one coherent "kind" to edit
 * a general width for otherwise. A selected element this panel doesn't
 * recognize at all (a plain hand-drawn shape, mixed into a marquee/Ctrl+A
 * selection alongside lattice pieces) is simply left out of the count —
 * this panel has never had anything to say about plain shapes.
 *
 * Reacts to `editorSelectionChanged` (editor-ui.js's _afterSelectionChange
 * / editor.js's _deselect), the one selection-changed signal that feature
 * added.
 */
import {
  pieceKindOf, hasColorOverride, applyColorOverride, clearColorOverride,
} from './editor-piece-override.js';
import { openColorMosaic } from './editor-color.js';
import {
  PATTERN_DEFAULTS, resolvePatternLayer, rewidthOwnedKind,
  CONTOUR_SEG_INDEX_ATTR, hasContourSegmentColor, clearContourSegmentColor,
} from './editor-lattice-pattern.js';
import { getElementLayer } from './layers.js';
import { attachFormula } from '../core/formula-field.js';

const KIND_LABEL = { rails: 'Rail', ties: 'Tie', nodes: 'Node', contour: 'Contour segment' };
// H5: singular/plural noun for the "N pieces (2 rails, 1 tie)" summary.
const KIND_NOUN = {
  rails: ['rail', 'rails'], ties: ['tie', 'ties'], nodes: ['node', 'nodes'],
  contour: ['contour segment', 'contour segments'],
};

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

function _kindOf(el) {
  return pieceKindOf(el) || (_isContourSegment(el) ? 'contour' : null);
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
function _hasOverride(editor, el, kind) {
  return kind === 'contour' ? hasContourSegmentColor(editor, el) : hasColorOverride(el);
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
      <span class="lattice-piece-color-mixed" style="font-size:10px; color:#888; display:none;">Mixed</span>
      <button type="button" class="panel-color-swatch lattice-piece-color" title="Piece colour"
        style="width:32px; height:22px; border:1px solid #ccc; border-radius:3px; cursor:pointer; padding:0;"></button>
      <button type="button" class="lattice-piece-color-reset" title="Reset to layer colour"
        style="font-size:10px; padding:2px 6px; cursor:pointer;">Reset</button>
    </div>
    <div class="lattice-piece-width-row" style="display:flex; gap:8px; align-items:center;">
      <label class="lattice-piece-width-label" style="font-size:11px; flex:1;"></label>
      <input type="number" class="lattice-piece-width" min="0" step="0.01"
        style="width:60px; height:22px; font-size:11px; text-align:center;">
    </div>`;
  bodyEl.insertBefore(section, bodyEl.firstChild);

  const kindEl = section.querySelector('.lattice-piece-panel-kind');
  const colorBtn = section.querySelector('.lattice-piece-color');
  const colorMixedEl = section.querySelector('.lattice-piece-color-mixed');
  const colorResetBtn = section.querySelector('.lattice-piece-color-reset');
  const widthRow = section.querySelector('.lattice-piece-width-row');
  const widthLabel = section.querySelector('.lattice-piece-width-label');
  const widthInput = section.querySelector('.lattice-piece-width');
  // R5: the width field is formula-capable too, over the SAME scope its
  // host panel declares (`scope` — a caller-supplied thunk, so it reads
  // live off whichever layer/pattern is active, same as the panel's own
  // fields).
  if (scope) attachFormula(widthInput, scope);

  let current = null; // { pieces: [{el, kind}], layerId } -- layerId is any one piece's own (rewidthOwnedKind/resolvePatternLayer both resolve through it to the shared pattern regardless of which kind-layer it names)

  function refresh() {
    if (!current) { section.style.display = 'none'; return; }
    const { pieces, layerId } = current;
    const kindCounts = {};
    for (const { kind } of pieces) kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    const kinds = Object.keys(kindCounts);
    const uniformKind = kinds.length === 1 ? kinds[0] : null;

    if (pieces.length === 1) {
      kindEl.textContent = KIND_LABEL[pieces[0].kind] || pieces[0].kind;
    } else {
      const parts = kinds.map((k) => {
        const [singular, plural] = KIND_NOUN[k] || [k, k];
        const n = kindCounts[k];
        return `${n} ${n === 1 ? singular : plural}`;
      });
      kindEl.textContent = `${pieces.length} pieces (${parts.join(', ')})`;
    }

    const colors = pieces.map(({ el, kind }) => _currentColor(el, kind) || _kindDefaults(editor, layerId, kind).color);
    const mixed = colors.some((c) => c !== colors[0]);
    colorMixedEl.style.display = mixed ? '' : 'none';
    colorBtn.style.background = mixed ? '#fff' : colors[0];
    colorBtn.style.backgroundImage = mixed
      ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)'
      : 'none';
    colorBtn.style.backgroundSize = mixed ? '8px 8px' : 'auto';
    colorBtn.style.backgroundPosition = mixed ? '0 0, 4px 4px' : '0 0';
    colorResetBtn.style.visibility = pieces.some(({ el, kind }) => _hasOverride(editor, el, kind)) ? 'visible' : 'hidden';

    if (uniformKind && uniformKind !== 'contour') {
      widthLabel.textContent = uniformKind === 'nodes' ? 'Size (all)' : 'Width (all)';
      widthInput.value = _currentWidth(pieces[0].el, uniformKind);
      widthRow.style.display = 'flex';
    } else {
      widthRow.style.display = 'none';
    }
    section.style.display = '';
  }

  document.addEventListener('editorSelectionChanged', (e) => {
    if (!e.detail || e.detail.editor !== editor) return;
    const { selected } = e.detail;
    const pieces = (selected || [])
      .map((el) => ({ el, kind: _kindOf(el) }))
      .filter((p) => p.kind); // a plain shape mixed into the selection has nothing this panel shows
    current = pieces.length ? { pieces, layerId: getElementLayer(pieces[0].el) } : null;
    refresh();
  });

  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!current) return;
    openColorMosaic(colorBtn, (hex) => {
      // H5: stamp the override attribute on every non-contour piece FIRST
      // (a bare DOM mutation, no commit of its own), THEN editor.setColor
      // LAST — it repaints every selected element (including the just-
      // stamped ones, redundantly but harmlessly, same value) AND stores
      // each contour piece's own segmentColors[i] AND commits exactly
      // once. Stamping first, committing last, means the ONE undo step
      // captures everything together — reversed, calling setColor first
      // would push its own snapshot BEFORE the override attributes existed.
      for (const { el, kind } of current.pieces) {
        if (kind !== 'contour') applyColorOverride(el, kind, hex);
      }
      editor.setColor(hex);
      refresh();
    });
  });

  colorResetBtn.addEventListener('click', () => {
    if (!current) return;
    const { pieces, layerId } = current;
    for (const { el, kind } of pieces) {
      const defaultColor = _kindDefaults(editor, layerId, kind).color;
      if (kind === 'contour') clearContourSegmentColor(editor, el, defaultColor);
      else clearColorOverride(el, kind, defaultColor);
    }
    // H2's own lesson, generalized: _notifyChange('commit') triggers
    // refreshBoundaryPatterns, which rebuilds a Shape Lattice's contour
    // elements (rails/ties/nodes never trigger this) — invalidating the
    // very selection this reset just cleared, the moment ANY contour piece
    // is among them. _commitStyleChange (setColor's own commit path, no
    // boundary refresh) is used whenever the selection includes one;
    // otherwise the ordinary pushState+notifyChange idiom, unchanged.
    if (pieces.some((p) => p.kind === 'contour')) {
      if (typeof editor._commitStyleChange === 'function') editor._commitStyleChange();
    } else {
      if (typeof editor.pushState === 'function') editor.pushState();
      if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
    }
    refresh();
  });

  widthInput.addEventListener('change', () => {
    if (!current) return;
    const kinds = [...new Set(current.pieces.map((p) => p.kind))];
    if (kinds.length !== 1 || kinds[0] === 'contour') return; // width row is hidden then; defensive no-op
    const kind = kinds[0];
    const { layerId } = current;
    const value = parseFloat(widthInput.value) || _kindDefaults(editor, layerId, kind).width;
    widthInput.value = value;
    // H3 (NO-PIECE-WIDTH): edits the lattice's GENERAL width/node_diameter
    // directly -- the SAME two steps wireWidthStepper (properties-
    // lattice.js's own Widths section) already does for this exact field,
    // reused here rather than duplicated: write PATTERN.widths[field], then
    // re-width every owned piece of this kind in place. rewidthOwnedKind
    // pushes state / notifies on its own.
    const patternLayer = resolvePatternLayer(editor, layerId);
    if (patternLayer && patternLayer.pattern) {
      const field = kind === 'nodes' ? 'nodeDiameter' : kind;
      patternLayer.pattern.widths = { ...PATTERN_DEFAULTS.widths, ...patternLayer.pattern.widths, [field]: value };
    }
    rewidthOwnedKind(editor, layerId, kind, value);
    refresh();
  });
}
