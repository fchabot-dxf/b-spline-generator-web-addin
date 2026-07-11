/**
 * Shared commit step for every expand strategy.
 *
 * Before this helper existed, editor-expand-shape.js,
 * editor-expand-text.js, and editor-expand-trace.js each duplicated the
 * same trailer:
 *
 *   - Create a <path> on the sketch layer with the computed `d`.
 *   - Set fill="#000000", stroke="none", fill-rule="evenodd",
 *     data-layer matching the original.
 *   - Clear transform (it's already baked into d).
 *   - Stash the pre-expand element under data-original-svg (or
 *     data-original-text-svg for text), so the editor's re-edit flow
 *     can recover the source.
 *   - Remove the original, select the replacement, push undo state.
 *
 * Three near-identical copies meant subtle drift — text used clone() to
 * strip selection classes before snapshotting; shape and trace did not.
 * Trace looked up the previous original-svg/text-svg before falling back
 * to a fresh snapshot; shape always overwrote. Centralizing the logic
 * here makes the contract explicit and changes propagate to all three
 * strategies at once.
 *
 * NOTE: the data-original-svg attribute value contains raw SVG markup
 * with `<` and `>` characters. HTML innerHTML serialization does NOT
 * escape those in attribute values, so the resulting saved SVG is
 * INVALID XML. The stamp rasterizer's DOMParser (strict
 * image/svg+xml) silently drops any element carrying such an
 * attribute. Mitigation lives in core/stamp/render-svg.js's
 * sanitizeSvgForRaster, which strips data-original-(text-)svg before
 * the rasterizer parses. Don't change that without also changing this.
 */
import { fusLog } from '../core/fusion-bridge.js';
import { encodeSnapshot } from '../core/svg-utils.js';

function _cLog(msg) {
    if (typeof window !== 'undefined' && window.__editorDebug === 'EXPAND-COMMIT') {
        try { console.log('[EXPAND-COMMIT] ' + msg); } catch (_) {}
    }
    try { fusLog('[EXPAND-COMMIT] ' + msg); } catch (_) {}
}

/** Snapshot a sketch element as an SVG markup string, with transient
 *  selection / hover classes removed. Uses clone() so the original
 *  isn't mutated. svg.js's clone() inserts the clone into the parent
 *  by default — the explicit remove() prevents a ghost from leaking
 *  into the sketch layer. */
function _snapshotMarkup(el) {
    let tmp;
    try { tmp = el.clone(); } catch (_) { return el.svg(); }
    try { tmp.removeClass('svg-selected'); } catch (_) {}
    try { tmp.removeClass('svg-hover'); } catch (_) {}
    let s;
    try { s = tmp.svg(); } catch (_) { s = ''; }
    try { tmp.remove(); } catch (_) {}
    return s;
}

/**
 * Commit an expanded path. Returns the new svg.js element on success,
 * null on failure (caller should typically `return false` to let the
 * orchestrator fall through to the next strategy).
 *
 * Options:
 *   - commit       (default true): call editor.pushState() at the end.
 *   - isText       (default false): if true, prefer data-original-text-svg
 *                  over data-original-svg (text-expanded re-edit needs the
 *                  sentinel to know the source was a <text>).
 *   - extraAttrs   (object, optional): extra attributes to set on the new
 *                  path before the original is removed (e.g. for debugging).
 *
 * Metadata preservation rules:
 *   1. If the original already carries data-original-text-svg or
 *      data-original-svg (i.e. we're re-expanding an already-expanded
 *      element), pass that through unchanged.
 *   2. Otherwise, snapshot the original via clone() (with selection /
 *      hover classes stripped) and store it as
 *      data-original-text-svg for text expansions,
 *      data-original-svg for everything else.
 */
export function commitExpandedPath(editor, originalEl, d, options) {
    const opts = options || {};
    const commit = opts.commit !== false;
    const isText = opts.isText === true;
    const layer = originalEl.attr('data-layer') || '0';

    if (!d || typeof d !== 'string' || !d.trim()) {
        _cLog('commit aborted: empty d');
        return null;
    }

    let expanded;
    try {
        expanded = editor._sketchLayer.path(d)
            .fill('#000000')
            .stroke('none')
            .attr('fill-rule', 'evenodd')
            .attr('data-layer', layer);
    } catch (e) {
        _cLog('sketchLayer.path() threw: ' + e.message);
        return null;
    }

    // Clear transform — it's been baked into the path's d coords.
    expanded.attr('transform', null);

    // Carry forward existing metadata if the original came from a
    // previous expansion. Otherwise snapshot fresh, picking the
    // attribute that matches this strategy's input type.
    const carriedText = originalEl.attr('data-original-text-svg');
    const carriedSvg  = originalEl.attr('data-original-svg');
    if (carriedText) {
        expanded.attr('data-original-text-svg', carriedText);
    } else if (carriedSvg) {
        expanded.attr('data-original-svg', carriedSvg);
    } else {
        // base64-encode so the raw <>-markup can't invalidate the containing
        // SVG's XML (EDM2). carried* values (above) are already encoded.
        const snap = encodeSnapshot(_snapshotMarkup(originalEl));
        expanded.attr(isText ? 'data-original-text-svg' : 'data-original-svg', snap);
    }

    if (opts.extraAttrs) {
        for (const k of Object.keys(opts.extraAttrs)) {
            try { expanded.attr(k, opts.extraAttrs[k]); } catch (_) {}
        }
    }

    try { originalEl.remove(); } catch (e) { _cLog('originalEl.remove() threw: ' + e.message); }
    try { editor._select(expanded); } catch (e) { _cLog('_select threw: ' + e.message); }
    if (commit && editor.pushState) {
        try { editor.pushState(); } catch (e) { _cLog('pushState threw: ' + e.message); }
    }
    _cLog('committed  isText=' + isText + '  dLen=' + d.length +
          '  layer=' + layer);
    return expanded;
}
