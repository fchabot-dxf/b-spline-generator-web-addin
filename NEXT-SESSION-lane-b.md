# LANE B — T17: SE7b design — the Lattice PATTERN generator. PLAN ONLY, no code.

**Seat B · epoch 1 · T17.** Worktree, branch `lane-b`. T16 (04d5087) accepted, merges with seat A's SE8b. Deliverable:
NEW `SE7B-PATTERN-GENERATOR-DESIGN.md` at the worktree root (+ WORK-LOG-lane-b.md). Read-only on product code.

## What Fred wants (ROADMAP "SE7 — Lattice", option C; photo: a carved relief with red horizontal rails on every
second row, yellow vertical ties of 1–3 rows on hand-picked columns, dark nodes at tie ends and crossings)
A declared pattern → Generate → ordinary rails/ties/nodes on three layers, editable afterwards with every tool;
reproducible from a seed like the terrain; must work on a phone (SE7m will add touch; the panel must not need hover).

## Ground truth to read first
`editor/editor-lattice.js` (SE7a/SE7n: toLattice/fromLattice, classifyDrag, constrain, latticeCrossings, emitSegment,
emitNode, findNodeAt, LATTICE_DEFAULTS, `data-lattice` attr), `editor/editor-grid.js` (GRID_DEFAULTS, GRID_SPACINGS,
SNAP_POLICY), `editor/layers.js` (add/active/visible, tooling fields), the SE4 + SE5 designs (one store, one-way
flows, MIGRATIONS), how the terrain seed is drawn (`core/` — find the RNG and reuse it, do not add a second one).

## Answer in the doc
1. **The pattern as data:** `PATTERN = { spacing, extent (board or a rect), rails: {every, offset}, ties: {density,
   spanMin, spanMax, columns?}, nodes: {ends, crossings}, layers: {rails, ties, nodes}, seed }` — refine the shape, say
   where it lives (editor document? `data-lattice-pattern` on the root like `data-editor-layers`?) and why.
2. **One-way generation:** Generate replaces the elements it owns and never touches hand-edited ones. How ownership is
   marked (`data-lattice-gen="<pattern id>"`), what an edit does to ownership (moving a generated tie with Select =
   still owned? node-dragged = detached?), and what Regenerate does with detached ones. No second store (SE4 lesson).
3. **Layers:** creates/reuses three editor layers with default tooling for rails/ties/nodes; how that interacts with SE5
   (tooling on the editor layer) and with the user's existing layers.
4. **Undo:** Generate/Regenerate = one step on the editor's undo stack.
5. **Panel UI** (390 px first): controls, a live preview-before-commit or not, seed ⟳, Detach-all. ASCII mockup.
6. **Slices** with predicted files and a verify line each; tests (determinism: same seed → identical SVG; ownership
   survives save/reopen; regenerate leaves detached elements untouched).

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T17: SE7b pattern generator design — K slices, <sha>"`
and stop.
