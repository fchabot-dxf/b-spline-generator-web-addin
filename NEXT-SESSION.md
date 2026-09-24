# NEXT — SE7c: generated and hand-drawn lattices look like the piece — declared widths, inset from the edge

**Ball: worker (seat A) · epoch 2 · SE7c.** First task for this seat after the reboot. Files: `editor/editor-lattice.js`,
`editor/editor-lattice-pattern.js`, tests (+ WORK-LOG). Seat B is on the Pattern panel layout + pinch (palette markup,
`styles/editor.css`, `editor/properties-lattice.js`, `editor/editor-input.js`, `editor/editor-interaction.js`) — not yours.
One commit by path.

## Ground truth (advisor, live site 3a99ef8, headless Chrome — ROADMAP "Live browser test 2026-09-24")
A first rail reads `x1=0 y1=0 x2=7 y2=0 stroke-width=0.5`; a node `cx=0 cy=2 r=0.05`; board 7×9, editor stroke 0.5.
Rails every 2 rows at 0.25" spacing = 0.5" apart with a 0.5" stroke → neighbouring rails touch, the pattern is one
mass. Nodes are 10× thinner than the lines. Rails/nodes on the board edge are cut in half. `emitSegment` uses
`editor._strokeWidth` for BOTH the generator and the hand-drawn Lattice tool.
Tool: `node scripts/smoke-editor.mjs <outDir> desktop` (headless Chrome, no deps) prints these probes + a screenshot
— after you push, it runs against the live site; for local checks pass `http://localhost:…` as the 3rd arg if you
serve the html folder (e.g. `npx http-server bspline-frame-builder/b-spline-gen/html -p 8765`).

## Build — declare the proportions once, relative to spacing
- `LATTICE_STYLE = { rail: { widthFactor: 0.28 }, tie: { widthFactor: 0.22 }, node: { radiusFactor: 0.30 } }` (× grid
  spacing; nodes visibly larger than the lines they sit on, as in the photo). `emitSegment` / `emitNode` take their
  width/radius from it (via the kind), NOT from `editor._strokeWidth`; the hand-drawn Lattice tool gets the same
  proportions. Remove `LATTICE_DEFAULTS.nodeRadiusFactor` if LATTICE_STYLE supersedes it (one source).
- Extent inset: `PATTERN.margin` (in lattice cells, default 1) — `'board'` extent becomes `[margin .. last-margin]` on
  both axes, so nothing sits on the edge.
- Keep existing documents working: generated elements store their own stroke-width attr, so old saves render as before.
## Verify
Tests: rail stroke-width = 0.28 × spacing; node r = 0.30 × spacing; with margin 1 no segment/node coordinate is 0 or
the board size; hand-drawn lattice rail uses the same width. `npx vitest run` green (rerun once if the whole suite reports
"no tests"). After pushing, run the smoke script and look at the screenshot — the rails/ties/nodes must be distinct.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE7c: LATTICE_STYLE widths + margin — <sha>, N files, vitest N, smoke screenshot: <path>"`
and stop.
