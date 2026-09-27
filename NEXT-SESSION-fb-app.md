# NEXT (fb-app) — F21: CONTOUR-FROM-FRAME — an "Offset from frame" toggle on the Shape Lattice contour

**Ball: worker (seat C) · epoch 1 · F21.** F20 ACCEPTED (being merged). Spec: ROADMAP.md "CONTOUR-FROM-FRAME". Merge origin/main
first (regenerate frame-defs via tools/gen_frame_defs.py if it conflicts). **FUSION WINDOW GRANTED on Ranchy for item 3** (F11
rules; clean-worktree deploys; redeploy clean main after). PROGRESS automatic ("F21 item N: …"); shots -> shots\seatC\; push each item.

## Checklist
- [ ] [F21-item-1] Contour section: [ ] Offset from frame + Distance (formula field, default 0.25 in). ON: the contour = the frame's INNER
      edge offset inward by Distance, via the F8 true-offset function (one shared function); preset/sliders/handles disabled while on;
      disabled with a hint when no frame is chosen. Saved as contour.fromFrame {on, distance}; old patterns = off (migration test).
- [ ] [F21-item-2] LINKED: a frame template / handle (incl. Shoulder/Hip) / Trim offset / thickness change refits the contour and refills
      the lattice (declared refill inputs, F17 P2); toggle off restores the preset shape. Tests: contour == offset(inner edge, d) within
      tolerance for T1/T2 x boards; validity (simple, tangent); undo.
- [ ] [F21-item-3] LIVE on Ranchy: B-spline Send with the frame-offset contour + [Send frame]: the contour sketch sits exactly the Distance
      inside the frame's inner edge (measure); screenshots.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F21 — <shas>"`.
