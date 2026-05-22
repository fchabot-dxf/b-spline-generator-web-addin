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
 * Rebuild the inner structure of a <text> element to hold multi-line
 * content. Output is one <tspan> per line, plus a final cursor <tspan>
 * positioned at `caretPos` (character offset into the full text). The
 * cursor tspan carries class "editor-caret" so the blink interval can
 * find it without relying on a brittle child-index.
 *
 *   Each text line tspan: x=lineStartX, dy=lineHeight (0 for first line)
 *   Cursor tspan: standalone "|" placed at the caret's (x, y), opacity
 *                 toggled by the blink loop.
 *
 * lineHeight is approximated as 1.2× the font size — same heuristic
 * used by the rest of the layout.
 *
 * Caller responsibilities:
 *   - pass `caretPos = currentText.length` when not actively editing
 *   - call again after every text mutation OR selectionStart change so
 *     the cursor position stays in sync with the textarea's caret.
 */
export function buildTspans(textEl, textContent, x, y, caretPos) {
    const node = textEl.node;
    while (node.firstChild) node.removeChild(node.firstChild);

    const family = (textEl.attr('font-family') || 'Arial').replace(/['"]/g, '').trim();
    const size = parseFloat(textEl.attr('font-size')) || 3;
    const lineHeight = size * 1.2;

    const lines = String(textContent || '').split('\n');
    const hasCaret = caretPos != null;
    if (!hasCaret) caretPos = lines.join('\n').length;

    dbg('COORD_STD', `_buildTspans: placing UI text at (${x},${y}) lines=${lines.length} caret=${hasCaret ? caretPos : 'none'}`);

    lines.forEach((line, i) => {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        t.setAttribute('x', x);
        if (i === 0) t.setAttribute('y', y);
        else         t.setAttribute('dy', lineHeight);
        // Use an empty space for empty lines so the tspan still occupies
        // a line. SVG.js / DOM collapses empty text content otherwise,
        // shrinking the line into the previous one.
        t.textContent = line.length ? line : ' ';
        node.appendChild(t);
    });

    if (!hasCaret) return;  // post-commit render — no caret tspan

    // Compute caret position from caretPos within the multi-line content.
    // Walk lines, counting characters, to find which line the caret sits
    // on and at what column.
    let remaining = caretPos;
    let caretLine = 0;
    for (let i = 0; i < lines.length; i++) {
        if (remaining <= lines[i].length) { caretLine = i; break; }
        remaining -= lines[i].length + 1; // +1 for the \n consumed
        caretLine = i + 1;
    }
    if (caretLine >= lines.length) {
        caretLine = lines.length - 1;
        remaining = lines[caretLine].length;
    }
    const caretCol = Math.max(0, Math.min(remaining, lines[caretLine].length));

    // Measure the caret's x by measuring the line's prefix width with
    // the same font we're rendering. _measureCtx is the shared canvas
    // context defined above for ascender measurement.
    const prefix = lines[caretLine].slice(0, caretCol);
    let caretX = x;
    if (_measureCtx) {
        _measureCtx.font = `${size}px "${family}", Arial, sans-serif`;
        caretX = x + _measureCtx.measureText(prefix).width / size * size;
        // Note: the measureText width is in CSS pixels at this font px
        // size — and we're treating SVG user units == px for measure
        // purposes (the same convention getAscenderForFont uses). So
        // adding `width` directly to x in user units is consistent.
        caretX = x + _measureCtx.measureText(prefix).width;
    }
    const caretY = y + caretLine * lineHeight;

    const tCursor = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tCursor.setAttribute('class', 'editor-caret');
    tCursor.setAttribute('x', caretX);
    tCursor.setAttribute('y', caretY);
    tCursor.textContent = '|';
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

