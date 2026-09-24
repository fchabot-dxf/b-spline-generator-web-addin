# LANE B — T14: build SE5 slice (a) of your own design — PRODUCT CODE this time

**Seat B · epoch 1 · T14.** Worktree, branch `lane-b`. Design: `SE5-TOOLING-STORE-DESIGN.md` (be5dc37), approved as
written; §3's open question is RULED by the advisor: tooling-slider undo lives on the EDITOR's undo stack, global
Ctrl+Z stays heightfield-only (only matters for slice c — not this turn).
Files (exactly your slice a): `core/state.js`, `main/stamp/_shared.js`, `main/stamp/svg-source.js`, + a test
(+ WORK-LOG-lane-b.md). **Seat A is editing `editor/` for SE8a on main (path-layout, editor-hit, transform-handles,
editor.js, action-tools, editor-io, text-session) — do NOT touch any file under `editor/`.** If slice (a) turns out to
need one, stop and say so in the pass note instead of editing it. One commit by path, predicted 4 files.

## Do slice (a)
- `updateP` `layerSpecific`: drop the `P.stampLayers` write and its gate; keep only the unconditional write to
  `editor._layers[P.activeLayerIdx][field]` (mirror `bindLayerOnlyNumber`'s pattern — cite it).
- `isFilletActive()`: loop `editor._layers` with `visible !== false`, same shape as `activeLayer()` above it.
- `svg-source.js` Browse-import + sidebar Clear: `setStampLayerEnabled(...)` → `setLayerVisible(editor, layer.id,
  true|false)` (import from `editor/layers.js` — importing is fine, editing it is not).
- Test: a 4-layer editor mock, depth slider on layer 4 (`P.stampLayers[3]` absent) → `editor._layers[3].depth`
  updated; `isFilletActive` true when only layer 4 has a fillet and is visible, false when hidden.

## Verify
`npx vitest run` green (count in WORK-LOG); `node --check` the 3 modules; `git show --stat HEAD` → 4 files + log.
Live proof is the advisor's.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T14: SE5a — updateP/isFilletActive/Browse+Clear on editor layers — <sha>, N files, vitest N"`
and stop.
