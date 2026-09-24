# LANE B — T23: SE8c part 2 — the four hand-rolled rule sets become declared tables (SA-DECL-1..4)

**Seat B · epoch 1 · T23.** Worktree, branch `lane-b`. SE7m (c42dfea) ACCEPTED, held until seat A passes SE8b-2
(seat A: `main/app-init.js`, `editor/editor.js`, `core/debug.js` — off-limits). Source: your audit SA-DECL-1..4.
One commit by path (two if big — say so). No behaviour change: every table must reproduce today's behaviour exactly.

## Do — one table each, next to the tables that already exist (MODE_HINTS, SNAP_POLICY, HANDLE_EDIT, INPUT_PROFILE)
1. **SA-DECL-1:** `createDrawingShape` / `updateDrawingShape` per-tool if/else (`editor-interaction.js`) →
   `DRAW_SHAPES = { line:{create, update}, rect:{…}, circle:{…}, draw:{…} }`; the handlers read it.
2. **SA-DECL-2:** toolbar-group visibility per mode (`editor-ui.js` `updateToolbarVisibility`, plus SE7a's lattice
   toggle and SE7b's Pattern panel and SE7m's touch group) → `TOOLBAR_GROUPS = { mode: [groupIds…] }` (or
   `{groupId: predicate}` if a group depends on selection, e.g. Font for a selected text) — ONE function applies it.
3. **SA-DECL-3:** any hit-tolerance literal left after SE7m's INPUT_PROFILE — list what remains; each becomes a named
   INPUT_PROFILE field or a named constant with a reason.
4. **SA-DECL-4:** element-kind capabilities repeated as `.type ===` branches (`properties-shape.js` fillable,
   `editor-interaction.js`, `editor-hit.js` node-editable) → `ELEMENT_CAPS = { line:{fill:false, nodes:true, …}, … }`
   next to HANDLE_EDIT (same keys — consider folding HANDLE_EDIT into it as one field; say which you chose and why).
## Verify
All existing tests green, unchanged; new tests only for the table lookups. Greps: `.type === '` branches remaining in
the three files — listed in WORK-LOG with a reason each.
## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T23: SE8c part 2 — DRAW_SHAPES, TOOLBAR_GROUPS, tolerances, ELEMENT_CAPS — <sha>, vitest N"`
and stop.
