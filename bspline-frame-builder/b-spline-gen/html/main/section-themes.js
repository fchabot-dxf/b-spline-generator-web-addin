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
  layers: { hue: 115 }, // the permanent Layers panel (c64a466, 2026-10-14): its own green, clear of Vector stamping's 135
  frame: { hue: 28 },
  skeleton: { hue: 265 },
  filter: { hue: 175 },
  band: { hue: 343 }, // the FLATTEN BAND (Fred 2026-11-25): in the widest free gap, between Sculpt top 320 and Brick 6
  brick: { hue: 6 },
  stamp: { hue: 135 }, // Vector Stamping = the editor's Artwork tab
  'sculpt-top': { hue: 320 },
  stl: { hue: 75 }, // STL stamp (STL-RELIEF-DESIGN.md): its own, clear of Thicken's 48 and Export's 90
  thicken: { hue: 48 },
  'sculpt-bot': { hue: 295 },
  view: { hue: 195 },
  export: { hue: 90 },
  resolution: { hue: 235 },
  // the LAYER STACK's card kinds with no sidebar section of their own (Fred 2026-11-23, main/layer-stack.js LAYER_TYPES):
  // a Lattice layer and a Height patch (clear of Shape 265 / Bottom 295). Lattice (Fred 2026-11-24: "clearly different"
  // from Draw's 135 green; was 155): TEAL, in the widest gap between the layer stack's own kinds (Draw 135 .. Height 280),
  // between Texture 175 and View 195, and clear of the UI's blues (--cad-accent 216, --cad-accent-blue 199)
  lattice: { hue: 185 },
  height: { hue: 280 },
});

/** Fred 2026-10-16 (the job timeline's chips: icon-on-colour, no text): one declared icon per SECTION_THEMES id,
 *  the SAME glyph the sidebar panel header already shows (bspline_gen_palette.html) -- reused, not reinvented.
 *  main/job-timeline-strip.js reads this + SECTION_THEMES' hue so a chip never carries its own hand-picked look. */
export const SECTION_ICONS = Object.freeze({
  // skeleton = TERRAIN SHAPE's ⛰ since TERRAIN-FLAT (2026-11-22); filter = TERRAIN TEXTURE
  stock: '📐', layers: '📑', frame: '🖼', skeleton: '⛰️', filter: '🎨', brick: '🧱', stamp: '📐',
  band: '🔳', 'sculpt-top': '🎨', stl: '🗿', thicken: '⛓️', 'sculpt-bot': '🎨', view: '👁️', export: '📩', resolution: '⚙️',
  lattice: '🕸️', height: '🎚️', // the layer stack's card kinds (the mockup's Height glyph)
});

/** A SECTION_THEMES hue as a flat CSS colour (not themeTokens' body/header/stripe/text derivation, which is for
 *  TINTING a whole panel) -- job-timeline-strip.js's chips want ONE saturated, readable-on-white colour per
 *  section, the same role JOB_STEP_KINDS' own (now-retired) per-kind `color` literal used to play. */
export function sectionColor(id) {
  const theme = SECTION_THEMES[id];
  return theme ? `hsl(${theme.hue}, 55%, 42%)` : '#607d8b';
}

/** The editor's right panels / sections -> the sidebar theme they share (+ a lightness step within the family). */
export const EDITOR_SECTION_THEMES = Object.freeze({
  // a PANEL: its own grey header (.layers-header) takes the theme's header + stripe (Fred)
  editorFramePanel: { theme: 'frame', part: 'panel' },
  editorLayersPanel: { theme: 'stamp', part: 'panel' },
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
  'brick-colour': { hue: 25 }, // Fred 2026-10-15: each element's Colour section
  'brick-crumble': { hue: 70 },
  'brick-random': { hue: 250 },
  'brick-bricks': { hue: 6 },
  'brick-pattern': { hue: 28 },
  'brick-accent': { hue: 330 },
  'brick-fan-centre': { hue: 48 }, // was brick-corners (the Corners picker, retired 2026-10-11)
  'brick-height': { hue: 285 },
  'brick-joint': { hue: 185 },
  'brick-surround': { hue: 115 },
});

/** EDITOR CARDS, one style (Fred 2026-11-24, option A): every 2D-editor collapse-tree card (main/drawer-tree.js
 *  .drawer-branch) wears the sidebar's coloured panel look -- header, stripe, body -- in SHADES of the colour its tab's
 *  layer has in the layer stack (main/layer-stack.js LAYER_TYPES[...].theme), so the colour also says which layer you
 *  are editing. Calm: one hue per tab, the cards told apart by a lightness step only.
 *    tree id -> { theme: a SECTION_THEMES id, tool: the shade of any TOOL card (armsTool), shades: { branch id: shade } }
 *  A branch not listed takes shade 0. A `flat` branch (main/drawer-tree.js: the Brick element + General groups) is no
 *  card and takes no tint: its BRICK_SECTION_THEMES sections are the cards. */
