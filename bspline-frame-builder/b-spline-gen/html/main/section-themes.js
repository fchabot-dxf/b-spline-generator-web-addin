/**
 * section-themes.js -- F35 item 30 (Fred: "good reason to color code the sections background"). ONE declared table:
 * every sidebar section and every editor right-panel section gets a HUE; everything visible is DERIVED from it
 * (themeTokens) for the light and dark themes -- a soft body tint, a stronger header, a saturated stripe -- so no
 * section ever carries its own hand-picked CSS. The editor reuses the sidebar's hue where it has the matching tab
 * (Frame, Brick, and Artwork = Vector Stamping); the Brick tab's tool sections share the brick hue, each a step
 * lighter or darker (`shade`).
 *
 * STEP 1 (this file): declaration + the derivation only, rendered on a tint sheet for Fred's look. Not imported by
 * the app yet -- STEP 2 wires it (on his OK) by writing the tokens as CSS custom properties per section.
 */
export const SECTION_THEMES = Object.freeze({
  // main sidebar (.panel-<id>)
  stock: { hue: 210 },
  frame: { hue: 28 },
  skeleton: { hue: 265 },
  filter: { hue: 175 },
  brick: { hue: 6 },
  stamp: { hue: 135 }, // Vector Stamping = the editor's Artwork tab
  'sculpt-top': { hue: 320 },
  thicken: { hue: 48 },
  'sculpt-bot': { hue: 295 },
  view: { hue: 195 },
  export: { hue: 90 },
  resolution: { hue: 235 },
  // editor-only
  photo: { hue: 345 },
});

/** The editor's right panels / sections -> the sidebar theme they share (+ a lightness step within the family). */
export const EDITOR_SECTION_THEMES = Object.freeze({
  editorFramePanel: { theme: 'frame' },
  editorLayersPanel: { theme: 'stamp' },
  editorPhotoPanel: { theme: 'photo' },
  brickWallSection: { theme: 'brick', shade: 0 },
  brickFrameSection: { theme: 'brick', shade: 1 },
  brickBrushSection: { theme: 'brick', shade: 2 },
  brickRaisedSection: { theme: 'brick', shade: 3 },
  brickStripeSection: { theme: 'brick', shade: 4 },
});

/** Derivation rules (HSL), one per token and theme. `shade` shifts lightness by SHADE_STEP per step. */
export const THEME_RULES = Object.freeze({
  light: { body: { s: 60, l: 97 }, header: { s: 55, l: 90 }, stripe: { s: 60, l: 52 }, text: { s: 45, l: 28 } },
  dark: { body: { s: 22, l: 15 }, header: { s: 28, l: 21 }, stripe: { s: 55, l: 58 }, text: { s: 50, l: 82 } },
});
const SHADE_STEP = { light: -1.2, dark: 1.2 };

/** { body, header, stripe, text } CSS colours for a theme id (or an editor section id) in 'light' | 'dark'. */
export function themeTokens(id, mode = 'light') {
  const editor = EDITOR_SECTION_THEMES[id];
  const theme = SECTION_THEMES[editor ? editor.theme : id];
  if (!theme) return null;
  const shade = (editor && editor.shade) || 0;
  const rules = THEME_RULES[mode] || THEME_RULES.light;
  const hsl = ({ s, l }, dl = 0) => `hsl(${theme.hue} ${s}% ${Math.max(0, Math.min(100, l + dl))}%)`;
  const dl = shade * SHADE_STEP[mode];
  return { body: hsl(rules.body, dl), header: hsl(rules.header, dl * 2), stripe: hsl(rules.stripe), text: hsl(rules.text) };
}
