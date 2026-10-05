/**
 * sidebar-layout.js -- F35 item 26: the main sidebar drag-resizes on desktop, and its contents use the room.
 *
 * ONE declaration (SIDEBAR_LAYOUT) drives all of it:
 *   - the #resizer drag (the shared editor/splitter.js, as the phone splitters in mobile-resizer.js), clamped to
 *     [minPx, maxPx] and always leaving `keepViewportPx` of the 3D view; the width persists per viewer
 *     (localStorage) under `storageKey`;
 *   - button/icon grids gain columns with the width: `cellMinPx` -> --sidebar-cell-min, read by the CSS auto-fill
 *     grids (styles/layout-app.css; .sidebar-desktop scopes them, so phones keep their own layout);
 *   - past `twoColumnPx` (~2x the default) the sections flow into two columns in reading order, a section never
 *     split (.cad-sidebar.sidebar-two-col, styles/layout-app.css).
 * Desktop only: phones (portrait and landscape) keep mobile-resizer.js's own splitters and one column.
 * A tap on the handle cycles the declared snaps (default <-> two columns), as every splitter's tap does.
 */
import { makeSplitter } from '../editor/splitter.js';
import { MOBILE_QUERY, LANDSCAPE_PHONE_QUERY } from '../editor/breakpoints.js';

export const SIDEBAR_LAYOUT = Object.freeze({
  defaultPx: 260, // = styles/layout-app.css :root --cad-sidebar-width
  minPx: 200,
  maxPx: 650, // 2.5x the default
  keepViewportPx: 300, // the 3D view never gets narrower than this
  twoColumnPx: 520, // 2x the default: from here the sections flow into two columns
  cellMinPx: 72, // one grid cell's minimum width: a 4-button group is 2 per row at the default, 4 at 1.5x, 2 at twoColumnPx
  storageKey: 'bspline.main.sidebarWidthPx',
});

/** Pure: the hard bounds at viewport width `vw`. */
export function sidebarBounds(vw, L = SIDEBAR_LAYOUT) {
  const max = Math.max(L.minPx, Math.min(L.maxPx, vw - L.keepViewportPx));
  return { min: L.minPx, max };
}

/** Pure: does a sidebar `px` wide flow its sections into two columns? */
export const isTwoColumn = (px, L = SIDEBAR_LAYOUT) => px >= L.twoColumnPx;

export function initSidebarLayout() {
  const resizer = document.getElementById('resizer');
  const sidebar = document.querySelector('.cad-sidebar');
  if (!resizer || !sidebar) return null;
  const root = document.documentElement;
  root.style.setProperty('--sidebar-cell-min', `${SIDEBAR_LAYOUT.cellMinPx}px`);
  const mqlMobile = window.matchMedia(MOBILE_QUERY);
  const mqlLandscapePhone = window.matchMedia(LANDSCAPE_PHONE_QUERY);
  const desktop = () => !mqlMobile.matches && !mqlLandscapePhone.matches;
  const setTwoColumn = (on) => sidebar.classList.toggle('sidebar-two-col', on);
  sidebar.classList.toggle('sidebar-desktop', desktop());

  const splitter = makeSplitter(root, {
    handle: resizer,
    axis: 'width',
    enabled: desktop,
    computeRawSize: (clientX, drag) => drag.startSize + (clientX - drag.startCoord),
    applySize: (px) => root.style.setProperty('--cad-sidebar-width', `${px}px`),
    readSize: () => sidebar.getBoundingClientRect().width,
    snaps: () => [{ name: 'default', px: SIDEBAR_LAYOUT.defaultPx }, { name: 'twoColumn', px: SIDEBAR_LAYOUT.twoColumnPx }],
    initialSnapName: 'default',
    min: () => sidebarBounds(window.innerWidth).min,
    max: () => sidebarBounds(window.innerWidth).max,
    storageKey: SIDEBAR_LAYOUT.storageKey,
    storage: 'local',
    onDragStart: () => { resizer.classList.add('resizing'); document.body.style.cursor = 'col-resize'; },
    onDragEnd: () => { resizer.classList.remove('resizing'); document.body.style.cursor = ''; },
    onApply: (px) => { setTwoColumn(isTwoColumn(px)); window.dispatchEvent(new Event('resize')); },
  });
  // crossing into a phone layout: one column (mobile-resizer.js owns the width there); back to desktop: the
  // viewer's own width again (the landscape splitter removes --cad-sidebar-width when it lets go)
  const onModeChange = () => {
    sidebar.classList.toggle('sidebar-desktop', desktop());
    if (desktop()) splitter.reapply(); else setTwoColumn(false);
  };
  mqlMobile.addEventListener('change', onModeChange);
  mqlLandscapePhone.addEventListener('change', onModeChange);
  return splitter;
}
