# NEXT — SE8b: moved objects stay clickable and expandable; no full re-render per mouse move

**Ball: worker (seat A) · epoch 1 · SE8b.** Source: `AUDIT-SVG-EDITOR.md` — SA-COORD-3, SA-COORD-4, SA-UNDO-1, SA-TEXT-3
(read each section). SE8a accepted and merged with SE5a/b (898ee73, 145 tests). Seat B is on CSS only
(`styles/base.css`, `styles/editor.css`) — do not touch those two files. One commit by path.

## 1. SA-COORD-3 — hit-testing uses the element's WORLD geometry
`getNearbyElement` (`editor-hit.js:58-80`) tests against the pre-transform local bbox, so a moved/rotated element can
be missed. Use `worldBbox(el)` for the bbox prefilter and map the pointer into local space (`el.matrix().inverse()`,
the same one SE7n uses) for any precise distance-to-geometry test. One helper `toLocal(el, pt)` in editor-coords.js,
used by SE7n's drag and this — do not write the inverse twice.
## 2. SA-COORD-4 — Expand frames the element in world space
`editor-expand-trace.js:33-50` frames the canvg viewBox from the local bbox while the content renders transformed.
Frame from `worldBbox` (or bake the element's matrix into a clone first) — pick whichever the finding's evidence
shows is smaller, say why.
## 3. SA-UNDO-1 — declare the change fan-out
`_onChange()` (full remask + rasterize + localStorage) fires on every mousemove during node drag, element move and
transform-handle drag. Declare it once: `editor._notifyChange(kind)` with `kind` = `'live'` (during a drag: coalesced
to one call per animation frame, preview-only work) or `'commit'` (gesture end / discrete edit: the full pipeline,
immediately). Every drag path calls `'live'`, every `handleEnd` / discrete edit calls `'commit'`. Count it: a test
that simulates 50 moves + 1 end and asserts the full pipeline ran once (mock `_onChange` target + rAF).
Report the before/after count in WORK-LOG.
## 4. SA-TEXT-3 — the orphan-adoption walk must skip `defs.rasterization-fonts` (your own SE8a flag).

## Verify
`npx vitest run` → 145 + new, green; `node --check` touched modules. Live (advisor, bridge permitting): drag a node
on a dense drawing — the 3D preview updates once per frame, not per event; click a moved object — selects.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE8b: world hit-test + toLocal, Expand framing, _notifyChange live/commit, fonts orphan skip — <sha>, N files, vitest N"`
and stop.
