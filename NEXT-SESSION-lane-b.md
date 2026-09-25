# NEXT (lane-b) — T60: DESIGN DOC — SE15 constrained Fusion sketches (docs only)

**Ball: worker (seat B) · epoch 2 · T60.** DOCS ONLY. NO FUSION (the advisor does all Fusion verification). T59
reviewed (966 green, screenshots viewed — handles + kink bar good); it merges to main as soon as seat A's in-flight
drawer fix lands (same files).

## Fred's asks (ROADMAP "Queued — SE15", authoritative)
Send Lattice / Shape Lattice geometry as REAL Fusion sketches with constraints instead of SVG import: PARTIALLY
constrained ("no need to fully lock them"), relationships only (tangent, coincident, horizontal/vertical, symmetric,
tie-end on rail), NO length/position dimensions ("no length needed"), but stroke WIDTH as a dimensioned offset driven
by Fusion user parameters (rail_width, tie_width, node_radius, border_width) with round caps as tangent arcs; shape
presets' own params (waist reach, corner radius, waist position, …) as user parameters where natural.
## Deliver `SE15-CONSTRAINED-SKETCH-DESIGN.md`
- The declared SKETCH MANIFEST (JSON): entities (ids, kind, geometry in model inches), constraints (typed, by entity
  id), parameters (name, value, unit, which dimension drives it), per-layer grouping; how it's produced from the
  editor model (shape preset params + lattice pieces + widths) — pure function.
- The add-in side: read the manifest, build the sketch with the Fusion API (addByTwoPoints / addByThreePoints /
  addByCenterRadius, geometricConstraints.addTangent/addCoincident/addHorizontal/addVertical/addSymmetry,
  sketchDimensions + userParameters, offset for width — research the current API names in the repo's existing
  Python (frame-builder fb_engine does most of this already — cite what's reusable), order of operations to avoid
  solver fights, what to do on a failed constraint (skip + report, never abort the whole send).
- Performance plan for big lattices (hundreds of pieces): what gets constrained vs plain; the plain-geometry fallback
  switch; a size threshold.
- How it coexists with the current SVG path (a Fusion Geometry option or a per-send toggle), and with Outline/Both.
- Slices (manifest+tests in the browser; add-in builder verified by the advisor in Fusion), open questions.
## When done
Commit by path (doc + WORK-LOG), push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T60: SE15 design — <sha>"`
and stop.
