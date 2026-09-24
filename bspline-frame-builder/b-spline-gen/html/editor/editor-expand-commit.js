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
 * NOTE (SA-TEXT-5, corrected — this used to describe a live bug, not
 * current behavior): the data-original-svg attribute value USED TO
 * contain raw SVG markup with `<` and `>` characters, which HTML
 * innerHTML serialization does not escape in attribute values, making
 * the saved SVG invalid XML. Fixed by EDM2: `commitExpandedPath` below
 * now always base64-encodes the snapshot via `encodeSnapshot` before
 * writing it (see the `snap = encodeSnapshot(...)` line), so new saves
 * are valid XML from the first write. `sanitizeSvgForRaster`
 * (core/stamp/render-svg.js) still strips data-original-(text-)svg
 * before the rasterizer parses, but that's now a defensive no-op for
 * new content — kept as a safety net for saves made before EDM2, which
 * `decodeSnapshot` still reads correctly (legacy-format fallback).
 * Proven by tests/editor-serialization.test.js's "EDM2: base64
 * data-original poison regression" suite.
 *
 * SE8e / SA-TEXT-4: "so the editor's re-edit flow can recover the
 * source" (line 13, above) used to be aspirational — nothing ever read
 * data-original-text-svg back into a live, editable element (only
 * editor-expand-trace.js decoded it, to re-run Expand at a different
 * detail setting, not to restore text). `isUnexpandable`/`unexpand`
 * below are that recovery path, for text specifically — see their own
 * doc comments.
 */
import { fusLog } from '../core/fusion-bridge.js';
import { encodeSnapshot, decodeSnapshot } from '../core/svg-utils.js';
import { dbg } from '../core/debug.js';
import { multiplyMatrix, matrixToString } from './handle-edit.js';

// SE8c/SA-DEAD-1: routed through the declared dbg() gate instead of
// hand-rolling window.__editorDebug === 'EXPAND-COMMIT'.
function _cLog(msg) {
    dbg('EXPAND-COMMIT', msg);
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

/**
 * SE8e / SA-TEXT-4: does `el` carry a live-text-restorable snapshot? Only
 * `data-original-text-svg` counts — a plain shape's `data-original-svg`
 * has no equivalent "editable source" gap the way text content does; this
 * feature exists specifically because expanded TEXT can otherwise never
 * be re-typed, only redrawn from scratch (the audit's own framing).
 */
export function isUnexpandable(el) {
    return !!(el && typeof el.attr === 'function' && el.attr('data-original-text-svg'));
}

/**
 * Restore an expanded text's original <text> element in place, decoding
 * the snapshot commitExpandedPath stashed at expand time (decodeSnapshot
 * — the exact inverse of the encodeSnapshot that wrote it, never a
 * second decoder). Composes the expanded element's CURRENT transform
 * (whatever moving/rotating it since expansion accumulated — a
 * 'geometry'-kind path, per SE7s's HANDLE_EDIT, never gets a SCALE left
 * in transform, only translate/rotate) onto the snapshot's OWN transform
 * (whatever the text had at expand time), so a moved/rotated expansion
 * comes back where it NOW is, not where it was pre-expand — matching
 * multiplyMatrix's established "delta x m0" convention (handle-edit.js,
 * SE7s): m0 = the snapshot's own transform, delta = everything that
 * happened to the expanded path since.
 *
 * Returns the restored <text> element, or null if `el` isn't
 * unexpandable, or the snapshot fails to decode/parse/adopt (logged, not
 * thrown — callers treat null as "did nothing," matching the button's
 * own "disabled / no-op" contract).
 */
export function unexpand(editor, el) {
    if (!isUnexpandable(el)) return null;
    const rawSvg = decodeSnapshot(el.attr('data-original-text-svg'));
    if (!rawSvg) { _cLog('unexpand: snapshot decoded empty'); return null; }

    let node;
    try {
        const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        wrapper.innerHTML = rawSvg;
        node = wrapper.firstElementChild;
    } catch (e) {
        _cLog('unexpand: markup parse threw: ' + e.message);
        return null;
    }
    if (!node) { _cLog('unexpand: snapshot markup parsed to nothing'); return null; }

    // The restored text is a live element again — the expand sentinel
    // belongs to the PATH that's about to be removed, not to it. Left in
    // place, a future re-expand would wrongly "carry forward" THIS
    // snapshot (commitExpandedPath's own carry-forward rule, above)
    // instead of taking a fresh one of whatever the text says by then.
    node.removeAttribute('data-original-text-svg');
    node.removeAttribute('data-original-svg');
    node.setAttribute('data-layer', String(el.attr('data-layer') || '0'));

    editor._sketchLayer.node.appendChild(node);
    const restored = window.SVG && window.SVG.adopt ? window.SVG.adopt(node) : null;
    if (!restored) {
        try { node.remove(); } catch (_) {}
        _cLog('unexpand: SVG.adopt unavailable or failed');
        return null;
    }

    const composed = multiplyMatrix(el.matrix(), restored.matrix());
    const isIdentity = composed.a === 1 && composed.b === 0 && composed.c === 0
        && composed.d === 1 && composed.e === 0 && composed.f === 0;
    restored.attr('transform', isIdentity ? null : matrixToString(composed));

    try { el.remove(); } catch (e) { _cLog('unexpand: expanded element remove() threw: ' + e.message); }
    try { editor._select(restored); } catch (e) { _cLog('unexpand: _select threw: ' + e.message); }
    if (editor.pushState) { try { editor.pushState(); } catch (e) { _cLog('unexpand: pushState threw: ' + e.message); } }
    if (editor._notifyChange) { try { editor._notifyChange('commit'); } catch (e) { _cLog('unexpand: _notifyChange threw: ' + e.message); } }
    _cLog('unexpand committed  layer=' + node.getAttribute('data-layer'));
    return restored;
}
