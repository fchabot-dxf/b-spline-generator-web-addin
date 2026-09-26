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
import { el, on } from './dom.js';

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

// UI2-FIX (Fred, live screenshot on the merged AMEND 2: scrolled content
// — the Ties "Cells/Rails" row and controls above it — visibly peeked
// out from behind the pinned Generate bar). The BUTTON's own rounded
// corners (`.cad-btn-primary`'s `border-radius`) don't cover a full
// rectangular band — scrolled content shows through the corner gaps.
// Generate is wrapped in its OWN plain-rectangle slot div so the STICKY
// element is a full-width square backdrop, with the rounded button
// floating inside it, not the button itself. PINNED_SLOT_CLASS is kept
// as an identifying hook (closest() in _unmount, below) — the actual
// visual styling comes from `sticky-actions` (UI4 AMEND 4b: ONE shared
// pinned-action style, also applied to the main sidebar's own "Generate
// New Seed" card in bspline_gen_palette.html, layout-app.css). Its
// negative margins + top:-14px compensate for the `aside` tag rule's own
// 14px padding on THIS column too (#editorLayersPanel is itself an
// `<aside>`) — confirmed live: without it, "Grid & rails"'s own title
// bar peeked through a 14px gap above Generate while scrolled, the exact
// bug Fred reported on the main sidebar's card.
const PINNED_SLOT_CLASS = 'lattice-side-column-pinned-slot';

let _mountedMode = null;

function _unmount(mode) {
  const cfg = TOOL_PANEL_MOUNTS[mode];
  if (!cfg) return;
  const panelEl = el(cfg.panelId);
  const bodyEl = el(cfg.bodyId);
  const footerEl = el(cfg.footerId);
  const generateEl = el(cfg.generateId);
  const detachAllEl = el(cfg.detachAllId);
  // generateEl is found by id regardless of which parent currently
  // wraps it — closest() unwraps it from the pinned slot before that
  // slot (created fresh on every _mount) is discarded below.
  const pinnedSlot = generateEl ? generateEl.closest('.' + PINNED_SLOT_CLASS) : null;
  if (panelEl && bodyEl) panelEl.insertBefore(bodyEl, footerEl || null);
  if (footerEl && generateEl) footerEl.insertBefore(generateEl, footerEl.firstChild);
  if (footerEl && detachAllEl) footerEl.appendChild(detachAllEl);
  if (pinnedSlot) pinnedSlot.remove();
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
  // Order: [pinned Generate, in its own opaque slot] -> [layers-header +
  // layers-list, untouched] -> [this tool's own settings body] -> [Detach all].
  if (generateEl) {
    const pinnedSlot = document.createElement('div');
    pinnedSlot.className = PINNED_SLOT_CLASS + ' sticky-actions';
    pinnedSlot.appendChild(generateEl);
    layersPanelEl.insertBefore(pinnedSlot, layersPanelEl.firstChild);
  }
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
// 4. UI3 (Fred: "like in main side bar, make lattice section collapsible")
//    — collapsible sections, reusing the EXACT mechanism editor-drawer.js
//    used to own privately (bold-span-first-child sections, a real DOM-
//    node chevron, localStorage persistence keyed by title) — moved HERE
//    and un-gated from mobile-only, since this module already owns every
//    other "what counts as a lattice panel section" concern (_tagSections/
//    _wireLiveColors/_hideSectionByTitle above); collapsing is the SAME
//    declared pattern applied on BOTH desktop and mobile now, not a
//    second one. editor-drawer.js no longer wires this itself.
// =========================================================================
const SECTION_STATE_PREFIX = 'bspline.editor.drawerSection.'; // unchanged key: desktop and mobile share one remembered state per section title.

function _loadSectionOpen(label, defaultOpen) {
  try {
    const raw = localStorage.getItem(SECTION_STATE_PREFIX + label);
    return raw === null ? defaultOpen : raw === '1';
  } catch (_) {
    return defaultOpen;
  }
}
function _saveSectionOpen(label, open) {
  try { localStorage.setItem(SECTION_STATE_PREFIX + label, open ? '1' : '0'); } catch (_) { /* same as above */ }
}

/** Wires one section's label as a click-to-collapse toggle for the rest
 *  of its own children — shared tail for both `_makeSectionsCollapsible`
 *  (a real bold-span section) and `_makeLayersCollapsible` (the Layers
 *  header + list, a different DOM shape but the same behaviour). `title`
 *  is the persistence key; `label` gets the chevron + click handler;
 *  `body` is the list of sibling nodes the toggle shows/hides. */
function _wireCollapse(title, label, body) {
  // Captured BEFORE any toggle ever runs — most of these rows declare
  // their own layout inline (`style="display:flex; ..."`, no CSS class
  // backing it), so `node.style.display = ''` does NOT restore "flex" the
  // way it would for a class-driven display; it just clears the inline
  // override entirely and the element falls back to its TAG's own
  // default (`block` for a bare `<div>`). Restoring the ORIGINAL captured
  // value (not bare '') is what editor-drawer.js's own prior version of
  // this already had to fix (MOB5: the Colors row's 3 swatches silently
  // stacked into a column on the very first render otherwise).
  const bodyOriginalDisplay = body.map((node) => node.style.display);
  const chevron = document.createElement('span');
  chevron.className = 'lattice-section-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▾';
  label.style.cursor = 'pointer';
  label.style.display = 'flex';
  label.style.alignItems = 'center';
  label.style.justifyContent = 'space-between';
  label.appendChild(chevron);

  const applyOpen = (open) => {
    body.forEach((node, i) => { node.style.display = open ? bodyOriginalDisplay[i] : 'none'; });
    chevron.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)';
  };
  let open = _loadSectionOpen(title, true);
  applyOpen(open);
  on(label, 'click', () => {
    open = !open;
    applyOpen(open);
    _saveSectionOpen(title, open);
  });
}

