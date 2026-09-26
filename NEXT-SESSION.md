# NEXT — UI4: pinned-action style fix + per-piece overrides in the lattice Select tool

**Ball: worker (seat A) · epoch 2 · UI4.** NO FUSION. UI3 (3fd41f9) accepted. Specs are UI3's AMEND 4/4b and AMEND 3
(read them in `handoff.py amendments` history / WORK-LOG). PROGRESS: tick each box (`- [x]`) in THIS file as you commit
that item, and push — the progress page (bspline-status.pages.dev) counts the ticks.

## Checklist
- [ ] 0. BUG FIRST (Fred + advisor reproduced headless on live main): in the SHAPE LATTICE, the Select icon drag shows the
      preview but the piece does NOT move on release — rail body drag moved 0.000 (box Lattice: same drag moves 0.5 and
      attached ties follow, all correct). After a tie drag the shape-lattice pieces were REPLACED (fresh elements) —
      suspect the shape lattice regenerates from its pattern after the drop (boundary refresh / refreshBoundaryPatterns)
      and discards the move. Root-cause; a Select move must persist on both lattice types (ties follow rails, rail ends
      stay on the contour per T73 where applicable). Also: dragging a NODE on the box Lattice didn't move it and left a
      DUPLICATE node (26 -> 27 nodes). Reproduce with real CDP mouse drags (scratchpad pattern: Input.dispatchMouseEvent
      press/move x8/release on the piece's screen point via getScreenCTM). Tests for both lattice types.
- [ ] 0b. BUG (Fred, live): CLEAR the canvas (toolbar Clear) then press Regenerate -> nothing is generated. Reproduce on both
      lattice types; likely the pattern still references a boundary/silhouette element or piece ids that Clear deleted.
      Regenerate after Clear must rebuild from the pattern's own declared data (re-creating the silhouette for the Shape
      Lattice). Test: generate -> Clear -> Regenerate -> pieces present (and contour for shape).
- [ ] 0c. BUG (Fred): layer holds a SHAPE lattice -> switch to the BOX Lattice tool -> its Regenerate rebuilds the SHAPE.
      Rule (declared): the ACTIVE TOOL decides the kind. Box tool Regenerate on that layer = clear the layer's generated
      pieces (Fred's 'regenerate clears and reuses the same layer') and generate a BOX lattice with the box panel's
      settings; Shape tool Regenerate = shape. Each tool's panel shows its own kind's settings even when the layer's
      stored pattern is the other kind. Test both directions.
- [x] 1. Pinned-action style (AMEND 4b): ONE shared sticky style for the main sidebar "Generate New Seed" and both lattice
      Regenerates — top:0 with NO gap above (nothing visible above while scrolling), opaque background full column width,
      full-width button. Root-cause the gap, note it in WORK-LOG.
- [x] 2. Screenshots of all three scrolled mid-list, desktop + ~1024px (iPad) — viewed before ticking.
- [ ] 3. Per-piece overrides (AMEND 3): selected rail/tie/node/contour piece shows COLOUR + WIDTH with an override; stored as
      declared data (data-override-color / data-override-width, one schema), rendered live.
- [ ] 4. Regenerate clears overrides (no warning — Fred); Undo restores them.
- [ ] 5. Tests for 1, 3, 4; full suite green; WORK-LOG entry.
- [ ] 6. BUG (Fred, live): a layer added from the MAIN sidebar (Vector Stamping → Layers +, e.g. "Layer 2") does NOT exist
      in the editor when it opens — the editor shows only Layer 1. Reproduce headless, root-cause (the editor rebuilding
      layers from saved artwork and dropping an EMPTY layer? two layer lists not sharing one source?) and fix by ONE
      declared layer list both surfaces read. Test: add in main → open editor → both layers present, same order/active.
- [ ] 7. The side-column Layers row truncates the name ("Lay…") next to its eye/3D/palette buttons — let the name use the
      available width (buttons compact / name min-width), same fix in the mobile drawer.
Commit by path, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UI4 — <shas>"`.
