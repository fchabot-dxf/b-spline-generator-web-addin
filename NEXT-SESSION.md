# NEXT — SE8a: what you see is what carves — declared path layout, no arcs in the bake, undo for style edits

**Ball: worker (seat A) · epoch 1 · SE8a.** Source: `AUDIT-SVG-EDITOR.md` (now on main) — findings SA-ROUNDTRIP-1,
SA-UNDO-2, SA-UNDO-3, SA-TEXT-1, SA-TEXT-2 (read each section; advisor confirmed the first four on main). Files:
NEW `editor/path-layout.js`, `editor/editor-hit.js`, `editor/editor-transform-handles.js`, `editor/editor.js`,
`editor/tools/action-tools.js`, `editor/editor-io.js`, `editor/editor-text-session.js` (only if the teardown lives
there), tests (+ WORK-LOG). One commit by path, predicted **7–9 files**. SE7n accepted (5cea9dd). Seat B is writing a
read-only design doc (tooling store) — no overlap.

## 1. SA-ROUNDTRIP-1 — declare the path command layout ONCE
`_bakeMatrixIntoPath` (`editor-transform-handles.js`) transforms every numeric (i, i+1) pair as a point; for `A` that
corrupts rx/ry, x-axis-rotation and both flags. `shapeToPath` (`:372-410`) turns every circle/ellipse into two arcs,
so every node carved in Fusion is garbage. Your SE7n `getNodes` already hard-codes the same per-command offsets.
- NEW `editor/path-layout.js`: `export const PATH_LAYOUT = { M:{pts:[[1,2]]}, L:{pts:[[1,2]]}, T:{pts:[[1,2]]},
  C:{pts:[[1,2],[3,4],[5,6]]}, S:{pts:[[1,2],[3,4]]}, Q:{pts:[[1,2],[3,4]]}, H:{x:1}, V:{y:1}, A:{arc:true,
  end:[6,7]}, Z:{} }` and `endPoint(seg)` → the segment's end offsets. `getNodes` reads end offsets from it (replace
  the per-branch literals), `_bakeMatrixIntoPath` transforms exactly `pts` (never radii/flags).
- Arcs under a general affine are not arcs: `arcToCubics(prev, seg)` (standard endpoint→centre parametrisation, ≤ 90°
  per cubic) and the bake converts every `A` to cubics FIRST, then transforms points; H/V become L before the bake
  (a rotated H is not horizontal). `shapeToPath` emits circles/ellipses as 4 cubics (κ = 0.5522847498) — no arcs.
- Test: a circle r=0.1 at (1,2) through `carveMatrix(7,9,96)` → every resulting point lies within 1e-3 px of the
  scaled circle; an `A` in a user path rotated 30° → endpoints and midpoint on the transformed ellipse; `PATH_LAYOUT`
  drives getNodes (existing node tests stay green).
## 2. SA-UNDO-2 / SA-UNDO-3 — style edits are gestures
`setStrokeWidth` (`editor.js:191`) has neither `pushState()` nor `_onChange()`; `setStrokeColor` has pushState but no
`_onChange`. Both: exactly one pushState + one _onChange per call when a selection changed. If the stroke-width input
fires per keystroke/spin, make sure it is one undo step per committed value (check the binding — `change`, not `input`).
## 3. SA-TEXT-1 — Cancel tears the text session down
`editorCancel` (`action-tools.js`) calls only `_onCommit(null)`; Apply calls `_commitText()` first. Cancel must end an
active text session WITHOUT committing it (read `editor-text-session.js:283-346` for the cancel path and the
`document` mousedown listener it removes) — declare one `endEditorSession(editor, {commit})` used by both buttons.
## 4. SA-TEXT-2 — font `<defs>` must not accumulate
Read the finding (`editor-io.js:294-332, 465-592`). Fix at the source: strip any existing `defs.rasterization-fonts`
before injecting a fresh one (and on open). Test: serialize → open → serialize three times → exactly one block.

## Verify
- `npx vitest run` → 113 + new, green; `node --check` touched modules.
- Greps: numeric offsets for segment ends appear only in `path-layout.js`; `' A '` no longer emitted by shapeToPath.
- Live (advisor, bridge permitting): lattice nodes sent to Fusion arrive as circles of the right size.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE8a: PATH_LAYOUT + arcs→cubics bake, style-edit undo, Cancel teardown, font defs dedupe — <sha>, N files, vitest N"`
and stop.
