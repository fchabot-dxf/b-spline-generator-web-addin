/**
 * lattice-side-column.js — UI2 (Fred: colour-coded lattice panel
 * sections, Generate pinned, hide Shape Lattice's "Fill seed") + UI2
 * AMEND 2, which REPLACES the original ask's simple "pin Generate in
 * its own panel" mechanism (Fred: "maybe the right hand panel is the
 * only panel then"): on DESKTOP there is ONE right-hand column
 * (#editorLayersPanel). It always holds the Layers list; when a tool
 * with its own settings panel is active (Lattice, Shape Lattice), that
 * panel's content MOUNTS into the SAME column instead of opening a
 * second, separate middle column: [pinned Generate] -> [Layers,
 * scrolls] -> [the tool's settings, scrolls] -> [Detach all]. No tool
 * active -> the column shows just Layers, exactly as it always has.
 *
 * HARD CONSTRAINT (stated in both the original dispatch and AMEND 2):
 * no edits to bspline_gen_palette.html — seat B owns that markup in
 * lane-b (T73); a markup change here would be a merge conflict. Every
 * piece of this is CSS (styles/editor.css) plus this ONE runtime
 * module — mounting is a plain DOM move (appendChild/insertBefore) of
 * nodes that already exist in the page, at runtime, never a template
 * change.
 *
 * Mobile is UNCHANGED: the drawer's own tab mechanism (editor-drawer.js)
 * already gives Layers and the active tool their own tabs there, so
 * `_isDesktop()` below gates every mount/unmount off entirely on a
 * narrow or coarse-pointer viewport — this module never touches the
 * drawer's own DOM at all.
 */
import { el } from './dom.js';

// =========================================================================
// 1. Section colour-coding (Fred picked option B from the mockup).
// =========================================================================

/** Declared ONCE: section title -> colour KIND. Anything not listed here
 *  falls through to 'neutral' (Add, Colors, Widths, Seed, Fill seed...).
 *  The dispatch's own wording named "Contour/Border/Shape" for the
 *  outer-shape kind; 'Boundary' is added too since that's this app's
 *  ACTUAL current section title for the same concept (Pick shape / the
 *  Ending rule / show-contour toggle) — neither panel says "Contour"
 *  verbatim today. */
export const SECTION_KIND_BY_TITLE = {
  'Grid & rails': 'rails',
  'Ties': 'ties',
  'Nodes': 'nodes',
  'Contour': 'contour',
  'Border': 'contour',
  'Shape': 'contour',
  'Boundary': 'contour',
};
const DEFAULT_KIND = 'neutral';

export function sectionKindForTitle(title) {
  return SECTION_KIND_BY_TITLE[(title || '').trim()] || DEFAULT_KIND;
}

/** Same bold-span-first-child detection editor-drawer.js's own
 *  _makeSectionsCollapsible already established for "what counts as a
 *  section" — tags every direct child of `bodyEl` that matches with
 *  `data-lattice-section="<kind>"`; CSS (styles/editor.css) does the
 *  actual tint/bar/title-colour look from that attribute alone. */
function _tagSections(bodyEl) {
  for (const section of Array.from(bodyEl.children)) {
    const label = section.firstElementChild;
    if (!label || label.tagName !== 'SPAN') continue;
    if (!/font-weight:\s*600/.test(label.getAttribute('style') || '')) continue;
    section.dataset.latticeSection = sectionKindForTitle(label.textContent);
  }
}

/** The pattern's contour colour has no swatch anywhere in the UI (only
 *  rails/ties/nodes are user-editable, via the Colors row) — it's always
 *  PATTERN_DEFAULTS.colors.contour (editor-lattice-pattern.js). Fixed
 *  here rather than imported, to keep this module's only coupling to the
 *  rest of the editor at the DOM-id level (same reasoning every other
 *  panel-decorator module in this codebase already keeps import-light). */
const CONTOUR_COLOR_RGB = { r: 0x2e, g: 0x7d, b: 0x32 };

const SWATCH_IDS_BY_PANEL = {
  editorLatticePanel: { rails: 'latticeColorRails', ties: 'latticeColorTies', nodes: 'latticeColorNodes' },
  editorShapeLatticePanel: { rails: 'shapeLatticeColorRails', ties: 'shapeLatticeColorTies', nodes: 'shapeLatticeColorNodes' },
};

