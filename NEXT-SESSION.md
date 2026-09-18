# LANE B — T6: pan state can get stuck (Space held when focus leaves) — declare one reset, call it from every exit

**Seat B · epoch 1 · T6.** Worktree `b-spline-generator-web-addin-lane-b`, branch `lane-b`. Files:
`bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js`, `editor/editor-io.js` (open()), maybe
`editor/editor.js` (+ WORK-LOG-lane-b.md). Seat A is in `main/` (SE3a) — no overlap. One commit by path, predicted
**2–3 files** + log.

## Ground truth
SE2 (80da844) tracks Space with keydown/keyup on `window`, both gated by `_isEditorActive`. Seat A flagged it in
WORK-LOG: if focus leaves the modal while Space is held (alt-tab, a native confirm dialog, the palette losing focus —
all common in Fusion's palette host), keyup never arrives → `_spaceHeld` stays true and the next left-click pans
instead of drawing, with the `pan-ready` cursor stuck. Same shape for `_isPanning`/`_panStart` if mouseup is lost
(middle-drag released outside the window).

## Build — one declared reset, four callers
- `export function resetPanState(editor)` in editor-interaction.js: `_spaceHeld=false; _isPanning=false;
  _panStart=null;` and remove both `pan-ready` / `panning` classes from `#editorSVGContainer`. The Space keyup handler
  and the mouseup pan-end branch call it instead of hand-rolling the same three lines each.
- Call it from: (1) `on(window, 'blur', …)` registered in `initInteraction` (focus left the page/palette), (2)
  `open()` in editor-io.js (fresh session never starts pan-ready), (3) the existing document-level mouseup/leave path
  if there is one (`grep -n "mouseup\|mouseleave" editor-interaction.js`) — if the pan end only listens on the svg
  node, move that listener to `window` so a release outside the canvas still ends the pan.
- No new state, no timers.

## Verify
- `node --check` touched modules; `npx vitest run` → 47 green (no new test needed; DOM-bound).
- Greps: `_spaceHeld = false` → only inside `resetPanState`; `classList.remove('pan-ready')` → only there;
  `resetPanState(` → definition + ≥3 callers.
- `git show --stat HEAD` → 2–3 files + log. Live is the ADVISOR's.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T6: resetPanState declared, called from keyup/mouseup/blur/open — <sha>, N files"`
and stop.
