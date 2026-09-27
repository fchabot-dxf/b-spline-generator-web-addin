# NEXT (fb-app) — F13: FRAME-GEN — a [Generate] button for the frame shape, then tweak with handles

**Ball: worker (seat C) · epoch 1 · F13.** F12 ACCEPTED (52649ec 6074fd9 630ef38), being merged to main. NO FUSION needed
(seeds already proven live in F11). Spec: ROADMAP.md "FRAME-GEN". Fred's rules: no guard logic (code it right + tests),
no new Fusion params. Seat A (regular add-in) is on H1 SNAP-SPLIT (drag/snap paths, the toolbar): not your files.
PROGRESS automatic ("F13 item N: …"); shots -> shots\seatC\ as items land; push each item.

## Checklist
- [ ] [F13-item-1] Frame tab [Generate]: a new seeded random shape each press (the frame seed is stored in the frame record,
      so a shape is reproducible). Every declared frame handle value is drawn inside its feasibleParamRanges (the F5 +
      F12 range holes included), and the results are written as the handles' SEEDS (F9/F11 path), so [Send frame] builds
      exactly what's shown.
- [ ] [F13-item-2] Handles tweak the generated shape; a tweak persists until the next Generate; Undo restores the previous
      shape (generate and tweak are both undoable steps); a template change still resets.
- [ ] [F13-item-3] Tests: N=200 generates per template are all valid outlines, same seed -> same shape, tweak -> save ->
      reload keeps it, undo; payload seeds == shown shape. Shots: 3 generated shapes + 1 tweaked, T1 + T2, desktop + mobile.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F13 — <shas>"`.
