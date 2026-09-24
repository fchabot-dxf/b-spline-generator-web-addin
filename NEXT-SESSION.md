# NEXT — SE9: a color per vector element, for visualising the piece in the editor (never a carve input)

**Ball: worker (seat A) · epoch 2 · SE9.** Fred: "add colors to vectors" → "color per element" → "for simulation, in
editor only". Seat B is on SE7p in `bspline_gen_palette.html` (`#editorLatticePanel` region ONLY), `styles/editor.css`,
`editor/properties-lattice.js` — you may add markup to the palette's STROKE/STYLE toolbar region (not the lattice
panel) and must not touch those two other files. One commit by path.

## Ground truth
- `editor._strokeColor` / `_fillColor` exist (`editor.js:82,87`) and new shapes use them (`properties-shape.js:74-75`),
  but there is no color UI; `setStrokeColor` was removed in SE8d as dead (zero callers) — this brings the capability
  back WITH a door.
- The carve is color-blind: the stamp rasterizer builds its mask from ALPHA only (`core/stamp/index.js:2,165`,
  `core/stamp/sdf.js:38`); the Fusion bake sends geometry. "Editor only" therefore means: color lives on the element for
  display and survives save/reopen, and nothing downstream reads it. Prove that, don't assume it.
## Build
0. **Fred (amend): stroke and fill are ALWAYS the same color per element.** One `editor._color`; setColor writes it
   to stroke AND fill of each selected element (the FILL/STROKE/BOTH mode only decides whether fill is `none`); new
   shapes use it for both. Test: stroke === fill (or fill none) after setColor.
1. One toolbar control "COLOR" next to STROKE: an `<input type="color">` (no alpha — an opaque color can't change
   coverage) plus a short swatch row of presets declared once, `VECTOR_COLORS = ['#000000', '#c62828' (red),
   '#f9c80e' (yellow), '#1a237e' (navy), '#2e7d32', '#ffffff']` — the first four are Fred's piece.
2. `editor.setColor(color)`: sets `_strokeColor` and `_fillColor` for NEW shapes, and recolors the current selection
   (stroke, and fill when the element is filled — respect FILL/STROKE/BOTH); ONE `pushState()` + `_notifyChange('commit')`
   per committed change (`change` event, not `input`). Selecting an element shows its color in the control.
3. Lattice: generated/hand-drawn rails, ties, nodes take the current color like any other element (Fred can color
   the Rails/Ties/Nodes layers' content by selecting it — no per-kind color table unless he asks).
4. Carve-neutral guard (the "editor only" promise): a test that rasterizes the same shape in black and in yellow
   through the real mask path used by the stamp (or its pure part) and asserts identical masks; and a test that the
   Fusion bake output contains no color-dependent geometry change. If any path turns out to read color, strip color
   there (serialize-for-raster forces black) and say so.
## Verify
`npx vitest run` green (rerun once if the whole suite reports "no tests"); smoke screenshot (serve from the REPO ROOT —
see the script header) with a red rail, yellow tie, navy node.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE9: per-element color (picker + VECTOR_COLORS), carve-neutral proven — <sha>, N files, vitest N, screenshot: <path>"`
and stop.
