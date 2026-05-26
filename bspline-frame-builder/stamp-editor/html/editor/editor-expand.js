/**
 * "Expand" turns a selected element into a filled outline path. Three
 * strategies are tried in order; the first one that handles the element
 * wins.
 */
import { expandText } from './editor-expand-text.js';
import { expandShape } from './editor-expand-shape.js';
import { expandTrace } from './editor-expand-trace.js';
import { fusLog } from '../core/fusion-bridge.js';

function _oLog(msg) {
    if (typeof window !== 'undefined' && window.__editorDebug === 'EXPAND-ORCH') {
        try { console.log('[EXPAND-ORCH] ' + msg); } catch (_) {}
    }
    try { fusLog('[EXPAND-ORCH] ' + msg); } catch (_) {}
}

export async function expandCurrent(editor, detail = 1.0, simplify = 15, accuracy = 1.0, commit = true) {
    if (!editor._selectedElement) {
        _oLog('no selection -> abort');
        return;
    }
    const el = editor._selectedElement;

    // Guard: do not expand elements whose layer is currently hidden.
    // Hidden layers are excluded from stamp/export; expand should be
    // consistent with that — operating on invisible geometry produces
    // confusing results and may corrupt the layer's content silently.
    const elLayerId = el.attr && el.attr('data-layer');
    if (elLayerId != null && Array.isArray(editor._layers)) {
        const layerObj = editor._layers.find(l => String(l.id) === String(elLayerId));
        if (layerObj && layerObj.visible === false) {
            _oLog('element is on a hidden layer -> abort');
            return;
        }
    }

    const opts = { detail, simplify, accuracy, commit };
    _oLog('begin  selType=' + el.type + '  children=' + editor._sketchLayer.children().toArray().length);

    const r1 = await expandText(editor, el, opts);
    _oLog('expandText returned ' + r1 + '  children=' + editor._sketchLayer.children().toArray().length);
    if (r1) return;

    const r2 = await expandShape(editor, el, opts);
    _oLog('expandShape returned ' + r2 + '  children=' + editor._sketchLayer.children().toArray().length);
    if (r2) return;

    _oLog('falling through to expandTrace');
    const r3 = await expandTrace(editor, el, opts);
    _oLog('expandTrace returned ' + r3 + '  children=' + editor._sketchLayer.children().toArray().length);
}
