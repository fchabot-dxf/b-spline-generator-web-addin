# LANE B — T9: BUGS_OPEN bookkeeping for today's finds (docs only)

**Seat B · epoch 1 · T9.** Worktree `b-spline-generator-web-addin-lane-b`, branch `lane-b`. File: `BUGS_OPEN.md`
(+ WORK-LOG-lane-b.md). One commit by path. Same rubric as your T3 (status line + summary-table row per entry).

## Update / add
- **B12** → `CLOSED f46561a (guarded by tests/stamp-mask-clear.test.js)` — SE3a; advisor live-verified 2026-09-18
  08:45 (Cancel reverts; Clear → Apply clears the carve).
- **B13 (new, from SE4-MIRROR-RETIREMENT-DESIGN.md findings #1+#2):** "Global undo/redo nulls `P.stampLayers[0].svg`
  (`takeSnapshot`'s `stampSvgText` is always null; `applySnapshot` tests `!== undefined`) and `export-flow.js`
  reads that field with no editor fallback → Send-to-Fusion / Export-STEP silently drop the drawing after any undo."
  Status: OPEN — fix in flight as SE4a (seat A). Proof lines: `core/history.js:24`, `main/snapshot-manager.js:41`,
  `main/export-flow.js:40-44`.
- **B14 (new):** "Ghost selection overlay after Clear / reopen — highlight + handle layers survive
  `_sketchLayer.clear()`." Status: `CLOSED 13a2480 (no guard — DOM-bound)`; note the bonus: `_deselect()` also
  missed `_selectionHighlights` for every caller.
- **B15 (new, from the design §3 finding #3):** "Two buttons named Clear with different effects: the sidebar
  `btnStampClear` clears only the mirror (`svg-source.js:73-82`), the editor's `editorClear` clears real content."
  Status: OPEN — scheduled for SE4 slice (b).

## Verify
- Summary table has rows B1–B15; each new `### B` heading has exactly one status line under it.
- `git show --stat HEAD` → BUGS_OPEN.md + log.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T9: BUGS_OPEN B12 closed, B13–B15 added — <sha>"`
and stop.
