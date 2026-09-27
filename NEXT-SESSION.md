# NEXT — seat A, regular add-in — H3: NO-PIECE-WIDTH (remove the per-piece width override for lattice pieces)

**Ball: worker (seat A) · epoch 3 · H3.** H2 SEG-COLOR-PANEL ACCEPTED (879d5ac; pixel-verified: the segment renders #1565c0).
NO FUSION (the advisor checks it live on Ranchy after). Spec: ROADMAP.md "NO-PIECE-WIDTH" (incl. the NODES rule: nodes
follow the general node_diameter, no per-node size). Seat C is on F17 (Send-as-drawn: the lattice manifest now reads
pieces FROM THE DOM, in editor-sketch-manifest.js + export-flow.js on the fb-app branch, not merged yet): coordinate before
touching those two files; the per-piece width DIMENSION removal there may need to land after F17 merges. PROGRESS automatic
("H3 item N: …"); push each item; shots -> shots\seatA\.

THIS IS A REMOVAL: sweep the whole chain; every link is REMOVED or KEPT WITH A NAMED REASON in the WORK-LOG.

## Checklist
- [ ] [H3-item-1] The Selected piece panel: Colour stays per piece; its Width (rails/ties) and size (nodes) controls now edit
      the lattice's GENERAL value for that kind (all parts change). Contour segments stay colour-only.
- [ ] [H3-item-2] Remove the chain: data-override-width attr + the width half of editor-piece-override.js ->
      rewidthOwnedKind's override-skip -> SVG/export width attr -> the manifest's per-piece hardcoded width DIMENSION
      (T75 item 3 / OVR-FUSION; if it lives in files seat C is editing in F17, list it for the advisor instead of editing).
      Old saved patterns carrying data-override-width: ignored on load (migration test).
- [ ] [H3-item-3] Tests: guarded-by-old-behaviour tests are REWRITTEN to assert the new rule (never silently deleted); a
      grep proves no reader of data-override-width remains. Plain drawing elements (rect/freeform/line) keep per-element
      width (test). Shots desktop + mobile.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H3 — <shas>"`.
