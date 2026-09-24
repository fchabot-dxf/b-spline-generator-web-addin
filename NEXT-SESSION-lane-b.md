# LANE B — T19: build SE7b slice 2 — Generate / Regenerate into three layers, saved with the document

**Seat B · epoch 1 · T19.** Worktree, branch `lane-b` (merged with main — SE8b is in: use `editor._notifyChange
('commit')` for the single end-of-generate change, not raw `_onChange`). Slice 1 (8354a5c) accepted. Design §5 slice 2
+ the advisor rulings in your T18 task (anchor as data; **occupied-cell skip is IN this slice**).
Files: `editor/editor-lattice-pattern.js`, `editor/editor-io.js`, NEW `tests/editor-lattice-pattern-emit.test.js`
(+ WORK-LOG-lane-b.md). **Seat A is on SE7s in `editor/editor-transform-handles.js`, `editor/editor-interaction.js`
and maybe a new `editor/handle-edit.js` — do not touch those.** If you need `editor-lattice.js` or `layers.js` changed,
stop and say so rather than editing. One commit by path.

## Do
- `generatePattern(editor, PATTERN)`: resolve extent from the board, gather `occupied` from DETACHED lattice
  elements (have `data-lattice`, lack `data-lattice-gen`) as `"i,j,kind"` keys (world centres via `worldPoint` —
  moved elements count where they ARE), remove owned `[data-lattice-gen="<id>"]`, `computePattern`, create/reuse the
  three layers (Rails/Ties/Nodes, ids stored in `PATTERN.layers`), emit via `emitSegment`/`emitNode` with
  `data-lattice-gen`, ONE `pushState()` + ONE `_notifyChange('commit')`.
- `_serializeLatticePatternAttr` + read in `open()` exactly per §1 (same 3 save sites + 1 open site as
  `_serializeLayersAttr`).
- Tooling defaults for the three layers: pick sensible values (rails V-bit, ties V-bit shallower, nodes ballnose),
  declared as one `LATTICE_LAYER_DEFAULTS` object — Fred tunes them live later.

## Verify — your §6 slice-2 list, plus: a detached tie at column 5 → Regenerate does NOT emit a new tie at column 5.
`npx vitest run` green (count); `git show --stat HEAD` → 3 files + log.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T19: SE7b slice 2 — generatePattern, 3 layers, ownership + occupied skip, data-lattice-pattern persisted — <sha>, vitest N"`
and stop.
