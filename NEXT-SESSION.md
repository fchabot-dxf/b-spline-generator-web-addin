# NEXT — seat A — H13: HAPTICS (all the moments Fred approved)

**Ball: worker (seat A) · epoch 3 · H13.** H12 ACCEPTED (9b1574f). Spec: ROADMAP.md "HAPTICS". NO FUSION. Seat B = core/noise;
seat C = frame solver/handles (F24): call haptic() from their clamp points only through tiny hooks. PROGRESS automatic
("H13 item N: …"); push each item; shots/notes -> shots\seatA\.

## Checklist
- [ ] [H13-item-1] ONE declared module (e.g. core/haptics.js): a table {event -> pattern} + haptic(event); backends: Android/Chrome
      navigator.vibrate; iOS/iPadOS Safari 18+ = the hidden <input type=checkbox switch> toggle trick; desktop/Fusion = no-op.
- [ ] [H13-item-2] Wire ALL events: snap (grid or geometry, only on ENTERING a snap: rate-limited), limit (any clamped drag: frame
      Shoulder/Hip/waist handles, Shape Lattice handles, cut-joint pushes, lip/trim ranges: one call at each clamp), multiselect
      add/remove (double tick), context menu open (tick), cut/join (tick).
- [ ] [H13-item-3] Settings toggle "Haptic feedback" (default ON on touch devices), persisted.
- [ ] [H13-item-4] Tests: each event -> its pattern; the snap rate limit; the toggle; no-op without support. Note in the WORK-LOG
      how Fred can check the feel on his Android phone + iPad (which gestures to try).
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H13 — <shas>"`.
