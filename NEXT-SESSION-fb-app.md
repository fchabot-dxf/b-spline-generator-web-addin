# NEXT (fb-app) — F25: Tool Profile + V-Bit Angle on one line (small sidebar layout)

**Ball: worker (seat C) · epoch 3 · F25.** F24 ACCEPTED + merged (c9cac56). Fred: "tool profile and vbit angle can be on the same line".
In the Vector Stamping section: Tool Profile (select) and V-Bit Angle (stepper, shown for V-bit profiles) side by side, like seat A's
Width (X) / Height (Y) row (reuse seat A's paired-row pattern from H10/H11-item-0 + the H12 inline label pattern; don't invent a
new one). When the profile has no angle field, the select takes the full row. Seat A is on H13 haptics (JS modules), seat B on
core/noise: small, additive HTML/CSS only here. NO FUSION. PROGRESS automatic ("F25 item N: …").

## Checklist
- [ ] [F25-item-1] Tool Profile + V-Bit Angle on one line at 390 / 768 / 834 / 1024 / 1366 (value fully visible; seat A's multi-width
      check script extended to this row); the angle's own show/hide per profile unchanged.
- [ ] [F25-item-2] While there: list (in the WORK-LOG, don't change) any OTHER label/field pairs in the sidebar that could share a line
      the same way, for Fred to pick. Shots before/after at 390 + 834.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — F25 — <shas>"`.
