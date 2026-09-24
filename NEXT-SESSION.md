# NEXT — SE7n: node tool that actually drags — one node model, pointer mapped into the element's own space

**Ball: worker (seat A) · epoch 1 · SE7n.** Files: `editor/editor-hit.js` (getNodes), `editor/editor-interaction.js`
(dragNode + findNodeAt caller), `editor/editor-lattice.js` (findNodeAt), `editor/editor-ui.js` (AUTO NODES wiring),
`tests/editor-nodes.test.js` (+ WORK-LOG). One commit by path, predicted **5–6 files**. SE7a (067c3df) reviewed and
accepted, pushed (site rebuilding); the add-in is NOT deployed yet (Fusion bridge down). Seat B is running a
read-only audit of editor/ in its worktree — no conflict, but its findings may add to this area later.

## Ground truth (advisor, from the code — ROADMAP "SE7n")
1. `getNodes` (`editor-hit.js:28-55`) returns rect corners and circle/ellipse centres, but `dragNode`
   (`editor-interaction.js`, `function dragNode`) has branches only for line / polyline / polygon / path — grabbing a
   rect/circle/ellipse node turns it red and nothing moves. Every lattice node is a circle.
2. `getNodes` maps each node to WORLD with `worldPoint(el, pt)` (`:55`); `dragNode` writes the (world) pointer into
   LOCAL attributes (`x1/y1`, array entries) with no inverse of `el.matrix()` — anything moved with Select (it writes
   `transform="translate(...)"`), scaled or rotated jumps by its transform offset.
3. `getNodes` pushes nodes only for M/L/C/Q path segments; `dragNode` indexes `el.array()[idx]` over ALL segments —
   after the first Z/H/V/A/S/T the wrong segment is edited.
4. SE7a leftovers: `findNodeAt` (`editor-lattice.js`) compares raw `cx/cy` (local) against a world lattice point — a
   node moved with Select is not deduped; and the AUTO NODES button has no click handler (your own WORK-LOG flag).

## Build — declare the node model once
- `getNodes(el)` returns `[{ x, y, set(localPt) }]`: `x,y` in WORLD (as today, via `worldPoint`), `set` closes over
  the real target — line: `x1/y1` or `x2/y2`; polyline/polygon: array index; path: the ACTUAL `el.array()` segment
  index of that node (build the node list and its segment index in the same loop, so hit-test and drag can never
  disagree); rect: the dragged corner with the OPPOSITE corner pinned (normalise negative width/height); circle /
  ellipse: `cx/cy` (radius untouched — the per-kind radius edit is SE7s). Add H/V (endpoint = one coord + the
  previous point's other coord) and A (end point) and S/T to the node list so every segment end is a node.
- `dragNode(editor, pt)`: `const local = transformPoint(el.matrix().inverse(), pt)` then `nodes[idx].set(local)`.
  Existing callers of `getNodes` that only read `x,y` keep working unchanged — grep them and say so.
- `findNodeAt`: compare the node's WORLD centre (`worldPoint(ch, {x:cx,y:cy})`, or `worldBbox` centre) to the lattice
  point.
- AUTO NODES: bind `#editorLatticeAutoNodes` (or whatever id you gave it) in the same module that binds SHOW/SNAP: flip
  `editor._lattice.autoNodes`, toggle `.active`. Initial `.active` state from `LATTICE_DEFAULTS` at bind time.

## Verify
- `tests/editor-nodes.test.js` (pure where possible: build node lists from plain attribute/array fixtures, or a tiny
  mock element with `matrix()` returning `{a..f}` + `inverse()`): (a) line with `translate(1,0)` — setting the world
  point (5,5) writes local (4,5); (b) path `M0 0 L1 0 Z M2 2 L3 3` — node 3 (the second M… L 3 3 end) edits the
  segment holding `3 3`, not the `Z`; (c) circle centre set; (d) rect corner drag pins the opposite corner, and a
  drag past it normalises width/height positive; (e) H/V node positions. ≥ 6 tests.
- `npx vitest run` → 103 + new, green. `node --check` touched modules.
- Live (advisor, when the bridge is back): move a line with Select, then drag its endpoint in Node mode — it follows
  the cursor; drag a lattice node; drag a corner of a filled pen shape.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE7n: node model with setters, inverse-matrix drag, path index fix, findNodeAt world, AUTO NODES wired — <sha>, N files, vitest N"`
and stop.
