/**
 * editor-drawer.js — MOB3 (Fred, live on his phone: "I can't see the
 * panels — we need to revisit the UI in these tools, maybe a drawer?").
 * ONE bottom drawer replaces the old separate "Lattice panel as its own
 * collapsed bottom sheet" + "Layers panel squeezed into a thin stacked
 * strip" (MOB2/MOB2b) under the existing narrow/coarse breakpoint —
 * desktop is untouched (the drawer wrapper is `display:contents` there,
 * so #editorLatticePanel/#editorLayersPanel stay direct flex children of
 * .cad-modal-body exactly as before, styles/editor.css).
 *
 * Pure snap-height math (drawerHeightPx) has no DOM dependency and is
 * unit-tested directly, matching editor-grid.js's/editor-view.js's own
 * pure/DOM split. The drag/tap/snap gesture itself (MOB3 AMEND: a free
 * splitter, not a fixed peek/half/full toggle) is declared once in
 * splitter.js and shared with main/mobile-resizer.js's own preview/
 * sidebar splitter — see splitter.js's own header. Section collapse and
 * tab switching are DOM orchestration below that line.
 */
import { el, on } from './dom.js';
import { makeSplitter } from './splitter.js';

/** Declared once — a future tool with its own options panel is one entry
 *  here, not a new mechanism. Only Lattice has one today; every other
 *  mode falls through to `null` (drawer shows Layers only, no tool tab),
 *  matching the dispatch's own "tools with no options -> the tab shows
 *  Layers only." */
export const TOOL_PANELS = {
  lattice: { panelId: 'editorLatticePanel', label: 'Lattice Pattern' },
  // T58 (SE14 Slice 3): the first REAL exercise of "a future tool with its
  // own options panel is one entry here" — see this file's own generalized
  // _activateTab/measuredPeekFloorPx below (they used to hardcode
  // 'editorLatticePanel' since only one entry ever existed; a second entry
  // is what actually proves the table generic, not just declared that way).
  shapeLattice: { panelId: 'editorShapeLatticePanel', label: 'Shape Lattice' },
};

export const DRAWER_SNAP_STATES = ['peek', 'half', 'full'];
const DRAWER_HEIGHT_STORAGE_KEY = 'bspline.editor.drawerHeightPx';
const SECTION_STATE_PREFIX = 'bspline.editor.drawerSection.';

/** Peek is a fixed px height (the dispatch's own "~96px: tabs + essentials
 *  row" — a slim, content-driven amount, not a viewport proportion); half
 *  and full are vh-based fractions of the CURRENT viewport, matching the
 *  dispatch's own "~50vh"/"~88vh". */
const PEEK_HEIGHT_PX = 96;
const HALF_VH_FRACTION = 0.5;
const FULL_VH_FRACTION = 0.88;

/** Pure: resolve a snap state to a concrete px height for the given
 *  viewport height. 'peek' is this function's OWN floor only — initDrawer
 *  raises it live against the Lattice tool's actually-measured essentials
 *  (its own peek content can exceed 96px; see measuredPeekFloorPx below). */
export function drawerHeightPx(state, viewportHeight) {
  if (state === 'half') return Math.round(viewportHeight * HALF_VH_FRACTION);
  if (state === 'full') return Math.round(viewportHeight * FULL_VH_FRACTION);
  return PEEK_HEIGHT_PX; // 'peek', and the floor for any unrecognized state
}

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

/** SE7k/MOB2's own section shape: a direct child of the panel body whose
 *  FIRST element child is a bold (`font-weight:600`) `<span>` label —
 *  Rails/Ties/Nodes/Colors/Widths already look like this with ZERO
 *  markup changes, and any FUTURE section (e.g. seat B's own upcoming
 *  Boundary panel, lane-b) that follows this file's own established
 *  convention becomes collapsible automatically too, for free — this
 *  walks the DOM generically at drawer-init time rather than hand-wiring
 *  a toggle per section. `data-no-collapse` opts a section OUT (the "Add"
 *  row: it must always stay visible in the peek row, never collapsed).
 *  Desktop-untouched (MOB2/MOB3's own standing rule): gated on the SAME
 *  max-width:720px structural breakpoint styles/editor.css's drawer rules
 *  use, checked ONCE here — a desktop session never gets the chevron/
 *  click affordance at all, so it can't inherit a collapsed section from
 *  a phone session sharing the same localStorage either. A live resize
 *  across the breakpoint while the modal is already open won't retro-
 *  actively wire this (same one-time-check shape as this file's own
 *  drag-vs-tap threshold), an accepted, narrow edge case. */
