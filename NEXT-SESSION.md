# NEXT — UX-UNDO + SE5c: every sidebar slider is undoable, one step per release (Fred: "yes do it")

**Ball: worker (seat A) · epoch 2 · UX-UNDO.** Ruling on record (ROADMAP "undo follows where the change was made" +
"CORRECTION… UX-UNDO"): sidebar controls (global params, seed, filters, per-layer tooling on the editor layer) → the
palette's GLOBAL undo; drawing content → the editor's own stack (unchanged). Today `takeSnapshot` (`core/history.js:25`)
is called only by sculpt stroke/clear and the initial snapshot — no slider makes an undo step. Seat B is on tie snapping
(`editor/editor-lattice*.js`) — not yours. Files: `core/history.js`, `main/snapshot-manager.js`, the sidebar binders
(`main/stamp/_dom-binders.js`, `core/ui-utils.js`, `core/noise/tweaks-ui.js` — grep every sidebar control binding),
`core/state.js` if updateP is the funnel, tests (+ WORK-LOG). One commit by path (two if big).
## Build — declared, not per-control
1. `UNDO_SCOPE` (one table): control group → 'global' | 'none' (e.g. purely visual view toggles 'none'). Every sidebar
   control binding reads it; no per-control ad-hoc `takeSnapshot` calls.
2. ONE step per committed value: take the snapshot on `change` (slider release / number commit / select change), never
   on `input`. Rapid +/− stepper clicks: coalesce within 400 ms into one step (declare the window).
3. SE5c: the snapshot captures per-layer TOOLING from `editor._layers` (depth, profile, angle, blur, smoothing,
   suppression, fillets, tx/ty/rotation/scale/mirror, visible, carve, showColor) — NOT content (`P.editorSvg` stays out,
   per SE4c) — and `applySnapshot` restores it + triggers the same remask/rebuild a slider change does.
4. Undo/redo buttons (top bar, UX3) and Ctrl+Z/Y already route to unifiedUndo/Redo — just verify.
## Verify
Tests: a slider change → exactly one new history entry; five quick stepper clicks → one entry; undo restores the prior
value and the per-layer tooling; a drawing edit does NOT create a global entry; redo works. `npx vitest run` green.
Live (Fusion bridge up): change Plunge Depth, toggle a layer's 3D, Ctrl+Z twice → both revert, carve updates.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UX-UNDO + SE5c: UNDO_SCOPE, one step per release, layer tooling in snapshots — <sha>, vitest N"`
and stop.
