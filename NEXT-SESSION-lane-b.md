# NEXT (lane-b) — T70: SE14b — Shape Lattice CONTOUR as separate selectable, colourable SEGMENTS in the app

**Ball: worker (seat B) · epoch 2 · T70.** NO FUSION. T69 (02b9100) is being verified by the advisor in Fusion now; if it
needs a fix you will get an `amend`.
Fred: "we should also represent those separations in the add-in preview, to be able to select segments and color them".
- The generated silhouette is drawn as ONE ELEMENT PER SEGMENT (line / circular arc, round caps, stroke = stroke_width,
  colour per segment), not one path. Each is selectable and recolourable with the normal select tool.
- The per-segment list must be the SAME piece list the manifest reads (seg0..segN, same ids and geometry): one
  declaration, two consumers. The T68 parity test (tests/parity-app-manifest.test.js) must cover the contour segments.
- The fill boundary = the segments chained into one closed loop — DERIVED at render time, not stored twice.
- Straight/curve/kink styling stays mirrored per left/right pair; COLOUR is per segment (left ≠ right allowed).
- A colour set on a segment survives a regenerate with the same segment count (key it by segment id); a count change
  may reset it — say which in the WORK-LOG.
- Drape/3D preview and SVG export also show per-segment colour.
- Tests: N segments rendered = N manifest contour entities; recolour one segment → only it changes; regenerate keeps it.
  Render the default hourglass + bottle with two segments recoloured to PNG and VIEW them before passing.
Pass back: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T70: SE14b contour segments — <sha>, tests"`.
