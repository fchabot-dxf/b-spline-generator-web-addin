# LANE B — T20: SE8c (part 1) — dead-code chain removals + debug/font declarations, OUTSIDE seat A's files

**Seat B · epoch 1 · T20.** Worktree, branch `lane-b`. Slice 2 (9ec4635) ACCEPTED, held on lane-b until SE7s passes
(slice 3's drag-end detach hook lives in seat A's file). Note for slice 3 later: generatePattern leaves the ACTIVE layer
on Nodes — restore the user's previous active layer (record it now in WORK-LOG, fix in slice 3).
**Off-limits (seat A, SE7s):** `editor/editor-interaction.js`, `editor/editor-transform-handles.js`, `editor/editor.js`,
any new `editor/handle-edit.js`. Everything else from your own audit's SA-DEAD-* / SA-TEXT-5/6/7 list is yours.
One commit by path (or two if the font declaration is big — say so).

## Do — each removal is a CHAIN (door → handler → state → CSS → test), accounted for in WORK-LOG
- SA-DEAD-1: the 8 hand-rolled `window.__editorDebug === 'X'` gates → the declared `dbg()` / `isDebugEnabled()`
  (`core/debug.js`); add their categories to that gate's doc list. SKIP any site inside the off-limits files and
  list it as a leftover.
- SA-DEAD-2 `updateNodeCountUI` (zero callers) — remove, plus `#editorNodeCountUI` markup and the instance wiring IF
  the wiring is outside `editor.js`; otherwise list the `editor.js` link as a leftover for seat A.
- SA-DEAD-3 doorless Smoothness ids in `properties-expand.js` — remove the dead wiring (Fred can ask for the control
  back later; say so in the log).
- SA-DEAD-4 `editorSelectPanel`, SA-DEAD-5 `editorSidebarToggle`, SA-DEAD-6 stale shim comments, SA-DEAD-7 redundant
  `setMode` branches, SA-DEAD-8 empty `if` (all in `editor-ui.js` / `editor-controls.js` / `layers.js` / the palette).
- SA-TEXT-5 stale doc comment; SA-TEXT-7 `TEXT-DBG` default OFF (match its own comment).
- SA-TEXT-6: ONE font list — `editor-fonts.js` is the declared source; `core/stamp/render-svg.js` imports it, and the
  palette `<select>` is populated from it at bind time (like the grid spacing select). Test: every font the select
  offers is known to the rasterizer.

## Verify
`npx vitest run` green (count); greps: `__editorDebug ===` → only leftover sites in off-limits files; `updateNodeCountUI`
→ 0 or the listed editor.js leftover; font names hand-typed in only one file.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T20: SE8c part 1 — dead chains removed, dbg gates declared, one font list — <sha>, N files, vitest N; leftovers: …"`
and stop.