export const EDITOR_CARD_THEMES = Object.freeze({
  drawDrawerTree: Object.freeze({ theme: 'stamp', tool: 0, shades: Object.freeze({ general: 1, stamp: 3 }) }), // (Layers retired: the editor layer stack)
  latticeDrawerTree: Object.freeze({ theme: 'lattice', tool: 0, shades: Object.freeze({ boundary: 0, rails: 1, ties: 2, nodes: 3, look: 4 }) }),
  shapeLatticeDrawerTree: Object.freeze({ theme: 'lattice', tool: 0, shades: Object.freeze({ boundary: 0, contour: 1, rails: 1, ties: 2, nodes: 3, look: 4 }) }),
  brickDrawerTree: Object.freeze({ theme: 'brick', tool: 0, shades: Object.freeze({}) }), // (its Layers card retired: the editor layer stack)
  heightDrawerTree: Object.freeze({ theme: 'height', tool: 0, shades: Object.freeze({ patch: 1, view: 2, stamp: 3, selection: 1, place: 2, file: 3 }) }),
});

/** Derivation rules (HSL), one per token and theme. `shade` shifts lightness by SHADE_STEP per step. */
export const THEME_RULES = Object.freeze({
  light: { body: { s: 60, l: 97 }, header: { s: 55, l: 90 }, stripe: { s: 60, l: 52 }, text: { s: 45, l: 28 } },
  dark: { body: { s: 22, l: 15 }, header: { s: 28, l: 21 }, stripe: { s: 55, l: 58 }, text: { s: 50, l: 82 } },
});
const SHADE_STEP = { light: -1.2, dark: 1.2 };

/** { body, header, stripe, text } CSS colours for a theme id (or an editor section id) in 'light' | 'dark'; `shadeOverride`
 *  (an editor card's step, EDITOR_CARD_THEMES) replaces the editor section's own shade. */
export function themeTokens(id, mode = 'light', shadeOverride = null) {
  const editor = EDITOR_SECTION_THEMES[id];
  const theme = SECTION_THEMES[editor ? editor.theme : id] || BRICK_SECTION_THEMES[id];
  if (!theme) return null;
  const shade = shadeOverride != null ? shadeOverride : (editor && editor.shade) || 0;
  const rules = THEME_RULES[mode] || THEME_RULES.light;
  const hsl = ({ s, l }, dl = 0) => `hsl(${theme.hue} ${s}% ${Math.max(0, Math.min(100, l + dl))}%)`;
  const dl = shade * SHADE_STEP[mode];
  return { body: hsl(rules.body, dl), header: hsl(rules.header, dl * 2), stripe: hsl(rules.stripe), text: hsl(rules.text) };
}

const TOKENS = ['body', 'header', 'stripe', 'text'];
function _writeTokens(el, id, shade = null) {
  for (const mode of ['light', 'dark']) {
    const k = themeTokens(id, mode, shade);
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

/** The layer stack (main/layer-stack.js): tint ONE card built at runtime by a SECTION_THEMES id, exactly as
 *  applySectionThemes tints a sidebar section (the same tokens + `section-themed`, so the sidebar's own themed-section
 *  CSS draws its stripe, header and body). */
export function themeSectionEl(el, id) {
  if (!el || !SECTION_THEMES[id]) return false;
  _writeTokens(el, id);
  el.classList.add('section-themed');
  return true;
}

/** EDITOR_CARD_THEMES' { theme, shade } for a card of tree `treeId` (null: the tree is not declared). */
export function editorCardTheme(treeId, branchId, isTool = false) {
  const t = EDITOR_CARD_THEMES[treeId];
  if (!t) return null;
  const shade = isTool ? t.tool : (t.shades[branchId] ?? 0);
  return { theme: t.theme, shade };
}

/** Tint ONE editor card (main/drawer-tree.js builds them at runtime) as EDITOR_CARD_THEMES declares: the same tokens as
 *  a sidebar section + `section-themed-card` (styles/editor.css). */
export function themeEditorCard(el, treeId, branchId, isTool = false) {
  const t = editorCardTheme(treeId, branchId, isTool);
  if (!el || !t || !SECTION_THEMES[t.theme]) return false;
  _writeTokens(el, t.theme, t.shade);
  el.classList.add('section-themed-card');
  return true;
}

/** Brick-tab v2: tint ONE Brick-editor section by its kind (BRICK_SECTION_THEMES) -- the sections are built at
 *  runtime (main/brick-tab-sections.js), after applySectionThemes ran. */
export function themeBrickSection(el, kind) {
  if (!el || !BRICK_SECTION_THEMES[kind]) return false;
  _writeTokens(el, kind);
  el.classList.add('section-themed-brick');
  return true;
}
