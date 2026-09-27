# NEXT — seat A — H9: mobile main header fits without scrolling + fix the Carve Depth stepper (H4 regression)

**Ball: worker (seat A) · epoch 3 · H9.** H8 + the H8 colour revision ACCEPTED. NO FUSION. Fred (phone screenshot, 390 px wide, main
app, not the editor): "these icons are too big, I'd prefer not to scroll, but I get it, and the header may be a bit too small".
Advisor also spotted in the same shot: the CARVE DEPTH stepper shows NO VALUE and NO "+" (the H4 44 px steppers squeezed its number
field to nothing next to the slider): a regression from H4. PROGRESS automatic ("H9 item N: …"); push each item; shots at 390 px.

## Checklist
- [ ] [H9-item-1] Main app header on mobile: ALL header controls (back, title, Undo, Redo, Save, Projects, Add-in, STEP/Send, Settings)
      fit at 390 px with NO horizontal scroll: smaller icon buttons (a declared mobile header button size, e.g. 36 px, still a
      comfortable tap target), the title shortened/compacted on mobile (e.g. "B-SPLINE" only, or smaller), and give the header a
      little more height/room if needed (Fred: "the header may be a bit too small"). Desktop unchanged.
- [ ] [H9-item-2] Fix the Carve Depth stepper (and ANY slider+stepper row, and every stepper) so the number is always visible at 390 px:
      a minimum input width that fits the value; the slider shrinks, not the number. A test/check across all stepper rows at 390 px
      that the input's visible width >= its value's text width (so H4 can't regress it again).
- [ ] [H9-item-3] Shots at 390 px: the main header, Stock Dimensions (Carve Depth), before/after.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H9 — <shas>"`.
