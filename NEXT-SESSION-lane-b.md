# LANE B — T25: does pinch-zoom really work on a phone? Prove it, fix it if not (audit mobile, SE7m)

**Seat B · epoch 2 · T25.** T24 is on HOLD by Fred's call (pattern panel) — leave its stash alone. This task is ONLY the
pinch question from T24 item 5, plus one non-pattern phone check. Files: `editor/editor-input.js`,
`editor/editor-interaction.js` (pointer path only), `styles/editor.css` if needed, `scripts/smoke-editor.mjs`, tests
(+ WORK-LOG-lane-b.md). Seat A is on SE8b-3 (perf mode in smoke-editor.mjs + change pipeline) — you both touch
`scripts/smoke-editor.mjs`: YOU own the `mobile` mode, seat A owns a new `perf` mode; keep your edits inside the mobile
branch. One commit by path.

## Ground truth
`node scripts/smoke-editor.mjs <out> mobile` (390×844, touch emulation) did a two-finger spread with
`Input.dispatchTouchEvent`; `svgEditor._view.zoom` stayed 1. Either (a) real touches wouldn't zoom either — a bug in the
SE7m pointer path (pointer map, `pointerType`, `touch-action` on `#editorSVGContainer`, setPointerCapture), or (b) the
emulated input doesn't produce the pointer events the editor listens for.
## Do
1. Instrument (temporarily) and find out which: log `pointerdown`/`pointermove` with `pointerId` + `pointerType` during
   the emulated pinch. Also try `Input.dispatchTouchEvent` with `Emulation.setEmitTouchEventsForMouse` / proper
   `radiusX/Y` + `force`, and `Input.synthesizePinchGesture` (CDP) — the last one is Chrome's own pinch synthesis.
2. (a) → fix it in the pointer path, with a unit test of the state machine. (b) → change the smoke script to the input
   method that produces real pointer events and prove `zoom > 1`.
3. While at 390 px with NO pattern panel open: check the Layers panel and the canvas share the screen sanely (audit
   SA-MOBILE-6); fix only if broken, CSS only. Screenshot paths in WORK-LOG.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T25: pinch — <real bug fixed | emulation only>, zoom after pinch = N, layers@390 <ok|fixed> — <sha>"`
and stop.
