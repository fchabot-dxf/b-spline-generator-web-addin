# NEXT — UX1: one declared "unsaved changes" state — confirm before Load discards edits, dot in the header (Fred's ruling)

**Ball: worker (seat A) · epoch 1 · UX1.** Files (under `bspline-frame-builder/b-spline-gen/html/`): `core/dirty.js` (new,
leaf), `core/history.js`, `main/param-manager.js`, `main/cloud-project-manager.js`, `main/app-init.js`,
`bspline_gen_palette.html`. One commit by path, predicted **6 files (1 new)**.

## Ground truth (advisor-verified)
- Change signals: `core/history.js:24` `takeSnapshot(label)` (3 callers: sculpt strokes ×2, and `app-init.js:65`
  `takeSnapshot("Initial")` at load — that one must NOT count as an edit); `main/param-manager.js:64` `applyParam(key,
  value)` (every slider/field change; NOT snapshotted today).
- Save/load points in `main/cloud-project-manager.js`: `quickSave` success at `:834-835` (`✓ Saved`); `_loadFrom` (`:940`)
  fetches then `applySnapshot(...)` `:949` + `setCurrentFile(name)` `:951` — this is where unsaved edits are silently
  discarded (by design symmetry with Quick Save; ruling: ask first). Check whether Save As shares the `:834` success path.
- Header: `bspline_gen_palette.html:279-288` `.cad-nav-titlebox` holds title, `#build-badge`, `#fmCurrentFileLabel`.
- No dirty notion exists anywhere today (`grep -i dirty` → only the build-stamp badge and a sculpt-stroke local).

## Do
1. **Declare it once** — `core/dirty.js` (no imports):
   ```js
   // The one "unsaved changes since the last save/load" state (UX1). Writers: any edit → markDirty();
   // a completed save or load → markClean(). Readers subscribe with onDirtyChange(fn).
   let _dirty = false; const _subs = new Set();
   export function isDirty() { return _dirty; }
   export function markDirty() { if (!_dirty) { _dirty = true; _subs.forEach((f) => f(true)); } }
   export function markClean() { if (_dirty) { _dirty = false; _subs.forEach((f) => f(false)); } }
   export function onDirtyChange(fn) { _subs.add(fn); fn(_dirty); return () => _subs.delete(fn); }
   ```
2. Writers: `takeSnapshot` calls `markDirty()` unless `label === "Initial"` (add a second optional parameter instead
   if you prefer: `takeSnapshot(label, stampSvgText, { edit = true } = {})` and have app-init pass `{edit:false}` —
   pick one, say which). `applyParam` calls `markDirty()` after it accepts the value.
3. Clean points: after the `✓ Saved` success (`:834`) → `markClean()`; in `_loadFrom` after `setCurrentFile(name)` →
   `markClean()`; `applySnapshot` on undo/redo does NOT touch it.
4. **Confirm before discard:** at the top of `_loadFrom`, `if (isDirty() && !window.confirm('You have unsaved changes.
   Reload the project and lose them?')) return false;`. Quick Save is unchanged (it saves, it never discards).
5. **The dot:** in the title box, before `#fmCurrentFileLabel`, `<span id="dirty-dot" class="cad-nav-version" title="Unsaved
   changes" hidden>●</span>`; in `cloud-project-manager.js` `init` (where the header is wired) subscribe:
   `onDirtyChange((d) => { const el = document.getElementById('dirty-dot'); if (el) el.hidden = !d; })`.

## Verify
- `node --check` ×5 JS; `npx vitest run` → 29 (history.js/state.js paths under test). Headless: `import` dirty.js in
  node, assert markDirty/markClean/onDirtyChange semantics (paste output).
- Greps: `markDirty(` → 2 call sites (history, param-manager); `markClean(` → 2; `confirm(` → 1 in `_loadFrom`;
  `dirty-dot` → 2 (html + js).
- `git show --stat HEAD` → 6 files. Web/Fusion look is the ADVISOR's (move a slider → dot appears; Quick Save → dot
  gone; Load with edits → prompt).

## Do NOT
Add a beforeunload prompt, touch undo/redo semantics, or the Project Manager's other actions.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UX1: core/dirty.js declared; takeSnapshot(non-Initial)+applyParam mark dirty; save/load mark clean; _loadFrom confirms when dirty; #dirty-dot in header — <sha>, 6 files; vitest 29. Next: UX2."`
and stop.
