# NEXT — SE8b-2: measure the drag pipeline, and stop persisting on every frame

**Ball: worker (seat A) · epoch 1 · SE8b-2.** SE8e accepted (00e21a9). Seat B is on SE7m (editor-interaction.js,
editor-transform-handles.js, editor-hit.js, editor-grid.js, editor-ui.js, palette modal markup, styles/) — not yours.
Your files: `main/app-init.js` (the editor `onChange`), `editor/editor.js` (`_notifyChange`), `core/debug.js` (one
category), tests (+ WORK-LOG). One commit by path.

## Ground truth
SE8b's `_notifyChange('live')` caps the fan-out at one `_onChange` per animation frame, but `_onChange` is still the
whole pipeline (`main/app-init.js` initSvgEditor): `saveForRasterization()` (serialize + font embedding) →
`P.editorSvg = …` → `saveLastSession()` (localStorage write) → `refreshAllStampMasks()` (rasterize every layer → masks
→ rebuild the heightfield + mesh). Nobody has measured which step costs what; the advisor can't until Fusion's bridge
is back, so this turn builds the measurement and makes only the change that is right regardless of numbers.
## Build
1. **Pass the kind through:** `_onChange(kind)` receives `'live' | 'commit'` from `_notifyChange` (default `'commit'`
   for any other caller). Declare in ONE place what each kind runs: `CHANGE_PIPELINE = { live: ['serialize',
   'remask'], commit: ['serialize', 'persist', 'remask'] }` — `persist` (`saveLastSession`) never runs during a drag.
2. **Measure:** a `PERF` debug category in `core/debug.js` (off by default); when on, each pipeline step logs its
   duration via `fusLog('[PERF] live serialize 3.1ms …')` plus a per-frame total — so the advisor can switch it on in
   the add-in or the site console and read real numbers.
3. Nothing else changes behaviour: if the table says a step runs, it runs exactly as today.
## Verify
Tests: a 'live' change never calls `saveLastSession`; a 'commit' calls it exactly once; the PERF gate off → no timing
logs. `npx vitest run` → 236 + new, green.
## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE8b-2: CHANGE_PIPELINE live/commit (no persist during drag), PERF timing gate — <sha>, N files, vitest N"`
and stop.
