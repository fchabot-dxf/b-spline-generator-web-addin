# LANE B — T30: ties go anywhere, but their ends snap to rails (Fred)

**Seat B · epoch 2 · T30.** Fred: "don't limit it to rails, but do snap to them". Seat A is on UX-UNDO (history, snapshot
manager, sidebar binders) — not yours. Files: `editor/editor-lattice-pattern.js`, `editor/editor-lattice.js`, the
Pattern panel's anchor control (palette `#editorLatticePanel` + `editor/properties-lattice.js`), tests (+ WORK-LOG-lane-b.md).
One commit by path.
## Build
- Declare `railSnapRows` (default 1) in PATTERN_DEFAULTS.ties (and LATTICE_DEFAULTS for the hand tool). A tie END that
  lands within `railSnapRows` rows of a rail row moves onto that rail; otherwise it stays where it is (free).
- Generator: default anchor becomes 'free' + snapping (spans still spanMin..spanMax, measured after snapping; if snapping
  would make a span leave that range, snap the end that keeps it in range, else leave free). The 'rails' strict mode
  stays available in the anchor select; add the snap distance as a small number field "snap to rails within N rows"
  (0 = off).
- Hand-drawn Lattice tool: a tie drag's end snaps to the nearest rail row within railSnapRows (the hover marker shows the
  snapped point).
- Existing saved patterns keep their stored anchor value (no migration needed — an explicit 'rails' stays 'rails').
## Verify
Tests: an end one row from a rail snaps on; two rows away stays free (default 1); 'rails' mode unchanged; span limits
respected after snap; hand-tool end snap. Smoke screenshot of a generated pattern. `npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T30: ties free + rail-snap (railSnapRows) — <sha>, vitest N"`
and stop.
