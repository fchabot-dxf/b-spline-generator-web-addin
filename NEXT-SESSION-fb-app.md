# NEXT (fb-app) — F19: a rail dragged across a cut tie's joint PUSHES the joint along

**Ball: worker (seat C) · epoch 1 · F19.** F18 ACCEPTED + merged (a626e8f). NO FUSION. Fred's ruling on your F18 question:
option (b) PUSH: when a rail move would carry an attached cut tie's segment past that tie's joint, the joint slides along the
tie ahead of the rail (same "joints slide along" rule as Q3), keeping the near segment >= a declared minimum length
(e.g. MIN_RAIL_PIECE / the existing min piece length); the drag is never blocked; the far segment shrinks accordingly.
If the tie's far segment would drop below the minimum too, the drag clamps there (the only clamp; state it). Seat A is
idle; H5/H6 gesture code (editor-multiselect-gesture.js, editor-context-menu.js) is theirs: don't restructure it.
PROGRESS automatic ("F19 item N: …"); shots -> shots\seatC\; push each item.

## Checklist
- [ ] [F19-item-1] Implement the push in the lattice rail-move path (the chain/joint logic from F18), both orientations; multi-joint
      ties (2 cuts) push the nearest joint only.
- [ ] [F19-item-2] Tests: RED first (today the near segment flips); rail dragged past a cut tie's joint -> joint pushed, both segments
      >= minimum, still coincident, still a straight tie; undo = one step; the uncut-tie behaviour is unchanged; the F18
      acceptance suite stays green. Shots: before/mid/after drag, desktop + mobile.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F19 — <shas>"`.
