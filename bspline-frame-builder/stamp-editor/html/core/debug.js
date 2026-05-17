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
 * VertexColor. The category prefix is preserved in the output so log
 * greps still work.
 */

// Default: only TEXT-DBG (the text editor session trace). Other
// categories stay silent. Override at runtime via window.__editorDebug.
let _flag = 'TEXT-DBG';
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
