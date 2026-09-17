# LANE B (audit seat) — A4: audit `stamp-editor/` (~10.7k lines). READ-ONLY.

**Seat B · epoch 1 · A4.** Same rules as A1-A3. Append an **"A4 — stamp-editor"** section to `AUDIT-2026-09.md`.

**A3 review (advisor):** accepted. A3-1 becomes a seat-A task — not "add the 5 names" but DERIVE the wipe list from the
`core/` folder so it cannot drift again (the hand-maintained list IS the bug). A3-2 (`check_addin_sync.py`) → delete.

## A4 scope — `bspline-frame-builder/stamp-editor/`
Context you need first: ROADMAP "CLEANUP PHASE" C1 (the editor tree used to be a sync-GENERATED fork of
`b-spline-gen/html/editor/` + `core/stamp/`; C1 untracked the generated copies) and C5/EDM4 (the `P.stampLayers` mirror
tangle, still open, carve-path). `sync_stamp_bundle.py` at `bspline-frame-builder/` root is the generator.
1. **Fork status (P1: one frontend, no copy-paste per host):** which files under `stamp-editor/html/` are GENERATED
   (by `sync_stamp_bundle.py`) vs UNIQUE (engine.js / runtime.js / main/)? Are any generated copies still tracked in git
   (`git ls-files stamp-editor/`)? Has any generated copy been hand-edited since its source (diff them)? Name each.
2. `stamp-editor.py` (entry) — lifecycle symmetry, palette + handlers released in `stop()`.
3. `html/main/` + `html/core/runtime.js` + `engine.js` — the unique code: doorless handlers both directions
   (`fusionSendData` actions vs Python dispatcher; `sendInfoToHTML` events vs JS handlers), hand-rolled tables that
   should be declarations, dead functions (0 callers), honesty (comments describing a pre-C1 or pre-EDM4 state).
4. **EDM4 (C5) reconnaissance, read-only:** where is `P.stampLayers` written and read today? One list of `file:line`
   for writers and one for readers — this is the map the eventual C5 carve needs; do not propose the carve.
5. Tests: `tests/` at repo root has 4 vitest files (29 green) — which touch stamp-editor code?

Do NOT run Fusion; do not run `sync_stamp_bundle.py` (it writes). Static read + grep + `git ls-files` + `diff`.

## When done
Append lane-b WORK-LOG, commit by path, then FROM THIS FOLDER:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "A4 stamp-editor audit: <n> findings (<H/M/L>), fork status: <tracked generated copies? hand-edited?>, stampLayers writers/readers mapped, <sha>. Next: A5 b-spline-gen."`
and stop.
