# LANE B — T33: SE12 design — LIVE expand (lines stay editable, the outline is derived). PLAN ONLY, no code.

**Seat B · epoch 2 · T33.** Fred: "is there a way to draw lines and lattice that are already expanded but keep their
editability?" → approved the LIVE expand idea ("that's the ideal solution"). NO FUSION (hard rule) — browser only.
Deliverable: NEW `SE12-LIVE-EXPAND-DESIGN.md` at the worktree root (+ WORK-LOG-lane-b.md). Read-only on product code.
Seat A is on SE7g (pattern seed + colors) — no overlap.
## The idea (agreed with Fred)
Lines and lattice pieces stay real `<line>/<path>` elements (drag nodes, length, stroke width, Regenerate all keep
working). A per-layer "expanded" setting makes the OUTLINE of each stroke (offset by stroke width/2, caps/joins
respected) derived on the fly — shown faintly in the editor as the true cut contour, used for the carve and for the
Fusion export. The document stores only the lines (single store, SE4 lesson). The existing destructive Expand button
stays for freezing a shape.
## Answer in the doc
1. **Where the outline comes from:** reuse the existing Expand pipeline (`editor-expand*.js`, `expand.js` — trace /
   union / shape) as a PURE function stroke → outline path; what it needs that it doesn't have today; cost per element
   and whether it's fast enough to recompute on every commit (numbers from a quick bench in the browser).
2. **Caching + invalidation:** derived outlines keyed by element + geometry + stroke width (never stored in the SVG);
   when recomputed ('commit' only, per CHANGE_PIPELINE).
3. **The toggle:** a per-layer field (e.g. `outline: boolean`) — where it sits in the layer row next to 👁 · 3D · 🎨,
   persisted, MIGRATIONS default false. Open question for Fred, answered in the doc as options: when expanded, does
   Fusion get the outline only, the centerline only, or both (V-bit engraving follows centerlines; pockets/cuts want
   outlines) — design so it's a data choice, not a code fork.
4. **Carve:** does the raster carve change at all? (It rasterizes the stroke already — likely identical; prove it.)
5. **Display:** how the faint contour is drawn (layer under the sketch, non-interactive, never serialized) and how it
   behaves with the SE9 color / showColor.
6. **Export:** exactly where `bakeSvgForCarving` / export-flow swap lines for outlines.
7. **Slices** with files + verify lines; STOP conditions (text, circles-as-nodes, open vs closed paths, joins at lattice
   crossings — do crossing rails/ties union into one outline or stay separate?).
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T33: SE12 live-expand design — K slices, open question: <…> — <sha>"`
and stop.
