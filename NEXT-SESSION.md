# NEXT — seat A, regular add-in — H4: mobile pass (bigger steppers + scrollable editor header, no ACTIVE LAYER label)

**Ball: worker (seat A) · epoch 3 · H4.** H3 NO-PIECE-WIDTH ACCEPTED (de11159, 1e78eec; verified: the Send payload's slot
widths are all stroke_width, nodes all node_diameter; full suite green). NO FUSION. Spec: ROADMAP.md "MOB-STEPPERS +
editor header". Seat C is on F18 (Frame-tab pinch/pan + the cut tool, editor-interaction.js hooks): pull --rebase often.
PROGRESS automatic ("H4 item N: …"); push each item; shots -> shots\seatA\ at 390 px.

## Checklist
- [ ] [H4-item-1] ONE declared touch size for every numeric stepper (sidebar, both lattice panels, the Frame section, the
      Selected piece panel, formula fields): at the mobile breakpoint + @media (pointer: coarse), −/+ >= 44 px square with a
      matching input height; desktop unchanged; no row overflows at 390 px.
- [ ] [H4-item-2] Editor header on mobile: the top row (layer picker, [Frame | Artwork], ⋮, Cancel, Download SVG, Apply
      Stencils) scrolls horizontally (touch scroll, no page scroll) or wraps, with Apply Stencils always reachable.
- [ ] [H4-item-3] REMOVE the "ACTIVE LAYER" label everywhere (the layer picker stays); a removal: no orphan CSS/ids/tests.
- [ ] [H4-item-4] Shots before/after at 390 px: the Frame section, a lattice panel, the editor header.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H4 — <shas>"`.
