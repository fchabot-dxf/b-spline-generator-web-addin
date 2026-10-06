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
import { LANDSCAPE_PHONE_QUERY } from './breakpoints.js';

/** Declared once — the tools with their own options panel (a future one is one entry here): entering one opens the
 *  drawer at peek. The Art tabs (Fred: "what's stripe and brick?") retired the drawer's tool | panel tab pair -- the
 *  panel's settings mount under Layers on every viewport now (lattice-side-column.js TOOL_PANEL_MOUNTS). */
export const TOOL_PANELS = {
  lattice: { panelId: 'editorLatticePanel' },
  shapeLattice: { panelId: 'editorShapeLatticePanel' }, // T58 (SE14 Slice 3)
  stripe: { panelId: 'editorStripePanel' }, // F27 item 3
};

export const DRAWER_SNAP_STATES = ['peek', 'half', 'full'];
const DRAWER_HEIGHT_STORAGE_KEY = 'bspline.editor.drawerHeightPx';

/** Peek is a fixed px height (the dispatch's own "~96px: essentials
 *  row" — a slim, content-driven amount, not a viewport proportion); half
 *  and full are vh-based fractions of the CURRENT viewport, matching the
 *  dispatch's own "~50vh"/"~88vh". */
const PEEK_HEIGHT_PX = 96;
const HALF_VH_FRACTION = 0.5;
const FULL_VH_FRACTION = 0.88;

/** Pure: resolve a snap state to a concrete px height for the given
 *  viewport height. 'peek' is this function's OWN floor only — initDrawer
 *  raises it live against the active tab's declared peek essentials (tabEssentialsFloorPx below). */
export function drawerHeightPx(state, viewportHeight) {
  if (state === 'half') return Math.round(viewportHeight * HALF_VH_FRACTION);
  if (state === 'full') return Math.round(viewportHeight * FULL_VH_FRACTION);
  return PEEK_HEIGHT_PX; // 'peek', and the floor for any unrecognized state
}

/** MOB4: landscape phone's own side-column splitter — WIDTH snaps instead
 *  of HEIGHT ones, "canvasMax" (narrowest column: MOB4's own "canvas-max")
 *  through "settingsMax" ("settings-max", the widest). Declared as
 *  fractions of viewport WIDTH, same shape as drawerHeightPx's own vh
 *  fractions — but noticeably more conservative ones: a landscape phone's
 *  own width (typically 700-915px) is what the CANVAS has to share, not
 *  disposable space the way portrait's full HEIGHT is once the drawer
 *  covers it, so even "settings-max" stops well short of half the screen.
 *  canvasMax uses a fixed floor (236px — this panel's own long-standing
 *  DESKTOP width, not a live content measurement the way portrait's peek
 *  is; a side column's minimum usable width doesn't shrink/grow with
 *  which tool happens to be open the way a bottom sheet's height does).
 *  UI1 fix-first #2: raised from 220 to 236 alongside the desktop panels'
 *  own width bump (styles/editor.css's `.editor-layers-panel`) — same
 *  narrow-column name-truncation fix applies here too. */
export const LANDSCAPE_SNAP_STATES = ['canvasMax', 'half', 'settingsMax'];
const LANDSCAPE_WIDTH_STORAGE_KEY = 'bspline.editor.landscapeDrawerWidthPx';
const LANDSCAPE_CANVAS_MAX_WIDTH_PX = 236;
const LANDSCAPE_HALF_VW_FRACTION = 0.38;
const LANDSCAPE_SETTINGS_MAX_VW_FRACTION = 0.45;
// Mirrors styles/editor.css's own landscape media query exactly — a
// landscape phone is `pointer:coarse` but WIDER than portrait's own
// 720px breakpoint, so `min-width:721px` keeps the two from ever both
// matching the same viewport (checked live wherever this string is used,
// not just declared once and trusted).
const LANDSCAPE_MEDIA_QUERY = LANDSCAPE_PHONE_QUERY; // audit tidy-up: breakpoints.js

/** Pure: resolve a landscape snap state to a concrete px WIDTH for the
 *  given viewport width — same role as drawerHeightPx, for the OTHER axis. */