function _makeSectionsCollapsible(panelBodyEl) {
  if (!panelBodyEl) return;
  if (!window.matchMedia('(max-width: 720px)').matches) return;
  for (const section of Array.from(panelBodyEl.children)) {
    if (section.hasAttribute('data-no-collapse')) continue;
    const label = section.firstElementChild;
    if (!label || label.tagName !== 'SPAN' || !/font-weight:\s*600/.test(label.getAttribute('style') || '')) continue;
    const title = label.textContent.trim();
    if (!title || section.dataset.collapsibleInit) continue;
    section.dataset.collapsibleInit = '1';

    const body = Array.from(section.children).filter((c) => c !== label);
    const chevron = document.createElement('span');
    chevron.className = 'editor-drawer-section-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';
    label.style.cursor = 'pointer';
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.justifyContent = 'space-between';
    label.appendChild(chevron);

    const applyOpen = (open) => {
      for (const node of body) node.style.display = open ? '' : 'none';
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
}

/** SE7k's Add: row and the Generate/Regenerate footer are the dispatch's
 *  own declared peek-row content ("Lattice's peek row = Add: Rail/Tie/
 *  Node + Generate/Regenerate") — no DOM relocation needed to achieve
 *  that: Add is already the body's first (non-collapsible) child, and
 *  the footer becomes `position:sticky; bottom:0` (styles/editor.css)
 *  inside the drawer body's own scroll context, so both stay visible at
 *  ANY drawer height, including peek, without duplicating their markup
 *  or breaking properties-lattice.js's existing getElementById wiring
 *  (an element's DOM POSITION is irrelevant to that; only its id is). */
function _syncTabsForMode(editor, mode) {
  const toolTab = el('editorDrawerTab-tool');
  const layersTab = el('editorDrawerTab-layers');
  if (!toolTab || !layersTab) return;
  const toolPanel = TOOL_PANELS[mode];
  toolTab.classList.toggle('hidden', !toolPanel);
  toolTab.textContent = toolPanel ? toolPanel.label : '';
  // T58: which panel element the tab tracks travels WITH the tab button
  // itself (a data attribute, not a second parameter threaded through
  // every _activateTab call site below) — now that TOOL_PANELS has a
  // second entry, "the tool tab's panel" is no longer always
  // #editorLatticePanel; a click on the tab (below) needs to resolve the
  // SAME panel this call just picked, not a hardcoded one.
  toolTab.dataset.panelId = toolPanel ? toolPanel.panelId : '';
  // A tool switch always shows THAT tool's own tab (matches the
  // dispatch's own "opening the Lattice tool opens the drawer at peek" —
  // switching tools is meant to surface the new tool's options, not
  // preserve whichever tab a PREVIOUS tool happened to leave active): a
  // mode with its own panel activates the tool tab; one without leaves
  // Layers as the only (and therefore active) tab.
  _activateTab(editor, toolPanel ? 'tool' : 'layers');
}

/** T58: generalized from a hardcoded `#editorLatticePanel` reference —
 *  reads WHICH panel the tool tab currently represents off its own
 *  `dataset.panelId` (set by `_syncTabsForMode` above on every mode
 *  switch), so a second (or Nth) `TOOL_PANELS` entry shows/hides the
 *  RIGHT panel rather than always the Lattice one. Every OTHER
 *  `TOOL_PANELS` panel is left alone here (not force-hidden) — each one
 *  is already gated by `editor-ui.js`'s own `TOOLBAR_GROUPS` predicate
 *  (`currentMode === '<mode>'`), which independently hides it the moment
 *  the mode isn't its own; this toggle only needs to pick the right
 *  panel among the (at most one) that TOOLBAR_GROUPS already left
 *  visible. */
function _activateTab(editor, which) {
  const toolTab = el('editorDrawerTab-tool');
  const layersTab = el('editorDrawerTab-layers');
  const layersPanel = el('editorLayersPanel');
  if (!toolTab || !layersTab) return;
  const toolPanelId = toolTab.dataset.panelId;
  const toolPanel = toolPanelId ? el(toolPanelId) : null;
  toolTab.classList.toggle('active', which === 'tool');
  layersTab.classList.toggle('active', which === 'layers');
  if (toolPanel) toolPanel.classList.toggle('editor-drawer-tab-hidden', which !== 'tool');
  if (layersPanel) layersPanel.classList.toggle('editor-drawer-tab-hidden', which !== 'layers');
}

/** Called from editor-ui.js's setMode on every tool switch — keeps the
 *  drawer's tabs in sync with whether the CURRENT tool has an options
 *  panel at all. A no-op if the drawer isn't in this host's DOM. */
export function syncDrawerForMode(editor, mode) {
  _syncTabsForMode(editor, mode);
}

/** MOB3: Download SVG / Clear's ⋯ overflow menu (narrow/coarse only —
 *  desktop keeps them inline, styles/editor.css's `display:contents` on
 *  #editorHeaderMoreMenu). Positioning/outside-click/Escape-to-close
 *  mirror editor-color.js's openColorMosaic popover exactly (viewport-
 *  relative getBoundingClientRect, clamped so it can't overflow the
 *  right/bottom edge) — the SAME popover shape, not a second one, even
 *  though this menu is a static pre-existing element rather than one
 *  built fresh per open. */
export function initHeaderOverflowMenu() {
  const trigger = el('editorHeaderMore');
  const menu = el('editorHeaderMoreMenu');
  if (!trigger || !menu) return;

  function position() {
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = rect.right - mw;
    let top = rect.bottom + 6;
    if (left < margin) left = margin;
    if (top + mh + margin > window.innerHeight) top = Math.max(margin, rect.top - mh - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }
  function close() {
    menu.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutsideMouseDown, true);
    document.removeEventListener('keydown', onKeydown, true);
  }
  function onOutsideMouseDown(e) {
    if (!menu.contains(e.target) && e.target !== trigger) close();
  }
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  on(trigger, 'click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('open')) { close(); return; }
    menu.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    position();
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    document.addEventListener('keydown', onKeydown, true);
  });
  // A tap on either action inside the menu should close it, same as any
  // other popover — Download/Clear's own handlers (action-tools.js) fire
  // from the SAME click, unaffected by this menu closing itself.
  on(menu, 'click', close);
}

export function initDrawer(editor) {
  const drawer = el('editorMobileDrawer');
  const handle = el('editorDrawerHandle');
  const toolTab = el('editorDrawerTab-tool');
  const layersTab = el('editorDrawerTab-layers');
  if (!drawer || !handle || !toolTab || !layersTab) return; // panel not present in this host — no-op, matches other init*() modules' own guard shape

  // T58: every declared TOOL_PANELS body, not just Lattice's own — each
  // follows the SAME "bold-span-first-child" section convention
  // (_makeSectionsCollapsible's own doc comment already promised this for
  // free to "any future section"; a second real panel is what actually
  // exercises that promise).
  for (const { panelId } of Object.values(TOOL_PANELS)) {
    _makeSectionsCollapsible(el(`${panelId}Body`));
  }

  on(toolTab, 'click', () => _activateTab(editor, 'tool'));
  on(layersTab, 'click', () => _activateTab(editor, 'layers'));
  _activateTab(editor, 'layers'); // a sane default before the first setMode() call ever runs

  // Peek's declared ~96px (drawerHeightPx's own pure floor, used as-is by
  // its unit tests) doesn't actually leave room for the handle + tabs bar
  // PLUS Lattice's own declared peek row (Add: Rail/Tie/Node + Generate/
  // Regenerate) once real chrome heights are subtracted — confirmed live:
  // both landed off-screen with the bare constant. Measures the ACTUAL
  // essentials instead (handle + tabs + Add section + footer, all normal-
  // flow children of the scrollable #editorDrawerBody, so their own
  // offsetHeight is never artificially compressed by the drawer's current
  // overall height) and uses whichever is taller — the constant stays as
  // the documented floor for a tab with no measurable essentials (Layers-
  // only tools).
  function measuredPeekFloorPx() {
    const chrome = handle.offsetHeight + (el('editorDrawerTabs')?.offsetHeight || 0);
    // T58: read the CURRENT tool tab's own panel (dataset.panelId, set by
    // _syncTabsForMode) rather than hardcoding editorLatticePanel — a
    // second TOOL_PANELS entry needs its OWN essentials measured, not
    // Lattice's.
    const panelId = el('editorDrawerTab-tool')?.dataset.panelId;
    const panel = panelId ? el(panelId) : null;
    const showing = panel && !panel.classList.contains('editor-drawer-tab-hidden');
    if (showing) {
      const addSection = document.querySelector(`#${panelId}Body [data-no-collapse]`);
      const footer = el(`${panelId}Footer`);
      if (addSection && footer) return chrome + addSection.offsetHeight + footer.offsetHeight + 24;
    }
    return drawerHeightPx('peek', window.innerHeight);
  }
  function peekFloorPx() {
    return Math.max(drawerHeightPx('peek', window.innerHeight), measuredPeekFloorPx());
  }
  // The splitter's own declared snap points — DRAWER_SNAP_STATES stays the
  // single source of the three names (peek/half/full order); 'peek' alone
  // needs the live floor above, the other two are drawerHeightPx's pure
  // vh-fraction math.
  function currentSnaps() {
    const vh = window.innerHeight;
    return DRAWER_SNAP_STATES.map((name) => ({
      name,
      px: name === 'peek' ? peekFloorPx() : drawerHeightPx(name, vh),
    }));
  }

  // MOB3 AMEND: a free splitter (drag to ANY height between peek/full, soft
  // snap within 24px of a declared point) — not the fixed peek/half/full
  // toggle this used to hand-roll here. splitter.js owns the drag/tap/
  // snap/persist mechanism once, shared with main/mobile-resizer.js's own
  // preview/sidebar splitter on the app's main screen.
  const splitter = makeSplitter(drawer, {
    handle,
    axis: 'height',
    // Bottom-anchored: dragging UP (clientY decreases) GROWS the drawer.
    computeRawSize: (clientY, { startCoord, startSize }) => startSize - (clientY - startCoord),
    snaps: currentSnaps,
    min: peekFloorPx,
    max: () => drawerHeightPx('full', window.innerHeight),
    storageKey: DRAWER_HEIGHT_STORAGE_KEY,
    onApply: (px, snapName) => drawer.classList.toggle('is-peek', snapName === 'peek'),
    onDragStart: () => drawer.classList.add('is-dragging'),
    onDragEnd: () => drawer.classList.remove('is-dragging'),
  });

  // Same "publish the live rendered height as a CSS custom property" idiom
  // MOB2's own --lattice-sheet-height used (properties-lattice.js) for the
  // undo/redo pill to lift clear of — --drawer-height replaces it now that
  // the drawer (not the old collapsible Lattice sheet alone) is the one
  // thing that can cover the canvas bottom. ResizeObserver on the drawer
  // itself (not a fixed px readout) so a mid-drag height change updates
  // the pill's own position live too, not just after a snap settles.
  if (typeof ResizeObserver !== 'undefined') {
    const syncDrawerHeightVar = () => {
      const h = drawer.classList.contains('hidden') ? 0 : drawer.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--drawer-height', `${h}px`);
    };
    new ResizeObserver(syncDrawerHeightVar).observe(drawer);
  }

  document.addEventListener('editorModeChanged', (e) => {
    if (e.detail && e.detail.editor === editor) {
      // _syncTabsForMode FIRST: it un-hides the Lattice panel for 'lattice'
      // mode, and measuredPeekFloorPx() (splitter's own 'peek' snap) can
      // only measure the Add/footer content once that panel is actually
      // visible — reversed, this call measured the STILL-HIDDEN panel and
      // silently fell back to the bare 96px floor (confirmed live: Add/
      // Generate landed off-screen at peek on the very first tool-open).
      _syncTabsForMode(editor, e.detail.mode);
      // T58: generalized from `mode === 'lattice'` — ANY tool with its own
      // TOOL_PANELS entry snaps the drawer open at peek on entry, not just
      // the Lattice tool specifically (the dispatch's own reasoning —
      // "surface the new tool's options" — applies equally to a second
      // tool's own panel).
      if (TOOL_PANELS[e.detail.mode]) splitter.snapTo('peek');
    }
  });
}
