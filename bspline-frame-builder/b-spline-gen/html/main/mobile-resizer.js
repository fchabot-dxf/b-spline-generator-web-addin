/**
 * mobile-resizer.js — MOB3 AMEND (Fred: "another option is a draggable
 * handle on the preview panel window"). Makes the SAME #resizer handle
 * that already resizes the sidebar column on desktop (the classic inline
 * script in bspline_gen_palette.html, "Resizer Compatibility logic") also
 * free-drag the 3D preview row's height on phones — through the shared
 * splitter.js (editor-drawer.js's own bottom-drawer handle is its other
 * caller), not a second hand-rolled drag loop.
 *
 * The inline script's own mobile/vertical branch was removed in the same
 * change — it now cedes #resizer on phones to this module (`enabled`
 * below); its desktop/horizontal branch is untouched.
 */
import { makeSplitter } from '../editor/splitter.js';

const STORAGE_KEY = 'bspline.main.previewHeightPx';
const MOBILE_BREAKPOINT = '(max-width: 700px)'; // matches styles/layout-app.css's own @media block
const MIN_PREVIEW_PX = 120;
const BOTTOM_MARGIN_PX = 120; // keeps this much of the sidebar visible below the preview, matching the resizer's pre-AMEND floor

export function initMobilePreviewResizer() {
  const resizer = document.getElementById('resizer');
  const mainContent = document.querySelector('.cad-main-content');
  const viewport = document.querySelector('.cad-viewport');
  if (!resizer || !mainContent || !viewport) return;

  const mqlMobile = window.matchMedia(MOBILE_BREAKPOINT);

  function snaps() {
    const h = mainContent.getBoundingClientRect().height;
    return [
      { name: 'small', px: Math.round(h * 0.25) },
      { name: 'default', px: Math.round(h * 0.4) }, // matches the CSS default (40vh) so a first load doesn't visibly jump
      { name: 'large', px: Math.round(h * 0.65) },
    ];
  }

  const splitter = makeSplitter(viewport, {
    handle: resizer,
    axis: 'height',
    enabled: () => mqlMobile.matches,
    initialSnapName: 'default',
    computeRawSize: (clientY) => clientY - mainContent.getBoundingClientRect().top,
    applySize: (px) => { mainContent.style.gridTemplateRows = `${px}px 12px 1fr`; },
    snaps,
    min: () => MIN_PREVIEW_PX,
    max: () => mainContent.getBoundingClientRect().height - BOTTOM_MARGIN_PX,
    storageKey: STORAGE_KEY,
    // Same visual feedback the old hand-rolled vertical drag gave —
    // reuses .cad-resizer.resizing (styles/layout-app.css) rather than
    // declaring a second CSS rule for the same affordance.
    onDragStart: () => { resizer.classList.add('resizing'); document.body.style.cursor = 'row-resize'; },
    onDragEnd: () => { resizer.classList.remove('resizing'); document.body.style.cursor = ''; },
    // The Three.js canvas only redraws to its new size on a `resize`
    // event (main.js's own `window.addEventListener('resize', ...)`) —
    // the old vertical-drag code dispatched one on every move for the
    // same reason.
    onApply: () => { if (window.dispatchEvent) window.dispatchEvent(new Event('resize')); },
  });

  // Crossing INTO mobile via a live resize (not a fresh load) restores the
  // persisted/default preview height instead of leaving whatever desktop
  // had computed; crossing OUT clears the inline override so the desktop
  // grid's own CSS (Section 9, layout-app.css) reasserts.
  mqlMobile.addEventListener('change', (e) => {
    if (e.matches) splitter.reapply();
    else mainContent.style.gridTemplateRows = '';
  });
}
