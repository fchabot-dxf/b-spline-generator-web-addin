# NEXT — PERF1: lattice drag must redraw live, every frame, even in Fusion (Fred)

**Ball: worker (seat A) · epoch 2 · PERF1.** NO FUSION for workers — browser proof only (with CPU throttling to mimic
Fusion's slower webview). Seat B idle.

## Fred (trying the build): "works great but the preview of move isn't fast enough — I don't see geometry until release"
Advisor measured in headless Chrome with smoke-lattice-connected.mjs (3 pieces): attrs DO update mid-drag. So it's
cost, not logic — with a real generated lattice (~40–60 pieces) in Fusion's webview something per-pointermove is heavy
enough that painting starves until release.

## Do
1. MEASURE first: generate a real pattern (default settings, 7x9 board), CDP `Emulation.setCPUThrottlingRate {rate: 4}`,
   drag a rail and a tie-node with 30+ mouseMoved steps; record per-event handler time (Performance.getMetrics /
   performance.now() around the handler, or a CDP trace) and what runs per move: hover hit-testing
   (_getNearbyElement over all children), snap cursor, applyLayerState, _notifyChange('live') / CHANGE_PIPELINE live
   consumers (drape/relief rebuild?), outline preview, selection highlight clone, getLayerPattern lookups,
   _existingRailRows scans. Write the numbers in WORK-LOG.
2. Fix at the cause: during a lattice move do the minimum per frame — coalesce pointermoves to one update per
   requestAnimationFrame, skip hover/highlight work while `_latticeMove` is active, never trigger live 3D/drape/mask
   work mid-drag (commit on release only — declare it in CHANGE_PIPELINE if a consumer is misfiled), precompute
   anything the move needs at drag START (the snapshot already exists).
3. Check the same for Select-tool drags and HANDLE_EDIT (Fred says "move" generally) — fix if the same cause.
## Verify
- Before/after table: median + p95 ms per move event at 4x throttle, frames painted during the drag (count rAF ticks
  that saw changed attrs). Target: p95 < 16 ms, a visible update on every rAF during the drag.
- `npx vitest run` green; the connected-lattice smoke still all true.
## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "PERF1: live drag — <sha>, before/after ms"`
and stop.
