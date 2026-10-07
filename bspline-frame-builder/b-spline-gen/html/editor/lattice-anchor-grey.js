/**
 * editor/lattice-anchor-grey.js -- item 74h (Fred: grey + explain, the 74b precedent): a Lattice / Shape Lattice rails
 * anchor (Start / Center / End) is greyed, with why, while it would lay the SAME rails as the current one at the panel's
 * spacing / count (measured: T1 at 1 in spacing, all three laid the same 9 rails). The fact is the rail plan's
 * (editor-lattice-pattern.js railAnchorsSameAsCurrent) on the span the last Generate stored -- nothing is laid; the
 * current anchor is never greyed. A detection signal, not a clamp: it comes back live when the spacing changes.
 */
import { el } from './dom.js';
import { getActiveLayer } from './layers.js';
import { resolvePatternLayer, railAnchorsSameAsCurrent, RAIL_ANCHORS, PATTERN_DEFAULTS } from './editor-lattice-pattern.js';

export const SAME_RAILS_WHY = 'Same rails as the current anchor at this spacing';
const BUTTON = { start: 'RailsAnchorStart', center: 'RailsAnchorCenter', end: 'RailsAnchorEnd' };

/** The active layer's pattern, never created here (the panels' own accessors make one on an empty layer). */
function _patternReadOnly(editor) {
  const id = getActiveLayer(editor);
  const layer = id != null ? resolvePatternLayer(editor, id) : null;
  return layer ? layer.pattern : null;
}

/** Grey / un-grey one panel's anchor row (`prefix` = 'lattice' | 'shapeLattice') from its live fields. */
export function syncAnchorGrey(editor, prefix) {
  const btn = Object.fromEntries(RAIL_ANCHORS.map((a) => [a, el(prefix + BUTTON[a])]));
  if (!btn.center) return;
  const p = _patternReadOnly(editor);
  const current = RAIL_ANCHORS.find((a) => btn[a] && btn[a].classList.contains('active')) || 'center';
  const num = (id) => { const v = parseFloat(el(prefix + id)?.value); return Number.isFinite(v) ? v : null; };
  const rails = { ...PATTERN_DEFAULTS.rails, ...((p && p.rails) || {}), mode: 'spacing', anchor: current };
  if (num('RailsSpacing') != null) rails.spacing = num('RailsSpacing');
  const count = num('RailsSpacingCount'); rails.spacingCount = count != null && count > 0 ? Math.round(count) : null;
  const same = p ? railAnchorsSameAsCurrent(p.railSpan, rails, p.spacing || PATTERN_DEFAULTS.spacing) : {};
  for (const a of RAIL_ANCHORS) {
    const b = btn[a]; if (!b) continue;
    if (b.dataset.ownTitle === undefined) b.dataset.ownTitle = b.title || '';
    b.disabled = !!same[a];
    b.title = same[a] ? SAME_RAILS_WHY : b.dataset.ownTitle;
  }
}

/** Keep one panel's row in step: its own anchor / spacing / count edits, every commit (a Generate stores a new span),
 *  a layer switch, and a 74d settings restore (an Undo of an anchor or spacing change). */
export function initAnchorGrey(editor, prefix) {
  const sync = () => syncAnchorGrey(editor, prefix);
  for (const a of RAIL_ANCHORS) el(prefix + BUTTON[a])?.addEventListener('click', () => queueMicrotask(sync));
  for (const id of ['RailsSpacing', 'RailsSpacingCount']) { const n = el(prefix + id); n?.addEventListener('input', sync); n?.addEventListener('change', sync); }
  if (typeof document !== 'undefined') {
    for (const type of ['editorCommit', 'editorLayersChanged', 'nextSettingsRestored']) document.addEventListener(type, () => queueMicrotask(sync));
  }
  sync();
}
