# NEXT (fb-app) — F17: SE16 prerequisites P1 (Send as drawn) + P2 (hand edits survive the boundary refill)

**Ball: worker (seat C) · epoch 1 · F17.** F16 design ACCEPTED (CUT-TOOL-DESIGN.md). P1 + P2 are BUGS under Fred's standing
rule ("make sure the drawing in the add-in matches the one we insert in Fusion"), so they go now; the cut tool itself
waits for Fred's Q1-Q6 answers. Seat A is on H2 SEG-COLOR-PANEL (lattice-piece-panel.js + the segmentColors helper in
editor.js): coordinate if you must touch editor.js. **FUSION WINDOW GRANTED on Ranchy for item 3** (F11 rules: tagged
scratch docs only, closed by handle; Fred's docs untouched; claude-* cleaned; DEPLOY ONLY FROM A CLEAN WORKTREE AT
origin/main or your fb-app build, never from the main checkout; redeploy clean main when done; short calls; stop on any
dialog). PROGRESS automatic ("F17 item N: …"); shots -> shots\seatC\ as items land; push each item.

## Checklist
- [ ] [F17-item-1] P1: the lattice manifest reads rails/ties/nodes FROM the owned DOM pieces (endpoints, width, colour
      override), keeping kind, contour hits and attachment coincidents; railGroup derived (§3 chain), not from
      computePattern; the positional DOM-order width mapping is gone. RED-first test: a dragged rail's Slot sits where it
      was drawn. Parity app==manifest across the existing sweep stays green.
- [ ] [F17-item-2] P2: declare which commit kinds refill a boundary-linked pattern (boundary/contour changes) instead of the
      one-shot _skipBoundaryRefillOnce; piece moves (and later cut/join) do not refill. RED-first test: hand-move in a
      Shape Lattice, then an unrelated commit: the move survives.
- [ ] [F17-item-3] LIVE on Ranchy: capture_send_payload.mjs with a hand-dragged rail + tie (extend the script with a drag
      step), replay into a tagged scratch doc: the Fusion slots sit where drawn (measure), projections still link (0 FAIL).
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F17 — <shas>"`.
