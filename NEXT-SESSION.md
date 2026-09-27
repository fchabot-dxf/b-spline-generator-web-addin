# NEXT — seat A — H8: the frame a TINY bit different in colour from the board

**Ball: worker (seat A) · epoch 3 · H8.** H7 ACCEPTED (611490e). NO FUSION. Fred: "make frame colour a bit different than
board, tiny bit". Today the 3D preview frame (wood preview colour, e.g. Ash) and the panel read as nearly the same colour.
Files: core/preview/frame-mesh.js (the 3D bars) + the editor's frame band (editor/editor-frame-profile.js). These are seat
C's files, but seat C is on F19 (cut-tool rail drag, editor-lattice/interaction), so no overlap: keep this change small.
PROGRESS automatic ("H8 item N: …"); shots -> shots\seatA\; push each item.

## Checklist
- [ ] [H8-item-1] ONE declared offset (e.g. FRAME_TINT = a small lightness shift, ~8% darker, or a slight warm hue shift: pick one,
      state it) applied to the chosen wood's preview colour for the frame, in BOTH the 3D preview bars and the editor frame band
      (same constant), so the frame is just distinguishable from the board without looking like a different wood.
- [ ] [H8-item-2] Test: the frame colour == the wood colour with the declared offset, for every declared wood; the board colour is
      unchanged. Shots (3D iso + from below like Fred's phone shot + the editor Frame tab), Ash and Mahogany, before/after.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H8 — <shas>"`.