/** Walks every direct child of `bodyEl` and makes the ones matching the
 *  bold-span-first-child section shape collapsible. `data-no-collapse`
 *  opts a section out — AMEND 1's new icon tool row (replacing Add:) must
 *  always stay visible, same as Add: itself always was. */
function _makeSectionsCollapsible(bodyEl) {
  if (!bodyEl) return;
  for (const section of Array.from(bodyEl.children)) {
    if (section.hasAttribute('data-no-collapse')) continue;
    const label = section.firstElementChild;
    if (!label || label.tagName !== 'SPAN' || !/font-weight:\s*600/.test(label.getAttribute('style') || '')) continue;
    const title = label.textContent.trim();
    if (!title || section.dataset.collapsibleInit) continue;
    section.dataset.collapsibleInit = '1';
    _wireCollapse(title, label, Array.from(section.children).filter((c) => c !== label));
  }
}

/** UI3: "the Layers block in the side column is collapsible too" — same
 *  mechanism, applied to #editorLayersPanel's own static header+list
 *  (bspline_gen_palette.html markup — can't be edited) instead of a
 *  bold-span section: the header's own `<span>Layers</span>` becomes the
 *  clickable/chevron-bearing label, collapsing the SIBLING `.layers-list`.
 *  Scoped to the label itself (not the whole `.layers-header`), so
 *  `#editorAddLayer`'s own `+` button, a header SIBLING of the label,
 *  keeps its own click handler completely undisturbed. */
function _makeLayersCollapsible(layersPanelEl) {
  if (!layersPanelEl) return;
  const header = layersPanelEl.querySelector('.layers-header');
  const label = header ? header.querySelector('span') : null;
  const list = layersPanelEl.querySelector('.layers-list');
  if (!header || !label || !list || header.dataset.collapsibleInit) return;
  header.dataset.collapsibleInit = '1';
  _wireCollapse('Layers', label, [list]);
}

// =========================================================================
// 5. UI3 AMEND 1 + AMEND 2 (Fred) — icon tool row replacing the Lattice
//    panel's text "Add" row: [Select] [Rail] [Tie] [Node] (Shape Lattice:
//    "if it has add modes (else just Select)" — it has none, so [Select]
//    alone). Select reuses the main Select tool's own selection/colour/
//    delete path (editor._select/_selectAdd, wired into latticeHandler
//    directly — editor-interaction.js — and editor.setColor/
//    deleteSelected, both already whole-selection-generic) — no second
//    selection system. Rail/Tie/Node proxy-click the ORIGINAL (now-
//    hidden) latticeAdd-* buttons, so properties-lattice.js's existing
//    selectDrawKind stays the ONE place drawKind actually gets written.
// =========================================================================
const LATTICE_ICON_MUTED = '#9aa0a6'; // AMEND 2d: "Grey = one declared muted grey."

const LATTICE_KIND_ICON_TOOLTIPS = {
  select: 'Select — tap a piece to select it; colour/delete work like the main Select tool.',
  rail: 'Drag along the rail axis.',
  tie: 'Drag across the rails — snaps to them.',
  node: 'Click to place a node.',
};

/** AMEND 2/2b/2c/2d: ONE parameterised inline SVG glyph, not three hand-
 *  drawn icons. Rail/Tie share an orientation-neutral diagonal-ladder
 *  shape (two long ~45deg lines + a short crossbar, since rails/ties can
 *  run horizontally OR vertically) and differ only in WHICH part is drawn
 *  in that kind's own live colour (the rest stays muted grey); Node is a
 *  plain dot, not the ladder (Fred: "Node is just a point"); Select is a
 *  plain pointer (reuses #toolSelect's own cursor path). Colours are CSS
 *  custom properties (`var(--kind-rails)` etc.) inherited from bodyEl —
 *  the SAME ones _wireLiveColors (section 1, above) already keeps live-
 *  synced to the Colors row swatches via a MutationObserver — one colour-
 *  sync mechanism, not a second (AMEND 2c): these icons update live the
 *  instant a swatch changes, with zero JS wiring of their own. */
