# NEXT — seat A — H14: CONTROL-BY-PRECISION — each parameter's control type declared by whether it needs an exact value

**Ball: worker (seat A) · epoch 3 · H14.** H13 HAPTICS ACCEPTED (3cba5cf; Fred checks the feel on device). NO FUSION. Fred: "can be only
sliders side by side, no? choice of slider or stepper depends on the param: does it need a precise input?". Seat C's F25 WORK-LOG
(fb-app, "Item 2") lists the X/Y pairs: Stamp layer Offset X/Y (in), main pan Offset X/Y (screens), Skeleton Symmetry Offset X/Y, the
SVG-editor drawer's pan Offset X/Y, all slider+stepper rows today. Seat B = core/noise; seat C idle. PROGRESS: commit subjects
"H14 item N: …" (the page counts them).

## Checklist (SCOPE NARROWED by Fred: "only make this to the ones you found just now")
- [ ] [H14-item-1] The 4 X/Y pairs ONLY (seat C's F25 list): Stamp layer Offset X/Y (in), main pan Offset X/Y (screens), Skeleton
      Symmetry Offset X/Y, the SVG-editor drawer's pan Offset X/Y: each pair = two SLIDERS side by side on one line (value readout
      beside each; the stepper dropped for these), one small declared list of these pairs (no app-wide table). Ids/hidden inputs
      intact (tests, saved projects, formula fields).
- [ ] [H14-item-2] Check at 390 / 768 / 834 / 1024 / 1366 that each pair is on one line and the readouts are visible (your multi-width
      script); shots at 390 + 834.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H14 — <shas>"`.