const FALLBACK_RGB = { r: 136, g: 136, b: 136 };

/** properties-lattice.js/properties-shape-lattice.js write the swatch's
 *  colour as `swatchEl.style.background = colors.rails` (a hex string
 *  from PATTERN_DEFAULTS.colors, e.g. "#c62828"). Reads `.style.
 *  backgroundColor` directly (NOT getComputedStyle, which needs a real
 *  layout engine some lightweight DOM environments don't fully provide)
 *  and accepts either hex or rgb()/rgba() — real browsers normalize a
 *  `.style.background =` hex assignment to rgb() when read back via
 *  `.style.backgroundColor`, but that normalization isn't guaranteed in
 *  every environment this module might run test-side, so both forms are
 *  parsed rather than assumed. */
function _readSwatchRgb(swatchEl) {
  const raw = (swatchEl.style.backgroundColor || swatchEl.style.background || '').trim();
  const hexMatch = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hexMatch) {
    const n = parseInt(hexMatch[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgbMatch = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(raw);
  if (rgbMatch) return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };
  return FALLBACK_RGB;
}

/** Sets BOTH the solid colour (the section's left bar + title text) and
 *  a ~12% tint (the section's own background) as CSS custom properties
 *  on `bodyEl` itself — inherited by every tagged section inside it
 *  regardless of which parent `bodyEl` currently lives under (its own
 *  panel, or mounted into the side column), so colour tracking survives
 *  the AMEND 2 mount/unmount moves for free. */
function _applyKindColor(bodyEl, kind, { r, g, b }) {
  bodyEl.style.setProperty(`--kind-${kind}`, `rgb(${r}, ${g}, ${b})`);
  bodyEl.style.setProperty(`--kind-${kind}-tint`, `rgba(${r}, ${g}, ${b}, 0.12)`);
}

/** Live sync (Fred: the bar colour "follows the Colors row live") — a
 *  MutationObserver on each swatch's own `style` attribute, since
 *  properties-lattice.js/properties-shape-lattice.js already write
 *  `swatchEl.style.background = colors.rails` on every pattern
 *  read-back (layer switch, Generate, a colour pick) with no event of
 *  its own to listen for instead. Observing the swatch rather than
 *  hooking into those two modules keeps this file's ENTIRE UI2
 *  implementation in one place, per the dispatch's own "one decorator
 *  module" — no edits to either properties-*.js file. */
function _wireLiveColors(panelId, bodyEl) {
  _applyKindColor(bodyEl, 'contour', CONTOUR_COLOR_RGB);
  const swatchIds = SWATCH_IDS_BY_PANEL[panelId];
  if (!swatchIds) return;
  for (const [kind, id] of Object.entries(swatchIds)) {
    const swatchEl = el(id);
    if (!swatchEl) continue;
    const sync = () => _applyKindColor(bodyEl, kind, _readSwatchRgb(swatchEl));
    sync();
    new MutationObserver(sync).observe(swatchEl, { attributes: true, attributeFilter: ['style'] });
  }
}

// =========================================================================
// 2. Hide Shape Lattice's "Fill seed" section (Generate already rolls a
//    fresh fill seed on every press — see that section's own title bar).
// =========================================================================
function _hideSectionByTitle(bodyEl, title) {
  for (const section of Array.from(bodyEl.children)) {
    const label = section.firstElementChild;
    if (label && label.tagName === 'SPAN' && label.textContent.trim() === title) {
      section.style.display = 'none';
      return;
    }
  }
}

// =========================================================================
// 3. AMEND 2 — mount the active tool's panel content into the ONE
//    right-hand column (#editorLayersPanel) on desktop.
// =========================================================================

/** Declared ONCE — the column's own mount points, and which element of
 *  each tool panel goes into which one. Adding a third tool panel later
 *  (the dispatch's own "any other tool panel that today opens as its
 *  own middle column") is one more entry here, not new mount/unmount
 *  code. */
const TOOL_PANEL_MOUNTS = {
  lattice: {
    panelId: 'editorLatticePanel',
    bodyId: 'editorLatticePanelBody',
    footerId: 'editorLatticePanelFooter',
    generateId: 'latticeGenerate',
    detachAllId: 'latticeDetachAll',
  },
  shapeLattice: {
    panelId: 'editorShapeLatticePanel',
    bodyId: 'editorShapeLatticePanelBody',
    footerId: 'editorShapeLatticePanelFooter',
    generateId: 'shapeLatticeGenerate',
    detachAllId: 'shapeLatticeDetachAll',
  },
};

// Same shared breakpoint bucket editor-drawer.js's own landscape query
// and MOB5's compact-row CSS already use — "coarse+narrow (portrait) OR
// coarse+short (landscape)" is this app's one declared definition of
// "mobile," checked here rather than re-derived, so a future change to
// either breakpoint can't quietly leave this module disagreeing with
// the drawer about what counts as mobile.
const MOBILE_MEDIA_QUERY = '(max-width: 720px), (pointer: coarse) and (max-height: 500px) and (min-width: 721px)';
function _isDesktop() {
  return !window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

let _mountedMode = null;

function _unmount(mode) {
  const cfg = TOOL_PANEL_MOUNTS[mode];
  if (!cfg) return;
  const panelEl = el(cfg.panelId);
  const bodyEl = el(cfg.bodyId);
  const footerEl = el(cfg.footerId);
  const generateEl = el(cfg.generateId);
  const detachAllEl = el(cfg.detachAllId);
  if (panelEl && bodyEl) panelEl.insertBefore(bodyEl, footerEl || null);
  if (footerEl && generateEl) footerEl.insertBefore(generateEl, footerEl.firstChild);
  if (footerEl && detachAllEl) footerEl.appendChild(detachAllEl);
  // Clears the inline override this module itself added in _mount — the
  // panel goes back to relying purely on editor-ui.js's own
  // TOOLBAR_GROUPS `.hidden` class, same as before this module existed.
  if (panelEl) panelEl.style.display = '';
  _mountedMode = null;
}

function _mount(mode, layersPanelEl) {
  const cfg = TOOL_PANEL_MOUNTS[mode];
  if (!cfg) return;
  const panelEl = el(cfg.panelId);
  const bodyEl = el(cfg.bodyId);
  const generateEl = el(cfg.generateId);
  const detachAllEl = el(cfg.detachAllId);
  if (!panelEl || !bodyEl) return;
  const layersList = layersPanelEl.querySelector('.layers-list');
  // Order: [pinned Generate] -> [layers-header + layers-list, untouched]
  // -> [this tool's own settings body] -> [Detach all].
  if (generateEl) layersPanelEl.insertBefore(generateEl, layersPanelEl.firstChild);
  layersPanelEl.insertBefore(bodyEl, layersList ? layersList.nextSibling : null);
  if (detachAllEl) layersPanelEl.appendChild(detachAllEl);
  // The original middle column is now an empty shell (its own header +
  // now-vacated footer) — force it out of layout so the canvas reclaims
  // the width, regardless of what TOOLBAR_GROUPS' own `.hidden` class
  // (editor-ui.js) currently says for this mode.
  panelEl.style.display = 'none';
  _mountedMode = mode;
}

function _syncMount(mode) {
  const layersPanelEl = el('editorLayersPanel');
  if (!layersPanelEl) return;
  const desktop = _isDesktop();
  if (_mountedMode && (_mountedMode !== mode || !desktop)) {
    _unmount(_mountedMode);
  }
  if (desktop && TOOL_PANEL_MOUNTS[mode] && _mountedMode !== mode) {
    _mount(mode, layersPanelEl);
  }
}

// =========================================================================
// Init
// =========================================================================
export function initLatticeSideColumn(editor) {
  for (const cfg of Object.values(TOOL_PANEL_MOUNTS)) {
    const bodyEl = el(cfg.bodyId);
    if (!bodyEl) continue;
    _tagSections(bodyEl);
    _wireLiveColors(cfg.panelId, bodyEl);
  }
  const shapeBody = el(TOOL_PANEL_MOUNTS.shapeLattice.bodyId);
  if (shapeBody) _hideSectionByTitle(shapeBody, 'Fill seed');

  let lastMode = null;
  document.addEventListener('editorModeChanged', (e) => {
    if (!e.detail || e.detail.editor !== editor) return;
    lastMode = e.detail.mode;
    _syncMount(lastMode);
  });
  // A live resize can cross the desktop/mobile breakpoint while a tool
  // panel is already mounted (or, on mobile, while it was never
  // supposed to be) — re-evaluate against whatever mode is current.
  window.addEventListener('resize', () => {
    if (lastMode !== null) _syncMount(lastMode);
  });
}
