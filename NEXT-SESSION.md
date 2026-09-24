# NEXT — SE7s: handles never scale the stroke — declared per-kind handle edit, anchor-direction corner scale

**Ball: worker (seat A) · epoch 1 · SE7s.** Source: ROADMAP "SE7s" (three entries — read all three) + Fred's rulings:
"scaling on a tie shouldn't actually scale — only adjust length", "scaling shapes shouldn't scale the stroke
anywhere". Files: `editor/editor-transform-handles.js`, `editor/editor-interaction.js` (handleEnd/drag wiring only),
maybe NEW `editor/handle-edit.js` for the pure math, tests (+ WORK-LOG). SE8b accepted + merged. Seat B is building
SE7b slice 1 in NEW `editor/editor-lattice-pattern.js` + `core/terrain.js` — not yours. One commit by path.

## Ground truth (advisor-confirmed)
- Corner factor uses the pointer's DOMINANT axis (`editor-transform-handles.js` `applyTransformDrag`, the `useX`
  line): a 0.02×3 tie dragged 0.3" sideways from its corner scales ×15; a box jitters ×1.49↔×1.52.
- Handles sit on the WORLD-aligned bbox and scale world X/Y → a side handle on a rotated element shears it.
- The scale is carried as a `transform`, no stroke compensation → editor view AND the stamp raster scale the stroke
  (carve width); Flatten (`bakeMatrixIntoElement`) keeps the OLD stroke-width → it silently jumps back.

## Build — declare it
1. `HANDLE_EDIT = { line:'endpoints', circle:'radius', ellipse:'radii', rect:'geometry', path:'geometry',
   polyline:'geometry', polygon:'geometry', text:'scale' }` (pure module). `line` (every rail/tie): the dragged
   handle moves the endpoint nearest to it ALONG THE LINE'S OWN DIRECTION (length only, angle kept), the other end is
   the anchor; snapped per SNAP_POLICY('select'). Lines drawn with the Line tool follow the SAME rule for now (Fred
   chose length-only for lattice lines; a free-endpoint variant for Line-tool lines is a later option, not this turn).
   `circle`: radius only, centre fixed. `ellipse`: rx/ry independently. `geometry`: baked into coordinates on EVERY
   move from the drag-start geometry snapshot (use SE8a's `normalizeForBake` + `PATH_LAYOUT`, and rect → path only if
   the rect is rotated; an axis-aligned rect scales by x/y/width/height) — never a scale left in `transform`, never a
   stroke-width change. `text`: today's transform scale (font geometry).
2. Corner factor = projection `(n·o)/(o·o)` onto the anchor→handle vector (uniform); side handles unchanged.
3. Rotated single selection: handles in the element's own frame (decompose `m0` into rotation + scale; anchor/handles
   from the local bbox; delta composed in local space). Multi-selection keeps the world frame; each element is edited
   by its own HANDLE_EDIT rule from the shared anchor.
4. Changes go through `_notifyChange('live')` during the drag and `'commit'` at the end (SE8b).
## Verify
Tests: thin tie sideways ×1.00; box corner projection stable; a ×2 side drag leaves `stroke-width` unchanged and no
`scale` in `transform`; a 30°-rotated rect side drag keeps right angles; a line handle drag changes length only
(angle within 1e-9); circle → radius only. `npx vitest run` → 162 + new, green.
## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE7s: HANDLE_EDIT per kind, stroke never scales, projection corner, rotated frame — <sha>, N files, vitest N"`
and stop.
