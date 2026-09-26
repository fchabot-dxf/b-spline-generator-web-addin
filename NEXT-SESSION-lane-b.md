# NEXT (lane-b) — T77: TIE-GAP — minimum spacing between generated ties

**Ball: worker (seat B) · epoch 5 · T77.** NO FUSION. T76 (SE17) accepted, merging to main now. Spec: ROADMAP.md on
main "TIE-GAP". It's an APP setting only (Fred: "in the add-in, not Fusion") — never a Fusion parameter.
PROGRESS automatic ("T77 item N: …"). Screenshots (styled server) → shots\seatB\.

## Checklist
- [ ] [T77-item-1] Declared `ties.minSpacing` (default 0.5 in) + a "Min spacing" field in the Ties section of BOTH lattice
      panels (same C1 style; saved with the pattern; old patterns read the default).
- [ ] [T77-item-2] Generator: never place two ties closer than minSpacing along the rail direction (same rail gap; and
      adjacent gaps where they'd visually pair — decide + log); if the count range can't fit, generate FEWER. Works for
      one-ended ties and the Shape Lattice (contour-clipped ties) too. Hand-added / dragged ties are exempt.
- [ ] [T77-item-3] Sweep test across seeds x counts x presets x orientations: no generated pair closer than minSpacing;
      parity app==manifest unchanged; kind-layer split (SE17) unaffected.
Pass back from the lane-b root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 5 — T77 — <shas>"`.
