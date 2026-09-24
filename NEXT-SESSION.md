# NEXT — SE8e: Un-expand — an expanded text can become editable text again (SA-TEXT-4)

**Ball: worker (seat A) · epoch 1 · SE8e.** SE8d accepted + merged with SE7b slice 3 (main 231 tests). Seat B is on
SE7m (mobile): `editor/editor-interaction.js`, `editor/editor-transform-handles.js`, `editor/editor-hit.js`,
`editor/editor-grid.js`, `editor/editor-ui.js`, the palette modal markup for a touch action group, `styles/*` — do NOT
touch those. Your files: `editor/editor-expand-commit.js`, `editor/editor-expand-trace.js` (read), NEW action in
`editor/tools/action-tools.js`, one rail/toolbar button (tell me where you put it — if it must go in the palette markup,
add ONLY that one button line and say so, seat B edits other regions of that file), tests (+ WORK-LOG).
One commit by path.

## Ground truth: AUDIT-SVG-EDITOR.md SA-TEXT-4 (line 397+)
Expand stores the original as base64 `data-original-text-svg` / `data-original-svg` (`editor-expand-commit.js:107-121`,
decoded only by `expand-trace.js:46` to re-run Expand). No path restores an editable `<text>`; Ctrl+Z is wiped on every
reopen (`open()`).
## Build
- `unexpand(editor, el)`: decode the stored original (reuse the existing `decodeSnapshot` — do not write a second
  decoder), replace the expanded group/path with the restored `<text>` IN PLACE (same `data-layer`, the expanded
  element's CURRENT transform composed onto the original's so a moved expansion comes back where it now is), select
  it, ONE pushState + `_notifyChange('commit')`.
- A declared rule for which elements are un-expandable: `isUnexpandable(el)` = has the stored original attr. The
  button is enabled only for a selection where every element is un-expandable.
- Button: "Un-expand" next to the existing Expand controls (the Expand group is contextual — show it there).
## Verify
Tests: expand → unexpand round-trip returns the same text content/font/size; a moved expansion comes back at the moved
position; a path without the attr → button disabled / no-op. `npx vitest run` → 231 + new, green.
## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE8e: Un-expand (decodeSnapshot reuse, transform kept) — <sha>, N files, vitest N"`
and stop.
