# NEXT (fb-app) — F20: SHOULDER-HIP — separate Shoulder and Hip handles (Shape Lattice + Frame)

**Ball: worker (seat C) · epoch 1 · F20.** F19 ACCEPTED (being merged). Spec: ROADMAP.md "SHOULDER-HIP". Merge origin/main
first (H8 added core/color-utils.js FRAME_TINT in frame-mesh.js + editor-frame-profile.js: keep it). **FUSION WINDOW GRANTED on
Ranchy for item 2** (F11 rules; deploy only from a clean worktree or your fb-app build; redeploy clean main after).
PROGRESS automatic ("F20 item N: …"); shots -> shots\seatC\; push each item. Seat A is idle (no overlap).

## Checklist
- [ ] [F20-item-1] Shape Lattice hourglass: relabel cornerRadiusTop/Bottom handles + sliders "Shoulder" / "Hip"; REMOVE the combined
      cornerRadius handle + slider (a removal sweep; the param stays only as a migration input -> both; old patterns keep their
      exact shape: migration test). The F5 sweep stays green.
- [ ] [F20-item-2] Frame hourglass (T1): FIRST, live on Ranchy, find whether T1's phases force the shoulder and hip corners equal
      (ck_skel_shoulder_equal / arc-weld constraints): report the constraint(s). If they're independent, split the one corner
      seed into Shoulder + Hip seeds (option B positions, no new Fusion params), with per-handle live parity. If they're forced
      equal, STOP and report the options (don't modify the template yet).
- [ ] [F20-item-3] Tests + shots (both handles dragged independently, Shape Lattice + Frame tab; the Fusion outline for the frame).
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F20 — <shas>"`.
