# NEXT — seat A — H12: sub-labels inline with their labels, across the whole UI

**Ball: worker (seat A) · epoch 3 · H12.** H11 item 0 ACCEPTED (dc06793). NO FUSION. Fred (iPad screenshot, SEED section: "Offset X
(pan, in screens)", "Offset Y (pan, in screens)", "Rotation (degrees)" each take 2 lines): "go through the UI and see if sub-labels
can fit onto their label lines, like width/height". Seat B = core/noise; seat C = frame handle files: not yours.
PROGRESS automatic ("H12 item N: …"); push each item; shots -> shots\seatA\.

## Checklist
- [ ] [H12-item-1] Inventory (in the WORK-LOG): every label that has a sub-label / hint line under it (sidebar sections, lattice
      panels, Frame section, the editor panels, Settings): selector + current text.
- [ ] [H12-item-2] ONE declared pattern (a shared class/markup: bold label + muted sub-label on the same line, like "Width (X)") applied
      to all of them. Where a sub-label is too long to fit at 390 px, shorten the WORDING (e.g. "(pan, in screens)" -> "(screens)"),
      state each rename; never let it wrap. Keep ids/for= intact (formula fields + tests reference them).
- [ ] [H12-item-3] Check (extend your multi-width script): every label + sub-label is ONE line at 390 / 768 / 834 / 1024 / 1366;
      mutation-tested like H10. Shots before/after (SEED section + one lattice panel + Frame section) at 390 + 834.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H12 — <shas>"`.
