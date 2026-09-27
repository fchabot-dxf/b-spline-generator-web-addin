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
- [ ] [F26-item-1] OFFSET FROM FRAME: reference = the frame OUTER edge, and negatives allowed (Fred: 'offset from frame at 0 is clamped to the inside of frame rather than outside, and doesn't accept negative value' + screenshot: distance 0 puts the contour against the frame's INNER edge). Today (contour-from-frame.js) the contour's outside edge = frame cut profile offset inward by frame_thickness + distance, and distance < 0 is rejected in contourFromFrameOf + the panel's _writeFromFrame (falls back to 0.25). NEW: contour's outside edge = the frame's OUTER edge (cut profile) offset by distance: 0 = on the outer edge, + = inward, - = outward. Accept negatives everywhere (panel, formula field, contourFromFrameOf); make sure the offset call handles outward offsets (offsetOutlineInward with a negative amount, or the matching outward offset; one declared path, measured: a test that distance -0.25 puts the contour outside edge 0.25 in outside the frame outline). MIGRATION: saved patterns stored distance from the inner edge, so on load convert old values once (d_new = d_old + frame_thickness, declared schema version) so existing contours don't move. Update the panel hint text. Tests + shots (0, +0.5, -0.25) to C:/Users/danse/.bspline-status/shots/seatC/. Commit as 'F26 item 1: ...'.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — F25 — <shas>"`.
