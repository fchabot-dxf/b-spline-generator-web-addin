# LANE B — T8: ghost selection after Clear / reopen — declare the session reset, deselect on every content wipe

**Seat B · epoch 1 · T8.** Worktree `b-spline-generator-web-addin-lane-b`, branch `lane-b`. Files:
`bspline-frame-builder/b-spline-gen/html/editor/editor-io.js` (open), `editor/tools/action-tools.js` (Clear),
`editor/editor.js` or `editor/editor-ui.js` (where `_deselect` lives) (+ WORK-LOG-lane-b.md). Seat A is writing a
design doc — no overlap. One commit by path, predicted **2–3 files** + log.

## Ground truth (advisor, live 2026-09-18 08:44, log-confirmed)
After Clear → Apply, then reopen: `open()` logs `children=0` (document truly empty) yet the canvas shows the OLD stroke
as a translucent yellow band WITH transform handles, before any key is pressed. Both Clear (`action-tools.js:18-24`,
`_sketchLayer.clear()` + pushState + onChange) and `open()` (`editor-io.js:464+`, `_sketchLayer.clear()`) wipe the
sketch layer but never deselect: `_selectedElements` still points at the removed nodes and `_highlightLayer` /
`_handleLayer` keep drawing them. Seat B's own T6 already declared `resetPanState`; this is the same shape for
selection.

## Build — one declared reset for "the content is gone"
- Find the existing deselect (`grep -n "_deselect\|export function deselect" editor/`). It must clear
  `_selectedElements`, `_selectedNodes`, the highlight layer and the handle layer. If it already does all four, reuse;
  if it leaves a layer untouched, complete it THERE (one place).
- Call it from `open()` right after `_sketchLayer.clear()` and from the Clear handler before `pushState()`. If
  `editor.deleteSelected()` (editor.js:361+) already deselects after removing, leave it; if not, same call there.
- Prefer a tiny declared `resetContentState(editor)` in editor-ui.js (or next to `resetPanState`) that does
  deselect + node-count UI reset, called from the three sites, over three hand-rolled call pairs.

## Verify
- `node --check` touched modules; `npx vitest run` → 52 green.
- Greps: `_sketchLayer.clear()` sites → each followed (within 3 lines) by the reset call; `resetContentState(` →
  definition + 3 callers (or `_deselect(` if you reuse it directly — say which).
- Live is the ADVISOR's: draw → Clear → OK → no ghost; draw → select → Cancel → reopen → no ghost.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T8: content reset declared, ghost selection gone after Clear/open — <sha>, N files"`
and stop.
