# LANE B — T5 (breaker): SE2's pan/tolerance math vs. preserveAspectRatio — prove it, then fix it if wrong

**Seat B · epoch 1 · T5.** Worktree `b-spline-generator-web-addin-lane-b`, branch `lane-b` (merge `main` first:
`git merge --no-edit main` — SE2 80da844 is there). Files: `bspline-frame-builder/b-spline-gen/html/editor/editor-view.js`,
`editor/editor-interaction.js`, `editor/editor-hit.js`, `tests/editor-view.test.js` (+ WORK-LOG-lane-b.md). Seat A is in
`main/` (SE3a) — no overlap. One commit by path, predicted **4 files** + log.

## The suspicion (advisor, from the SE2 diff — not yet proven either way)
The editor root is `SVG().addTo(...).size('100%','100%')` with a viewBox and the DEFAULT `preserveAspectRatio`
(`xMidYMid meet`). Under `meet` the board renders at ONE uniform scale, `s = min(clientW / vb.w, clientH / vb.h)`
px per model unit, letterboxed on the other axis. Two places assume per-axis scale instead:
- `_panBy` (editor-interaction.js, SE2): `dx * vb.w / clientWidth` and `dy * vb.h / clientHeight` — on the
  letterboxed axis the drag will feel too slow (cursor and board separate).
- `getDynamicTolerance` (editor-hit.js:14, pre-existing): `px * vb.width / clientWidth` — wrong whenever the
  container is TALLER than the board's aspect (the docked 460 px palette with a 7×9 board is exactly that case),
  so click slop and handle sizes are off by the aspect ratio there.

## Do
1. **Prove it first** (breaker role): a vitest with a pure function and two container shapes (wide, tall) showing
   the per-axis formula disagrees with the uniform one on the letterboxed axis. Quote the numbers in WORK-LOG.
   If you find `preserveAspectRatio="none"` is actually set somewhere on the editor root (grep `preserveAspectRatio`
   under `editor/` and `init.js`), the suspicion is WRONG — say so, add the test that proves the per-axis formula is
   then correct, and stop there (no product change).
2. **If wrong, declare the scale once:** in `editor-view.js` add `export function viewScale(vb, clientW, clientH)`
   → `Math.min(clientW / vb.w, clientH / vb.h)` (px per model unit), and `screenToModelDelta(vb, clientW, clientH,
   dxPx, dyPx)` → `{ dx: dxPx / s, dy: dyPx / s }`. Then `_panBy` and `getDynamicTolerance` both go through it
   (tolerance = `px / viewScale(...)`). No other caller changes; no new fields on the editor.
3. Tests: extend `tests/editor-view.test.js` — `viewScale` for a wide and a tall container; `screenToModelDelta`
   round-trips a pan on both axes; the letterbox case is the one that used to disagree.

## Verify
- `npx vitest run` → 42 + new, green; `node --check` touched modules.
- Greps: `clientWidth` under `editor/` → only inside `viewScale`'s callers passing it through (i.e. the raw
  per-axis division appears nowhere); `viewScale(` → definition + 2 callers.
- `git show --stat HEAD` → 4 files + log. Live feel is the ADVISOR's.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T5: pan/tolerance scale — proven <right|wrong>, <sha>, N files, vitest N"`
and stop.
