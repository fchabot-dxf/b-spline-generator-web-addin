# NEXT (fb-app) — F18: Frame-tab pinch/pan + the SE16 ✂ CUT TOOL (code)

**Ball: worker (seat C) · epoch 1 · F18.** F17 ACCEPTED + merged (1c8a7ea; live 14/14 as drawn). Spec: CUT-TOOL-DESIGN.md
+ ROADMAP "SE16 RULINGS" (Q1-Q6 + "segments never carry their own width": width is always the general stroke_width) +
"FRAME-TAB-ZOOM". Seat A is on H3 NO-PIECE-WIDTH (removes per-piece width incl. the manifest's per-piece width dim,
editor-piece-override.js, lattice-piece-panel.js), then H4 mobile pass (header/steppers), then H5 MULTI-SELECT
(double-tap-and-hold in editor-interaction.js). You'll both touch editor-interaction.js: pull --rebase often, keep your
cut-tool code in its own module(s), and wire in with small hooks. **FUSION WINDOW GRANTED on Ranchy for item 4** (F11 rules;
deploy only from a clean worktree or your fb-app build; redeploy clean main after). PROGRESS automatic ("F18 item N: …");
shots -> shots\seatC\ as items land; push each item.

## Checklist
- [ ] [F18-item-1] FRAME-TAB-ZOOM: the Frame tab's shield captures only a one-finger gesture that STARTS ON A HANDLE; pinch and
      pan (and a one-finger drag off a handle) go to the normal canvas pan/zoom. Mobile CDP test: pinch + pan work, and a
      handle drag still works.
- [ ] [F18-item-2] The ✂ Cut tool per the design: main tool rail button; hover marker; tap = cut (snaps by H1's GRID/GEOM,
      Alt = exact); tap the joint = Join (clears both segments' overrides); lattice joints SLIDE ALONG the rail; plain lines:
      grabbing the shared point moves ONE end. Membership by derivation (no stored parent id). Regenerate clears cuts
      (Undo restores). No per-segment width.
- [ ] [F18-item-3] The ACCEPTANCE suite from the design: identical drag results before/after cutting (both orientations),
      with every segment a different COLOUR; undo/redo; mobile.
- [ ] [F18-item-4] LIVE on Ranchy: a cut rail (3 segments, 2 coloured) sent AS DRAWN: 3 slots, an explicit Coincident at
      each cut (mid-rail AND on a tie crossing), stroke_width drives all 3, projections still link. Measure; screenshot.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F18 — <shas>"`.
