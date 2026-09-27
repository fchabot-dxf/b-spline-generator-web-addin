# NEXT — seat A, regular add-in (back from the Asus) — H1: SNAP-SPLIT (grid snap vs geometry snap for manual moves)

**Ball: worker (seat A) · epoch 3 · H1.** You're back on the REGULAR add-in: the Asus loop handed it back (HANDOFF-REG-ADDIN.md
§5.1 = what shipped there: formula fields, stale params, RAIL-SPACING engine, R7 panel restructure, boundary guide). Pull
main first and read §5.1. NO FUSION (the advisor runs the live checks on this PC). Seat C (fb-app) owns: the silhouette
solver, the frame files, the Shape Lattice "Shape"/"Segments" sections + handles (SHAPE-PARAMS next); stay out of those.
Spec: ROADMAP.md "SNAP-SPLIT" (+ the RAIL-SPACING rulings under it). PROGRESS automatic ("H1 item N: …"); commit + push
each item; screenshots (styled server, tools/serve_app.py) -> shots\seatA\ as each item lands.

## Checklist
- [ ] [H1-item-1] ONE declared snap resolver (targets + priority) read by every manual drag path (Select-drag, lattice
      piece drags, direct edit): GRID snaps to grid points; GEOMETRY snaps to existing geometry (rails, ties' rail
      contacts, nodes, contour, line ends/midpoints/intersections) within a declared tolerance; both on = geometry wins
      inside its tolerance, else grid; Alt suspends all. Reuse your UI5 item 5 attachment/tolerance work, not a copy.
- [ ] [H1-item-2] Two toolbar toggles (GRID, GEOMETRY) replacing the single SNAP toggle, same UI1 segmented style,
      persisted like today's; old saved state maps SNAP on -> GRID on.
- [ ] [H1-item-3] Tests: each toggle alone, both, neither, Alt; lattice + direct edit; an off-grid rail (RAIL-SPACING) gets
      a tie end snapped onto it by GEOMETRY; mobile. Extend tools/repro/select_drag_shape.mjs for the live drag cases.
- [ ] [H1-item-4] Desktop + mobile shots of the toolbar + a geometry-snap drag.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H1 — <shas>"`.
