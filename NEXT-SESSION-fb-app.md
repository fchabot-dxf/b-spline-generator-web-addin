# NEXT (fb-app) — F22: PANEL LIP — the panel machined a small offset OUTWARD from the frame outline (flush-trim allowance)

**Ball: worker (seat C) · epoch 1 · F22.** F21 ACCEPTED + merged (8c647b0). Fred: "these are 5 parts that get machined on the CNC
(panel + 4 bars); for the panel I sometimes want a small offset outward, just to be sure it actually sits well everywhere and that
I can flush trim at the end when it's glued; I guess this lip would go in the frame section". **FUSION WINDOW GRANTED on Ranchy for
item 3** (F11 rules; clean-worktree deploys; redeploy clean main after). PROGRESS automatic ("F22 item N: …"); shots; push each item.

## Checklist
- [ ] [F22-item-1] Frame section field "Panel lip (in)" (formula field), default 0 (= today exactly); stored in the frame record;
      range 0..boundingboxoffset (the lip can't exceed the board-to-frame gap: a declared range, no runtime guard). Old records = 0.
- [ ] [F22-item-2] App preview: the 3D panel trim uses the frame OUTLINE offset OUTWARD by the lip (the F8 true-offset function,
      negative distance, one shared function); the bars are unchanged; the editor Frame/Artwork tabs show the lip as a thin band outside
      the outline (FRAME_COLORS-consistent, subtle). Tests: panel outline == offset(outline, +lip); lip 0 == today byte-for-byte.
- [ ] [F22-item-3] Fusion: the panel TRIM_CUT region = the outline offset outward by the lip, as a plain value/offset in the trim sketch
      (NO new user parameter); the frame bars unchanged. LIVE on Ranchy: lip 0.0625 -> the panel's outer edge measured 0.0625 outside
      the frame's outer edge all around (arcs included); lip 0 -> unchanged from today; both Send orders; screenshots.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F22 — <shas>"`.
