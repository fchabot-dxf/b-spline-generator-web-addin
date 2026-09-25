# NEXT — SE7k: explicit Add Rail / Add Tie / Add Node in the Lattice tool (Fred)

**Ball: worker (seat A) · epoch 2 · SE7k.** NO FUSION — browser proof only. PERF1 cancelled (Fred: fast after all).
Advisor meanwhile shipped: grid visible by default (83f02a9) and width steppers on the 0.05 grid (b4b4c43). Seat B is
on T44 (outline caps/joins + fallback notice) in lane-b.

## Fred: "needs an add rail and add tie, add node button"
Today the Lattice tool GUESSES rail vs tie from drag direction and has no node placement (Circle tool is the node
tool). Make the kind an explicit choice.

## Do
1. Declare `LATTICE_DRAW_KINDS` (rail / tie / node: label, icon, hint) and render a 3-button segmented control
   "Add: [Rail] [Tie] [Node]" at the TOP of the Lattice panel (from the table, like FUSION_GEOMETRY). One is always
   active; default Rail. Touch-sized under pointer:coarse like the other panel controls (MOB2 rules).
2. Drawing respects the chosen kind (orientation-aware via orient()):
   - Rail: drag → a rail constrained to its row (horizontal rails) / column (vertical), whatever the drag direction.
   - Tie: drag → a tie constrained across the rails, ends snapping to rail rows (railSnapRows, as today).
   - Node: click → a node at the snapped grid point (no drag needed); click on an existing node does nothing.
   - Auto-nodes behaviour unchanged for rails/ties.
   Remove the direction-guessing path (classifyDrag for new pieces) — no dead branch; keep it only if something else
   still needs it (say so).
3. Dragging ON an existing piece still MOVES it (SE7i/SE7j), in every Add mode.
4. Hand-drawn pieces use the ACTIVE layer's pattern Widths and Colors (rails/ties/nodes) — same numbers Generate uses —
   instead of LATTICE_STYLE × spacing / the toolbar color. One source: the Widths row. (Fred was confused that
   hand-drawn and generated pieces differ.) A layer with no pattern yet → PATTERN_DEFAULTS.
5. Keyboard: the lattice tool's shortcut cycles nothing new; optional 1/2/3 while the tool is active only if trivial.
## AMEND (advisor ruling on Fred's 'spawn or drag?'): BOTH
Click (no drag) SPAWNS a default piece at the clicked grid point — Rail: full-width row (Generate's extent); Tie: that
column between the two nearest rails; Node: the point. Drag draws exactly. The Add button only selects the kind. Declare
the click defaults in LATTICE_DRAW_KINDS. One undo step per spawn.

## AMEND 2 (Fred: "pulling on nodes should lengthen the tie")
Tie-END node drag → moves only that end along the tie's axis (tie lengthens/shortens, stays upright, snaps to grid +
rail rows, min length 1 step). Mid-span crossing node → ALSO stretches (AMEND 3, Fred: "dragging the tie changes position, node stretches it"): the end on
the side the pointer moves toward follows. SE7j's node-slide path is removed. Tie body drag → slide (unchanged).

## AMEND 4 (Fred: "can we change a rail's size?")
Rail END drag (rail-end node, or within the end-grab zone) → changes the rail's length along its own axis (snap to grid,
min 1 step, can't pass the other end). Body drag → move row (SE7i, unchanged). Attached ties stay; ones left off the
end keep position, no re-attach.

## Verify
- Pure tests for each kind's constraint in both orientations; node click placement; width/color come from the layer
  pattern.
- CDP: pick each button, draw, screenshot the panel + result (desktop and 390x844); drag-to-move still works.
- `npx vitest run` green.
## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE7k: Add Rail/Tie/Node — <sha>, vitest N, screenshots"`
and stop.
