# NEXT (fb-app) — F24: frame handles stay ON the outline + the bottle neckLength floor

**Ball: worker (seat C) · epoch 3 · F24.** F23 ACCEPTED (4dbaab3, being merged). NO FUSION unless a live parity check needs it.
PROGRESS automatic ("F24 item N: …"); shots -> shots\seatC\; push each item.

## Checklist
- [ ] [F24-item-1] HANDLE PLACEMENT: with the wider F23 range, the Shoulder/Hip handles land OFF the board (0935_F23reach_after_hip.png:
      circles in the canvas gutter at top-left/bottom-left) because they sit at the arc's centre, which runs away as the radius grows.
      Put every frame handle ON the outline (e.g. the arc's midpoint / the corner's tangent point), dragging along its declared axis,
      so it's always visible and reachable at any radius; same for the Shape Lattice handles if they share the placement. Test:
      each handle's anchor lies on the drawn outline and inside the board rect at the range extremes.
- [ ] [F24-item-2] T2 bottle neckLength floor: the same leftover-declared-band artifact you flagged; re-derive the neckWidth branch's
      cross-reference so neckLength's floor is the true geometric one. Tests + the F5 sweep green.
- [ ] [F24-item-3] Real-input drag repro (desktop + touch) at the extremes; shots.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — F24 — <shas>"`.
