# NEXT (lane-b) — T38: outline preview you can SEE + SHAPES (Fred: "shapes in priority, eventually text")

**Ball: worker (seat B) · epoch 2 · T38.** NO FUSION for workers — browser proof only. Seat A is on SE7i in the main
checkout and currently also edits editor.js / editor-io.js / layers.js, so T37 isn't merged to main yet (I'll resolve
at merge). Keep edits in your own modules where you can.

**Measured by the advisor in Fusion:** Sketch.importSVG keeps SVG `A` arcs and `<circle>` as TRUE SketchArc/
SketchCircle at exact radii — so exact outlines stay exact in Fusion. Emit arcs, never cubics, wherever the math allows.

## 1. Preview visibility (T37 review finding — fix first)
Your own t37-outline-preview.png shows no visible outline: a 0.02" line in the element's OWN color drawn over a stroke
of the same color is invisible. Make it read at every zoom: `vector-effect: non-scaling-stroke`, ~1px, a contrasting
treatment (e.g. dark 1px line over a 3px white halo, or dashed) — declare the style once (CSS class). Neutral/showColor
rule no longer needed for the line color; drop it if the new style doesn't use element color. Also refresh the
preview on undo/redo, layer switch and document open/restore (not only on edits) — assert each.

## 2. Shapes — OUTLINE_KINDS entries (exact where the math allows)
- Stroke-only closed shapes: outline = OUTER + INNER offset rings (±w/2), round joins, returned as one path with two
  subpaths (evenodd). rect → rounded outer rect (4 lines + 4 quarter `A`) + inner rect (sharp corners; if w ≥ min
  side the inner ring vanishes). circle → two concentric circles (as `A` pairs). polyline (open) / polygon (closed)
  → straight banks + round-join `A` at convex corners, clean miter intersection at concave corners.
- path made ONLY of M/L/H/V/A(circular, rx==ry)/Z → same exact construction (circular arcs offset to concentric arcs).
- Filled shapes (fill mode fill/both): outline = the shape's own edge (exact, no offset); 'both' = edge offset by w/2.
- Ellipses and cubic/quadratic paths: NOT exact by nature — return `{unsupported:'curve'}` this turn (declined, no
  preview); a tolerance-fit is a later turn. Say so in the table's doc.
Pure functions in editor-expand-analytic.js, one per kind, each with area/distance tests like T35 (every bank point
exactly w/2 from the source; rect/circle ring areas analytic).

## Verify
- vitest per kind + preview refresh triggers; `npx vitest run` green.
- CDP screenshots: lattice lines AND a stroked rect, circle, polygon on a layer set to Outline — outlines clearly
  visible at fit zoom and zoomed in.

## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T38: visible preview + shape outlines — <sha>, vitest N, screenshots: <paths>"`
and stop.
