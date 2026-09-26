# NEXT (fb-app) — F6: S2 part 1 — the editor shows the board as the frame's CUT PROFILE

**Ball: worker (seat C) · epoch 1 · F6.** F5 SIL-RESOLVE ACCEPTED (0f2fcf2), being merged to main with F4. NO FUSION
(F4 item 4 live check is now Fred's, on his other machine). origin/main already merged into fb-app (advisor).
OWNERSHIP CHANGE: Fred now works on the REGULAR add-in himself (main, other machine: see HANDOFF-REG-ADDIN.md). Keep
your edits to the palette HTML / editor.js / editor-ui.js small and additive, and commit+push often so merges stay
small. Spec: FB-APP-DESIGN.md §3 + stage table row S2. PROGRESS automatic ("F6 item N: …"). Shots → shots\seatC\.

GATE 3.2 DECIDED (advisor, Fred had not answered; reversible): option (c) NO shape handles in this stage. The frame
shape comes from the template + its declared params only; handles (a: declared shape params) come later.

## Checklist
- [ ] [F6-item-1] App reads frame-defs.json (the S1 generated file) + `tests/frame-defs.test.js` schema test (§2.2).
- [ ] [F6-item-2] The persisted FRAME RECORD in the project (template or none, params, frame bottom z, wood): declared
      schema, default = no frame (Q2), saved/loaded with the project, old projects read "no frame".
- [ ] [F6-item-3] Sidebar FRAME section, second after Stock Dimensions (§3.1): template select (None default), the
      extrusion settings, "Frame bottom (z)" (negative position), wood (declared list: Ash default, Mahogany, Pine,
      Cherry, Maple), [Edit frame shape] (can be a stub that opens the editor for now).
- [ ] [F6-item-4] HEADLINE (§3.0): with a frame chosen, the editor's board outline IS the frame's trimmed cut profile
      (one outline source, the same one the Fusion build uses), outside shaded as cut away, artwork untouched; live on
      param change. Run the F5 outline guard on it (never draw a looped outline).
- [ ] [F6-item-5] Tests + §3.5 shots for what exists in this stage (T1 + T2, desktop + mobile: sidebar section,
      editor cut profile); round trip set frame → save → reload → record intact.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F6 — <shas>"`.
