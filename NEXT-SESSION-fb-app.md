# NEXT (fb-app) — F8: S4 parity tune + the editor [Frame | Artwork] tabs

**Ball: worker (seat C) · epoch 1 · F8.** F7 ACCEPTED (481c4cc, eadc87e), being merged to main. NO FUSION (Fusion is
on Fred's other machine now; any live check becomes a step list for Fred). Fred owns the regular add-in on main: keep
palette/editor edits small and additive, push often. Fred's rule for this work: "no special logic preventing anything,
code it right and prove it by tests". PROGRESS automatic ("F8 item N: …"). Shots → shots\seatC\.

## Checklist
- [ ] [F8-item-1] S4: app parity tests against the F3 goldens (§5.2): the JS cut profile vs the recorded Fusion outline
      per template x board. Fix the 12x6 gap you flagged (0.44 in off) at its cause; state the tolerance used.
- [ ] [F8-item-2] Editor [Frame | Artwork] tabs (approved UI, §3): Frame tab = the frame's template + shape params
      (numeric fields only, gate 3.2 (c): no handles) with the live cut profile; Artwork tab = today's editor with the
      profile as background. [Edit frame shape] in the sidebar opens the Frame tab (replaces the F6 stub).
- [ ] [F8-item-3] Round trip: Frame -> Artwork -> Frame -> save -> reload, record intact, artwork untouched (test).
- [ ] [F8-item-4] Shots: both tabs, T1 + T2, desktop + mobile.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F8 — <shas>"`.
