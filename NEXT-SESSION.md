# NEXT — SE7i: a connected lattice on ONE layer — the Lattice tool moves pieces and the structure follows (Fred)

> **Advisor notes at dispatch (after SE7h review):** SE7h + add-ons are merged (4a1e319, 861d780; 561 green). Select/Node
> now reach any visible layer — keep that. Generate must now write into the ACTIVE layer (section 1) and stop
> restoring a previous layer / creating Rails/Ties/Nodes layers; sweep generatePattern's layer-restore code and
> PATTERN.layers callers. Seat B is on SE12 slice 3 (outline preview) in lane-b and touches editor.js at the commit
> hook only — keep your editor.js edits away from that. NO FUSION — browser proof only.

**Ball: worker (seat A) · epoch 2 · SE7i.** NO FUSION (browser proof only). Builds on SE7h (orientation + select-any-shown).
Files: `editor/editor-lattice.js`, `editor/editor-lattice-pattern.js`, `editor/editor-interaction.js` (lattice handler),
`editor/properties-lattice.js`, the `#editorLatticePanel` markup, tests (+ WORK-LOG). One or two commits by path.
## 1. One layer (Fred: "I don't mind if all lattice geometry is in one layer")
Generate NEVER creates a layer (Fred: "regenerate should clear and use the same layer, I'll create a new one if I want").
It writes rails, ties and nodes into the ACTIVE layer. Generate/Regenerate on a layer first CLEARS every generated piece
in that layer (everything carrying `data-lattice-gen`, INCLUDING pieces moved by hand since), then emits the new pattern
there — one pattern per layer; a second lattice = Fred makes a new layer, activates it, Generates. Hand-drawn elements
(no `data-lattice-gen`) in that layer are untouched. The active layer stays active. Per-kind colors stay (element color).
`PATTERN.layers` (rails/ties/nodes ids) retires — remove the auto-create code and its callers (sweep the chain); an old
file with those three layers keeps them as ordinary layers.
PER-LAYER SETTINGS (advisor rec, Fred didn't object): the pattern settings (PATTERN: spacing, rails, ties, nodes,
colors, widths, orientation, seed) are stored ON THE LAYER (e.g. layer.pattern), not once per file. Activating a layer
loads its settings into the Pattern panel; Generate/Regenerate write back to that layer; a layer with none starts from
PATTERN_DEFAULTS. Migration: an existing file-level PATTERN attaches to the layer holding its generated pieces.
## 2. Widths (Fred's pick pending — default: a Widths row)
A "Widths" row in the Pattern panel mirroring Colors: Rails, Ties (0.05" steppers) and Node size; defaults from
LATTICE_STYLE × spacing; changing one re-widths the OWNED pieces of that kind in place (no reseed), one undo step.
(If Fred picks "toolbar STROKE" instead before you start, the advisor will amend.)
## 3. Connected editing in the Lattice tool (Fred approved the rules)
- Drag on EMPTY space → draw a rail/tie as today. Drag ON an existing piece → move it, structure-aware:
  - **Rail**: moves only ACROSS its direction (rows when horizontal, columns when vertical — respect SE7h orientation),
    snapping to the lattice. Every tie with an end on it stretches (its LENGTH changes — never its stroke width — and its
    position ALONG the rail never changes: with horizontal rails a rail move shifts tie ends only vertically, x fixed;
    vertical rails: only horizontally, y fixed — Fred);
    nodes on the rail move with it. A rail never slides along its own length.
  - **Tie**: drags freely (snapping to the lattice), its end nodes follow; it is NOT confined between rails (Fred).
  - **Node**: moves the tie end it belongs to along its rail.
- Attachment is DERIVED at drag start from geometry and is ONLY coincidence with a rail's AXIS (Fred): a tie end is ATTACHED to a rail
  iff it sits EXACTLY on a lattice grid point (i,j) that the rail passes through (Fred: "attach should mean snapped
  to grid on the same point") — compare lattice coordinates (toLattice of the WORLD end point, exact integer match
  after rounding within 1e-6 of a grid point), not distances. Off-grid ends (Alt, Select nudges) never attach; a grid
  point on the rail's row but beyond the rail's end doesn't attach. Attachments are fixed at drag START; a dragged rail
  never picks up ties it crosses mid-drag. A NODE is NOT required (Fred asked): attachment is the shared grid point alone, so it
  works with Auto nodes off; a node sitting on that point is simply carried along — nothing stored,
  no second source of truth (SE4 lesson). Ties keep their attachment when a rail passes another rail.
- One drag = one undo step for everything that moved; moved pieces KEEP `data-lattice-gen` (the old detach rule
  retires: Fred wants Regenerate to clear the layer's generated pieces, moved ones included).
- Hover feedback: the piece under the pointer highlights in Lattice mode (so "grab vs draw" is visible).
## 4. Robust to the other tools (Fred: "once we use the direct select tool the lattice data is corrupted?")
It must NOT be: there is no stored lattice graph — only `data-lattice` kind tags + geometry. Requirements: (a) attachment
derivation reads each piece's WORLD geometry (`worldPoint` / the element's matrix — Select writes `transform=translate`),
never raw attrs; a Lattice-mode move BAKES its result into the attrs (no transform left); (b) every tool (Select move,
Nodes drag, HANDLE_EDIT length changes, color, width) preserves `data-lattice`. Select stays a plain single-piece move (the
escape hatch); only Lattice mode is structure-aware. Test: Select-move a rail (transform), then a Lattice-mode drag on
another rail — attachments computed from world positions, the Select-moved rail's former ties are free, no errors.

## Verify
Tests (pure where possible: derive attachments, apply a rail move → tie endpoints/lengths + node positions): rail move
stretches ties and carries nodes; tie slide keeps nodes; widths unchanged by moves; orientation vertical works the
same; one undo step; Generate writes into the active layer, creates no layer, and Regenerate clears the previous generated pieces (moved
ones too) while hand-drawn ones stay. **Vertical orientation mirror (Fred: "vice versa if I
  inverse the orientation"):** a test with rails vertical — dragging a rail left/right changes the horizontal ties'
  length (left-right), never their stroke width; ties slide up/down along the rails. Browser smoke screenshot before/after a rail drag.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE7i: connected lattice on one layer + widths — <sha>, vitest N, screenshots: <paths>"`
and stop.
