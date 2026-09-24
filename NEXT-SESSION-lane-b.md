# LANE B — T12: full audit of the SVG editor (READ-ONLY; deliverable = AUDIT-SVG-EDITOR.md)

**Seat B · epoch 1 · T12.** Worktree `b-spline-generator-web-addin-lane-b`, branch `lane-b` (synced to main eedda54).
**New task-file name:** lane-b tasks now live in `NEXT-SESSION-lane-b.md` (this file) so merges into main stop
conflicting on NEXT-SESSION.md. Deliverable: NEW `AUDIT-SVG-EDITOR.md` at the worktree root (+ WORK-LOG-lane-b.md).
**No product code, no test files** — seat A is editing `editor/editor-interaction.js`, `editor/editor-grid.js`,
`editor/editor.js` and friends right now (SE7a). Read them at your HEAD; do not touch them. One commit by path.

## Scope
Everything the vector editor is: `bspline-frame-builder/b-spline-gen/html/editor/**` (36 files, ~6.9k lines), the modal
markup + inline script in `bspline_gen_palette.html` (`#svgEditorModal`), `styles/editor.css`, and the host glue that
feeds it: `main/app-init.js` (initSvgEditor, onChange/onCommit, MIGRATIONS), `main/stamp/svg-source.js`,
`main/stamp-mask-manager.js`, `main/export-flow.js`, `core/engine/rebuild.js` (`_collectStampPasses`), the stamp
rasterizer under `core/stamp/`. Fred's goal behind the audit: the editor is becoming a PATTERN tool (lattice of
rails/ties/nodes carved into terrain) that must also work on a phone.

## Already known — do NOT re-report, but DO say if you find they are worse/wider than written (ROADMAP SE7*)
- SE7n: node drag — no branch for rect/circle/ellipse; world pointer written into local attrs (no inverse matrix);
  getNodes (M/L/C/Q only) vs dragNode (full array) index skew.
- SE7s: corner scale uses the pointer's dominant axis, not the anchor→handle direction (×15 on thin ties); handles
  on the world bbox shear rotated elements; scale carried as a transform scales the STROKE (carve width) and Flatten
  silently reverts the width.
- SE7m: mobile — second finger ignored (`editor-interaction.js:233`), wheel/Space/middle/Alt/keys have no touch path.
- SE6 follow-up: grid minor lines vanish over dark topo bands.

## Dimensions — for each, find concrete defects, not style notes
1. **Coordinate spaces.** Today's two bugs share one cause: world vs local (element `transform`) mixed up. Sweep
   EVERY place that reads a pointer, a bbox, a node or an attribute and writes geometry: does it agree on the space?
   (`worldPoint`, `worldBbox`, `transformPoint`, `el.matrix()`, `rbox`, `bbox`, `getCTM`, `x()/y()`.) List each site.
2. **Per-gesture undo + change fan-out.** For every tool gesture: exactly one `pushState` per user action? Does any
   path push per MOVE (undo spam) or never (lost undo)? `_onChange` → remask + rebuild: does any tool fire it per
   pointermove (perf: a full stamp rasterize per mouse event)? Measure with a count, cite lines.
3. **Save → reopen → carve round trip.** What does the editor show vs what `serializeEditor` saves vs what the
   rasterizer carves vs what `bakeSvgForCarving` sends to Fusion? Per element kind (line, rect, circle, ellipse,
   path, polyline, text, expanded text, elements with transforms, hidden layers). Any kind that looks right in the
   editor but carves differently is a HIGH finding. Where cheap, prove with a node script (DOMParser/pure math) and
   quote the output.
4. **Tools vs declarations.** Which per-tool rules are hand-rolled branches that should be declared data (the way
   SNAP_POLICY now is)? e.g. which modes show which toolbar groups, hit tolerances, cursors, which elements each tool
   can act on. Name the table each should become.
5. **Dead / doorless / half-built.** Handlers bound to absent ids, modes with no door, `properties-*` panels nobody
   opens, compatibility shims (the palette has "Invisible interaction elements (needed for JS compatibility)"),
   `dbg()` traces, exports used only locally. Chain each removal (door → handler → state → CSS → test).
6. **Text + Expand.** The text session (20 dbg calls, 396 lines) and Expand pipeline: failure modes, what is lost on
   reopen, what carves.
7. **Layers.** Layer ops (add/remove/rename/reorder/visibility/active) vs the `P.stampLayers` tooling mirror by
   index — any op that desyncs editor layer i from P.stampLayers[i] (reorder, remove in the middle)?
8. **Mobile readiness** beyond SE7m: hit sizes, modal layout at 390 px, anything hover-only.

## Format (same discipline as AUDIT-2026-09.md)
Top: a ranked table — id (SA1…), severity (HIGH/MED/LOW), confidence, one-line claim, file:line. Then one section per
finding: failure scenario (concrete input → wrong output), evidence (quoted lines / script output), proposed fix as a
DECLARATION where one fits, and which SE slice it belongs to (existing SE7n/s/m/b or a new one). End with a proposed
order of new slices. Verify before you claim: a finding without a quoted line or a reproduced number is a hypothesis
— label it so.

## When done
Append WORK-LOG-lane-b.md, commit `AUDIT-SVG-EDITOR.md` + the log by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T12: SVG editor audit — N findings (H/M/L), <sha>"`
and stop.
