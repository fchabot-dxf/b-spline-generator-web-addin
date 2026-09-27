# NEXT — seat A — H14: CONTROL-BY-PRECISION — each parameter's control type declared by whether it needs an exact value

**Ball: worker (seat A) · epoch 3 · H14.** H13 HAPTICS ACCEPTED (3cba5cf; Fred checks the feel on device). NO FUSION. Fred: "can be only
sliders side by side, no? choice of slider or stepper depends on the param: does it need a precise input?". Seat C's F25 WORK-LOG
(fb-app, "Item 2") lists the X/Y pairs: Stamp layer Offset X/Y (in), main pan Offset X/Y (screens), Skeleton Symmetry Offset X/Y, the
SVG-editor drawer's pan Offset X/Y, all slider+stepper rows today. Seat B = core/noise; seat C idle. PROGRESS: commit subjects
"H14 item N: …" (the page counts them).

## Checklist
- [ ] [H14-item-1] ONE declared table (data, one module, e.g. main/param-controls.js): param id -> control 'stepper' (needs an exact typed
      value) | 'slider' (explored by feel; value readout beside it) | 'both' (genuinely needs both); plus optional pairWith for X/Y pairs.
      Classify EVERY numeric sidebar/panel parameter with a one-line reason each (the WORK-LOG gets the full table for Fred to review).
      Units in inches/degrees that go to Fusion/CNC lean 'stepper'; pans/strengths/noise shapes lean 'slider'.
- [ ] [H14-item-2] The UI renders each param from the table (no per-field hand edits): slider-only rows show a live value readout;
      'feel' X/Y pairs render as two sliders SIDE BY SIDE on one line at every width (390-1366); stepper pairs as today. Formula
      fields keep working where a stepper/number input exists; hidden inputs keep ids intact (tests + saved projects).
- [ ] [H14-item-3] Tests: the table covers every numeric param (a test fails if a new param lands unclassified); each control renders per
      its entry; pairs on one line (your multi-width script). Shots at 390 + 834 of the SEED section + a lattice panel.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H14 — <shas>"`.
