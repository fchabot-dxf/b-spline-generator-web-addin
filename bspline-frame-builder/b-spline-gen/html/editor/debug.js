/**
 * Diagnostic logging gate for the editor.
 *
 * Usage in code:
 *   import { dbg } from './debug.js';
 *   dbg('TEXT-DBG', `handleStart mode=${mode}`);
 *
 * Off by default — every dbg() call is a no-op until the user opts in
 * via the dev console:
 *
 *   window.__editorDebug = true;     // enable all categories
 *   window.__editorDebug = false;    // back to silent
 *
 * Keeping the [CATEGORY] prefix preserved means existing log greps and
 * the "find this string in the code" workflow both still work — only
 * the noise is gone.
 */

let _enabled = false;
if (typeof window !== 'undefined') {
    if (window.__editorDebug === true) _enabled = true;
    Object.defineProperty(window, '__editorDebug', {
        get() { return _enabled; },
        set(v) { _enabled = !!v; },
        configurable: true,
    });
}

export function dbg(category, ...args) {
    if (!_enabled) return;
    console.log(`[${category}]`, ...args);
}

export function dbgWarn(category, ...args) {
    if (!_enabled) return;
    console.warn(`[${category}]`, ...args);
}

export function isDebugEnabled() {
    return _enabled;
}
