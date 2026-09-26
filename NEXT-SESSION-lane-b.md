# NEXT (lane-b) — T76: SE17 — lattice kinds on separate layers → separate Fusion sketches linked by projection

**Ball: worker (seat B) · epoch 4 · T76.** NO FUSION (advisor verifies live). T75 accepted. Spec = ROADMAP.md on main,
"SE17" entry (read it fully: Fred's rules on order, hide/show, hidden-layer export, measured projection facts).
PROGRESS is automatic: start each work-commit subject with the item's tag words ("T76 item 3: …"), one tag per item.
Merge origin/main into lane-b FIRST (seat A's UI3-UI5 changed the lattice panels + select/move code).

## Checklist
- [ ] [T76-item-1] Declared kind→layer map + Fusion build order (data): contour → rails → ties → nodes.
- [ ] [T76-item-2] App: a generated lattice creates/updates ONE layer per kind (Rails / Ties / Nodes / Contour), named by
      kind, all tied to the one pattern (Regenerate/Detach/Size act on all of them; one pattern record, not four).
      Ordinary layers: drag-reorder = stacking, eye = show/hide, own carve/colour.
- [ ] [T76-item-3] Select/move (seat A's constrained lattice move) keeps working across kind-layers (a rail on the Rails
      layer still drags its ties on the Ties layer). Coordinate via the shared move path — no second implementation.
- [ ] [T76-item-4] Manifest: one manifest per kind-layer; cross-kind relations declared as PROJECTION references
      (tie-end → projected rail, rail-end → projected contour seg, node → projected joint, Collinear stays within a kind).
- [ ] [T76-item-5] Builder: build sketches in the declared order; each later sketch projects the needed curves from the
      earlier sketches (sketch.project) and puts the cross-kind constraints on the PROJECTED copies (a direct cross-
      sketch constraint is refused — measured). Shim models project() + refuses cross-sketch constraints.
- [ ] [T76-item-6] Hidden kind-layer: not exported; dependents keep exact geometry but lose those links (Fred's rule).
- [ ] [T76-item-7] Parity per sketch (verify_sketch_against_manifest per kind) + tests: all-shown, rails hidden, contour
      off; saved single-layer lattices from before SE17 still load (migrate on read or keep as one layer — decide+log).
Pass back: `cd <lane-b worktree> && python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 4 — T76 — <shas>"`.
