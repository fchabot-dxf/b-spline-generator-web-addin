# NEXT (fb-app) — F16: SE16 ✂ CUT TOOL — DESIGN ONLY (no product code this turn)

**Ball: worker (seat C) · epoch 1 · F16.** F15 ACCEPTED + merged (d74fa5d). NO FUSION. NO PRODUCT CODE: seat A's H1
SNAP-SPLIT is mid-flight in the same drag files (editor-interaction.js, editor-transform-handles.js, editor-grid.js,
editor-ui.js, the palette HTML), so this turn writes the design; the code comes after H1 merges, on top of its snap
resolver. Spec: ROADMAP.md "SE16" (+ Fred's ruling recorded there / HANDOFF-REG-ADDIN.md §5.1: lattice cut pieces MOVE
TOGETHER; direct edit moves a piece INDEPENDENTLY). PROGRESS automatic ("F16 item N: …"). Shots/mockups -> shots\seatC\.

## Checklist
- [ ] [F16-item-1] CUT-TOOL-DESIGN.md (repo root): the tool's gestures (tap a line to cut: snaps to joints, then grid; Alt
      = free; tap a cut again = Join), the DATA (segments keep lattice membership by DERIVATION, collinear + touching =
      one rail, declared tolerance; no stored parent id), the drag rules (a cut point = joint, moves both ends together;
      only true outer ends stretch; Select free-move = intentional break), how it uses H1's snap resolver (read H1's
      design from seat A's NEXT-SESSION/ROADMAP; don't write a second one), Fusion side (each segment its own slot;
      joint = separate points + explicit Coincident), undo, and per-segment colour (SEG-COLOR-PANEL).
- [ ] [F16-item-2] The ACCEPTANCE test plan from the ROADMAP (before/after-cut drag equality incl. every segment
      coloured differently, both orientations) written as concrete test cases, with the file each lives in.
- [ ] [F16-item-3] 3-4 rendered mockups of the tool in use (static SVG/PNG: cut marker, joint handle, a rail cut in 3
      coloured segments) for Fred; the list of open questions for Fred (if any) at the top of the doc.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F16 — <shas>"`.
