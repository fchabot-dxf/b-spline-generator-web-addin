/**
 * main/canvas-corners.js -- what sits in each corner of the two canvases, declared once (Fred 2026-10-14, desktop: the
 * 2D/3D toggle covered the heights HUD -- both were pinned top-left on their own). A corner listed with several items
 * becomes a STACK (one absolutely placed column, in the declared order), so its items never collide on any screen; an
 * item placed by its own code (`own`: the view cube's renderer, phase 3's Fit corner that follows the phone drawer) is
 * declared too, so nothing else is ever put in its corner.
 */
export const CANVAS_CORNERS = Object.freeze({
  previewArea: Object.freeze({
    'top-left': Object.freeze(['.view-mode-toggle', '#canvasTotalHeights']), // 2D/3D, then the heights readout
    'top-right': Object.freeze({ own: 'the view cube (core/preview/view-cube.js)' }),
    'bottom-left': Object.freeze(['#heightInspector']),
  }),
  editorCanvasContainer: Object.freeze({
    'top-left': Object.freeze(['.view-mode-toggle', '#editorCanvasTotalHeights']),
    'bottom-right': Object.freeze({ own: 'Fit (main/editor-chrome.js CANVAS_CORNER, above the phone drawer)' }),
  }),
});
export const CORNER_INSET_PX = 10;
export const CORNER_GAP_PX = 6;

// a bottom corner sits above the job timeline strip along the canvas bottom (main/job-timeline-strip.js sets
// --job-strip-height on its host)
export const cornerPos = (corner) => {
  const [v, h] = corner.split('-');
  const vOff = v === 'bottom' ? `calc(${CORNER_INSET_PX}px + var(--job-strip-height, 0px))` : `${CORNER_INSET_PX}px`;
  return `${v}:${vOff}; ${h}:${CORNER_INSET_PX}px; align-items:${h === 'left' ? 'flex-start' : 'flex-end'};`;
};

/** Builds each declared stack (once per host) and moves its items in, in order; an item not on the page yet is skipped
 *  (call again once it is). Returns the selectors not found. */
export function applyCanvasCorners(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return [];
  const missing = [];
  for (const [hostId, corners] of Object.entries(CANVAS_CORNERS)) {
    const host = doc.getElementById(hostId);
    if (!host) { missing.push(`#${hostId}`); continue; }
    for (const [corner, items] of Object.entries(corners)) {
      if (!Array.isArray(items)) continue; // placed by its own code
      let stack = host.querySelector(`:scope > .canvas-corner-stack[data-corner="${corner}"]`);
      if (!stack) {
        stack = doc.createElement('div');
        stack.className = 'canvas-corner-stack';
        stack.dataset.corner = corner;
        stack.style.cssText = `position:absolute; ${cornerPos(corner)} z-index:120; display:flex; flex-direction:column; gap:${CORNER_GAP_PX}px; pointer-events:none;`;
        host.appendChild(stack);
      }
      for (const sel of items) {
        const el = host.querySelector(`:scope > ${sel}`) || stack.querySelector(`:scope > ${sel}`);
        if (!el) { missing.push(`${hostId} ${sel}`); continue; }
        // its own corner pin goes: the stack places it
        Object.assign(el.style, { position: 'static', top: '', left: '', right: '', bottom: '' });
        // the stack lets clicks through to the canvas; its items take them back, unless they let them through too
        if (el.style.pointerEvents !== 'none') el.style.pointerEvents = 'auto';
        stack.appendChild(el);
      }
    }
  }
  return missing;
}
