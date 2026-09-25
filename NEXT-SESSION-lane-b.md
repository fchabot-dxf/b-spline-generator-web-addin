# NEXT (lane-b) — T52: DESIGN DOC — SE14 Shape Lattice tool (per-segment shape styles) + split from the box Lattice

**Ball: worker (seat B) · epoch 2 · T52.** DOCS ONLY. NO FUSION. T50/T51 reviewed + merged (844 green; advisor viewed
07-RESHOT: rails only inside the inner stroke edge, none in the band — correct).

## Fred's decisions (read ROADMAP.md "Queued — SE14" — authoritative)
- "The shape lattice and lattice box are different" → TWO TOOLS sharing one engine. The box `#` Lattice goes back to
  simple (the SE13 Boundary row moves OUT of it); a NEW Shape Lattice tool gets its own rail icon + drawer tab/desktop
  panel (MOB3 TOOL_PANELS table) with a SHAPE section + the same Fill settings (spacing, rails, ties, nodes, colors,
  widths, ending rule, border) + Generate.
- Shape source: GENERATE a mirrored hourglass/bust silhouette (seed; neck / chin / waist proportions) OR PICK any
  closed shape on the canvas (the SE13 link, unchanged).
- "Shape tool just has more settings for shape refinement, perhaps per shape segment toggle for curve, straight or
  kinked line" → per-SEGMENT style: straight | curve (true arc, bulge in↔out) | kink (sharp point in/out). Pick a segment
  from a list or by tapping it on the canvas; mirrored pairs change together; corner rounding radius.
- Output = exact L + circular A → ordinary node-editable path, exact carve/Outline export/Fusion.

## Sources
`reference/svgcreator-deployed/`: pathloop.js (style table + keypoint params), utils.js resolveGenerator :110 +
decomposeSegment (bulge → arcs, joint radius fillets), main.js :174-233 (neck/chin proportion zones).
`C:/Users/danse/APPS/SVG creator/src/envelope.js` (older waist-envelope: waist pos/width, pinch, CURVES table).
## Deliver
`SE14-SHAPE-LATTICE-DESIGN.md`: the two-tool split (what moves where, migration of existing SE13 boundary layers),
the silhouette data model (declared keypoint/segment table, per-segment {style, bulge, dir}), the generator
(seed → proportions → segments → exact primitives), segment picking on canvas, how a generated shape relates to the
fill (generated path is the linked boundary; editing segment styles regenerates the path + refills; hand node-edits
→ detaches the path from the generator, say how), UI mock (desktop panel + phone drawer), slices, open questions.
## When done
Commit by path (doc + WORK-LOG), push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T52: SE14 shape lattice design — <sha>"`
and stop.
