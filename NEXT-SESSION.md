# NEXT — SE8b-3: measure the drag pipeline in a real browser, then make 'live' cheap (audit SA-UNDO-1 follow-up)

**Ball: worker (seat A) · epoch 2 · SE8b-3.** SE7c is on HOLD by Fred's call (pattern generator scope undecided) —
leave any stashed SE7c work stashed, do not resume it. Files: `scripts/smoke-editor.mjs` (add a `perf` mode),
`main/app-init.js` / `editor/editor.js` (CHANGE_PIPELINE), whatever the numbers point at, tests (+ WORK-LOG).
Seat B is on pinch verification in `editor/editor-input.js`, `editor/editor-interaction.js` (pointer path), `styles/`
— not yours. One commit by path.

## Why
SE8b capped `_onChange` at one per animation frame; SE8b-2 declared `CHANGE_PIPELINE {live:[serialize, remask],
commit:[serialize, persist, remask]}` and a `PERF` debug category (`window.__editorDebug = 'PERF'`, core/debug.js) that
times each step. Nobody has measured yet — the advisor now can't wait on Fusion, the browser works.
## Do
1. **Measure:** add a `perf` mode to `scripts/smoke-editor.mjs`: open the editor, draw ~20 pen strokes (or Generate a
   lattice — reuse what's there), set `window.__editorDebug = 'PERF'`, select all, then drive a 2-second drag with CDP
   `Input.dispatchMouseEvent` (mousePressed → ~120 mouseMoved → mouseReleased) and collect the `[PERF]` lines (they go
   through `fusLog` — capture via console, or have the pipeline also push into `window.__perfLog` when PERF is on).
   Report per step: count, median, p95, and the frame total, for 'live' and 'commit'. Put the table in WORK-LOG.
2. **Act on the numbers, declared:** if `remask` dominates a live frame, 'live' gets a cheaper step (e.g. remask ONLY the
   layers whose content changed, or rasterize at reduced resolution during a drag and full resolution on commit) —
   add it as a named step in CHANGE_PIPELINE, not a branch inside the pipeline. If `serialize` dominates, cache per
   element. If nothing is slow (< 16 ms total), say so and change nothing.
3. Re-measure after the change; before/after table in WORK-LOG.
## Verify
`npx vitest run` green (rerun once if the whole suite reports "no tests"); the perf mode runs headless against a
local serve (`npx http-server bspline-frame-builder/b-spline-gen/html -p 8765`, pass the palette URL as the 3rd arg).
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE8b-3: live frame <before>ms → <after>ms (<what changed>) — <sha>, vitest N"`
and stop.