export function landscapeWidthPx(state, viewportWidth) {
  if (state === 'half') return Math.round(viewportWidth * LANDSCAPE_HALF_VW_FRACTION);
  if (state === 'settingsMax') return Math.round(viewportWidth * LANDSCAPE_SETTINGS_MAX_VW_FRACTION);
  return LANDSCAPE_CANVAS_MAX_WIDTH_PX; // 'canvasMax', and the floor for any unrecognized state
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
  if (!drawer || !handle) return; // panel not present in this host — no-op, matches other init*() modules' own guard shape

  // MOB4: shared by both splitters below (each is the OTHER one's
  // `enabled()` gate).
  const isLandscapeMode = () => window.matchMedia(LANDSCAPE_MEDIA_QUERY).matches;

  // UI3: section collapsibility for the TOOL_PANELS bodies moved to
  // lattice-side-column.js's own initLatticeSideColumn (called once,
  // unconditionally, from editor-controls.js) — that module already owns
  // every other "what a lattice panel section looks like" concern
  // (tagging, colour, hiding), and now collapsing on BOTH desktop and
  // mobile is the SAME declared mechanism instead of this file's own
  // former mobile-only copy of it.


  // The ACTIVE TAB's declared peek essentials (main/editor-tabs.js EDITOR_TABS[].peekEssentials, handed
  // over as drawer.dataset.peekEssentials on every tab switch): selectors whose rendered elements must show
  // in full at peek -- e.g. the Brick panel's pinned Generate (Fred: "Wall is missing the generate button":
  // only 10 of its 32 px showed). Only rendered matches count, so a hidden panel adds nothing.
  function tabEssentialsFloorPx() {
    let selectors = [];
    try { selectors = JSON.parse(drawer.dataset.peekEssentials || '[]'); } catch { selectors = []; }
    const h = selectors.reduce((sum, sel) => sum + Array.from(document.querySelectorAll(sel))
      .filter((node) => node.offsetParent !== null).reduce((s, node) => s + node.offsetHeight, 0), 0);
    if (!h) return 0;
    return handle.offsetHeight + h + 8;
  }
  function peekFloorPx() {
    // the Art tabs: the tab pair and the tool-panel floor are retired -- a tool's settings sit under Layers now
    return Math.max(drawerHeightPx('peek', window.innerHeight), tabEssentialsFloorPx());
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
    // MOB4: `.editor-drawer-handle` is hidden in landscape (its own
    // vertical-grip splitter takes over), so drags can't happen there
    // anyway — this ALSO stops the init-time apply()/resize listener from
    // writing a stale/oversized `height` onto what landscape's own CSS
    // now lays out as a normal (non-fixed) flex row child, sized by
    // `width` instead.
    enabled: () => !isLandscapeMode(),
    // Clearing the OTHER axis's own inline style here (not just skipping
    // this one via `enabled` above) matters because INLINE styles beat
    // an external stylesheet rule with no `!important` regardless of
    // specificity: portrait's own CSS sets `width:100%` (no !important),
    // which would LOSE to a stale inline `width:220px` left over from a
    // landscape session, right up until this splitter's own next apply()
    // — e.g. right after a rotation — clears it.
    onApply: (px, snapName) => {
      drawer.classList.toggle('is-peek', snapName === 'peek');
      drawer.style.width = '';
    },
    onDragStart: () => drawer.classList.add('is-dragging'),
    onDragEnd: () => drawer.classList.remove('is-dragging'),
  });
  // Audit C11: a tab tap at peek height used to only switch the tab, leaving its panel hidden below
  // the fold (the handle drag was the only way up). At peek, a tab tap now also opens to 'half' -- since the Art tabs,
  // a tab of any panel's strip in the drawer (editor/tab-strip.js .ui-tab-strip; the drawer's own tab pair is retired).
  on(drawer, 'click', (e) => {
    if (e.target && e.target.closest && e.target.closest('.ui-tab-strip .ui-tab')
      && !isLandscapeMode() && drawer.classList.contains('is-peek')) splitter.snapTo('half');
  });

  // The peek floor depends on what the drawer currently holds (the tab's declared essentials appear only
  // once their panel shows, e.g. the Brick panel on picking Wall), so a drawer AT peek re-measures when the
  // tab changes or a panel inside the drawer body is shown/hidden. Never while being dragged.
  const resnapPeek = () => {
    if (!isLandscapeMode() && drawer.classList.contains('is-peek') && !drawer.classList.contains('is-dragging')) splitter.snapTo('peek');
  };
  document.addEventListener('editorTabChanged', () => requestAnimationFrame(resnapPeek));
  const drawerBody = el('editorDrawerBody');
  if (drawerBody && typeof MutationObserver !== 'undefined') {
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; resnapPeek(); });
    }).observe(drawerBody, { attributes: true, attributeFilter: ['style', 'class'], subtree: true });
  }

  // MOB4: landscape phone's own side-column splitter — a SECOND
  // makeSplitter instance on the SAME drawer element, driving `width`
  // instead of `height`, gated to only ever engage in landscape (the
  // portrait splitter above is likewise inert there, since a landscape
  // session hides `.editor-drawer-handle` entirely — its own onPointerDown
  // never fires with no visible/hittable handle; `enabled()` below just
  // keeps its init-time apply()/resize listener from ALSO writing a
  // (harmless but pointless) height while inert). #editorDrawerHandleV is
  // a SEPARATE element from the portrait handle (styles/editor.css shows
  // exactly one of the two per orientation), so both splitters can be
  // wired unconditionally here with zero risk of double-handling one
  // pointer gesture. Unlike portrait, landscape's own #editorMobileDrawer
  // is a NORMAL (non-fixed) flex sibling of #editorCanvasContainer
  // (styles/editor.css's own comment there explains why) — so applying
  // `width` here is all that's needed for true side-by-side; no separate
  // CSS-var/padding reservation on the canvas required.
  const handleV = el('editorDrawerHandleV');
  if (handleV) {
    function currentLandscapeSnaps() {
      const vw = window.innerWidth;
      return LANDSCAPE_SNAP_STATES.map((name) => ({ name, px: landscapeWidthPx(name, vw) }));
    }
    makeSplitter(drawer, {
      handle: handleV,
      axis: 'width',
      // Right-anchored: dragging LEFT (clientX decreases) GROWS the drawer.
      computeRawSize: (clientX, { startCoord, startSize }) => startSize - (clientX - startCoord),
      snaps: currentLandscapeSnaps,
      min: () => landscapeWidthPx('canvasMax', window.innerWidth),
      max: () => landscapeWidthPx('settingsMax', window.innerWidth),
      storageKey: LANDSCAPE_WIDTH_STORAGE_KEY,
      enabled: isLandscapeMode,
      initialSnapName: 'canvasMax',
      // Mirrors the portrait splitter's own onApply — clears ITS axis's
      // stale inline value once this one is the side actually driving the
      // drawer's size (see that splitter's own comment for why this
      // matters, not just skipping-via-enabled).
      onApply: () => { drawer.style.height = ''; },
      onDragStart: () => drawer.classList.add('is-dragging'),
      onDragEnd: () => drawer.classList.remove('is-dragging'),
    });
  }

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
      // T58: generalized from `mode === 'lattice'` — ANY tool with its own
      // TOOL_PANELS entry snaps the drawer open at peek on entry, not just
      // the Lattice tool specifically (the dispatch's own reasoning —
      // "surface the new tool's options" — applies equally to a second
      // tool's own panel).
      // UI1 fix-first #1: `splitter.snapTo()` applies unconditionally —
      // it doesn't check ITS OWN `enabled` gate (splitter.js's `snapTo` is
      // a thin wrapper around `apply()`, same as `setSize`/`reapply`).
      // Un-guarded, this call set `drawer.style.height` to peek's ~96-140px
      // even in landscape (opening a tool while already landscape, no
      // rotation involved) — landscape's own CSS never sets height at all
      // (a normal flex-row sibling, sized by width only), so that stray
      // inline height silently capped the WHOLE side column, leaving
      // everything past Add+Regenerate blank (confirmed live via
      // screenshot: ui-landscape-peek.png). Peek/half/full are a portrait
      // bottom-drawer concept only — landscape's side column always shows
      // full content (scrolling), so this must never fire there.
      if (TOOL_PANELS[e.detail.mode] && !isLandscapeMode()) splitter.snapTo('peek');
    }
  });
}
