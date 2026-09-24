# NEXT — SE8f + SE7c: restore multi-select, then finish the lattice proportions (Fred: "finish lattice too")

**Ball: worker (seat A) · epoch 2.** SE8b-3 accepted (848b910). Seat B is on T25 (pinch) then T24/SE7p (pattern panel on
phones: palette `#editorLatticePanel` region, `styles/editor.css`, `editor/properties-lattice.js`, `editor/editor-input.js`,
`editor/editor-interaction.js` pointer path) — not yours. Two commits by path (one per part).

## Part 1 — SE8f: `editor._selectMany` / `editor._selectAdd` don't exist (your own finding, advisor-confirmed)
`editor.js:13` imports `selectAdd, selectMany` from editor-ui.js; nothing defines the instance methods. Callers:
`editor-interaction.js:323` (Ctrl+A, guarded → silent no-op), `:360-361` (paste, guarded), `:536` (Shift-click add,
UNGUARDED → throws), `editor-marquee.js:108-110`. Add the two delegations next to the existing `_select` one
(`_selectMany(els) { return selectMany(this, els); }`, same for Add). Then drop the now-pointless `typeof … ===
'function'` guards at :323 / :360 — they hid the bug. Test: Ctrl+A selects every visible element; Shift-add grows the
selection; marquee selects. (Do not touch editor-interaction.js beyond removing those two guards — seat B owns its
pointer path.)
## Part 2 — SE7c: resume `stash@{0}` (LATTICE_STYLE declared, nodeRadiusFactor removed) and finish it exactly as the
previous SE7c brief said (in git history: `git show 10c72db~0:NEXT-SESSION.md` is not it — read ROADMAP "Live browser
test 2026-09-24" + the SE7c section below):
- `LATTICE_STYLE = { rail:{widthFactor:0.28}, tie:{widthFactor:0.22}, node:{radiusFactor:0.30} }` × grid spacing;
  `emitSegment` / `emitNode` read it by kind (generator AND the hand-drawn Lattice tool), not `editor._strokeWidth`.
- `PATTERN.margin` (lattice cells, default 1): the 'board' extent is inset on both axes so nothing sits on the edge.
- Old saves keep their own stroke-width attrs (unchanged rendering).
- Tests: rail width = 0.28 × spacing, node r = 0.30 × spacing, margin 1 → no coordinate at 0 or the board size,
  hand-drawn rail uses the same width. Then `node scripts/smoke-editor.mjs <out> desktop <local palette URL>` and look
  at the screenshot: rails, ties and nodes must be distinct. Put the screenshot path in WORK-LOG.
## Verify
`npx vitest run` green (rerun once if the whole suite reports "no tests"). Push after each part.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE8f + SE7c: multi-select restored; LATTICE_STYLE + margin — <shas>, vitest N, screenshot: <path>"`
and stop.
