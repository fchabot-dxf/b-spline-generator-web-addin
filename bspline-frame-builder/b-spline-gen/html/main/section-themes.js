/**
 * section-themes.js -- F35 item 30 (Fred: "good reason to color code the sections background"). ONE declared table:
 * every sidebar section and every editor right-panel section gets a HUE; everything visible is DERIVED from it
 * (themeTokens) for the light and dark themes -- a soft body tint, a stronger header, a saturated stripe -- so no
 * section ever carries its own hand-picked CSS. The editor reuses the sidebar's hue where it has the matching tab
 * (Frame, Brick, and Artwork = Vector Stamping); the Brick tab's tool sections share the brick hue, each a step
 * lighter or darker (`shade`).
 *
 * STEP 2 (Fred's OK, incl. the editor panels' own headers): applySectionThemes() writes the tokens as CSS custom
 * properties on each section (+ the `section-themed` class); styles/layout-app.css (sidebar) and styles/editor.css
 * (editor panels) read them. Light is applied; the dark tokens are written too (`--section-*-dark`) for the dark
 * theme the app does not have yet -- no CSS reads them today.
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
  // the editor's Photo tab, and Surface > Photo (2026-10-10, the photo layer's own sidebar section)
  photo: { hue: 345 },
});

/** The editor's right panels / sections -> the sidebar theme they share (+ a lightness step within the family). */
export const EDITOR_SECTION_THEMES = Object.freeze({
  // a PANEL: its own grey header (.layers-header) takes the theme's header + stripe (Fred)
  editorFramePanel: { theme: 'frame', part: 'panel' },
  editorLayersPanel: { theme: 'stamp', part: 'panel' },
  editorPhotoPanel: { theme: 'photo', part: 'panel' },
  // Brick-tab v2 (Fred, 2026-10-07): the Wall / Frame / Brush / Raised settings now sit in their own KIND sections
  // (BRICK_SECTION_THEMES below), so the whole-tool tints and the shared 'Brick' header are gone; Stripe has none.
  brickStripeSection: { theme: 'brick', shade: 4 },
});

/** Fred (2026-10-07, Brick-tab v2: "color coded"): the Brick editor's section KINDS (main/brick-tab-sections.js) --
 *  one hue per kind, so the same kind is the same colour in every tab (Joint is always Joint's colour). Derived by
 *  themeTokens like every other section. */
export const BRICK_SECTION_THEMES = Object.freeze({
  'brick-size': { hue: 210 },
  'brick-look': { hue: 150 },
  'brick-crumble': { hue: 70 },
  'brick-random': { hue: 250 },
  'brick-bricks': { hue: 6 },
  'brick-pattern': { hue: 28 },
  'brick-accent': { hue: 330 },
  'brick-corners': { hue: 48 },
  'brick-height': { hue: 285 },
  'brick-joint': { hue: 185 },
  'brick-surround': { hue: 115 },
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
  const theme = SECTION_THEMES[editor ? editor.theme : id] || BRICK_SECTION_THEMES[id];
  if (!theme) return null;
  const shade = (editor && editor.shade) || 0;
  const rules = THEME_RULES[mode] || THEME_RULES.light;
  const hsl = ({ s, l }, dl = 0) => `hsl(${theme.hue} ${s}% ${Math.max(0, Math.min(100, l + dl))}%)`;
  const dl = shade * SHADE_STEP[mode];
  return { body: hsl(rules.body, dl), header: hsl(rules.header, dl * 2), stripe: hsl(rules.stripe), text: hsl(rules.text) };
}

const TOKENS = ['body', 'header', 'stripe', 'text'];
function _writeTokens(el, id) {
  for (const mode of ['light', 'dark']) {
    const k = themeTokens(id, mode);
    for (const t of TOKENS) el.style.setProperty(`--section-${t}${mode === 'dark' ? '-dark' : ''}`, k[t]);
  }
}
/** Step 2: tint every declared section in `doc` -- the main sidebar's `.panel-<id>` and the editor's panels /
 *  Brick sections by id. Returns how many were themed. Idempotent. */
export function applySectionThemes(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return 0;
  let n = 0;
  for (const id of Object.keys(SECTION_THEMES)) {
    for (const el of doc.querySelectorAll(`.cad-sidebar .panel-${id}`)) { _writeTokens(el, id); el.classList.add('section-themed'); n++; }
  }
  for (const [id, def] of Object.entries(EDITOR_SECTION_THEMES)) {
    const el = doc.getElementById(id);
    if (!el) continue;
    _writeTokens(el, id);
    el.classList.add(def.part === 'panel' ? 'section-themed-panel' : 'section-themed-section');
    n++;
  }
  return n;
}

/** Brick-tab v2: tint ONE Brick-editor section by its kind (BRICK_SECTION_THEMES) -- the sections are built at
 *  runtime (main/brick-tab-sections.js), after applySectionThemes ran. */
export function themeBrickSection(el, kind) {
  if (!el || !BRICK_SECTION_THEMES[kind]) return false;
  _writeTokens(el, kind);
  el.classList.add('section-themed-brick');
  return true;
}
