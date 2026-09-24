/**
 * SE9 / T28: the declared color palette for the per-element color control.
 * VECTOR_COLORS is declared as ROWS (one row per hue, 4 shades each) so
 * the toolbar's dropdown mosaic lays its cells out straight from this
 * data — never a second hand-typed grid to drift from it. 8 hues x 4
 * shades = 32 swatches. Fred's own piece (black/red/yellow/navy) is kept
 * verbatim inside the grid rather than bolted on separately: red
 * '#c62828' and yellow '#f9c80e' are each their hue row's own base shade,
 * navy '#1a237e' is the Blue row's darkest shade, black '#000000' is the
 * Neutral row's darkest shade.
 */
export const VECTOR_COLORS = [
  ['#ef9a9a', '#e53935', '#c62828', '#7f0000'], // Red
  ['#ffcc80', '#fb8c00', '#ef6c00', '#c43e00'], // Orange
  ['#fff59d', '#ffd600', '#f9c80e', '#b28704'], // Yellow
  ['#a5d6a7', '#66bb6a', '#2e7d32', '#1b5e20'], // Green
  ['#80cbc4', '#26a69a', '#00796b', '#004d40'], // Teal
  ['#90caf9', '#42a5f5', '#1565c0', '#1a237e'], // Blue
  ['#ce93d8', '#ab47bc', '#6a1b9a', '#4a148c'], // Purple
  ['#ffffff', '#bdbdbd', '#616161', '#000000'], // Neutral
];

/** T28: the color mosaic's "recent" row — last RECENT_COLORS_CAP colors
 *  picked, per-viewer, most-recent-first, deduped (re-picking a color
 *  already in the list moves it to front rather than repeating it). Same
 *  load/merge/save split as editor-grid.js's grid prefs (mergeGridPrefs):
 *  mergeRecentColors is pure so the ordering/cap logic is testable
 *  without mocking localStorage. */
const RECENT_COLORS_KEY = 'bsg.editorRecentColors';
export const RECENT_COLORS_CAP = 4;

export function mergeRecentColors(existing, hex) {
  const rest = (Array.isArray(existing) ? existing : []).filter((c) => c !== hex);
  if (!hex) return rest.slice(0, RECENT_COLORS_CAP);
  return [hex, ...rest].slice(0, RECENT_COLORS_CAP);
}

export function loadRecentColors() {
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, RECENT_COLORS_CAP) : [];
  } catch (_) {
    return [];
  }
}

export function saveRecentColors(list) {
  try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(list)); } catch (_) {}
}

/** Load, merge `hex` in, save, and return the updated list — the one
 *  call properties-shape.js makes after every pick (mosaic cell, recent
 *  cell, or the native custom picker). */
export function addRecentColor(hex) {
  const updated = mergeRecentColors(loadRecentColors(), hex);
  saveRecentColors(updated);
  return updated;
}
