# NEXT — SE7g: Generate always uses a new seed (Fred)

**Ball: worker (seat A) · epoch 2 · SE7g.** Fred: "lattice tool needs the generate button to automatically use a new seed".
Seat B is on T32 (editor undo/redo placement: palette editor HEADER + `styles/editor.css`) — stay in the
`#editorLatticePanel` region of the palette and out of editor.css. Files: `editor/properties-lattice.js`,
`editor/editor-lattice-pattern.js` (only if the seed source lives there), the lattice panel markup, tests (+ WORK-LOG).
One commit by path.
## Build
- Generate/Regenerate: draw a fresh seed each press (reuse the existing reroll logic — whatever `#latticeReroll` does
  today — as ONE function `nextSeed()`), write it into `PATTERN.seed` and the Seed field, then generate. Still one undo
  step (the seed change and the new geometry land in the same pushState).
- The Seed field stays editable and is persisted with the pattern as today (so a pattern can be noted), but Generate
  always rolls a new one — say in the field's title: "Generate picks a new seed each time".
- Remove `#latticeReroll` and its binding (removal chain in WORK-LOG) — Generate now does its job.
## Verify
Tests: two Generate presses → two different seeds and (with density < 1) different tie sets; the Seed field shows the
seed actually used; undo after Generate restores the previous pattern AND seed. `npx vitest run` green.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE7g: Generate rolls a new seed each press, reroll removed — <sha>, vitest N"`
and stop.
