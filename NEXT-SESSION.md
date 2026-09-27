# NEXT — seat A, regular add-in — H5: MULTI-SELECT (double-tap-and-hold adds; batch colour; hint)

**Ball: worker (seat A) · epoch 3 · H5.** H4 mobile pass ACCEPTED (fb2ddc6). NO FUSION. Spec: ROADMAP.md "MULTI-SELECT"
(Fred FINAL: DOUBLE-TAP-AND-HOLD, not plain hold; + the HINT when a single element is selected). Plain tap-and-hold is
RESERVED for H6's context menu: don't bind it. Seat C (F18) is adding the cut tool with small hooks in
editor-interaction.js and cutAt/join commands: pull --rebase often; don't restructure its hooks. PROGRESS automatic
("H5 item N: …"); push each item; shots -> shots\seatA\.

## Checklist
- [ ] [H5-item-1] Gesture: tap selects only that piece; DOUBLE-TAP-AND-HOLD (second press within the double-tap window, held
      still for the hold time) on a piece ADDS it / on a selected piece REMOVES it; press-and-move = drag (unchanged);
      Shift+click = add/remove on desktop. Main Select + lattice Select. Text elements excluded (double-tap = text edit).
      Browser long-press/callout suppressed on the canvas. Declared timings.
- [ ] [H5-item-2] The Selected piece panel reads the WHOLE selection: "N pieces (2 rails, 1 tie)"; Colour shows "mixed" when they
      differ; one pick recolours all (contour segments via segmentColors); Reset resets all; one undo step. Width/size stay
      the general controls (H3).
- [ ] [H5-item-3] HINT: when a single element is selected by tap, the editor hint line shows a declared string: "Double-tap and
      hold another piece to add it" (touch) / "Shift+click to add" (mouse).
- [ ] [H5-item-4] Tests (add/remove, tap replaces, drag unaffected, batch colour + reset + undo, text excluded) + a mobile CDP
      repro of the gesture; shots (panel with 3 pieces, "mixed", the hint).
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H5 — <shas>"`.
