# LANE B — T21: build SE7b slice 3 — detach-on-drag, Detach all, the Pattern panel, restore active layer

**Seat B · epoch 1 · T21.** Worktree, branch `lane-b` (merged with main 215 tests — SE7s is in: handle drags now go
through HANDLE_EDIT; find where they converge in `handleEnd` before hooking). Design §6 slice 3, with one change:
**the panel lives INSIDE the SVG editor modal**, not in the sidebar: a "Pattern" section in the modal's right-hand
panel above Layers, shown when the Lattice tool (K) is active (same visibility mechanism as the Font group), so it sits
next to the canvas it acts on. Seat A is on SE8d in `editor/editor-io.js`, `editor/editor.js`, `editor/editor-coords.js`
— do not touch those. One commit by path.

## Do
1. `handleEnd` hook (§2): strip `data-lattice-gen` from every element the completed drag moved (node drag, translate,
   transform handle), inside the same `if (editor._dragMoved)` before `pushState()` — one undo step reverts both.
2. "Detach all" (declared once, wired like `editorClear` in `tools/action-tools.js`): strips the tag from every owned
   element of the current pattern; one undo step; nothing moves or is deleted.
3. Panel per §5's mockup (390 px first, no hover-only control): spacing select derived from `GRID_SPACINGS`, rails
   every/offset, ties density / span min-max / **anchor rails|free** (Fred hasn't answered — default rails),
   nodes ends/crossings, seed + reroll, Generate/Regenerate (label from whether `PATTERN.id` exists), Detach all.
   Values bind to `editor._latticePattern` (restored by `open()` from `data-lattice-pattern`), defaults from
   `PATTERN_DEFAULTS`. NEW module for the wiring (e.g. `editor/properties-lattice.js`, matching `properties-*.js`).
4. `generatePattern` restores the user's previously active layer at the end (your slice-2 note).
## Verify
Your §6 slice-3 list + restore-active-layer test. `npx vitest run` green (count). Live 390 px capture is the advisor's.
## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T21: SE7b slice 3 — detach hook, Detach all, Pattern panel in the modal, active layer restored — <sha>, N files, vitest N"`
and stop.
