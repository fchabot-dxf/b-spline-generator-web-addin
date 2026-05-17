/**
 * Baseline-handling utilities for the editor's text tools.
 *
 * Why alphabetic baseline (with a manual ascender offset stored in
 * `data-anchor-y`) instead of `dominant-baseline="hanging"`? The hanging
 * baseline is honored by the live SVG renderer (the editor canvas) but
 * NOT by the same SVG rendered via <img> to a canvas — which is exactly
 * what the stamp pipeline does. That path falls back to alphabetic, so
 * hanging-baseline text would render at a different y in the stamp than
 * in the editor. Storing the user's intended visual top in
 * `data-anchor-y` and computing y = anchor-y + ascender keeps the live
 * render, stamp rasterization, and opentype expand all aligned.
 *
 * Public:
 *   - getAscenderForFont(family, size)   measure ascender for a font
 *   - reanchorTextY(textEl, family, size) keep visual top fixed across
 *                                         font/size changes
 *   - buildTspans(textEl, content, x, y) (re)build the two-tspan
 *                                         user-text + cursor structure
 *   - migrateTextElement(el, defaultFontSize) bring legacy / imported
 *                                         <text> elements into the
 *                                         alphabetic-baseline + anchor-y
 *                                         convention this editor uses.
 */

import { dbg } from './debug.js';

const _measureCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
const _measureCtx = _measureCanvas ? _measureCanvas.getContext('2d') : null;

/**
 * Returns the font's ascender in user units (treating user units as px
 * for measurement). Uses the browser's font metrics via canvas
 * measureText — same metrics the SVG renderer uses, so the offset
 * applied here matches the actual rendered baseline.
 *
 * Falls back to 0.8 * size for the rare browser without
 * actualBoundingBoxAscent (Firefox <74).
 */
export function getAscenderForFont(family, size) {
    if (!_measureCtx || !(size > 0)) return (size || 0) * 0.8;
    const cleaned = String(family || 'Arial').replace(/['"]/g, '').trim();
    _measureCtx.font = `${size}px "${cleaned}", Arial, sans-serif`;
    const m = _measureCtx.measureText('Mg');
    if (typeof m.actualBoundingBoxAscent === 'number' && m.actualBoundingBoxAscent > 0) {
        return m.actualBoundingBoxAscent;
    }
    return size * 0.8;
}

/**
 * Re-anchor a <text> element after a font/size change so its visual top
 * stays at `data-anchor-y`. Updates both the parent <text> y and the
 * inner text-content tspan (when present during an edit session).
 */
export function reanchorTextY(textEl, family, size) {
    const anchorY = parseFloat(textEl.attr('data-anchor-y'));
    if (!Number.isFinite(anchorY)) return;
    const newY = anchorY + getAscenderForFont(family, size);
    textEl.attr('y', newY);
    const inner = textEl.node.childNodes && textEl.node.childNodes[0];
    if (inner && inner.tagName && inner.tagName.toLowerCase() === 'tspan' && inner.hasAttribute('y')) {
        inner.setAttribute('y', newY);
    }
}

/**
 * Rebuild the two-tspan structure inside a <text> element:
 *   tspan[0] = the actual user text  (updated ONLY by the input handler)
 *   tspan[1] = the cursor character  (toggled ONLY by the blink interval)
 * Splitting writes between two children eliminates the race where the
 * cursor blink would clobber an in-flight input update.
 */
export function buildTspans(textEl, textContent, x, y) {
    const node = textEl.node;
    while (node.firstChild) node.removeChild(node.firstChild);

    dbg('COORD_STD', `_buildTspans: placing UI text at (${x},${y})`);

    const tText = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tText.setAttribute('x', x);
    tText.setAttribute('y', y);
    tText.textContent = textContent;

    const tCursor = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tCursor.textContent = '|';

    node.appendChild(tText);
    node.appendChild(tCursor);
}

/**
 * Bring a single <text> element into the alphabetic-baseline +
 * data-anchor-y convention. Two cases handled:
 *
 *   1. dominant-baseline="hanging" (legacy SVGs from older sessions or
 *      external tools): the old `y` was the visual top, so set
 *      anchor-y = old y, clear dominant-baseline, push y down by the
 *      font's ascender so the alphabetic baseline lands at the same
 *      world coord as the visual top used to.
 *
 *   2. No dominant-baseline AND no data-anchor-y (e.g., text imported
 *      from a third-party SVG): assume `y` is already the alphabetic
 *      baseline and back-fill anchor-y = y - ascender so subsequent
 *      font/size changes can re-anchor cleanly.
 *
 * No-op for elements that aren't <text> or are already migrated.
 */
export function migrateTextElement(el, defaultFontSize = 3) {
    if (!el || el.type !== 'text') return;
    const isHanging = el.attr('dominant-baseline') === 'hanging';
    const hasAnchorY = el.attr('data-anchor-y') != null;
    if (!isHanging && hasAnchorY) return;   // already migrated

    const family = (el.attr('font-family') || 'Arial').replace(/['"]/g, '').trim();
    const size = parseFloat(el.attr('font-size')) || defaultFontSize;
    const ascender = getAscenderForFont(family, size);

    if (isHanging) {
        const oldY = Number(el.attr('y') || 0);
        el.attr('data-anchor-y', oldY);
        el.attr('dominant-baseline', null);
        el.attr('y', oldY + ascender);
    } else {
        const curY = Number(el.attr('y') || 0);
        el.attr('data-anchor-y', curY - ascender);
    }
}

