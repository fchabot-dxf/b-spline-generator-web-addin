# LANE B — T22: build SE7m — the editor works with fingers (pointer events, pinch/pan, touch-sized targets)

**Seat B · epoch 1 · T22.** Worktree, branch `lane-b`. Slice 3 (3f22753) ACCEPTED, held until seat A passes SE8d.
Source: ROADMAP "SE7m" + your own audit SA-MOBILE-1/2/3/9/10/11/12/14/15 (SA-MOBILE-13/8/4/5 were T16).
**Off-limits (seat A, SE8d):** `editor/editor-io.js`, `editor/editor.js`, `editor/editor-coords.js`. If you need one of
them, stop and say so. One commit by path (two if it gets big — say so).

## Build — declare the input profile, one pointer path
1. **Pointer Events** replace the separate mouse*/touch* listeners in `initInteraction` (`editor-interaction.js:58-67`):
   `pointerdown` on the svg node (with `setPointerCapture`), `pointermove`/`pointerup`/`pointercancel`. Keep the
   wheel handler. Track active pointers in a Map (id → client pos) so a second finger is SEEN, not ignored
   (`:233` today returns on 2 touches).
2. `INPUT_PROFILE = { mouse:{slopPx:10, grabPx:15, handlePx:8, markerOffsetPx:0}, touch:{slopPx:22, grabPx:28,
   handlePx:14, markerOffsetPx:40}, pen:{slopPx:8, grabPx:12, handlePx:8, markerOffsetPx:0} }` (pure module or in
   editor-grid.js next to SNAP_POLICY); `editor._pointerType` set on every pointerdown. Every hit tolerance
   (`_getDynamicTolerance(10|15)` call sites — SA-MOBILE-1/2, SA-DECL-3) and the transform-handle size
   (`editor-transform-handles.js`, SA-MOBILE-3: from screen px via `viewScale`, not a viewBox fraction) read it.
3. **Two fingers** = pinch zoom about the midpoint + pan, through SE2's `zoomAbout` / view record (no new zoom math).
   Starting a second touch cancels any in-progress one-finger draw WITHOUT committing it (SA-MOBILE-14/15:
   `preventDefault` on the canvas touch path).
4. **Touch snap marker:** during a one-finger press, `updateSnapCursor` shows the ring offset `markerOffsetPx` above the
   finger with a 1 px leader; the gesture commits at the MARKER position (the thumb no longer hides the target).
5. On-screen equivalents for keyboard-only actions: a small action group (Copy / Paste / Select all / Cancel pen —
   SA-MOBILE-10/11) shown under `(pointer: coarse)`; Shift aids (SA-MOBILE-12) → a "Lock" toggle in that group that
   the scale/rotate code reads as `shift`. Tool help (SA-MOBILE-9): the active tool's hint line already exists at the
   bottom — make sure every tool's full help text is there (MODE_HINTS), not only in `title`.
## Verify
Pure tests: INPUT_PROFILE lookup; pinch math (two pointer tracks → zoom factor + pivot via zoomAbout); the
second-pointer-cancels-draw state machine with mock pointer events. `npx vitest run` green (count). Live on a phone is
Fred's (advisor will ask him to open the site).
## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T22: SE7m — pointer events, INPUT_PROFILE, pinch/pan, touch marker, on-screen actions — <sha>, N files, vitest N"`
and stop.
