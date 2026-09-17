// The one "unsaved changes since the last save/load" state (UX1). Writers: any edit → markDirty();
// a completed save or load → markClean(). Readers subscribe with onDirtyChange(fn).
let _dirty = false; const _subs = new Set();
export function isDirty() { return _dirty; }
export function markDirty() { if (!_dirty) { _dirty = true; _subs.forEach((f) => f(true)); } }
export function markClean() { if (_dirty) { _dirty = false; _subs.forEach((f) => f(false)); } }
export function onDirtyChange(fn) { _subs.add(fn); fn(_dirty); return () => _subs.delete(fn); }
