# NEXT — seat A, regular add-in — H2: SEG-COLOR-PANEL (contour segments in the "Selected piece" panel, colour only)

**Ball: worker (seat A) · epoch 3 · H2.** H1 SNAP-SPLIT ACCEPTED (407e4cc; full suite on main 1823 vitest + 365 pytest).
NO FUSION. Spec: ROADMAP.md "SEG-COLOR-PANEL". Seat C is DESIGNING the SE16 cut tool (CUT-TOOL-DESIGN.md, no code yet)
and will build it on your snap resolver; don't start cut-tool code. PROGRESS automatic ("H2 item N: …"); commit + push EACH
item as it passes (H1 sat uncommitted for 2 h: push as you go); shots -> shots\seatA\ as items land.

## Checklist
- [ ] [H2-item-1] Selecting a Shape Lattice contour segment shows the "Selected piece" panel (lattice-piece-panel.js) with
      COLOUR + Reset only, no width control (Fred: "only color").
- [ ] [H2-item-2] ONE storage path: the panel reads/writes the existing PATTERN.contour.segmentColors[i] (primitive index)
      via the same helper the toolbar COLOR uses (_storeContourSegmentColor in editor.js); no second schema, so the
      toolbar and the panel can't disagree.
- [ ] [H2-item-3] Tests: select segment -> panel colour == stored; set/reset; survives Regenerate + reload; Send payload
      carries it; no width control for a segment; toolbar COLOR and panel stay in sync. Desktop + mobile shots.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H2 — <shas>"`.
