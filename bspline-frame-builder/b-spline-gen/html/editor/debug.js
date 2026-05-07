/**
 * Editor-side debug helper. Re-exports from core/debug.js so editor and
 * core share the single `window.__editorDebug` flag. Toggle once, mute
 * or unmute everything (editor + stamp pipeline + preview).
 */
export { dbg, dbgWarn, isDebugEnabled } from '../core/debug.js';
