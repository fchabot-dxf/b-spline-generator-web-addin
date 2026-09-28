/**
 * editor-piece-override.js — UI5 items 1-4 (Fred, via advisor): per-piece
 * COLOUR override for a single selected rail/tie/node, independent of the
 * layer's own Colors panel default. "Declared data schema on the piece:
 * data-override-color (ONE schema module)" — this file IS that module:
 * the attribute name, plus the apply/clear/read helpers every other file
 * that touches an override goes through, so the schema itself never gets
 * duplicated or drifts between the panel that writes it
 * (lattice-piece-panel.js) and the sweep that must skip it
 * (editor-lattice-pattern.js's recolorOwnedKind). No imports of its own —
 * a plain attribute-name + DOM-read/write module, safe to import from
 * anywhere without a circular-dependency risk.
 *
 * Protected rails (Fred, 2026-09): item 3's "an override clears on the next Generate" no longer holds for a
 * generated RAIL -- a recoloured / striped / cut rail is protected, and Generate redraws it with its colours
 * (editor-lattice-pattern.js _captureProtectedRails / _reapplyProtectedRail). Ties and nodes still clear.
 *
 * Scope decision (UI5, this turn): rails/ties/nodes only. A CONTOUR
 * segment already has its OWN, older per-segment colour mechanism
 * (`PATTERN.contour.segmentColors[i]`, properties-shape-lattice.js) with
 * the OPPOSITE persistence rule this feature's own item 3 asks for —
 * Fred's existing per-segment style is designed to SURVIVE a same-
 * topology Regenerate (you style a segment once, it stays styled), while
 * item 3 wants a plain override CLEARED by Regenerate. Reusing this
 * module's attribute for contour too would mean picking one of those two
 * behaviours and silently breaking whichever feature didn't get it —
 * addressed instead (H2, SEG-COLOR-PANEL) by giving contour its own
 * colour path through the already-existing segmentColors mechanism, never
 * through this module.
 *
 * H3 (NO-PIECE-WIDTH, Fred: "changing stroke width is never per segment,
 * it's a general param... it should go, changing it changes every lattice
 * part"): the WIDTH half of this module (data-override-width plus
 * hasWidthOverride/applyWidthOverride/clearWidthOverride, and
 * rewidthOwnedKind/rewidthOwnedKinds's own override-skip that read it) is
 * REMOVED — a lattice piece has no per-piece width any more, only colour.
 * `lattice-piece-panel.js`'s own Width/size control now edits the
 * lattice's GENERAL width/node_diameter directly (rewidthOwnedKind), the
 * same mechanism the Colors/Widths panel section already uses. A plain
 * drawing element (rectangle/freeform/line/…) never went through this
 * module (its own per-element stroke-width is untouched). Old saved
 * patterns that still carry a stale data-override-width attribute are
 * simply ignored from now on: nothing here or in rewidthOwnedKind reads
 * it any more.
 */
export const OVERRIDE_COLOR_ATTR = 'data-override-color';

// The panel-facing kind vocabulary (recolorOwnedKind/rewidthOwnedKind's
// own 'rails'|'ties'|'nodes') differs from the DOM's own data-lattice
// value ('rail'|'tie'|'node') -- this module is the one place that maps
// between them, so a caller holding either can ask pieceKindOf a plain
// element and get the SAME answer.
const DOM_KIND_TO_PANEL_KIND = { rail: 'rails', tie: 'ties', node: 'nodes' };

/** The override-relevant kind of `elOrNode` ('rails'|'ties'|'nodes'), or
 *  null for anything else (a contour segment, a hand-drawn shape, nothing
 *  at all). Accepts either an svg.js wrapper (`.node`) or a raw DOM node. */
export function pieceKindOf(elOrNode) {
  const node = elOrNode && elOrNode.node ? elOrNode.node : elOrNode;
  if (!node || typeof node.getAttribute !== 'function') return null;
  const dl = node.getAttribute('data-lattice');
  return DOM_KIND_TO_PANEL_KIND[dl] || null;
}

export function hasColorOverride(el) {
  return !!(el && el.node && el.node.hasAttribute(OVERRIDE_COLOR_ATTR));
}

/** Paints `hex` onto `el` the same way recolorOwnedKind's own per-kind
 *  dispatch does (a node's fill is its visible colour; a rail/tie's
 *  stroke is), then stamps the override attribute so the Colors sweep
 *  leaves it alone from now on. */
export function applyColorOverride(el, kind, hex) {
  if (kind === 'nodes') el.fill(hex);
  else el.stroke({ color: hex });
  el.attr(OVERRIDE_COLOR_ATTR, hex);
}

/** Removes the colour override and repaints `el` with `defaultColor` —
 *  the value recolorOwnedKind would have applied all along had this piece
 *  never been overridden. */
export function clearColorOverride(el, kind, defaultColor) {
  el.node.removeAttribute(OVERRIDE_COLOR_ATTR);
  if (kind === 'nodes') el.fill(defaultColor);
  else el.stroke({ color: defaultColor });
}