function _buildLatticeIconSVG(kind) {
  if (kind === 'select') {
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">'
      + '<path d="M7 2l12 11.2-5.8.1 3.3 6.7-2.5 1.2-3.3-6.8-3.7 3.6V2z" style="fill: currentColor;" /></svg>';
  }
  if (kind === 'node') {
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">'
      + `<circle cx="12" cy="12" r="5" style="fill: var(--kind-nodes, ${LATTICE_ICON_MUTED});" /></svg>`;
  }
  const railColor = kind === 'rail' ? `var(--kind-rails, ${LATTICE_ICON_MUTED})` : LATTICE_ICON_MUTED;
  const tieColor = kind === 'tie' ? `var(--kind-ties, ${LATTICE_ICON_MUTED})` : LATTICE_ICON_MUTED;
  return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">'
    + `<line x1="6" y1="20" x2="11" y2="4" style="stroke: ${railColor}; stroke-width: 2; stroke-linecap: round;" />`
    + `<line x1="13" y1="20" x2="18" y2="4" style="stroke: ${railColor}; stroke-width: 2; stroke-linecap: round;" />`
    + `<line x1="8" y1="14" x2="16" y2="10" style="stroke: ${tieColor}; stroke-width: 2; stroke-linecap: round;" /></svg>`;
}

/** Replaces `bodyEl`'s "Add" row (if any — Shape Lattice has none) with a
 *  new icon tool row for the given `kinds` (declared order: select first,
 *  then whichever of rail/tie/node the panel supports). `data-no-collapse`
 *  on the new row too — same "always visible, never a collapsible
 *  section" exemption Add always had (and keeps editor-drawer.js's own
 *  measuredPeekFloorPx mobile-peek measurement working unchanged, since
 *  it queries generically for `[data-no-collapse]`, not Add's own id). */
function _buildLatticeIconRow(editor, bodyEl, kinds) {
  if (!bodyEl) return;
  const oldAddRow = bodyEl.querySelector('[data-no-collapse]');
  if (oldAddRow) oldAddRow.style.display = 'none';

  const row = document.createElement('div');
  row.dataset.noCollapse = '';
  row.className = 'lattice-icon-tool-row';

  const buttons = {};
  for (const kind of kinds) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-btn lattice-icon-tool-btn';
    btn.title = LATTICE_KIND_ICON_TOOLTIPS[kind];
    btn.innerHTML = _buildLatticeIconSVG(kind);
    buttons[kind] = btn;
    row.appendChild(btn);
  }

  function setActive(kind) {
    for (const k of kinds) buttons[k].classList.toggle('active', k === kind);
  }
  setActive(editor._lattice.drawKind || 'select');

  for (const kind of kinds) {
    on(buttons[kind], 'click', () => {
      if (kind === 'select') {
        editor._lattice.drawKind = 'select';
      } else {
        const oldBtn = el(`latticeAdd-${kind}`);
        if (oldBtn) oldBtn.click();
      }
      setActive(kind);
    });
  }

  if (oldAddRow) oldAddRow.insertAdjacentElement('afterend', row);
  else bodyEl.insertBefore(row, bodyEl.firstChild);
}

// =========================================================================
// Init
// =========================================================================
export function initLatticeSideColumn(editor) {
  // Hide Fill seed BEFORE any section gets wired collapsible below —
  // _wireCollapse appends a chevron INTO the label, which would corrupt
  // this title-text match (`label.textContent` stops being exactly
  // "Fill seed" once a "▾" child is appended to it).
  const latticeBody = el(TOOL_PANEL_MOUNTS.lattice.bodyId);
  const shapeBody = el(TOOL_PANEL_MOUNTS.shapeLattice.bodyId);
  if (shapeBody) _hideSectionByTitle(shapeBody, 'Fill seed');

  for (const cfg of Object.values(TOOL_PANEL_MOUNTS)) {
    const bodyEl = el(cfg.bodyId);
    if (!bodyEl) continue;
    _tagSections(bodyEl);
    _wireLiveColors(cfg.panelId, bodyEl);
    _makeSectionsCollapsible(bodyEl);
  }
  _makeLayersCollapsible(el('editorLayersPanel'));

  // AMEND 1: Shape Lattice "has [no] add modes" of its own — Select
  // alone; its existing shapeLatticeHandler already falls back to
  // selectHandler.start for any click that isn't on a param handle or a
  // segment (editor-interaction.js), so this button needs no state wiring
  // beyond looking the part — it's always the only, always-active choice.
  _buildLatticeIconRow(editor, latticeBody, ['select', 'rail', 'tie', 'node']);
  _buildLatticeIconRow(editor, shapeBody, ['select']);

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
