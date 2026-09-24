/**
 * App-wide diagnostic logging gate.
 *
 * Off by default — every dbg() / dbgWarn() call is a no-op until enabled
 * from the dev console. The flag accepts three forms:
 *
 *   window.__editorDebug = false            // off (default)
 *   window.__editorDebug = true             // every category
 *   window.__editorDebug = 'TEXT-DBG'       // just one category
 *   window.__editorDebug = ['TEXT-DBG', 'EXPAND']  // a few
 *
 * Categories used in code: TEXT-DBG, COORD_STD, EXPAND, STAMP DEBUG,
 * VertexColor, ERASER, EXPAND-COMMIT, EXPAND-SHAPE, EXPAND-ORCH,
 * EDITOR-IO, PERFORM-EXPAND, STAMP-RASTER, PERF. The category prefix is
 * preserved in the output so log greps still work.
 *
 * PERF (SE8b-2): per-step timing for editor._onChange's change pipeline
 * (main/app-init.js's runChangePipeline) — off by default like every
 * other category; switch it on to see which step (serialize/persist/
 * remask) actually costs what during a drag, in the add-in's log file
 * (fusLog) or the site's own devtools console (this dbg() call).
 */

// SE8c/SA-TEXT-7: default OFF, matching this file's own doc comment
// above ("off by default"/"false // off (default)") — it previously
// defaulted to 'TEXT-DBG' on, silently contradicting itself. Enable a
// category at runtime via window.__editorDebug.
let _flag = false;
if (typeof window !== 'undefined') {
    if (window.__editorDebug !== undefined) _flag = window.__editorDebug;
    Object.defineProperty(window, '__editorDebug', {
        get() { return _flag; },
        set(v) { _flag = v; },
        configurable: true,
    });
}

function _allows(category) {
    if (_flag === true) return true;
    if (!_flag) return false;
    if (typeof _flag === 'string') return _flag === category;
    if (Array.isArray(_flag)) return _flag.includes(category);
    return false;
}

export function dbg(category, ...args) {
    if (!_allows(category)) return;
    console.log(`[${category}]`, ...args);
}

export function dbgWarn(category, ...args) {
    if (!_allows(category)) return;
    console.warn(`[${category}]`, ...args);
}

export function isDebugEnabled(category) {
    return category ? _allows(category) : !!_flag;
}
