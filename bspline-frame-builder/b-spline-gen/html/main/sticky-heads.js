/**
 * sticky-heads.js -- Fred 2026-11-24: "on any screen size the header of a panel is locked at the top while you have it
 * in view". The pinning itself is pure CSS (styles/layout-app.css: a top-level .panel's .panel-header is position:
 * sticky at top: var(--sticky-head-top)); this module only declares WHERE each scroll area's pinned bar ends, so the
 * header parks just under it instead of behind it. ONE table, one mechanism: a scroll area, the pinned bar in it.
 * The variable is the bar's real height plus its own stuck offset (a sticky bar's `top`, e.g. the sidebar's -14px that
 * cancels the aside padding), re-measured when the bar resizes. A scroll area with no sticky bar (the editor's split
 * panel: its head sits outside the scrolling part) parks headers flush at the top, cancelling its own top padding.
 */
export const STICKY_HEAD_AREAS = Object.freeze([
  { scroller: '.cad-sidebar', bar: '.sticky-actions' }, // the main sidebar (desktop column and the phone bottom sheet)
  { scroller: '.editor-layers-panel', bar: ':scope > .sticky-actions' }, // the 2D editor's right panels
  { scroller: '.editor-lattice-panel', bar: ':scope > .sticky-actions' },
  { scroller: '.editor-panel-scroll', bar: null }, // a split panel's own scrolling part: nothing pinned inside it
]);

/** Pure: the --sticky-head-top value for a bar of `heightPx` with computed position `position` and top `topPx`. */
export function stickyHeadTop(heightPx, position, topPx, scrollerPadTopPx = 0) {
  // sticky offsets count from the scroller's content edge, so with nothing pinned a header sits flush at the top
  // of the scroll area when the offset cancels the scroller's own top padding
  if (position !== 'sticky') return Math.round(-(scrollerPadTopPx || 0)) || 0;
  return Math.round(heightPx + (Number.isFinite(topPx) ? topPx : 0));
}

export function measureStickyHeads(root = document) {
  for (const a of STICKY_HEAD_AREAS) {
    for (const scroller of root.querySelectorAll(a.scroller)) {
      const bar = a.bar ? scroller.querySelector(a.bar) : null;
      const pad = parseFloat(getComputedStyle(scroller).paddingTop);
      let px = stickyHeadTop(0, 'static', 0, pad);
      if (bar) { const cs = getComputedStyle(bar); px = stickyHeadTop(bar.getBoundingClientRect().height, cs.position, parseFloat(cs.top), pad); }
      if (scroller.style.getPropertyValue('--sticky-head-top') !== `${px}px`) scroller.style.setProperty('--sticky-head-top', `${px}px`);
    }
  }
}

/** The header selectors the CSS sticks (styles/layout-app.css) -- one list for the fold hand-off below. */
export const STICKY_HEAD_SELECTOR = '.panel:not(.panel-sub) > .panel-header, .drawer-branch > .drawer-branch-head';

/** Pure: how far (px) to scroll UP so a header that a fold left above its pinned line sits on it; 0 when it is fine. */
export function foldScrollFix(headTopPx, lineTopPx) {
  return headTopPx < lineTopPx - 0.5 ? Math.ceil(lineTopPx - headTopPx) : 0;
}

/** Folding a panel whose header was stuck shrinks the page under the pointer; scroll so the folded header stays on its
 *  pinned line instead of ending up behind the bar. Runs after the click's own handlers (the fold) have run. */
function keepFoldedHeaderInView(ev) {
  const head = ev.target.closest?.(STICKY_HEAD_SELECTOR);
  if (!head) return;
  requestAnimationFrame(() => {
    if (!head.isConnected) return;
    let sc = head.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    if (!sc) return;
    const cs = getComputedStyle(sc);
    const line = sc.getBoundingClientRect().top + sc.clientTop + parseFloat(cs.paddingTop) + parseFloat(cs.getPropertyValue('--sticky-head-top') || 0);
    const fix = foldScrollFix(head.getBoundingClientRect().top, line);
    if (fix) sc.scrollTop -= fix;
  });
}

export function initStickyHeads() {
  document.addEventListener('click', keepFoldedHeaderInView);
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; measureStickyHeads(); }); };
  measureStickyHeads();
  window.addEventListener('resize', later);
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(later);
    for (const a of STICKY_HEAD_AREAS) if (a.bar) for (const s of document.querySelectorAll(a.scroller)) { const b = s.querySelector(a.bar); if (b) ro.observe(b); }
  }
  // a bar mounted later (lattice-side-column.js moves its Generate slot in), a layout class flip: re-measured next frame
  if (typeof MutationObserver === 'function') new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
}
