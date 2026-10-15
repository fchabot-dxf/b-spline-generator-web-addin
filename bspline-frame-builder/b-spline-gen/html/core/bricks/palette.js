/**
 * Brick PALETTES (Fred's colour plan 2026-10-14, seat A): one colour per role (core/bricks/colour-roles.js) per
 * element, PAINT ONLY. An element's palette = its role defaults, then its pattern's declared `colours`
 * (library.js patternDefaultsOf), then the user's own (brickSettings.colourByElement[kind][role]; null = the default).
 * The field's default is the element's SET's natural colour (BRICK_SET_COLOURS) -- the set's photo texture stays
 * height detail only, never tinted.
 *
 * Shown only in the Colour look (brickSettings.lookMode === 'colour'; absent = 'height', today's height greys):
 * paletteCss() is the ONE set of rules the 2D view (a <style> outside the sketch layer), the 3D drape (the same
 * rules in its SVG) and the SVG download read -- never written into a brick's own attributes, so the sketch, the
 * height mask and Send's bytes stay identical.
 */
import { patternDefaultsOf, ELEMENT_PATTERN } from './library.js';
import { BRICK_COLOUR_ROLES, BRICK_ROLE_ATTR } from './colour-roles.js';

/** Each brick set's natural colour (its field default), by set id. */
export const BRICK_SET_COLOURS = Object.freeze({
  1: '#a5432e', // Brick 1 (red)
  2: '#b0714f', // Brick 2
  3: '#ece8df', // White rocks
  4: '#8f8f8a', // Grey brick
  5: '#7d7f80', // Grey stone
  6: '#a3a39b', // Grey ashlar
});
/** The roles' defaults when neither the set nor the pattern says (the grout keeps its own paint: groutPaint). */
export const ROLE_DEFAULT_COLOURS = Object.freeze({ field: '#a5432e', motif: '#3f8f72', accent: '#c9a227', stone: '#a3a39b' });
export const LOOK_MODES = Object.freeze(['height', 'colour']);
export const DEFAULT_LOOK_MODE = 'height'; // absent on a saved board = today's view (Fred's fork 1 decides new boards)
export const PALETTE_KINDS = Object.freeze(['wall', 'frame', 'brush']);
export const PALETTE_STYLE_ID = 'brickPaletteStyle';
/** The page event a palette / look change sends (main/app-init.js repaints the 3D drape on it). */
export const BRICK_PALETTE_CHANGED = 'brickPaletteChanged';
/** The roles an element's Colour section lists (its pieces can carry them) and how they read. The Raised brush
 *  paints the Brush's. */
export const ROLES_FOR_KIND = Object.freeze({
  wall: Object.freeze(['field', 'accent']),
  frame: Object.freeze(['field', 'motif', 'accent', 'stone']),
  brush: Object.freeze(['field', 'accent']),
});
export const ROLE_LABELS = Object.freeze({ field: 'Field', motif: 'Motif', accent: 'Accent', stone: 'Stone', grout: 'Grout' }); // grout: its row below the swatches (brick-panel.js syncGroutPaintRow)
const PAINTED_ROLES = BRICK_COLOUR_ROLES.filter((r) => r !== 'grout');

const _setIdOf = (settings, kind) => {
  const ids = (settings && settings.setIds) || {};
  return ids[kind] ?? ids.wall ?? (settings && settings.setId) ?? 1;
};

export function lookModeOf(settings) {
  const m = settings && settings.lookMode;
  return LOOK_MODES.includes(m) ? m : DEFAULT_LOOK_MODE;
}

/** An element's resolved palette {role: hex} (defaults -> its pattern's colours -> the user's own). */
export function paletteOf(settings, kind) {
  const spec = ELEMENT_PATTERN[kind];
  const patternId = spec && settings ? settings[spec.key] : null;
  const fromPattern = (patternId && patternDefaultsOf(kind, patternId).colours) || {};
  const own = (settings && settings.colourByElement && settings.colourByElement[kind]) || {};
  const out = { ...ROLE_DEFAULT_COLOURS, field: BRICK_SET_COLOURS[_setIdOf(settings, kind)] || ROLE_DEFAULT_COLOURS.field };
  for (const role of PAINTED_ROLES) {
    if (fromPattern[role]) out[role] = fromPattern[role];
    if (typeof own[role] === 'string' && /^#[0-9a-f]{6}$/i.test(own[role])) out[role] = own[role];
  }
  return out;
}

/** The colour of one brick node (its kind + role) in a palette set {kind: palette}; null outside the Colour look. */
export function brickPaintOf(settings, kind, role) {
  if (lookModeOf(settings) !== 'colour') return null;
  return paletteOf(settings, kind)[role] || null;
}

/** THE rules: per element kind and role, plus an accent-flagged piece (an uncut accent) as the accent. '' in the
 *  Height look (nothing painted: today's greys). */
export function paletteCss(settings) {
  if (lookModeOf(settings) !== 'colour') return '';
  const rules = [];
  for (const kind of PALETTE_KINDS) {
    const pal = paletteOf(settings, kind);
    for (const role of PAINTED_ROLES) rules.push(`[data-brick="${kind}"][${BRICK_ROLE_ATTR}="${role}"]{fill:${pal[role]} !important}`);
    rules.push(`[data-brick="${kind}"][data-brick-accent="1"]{fill:${pal.accent} !important}`);
  }
  return rules.join('');
}
