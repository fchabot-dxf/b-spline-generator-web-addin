/**
 * editor-piece-override.js — UI5 items 1-4 (Fred, via advisor): per-piece
 * colour/width overrides for a single selected rail/tie/node, independent
 * of the layer's own Colors/Widths panel defaults. "Declared data schema
 * on the piece: data-override-color / data-override-width (ONE schema
 * module)" — this file IS that module: the two attribute names, plus the
 * apply/clear/read helpers every other file that touches an override goes
 * through, so the schema itself never gets duplicated or drifts between
 * the panel that writes it (lattice-side-column.js) and the sweeps that
 * must skip it (editor-lattice-pattern.js's recolorOwnedKind/
 * rewidthOwnedKind(s)). No imports of its own — a plain attribute-name +
 * DOM-read/write module, safe to import from anywhere without a
 * circular-dependency risk.
 *
 * Scope decision (UI5, this turn): rails/ties/nodes only. A CONTOUR
 * segment already has its OWN, older per-segment colour mechanism
 * (`PATTERN.contour.segmentColors[i]`, properties-shape-lattice.js) with
 * the OPPOSITE persistence rule this feature's own item 3 asks for —
 * Fred's existing per-segment style is designed to SURVIVE a same-
 * topology Regenerate (you style a segment once, it stays styled), while
 * item 3 wants a plain override CLEARED by Regenerate. Reusing this
 * module's attributes for contour too would mean picking one of those two
 * behaviours and silently breaking whichever feature didn't get it — left
 * as a flagged follow-up (WORK-LOG) rather than guessed at.
 */
export const OVERRIDE_COLOR_ATTR = 'data-override-color';
export const OVERRIDE_WIDTH_ATTR = 'data-override-width';

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
export function hasWidthOverride(el) {
  return !!(el && el.node && el.node.hasAttribute(OVERRIDE_WIDTH_ATTR));
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

/** Sizes `el` the same way rewidthOwnedKind's own per-kind dispatch does
 *  (a node's `r` is a RADIUS, `value` here is the diameter the panel's
 *  stepper shows — the same diameter-in/radius-out split rewidthOwnedKind
 *  itself uses), then stamps the override attribute. */
export function applyWidthOverride(el, kind, value) {
  if (kind === 'nodes') el.attr('r', value / 2);
  else el.attr('stroke-width', value);
  el.attr(OVERRIDE_WIDTH_ATTR, value);
}

/** Removes the colour override and repaints `el` with `defaultColor` —
 *  the value recolorOwnedKind would have applied all along had this piece
 *  never been overridden. */
export function clearColorOverride(el, kind, defaultColor) {
  el.node.removeAttribute(OVERRIDE_COLOR_ATTR);
  if (kind === 'nodes') el.fill(defaultColor);
  else el.stroke({ color: defaultColor });
}

/** Removes the width override and re-sizes `el` with `defaultValue`
 *  (a diameter, matching applyWidthOverride's own units). */
export function clearWidthOverride(el, kind, defaultValue) {
  el.node.removeAttribute(OVERRIDE_WIDTH_ATTR);
  if (kind === 'nodes') el.attr('r', defaultValue / 2);
  else el.attr('stroke-width', defaultValue);
}
