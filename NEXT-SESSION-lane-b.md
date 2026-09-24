# LANE B — T32: editor Undo/Redo — header on desktop, floating bottom-left on touch (Fred)

**Seat B · epoch 2 · T32.** Fred: undo/redo out of the left tool rail; "mobile bottom left, desktop distinct placement".
Today `#editorUndo` / `#editorRedo` sit in the tool rail (palette :1454-1455), bound in `editor/tools/action-tools.js:9-10`.
Files: palette editor modal markup, `styles/editor.css`, tests (+ WORK-LOG-lane-b.md). Seat A idle. One commit by path.
## Build — ONE pair of buttons, placement by CSS (no duplicated controls, no JS layout switching)
- Move the two buttons into ONE `<div class="editor-history" role="group" aria-label="Undo and redo">` (ids and bindings
  unchanged) placed in the editor HEADER, left of Download SVG, as ↶ ↷ icon buttons with titles "Undo" / "Redo" (no
  keyboard hint text — in Fusion, Ctrl+Z belongs to the host).
- `@media (pointer: coarse)` (the SE7m touch rule, same query T16 used): `.editor-history` becomes
  `position: absolute; left: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px))` over the canvas container,
  44 px buttons, a light pill background with shadow, z-index above the canvas but below the pattern sheet's header —
  check it doesn't collide with the Pattern bottom sheet (T24) or the touch action group (SE7m): if the sheet is
  open, lift the pill above it (sheet height via a CSS variable the sheet already sets, or add one).
- Disabled state when there is nothing to undo/redo, if the editor exposes it (check `editor._undoStack` length after
  each pushState/undo/redo — one `updateHistoryButtons(editor)` called from those three places); skip if it needs
  touching editor.js heavily and say so.
- Remove the rail's divider/spacing left behind.
## Verify
Smoke (repo-root serve): desktop screenshot (header) + mobile screenshot (floating bottom-left, with and without the
Pattern sheet open). Undo/redo still work by click. `npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T32: undo/redo header (desktop) / floating bottom-left (touch) — <sha>, screenshots: <paths>"`
and stop.
