# NEXT (lane-b) — T73: SE14b — Shape Lattice contour as selectable, per-segment-colourable SEGMENTS

**Ball: worker (seat B) · epoch 4 · T73.** NO FUSION. T72 (57ab890) accepted pending the advisor's merge gate.
Fred: "we should also represent those separations in the add-in preview, to be able to select segments and color them";
"contour can have per segment colors within lattice right?" → yes, this task.
Your own investigation is in WORK-LOG-lane-b.md (T70/SE14b section of the capacity report, b62fd4d): rendering
pipeline, the boundary-resolution-reads-one-DOM-element hazard (lattice-fill clipping relies on it), the segment-tap
interaction question, the colour-persistence design. Use it.
- The contour is drawn as ONE ELEMENT PER SEGMENT (line / circular arc), round caps, stroke = the contour's width (auto
  = lattice stroke width, T72 item 6), from the SAME segment list the manifest reads (seg ids + geometry). One
  declaration, two consumers; the parity test covers segments.
- Each segment selectable with the normal select tool and recolourable; the T72 contour colour is the default, a
  per-segment colour overrides it (left ≠ right allowed). Store overrides keyed by segment id in the pattern.
- The fill/clip boundary stays ONE closed loop DERIVED from the segments (not stored twice) — keep lattice clipping,
  the show-contour checkbox (SE14c) and Border width auto working.
- A regenerate with the same segment count keeps per-segment colours; a count change resets them (say so in the log).
- SVG export / Send to Fusion / drape preview show per-segment colour.
- Tests: N drawn segments = N manifest contour entities; recolour one → only it changes; regenerate keeps it; the
  checkbox off hides all segments. Render hourglass + bottle with two segments recoloured, VIEW them before passing.
Pass back: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 4 — T73: SE14b — <sha>, tests"`.
