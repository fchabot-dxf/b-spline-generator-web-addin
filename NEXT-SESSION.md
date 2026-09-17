# LANE B (now the BREAKER seat) — T1: regression guards for today's fixes, in untested code. TESTS ONLY.

**Seat B · epoch 1 · T1.** Audit series complete (on main). Your lane changes shape: you now WRITE TESTS in this worktree
(synced with main at `694f09d`). **Breaker contract:** you add spec files only; you never edit product code. A test that
is RED against current code is a finding — report it in the pass note with the exact assertion, do not "fix" the code.
Commit by path on `lane-b`. The advisor merges.

## Step 0 — own environment
`npm ci` in THIS worktree (it has no `node_modules`). Then `npx vitest run` → expect 29 green before you add anything.
Python: `python -m pytest bspline-frame-builder/template-maker/tests -q` → 83.

## Targets (land each COMPLETELY; park what does not fit; each spec carries a non-vacuity proof — see below)
1. **`persistableP` (core/state.js, BG1)** — new `tests/persistable-p.test.js`: (a) every `stampLayers[i].mask` is
   `null` in the result; (b) every other field survives (`svg`, `enabled`, `depth`, `profile`, …); (c) the input `P`
   is NOT mutated (masks still there afterwards); (d) `JSON.stringify(persistableP())` contains no `"0":` mask blob
   when a layer's mask is a `Float32Array([1,2,3])` — the exact corruption A5a-1 found.
2. **`takeSnapshot` (core/history.js, BG1)** — same file or `tests/history-snapshot.test.js`: push a snapshot with a
   `Float32Array` mask on a layer; assert the stored `snapshot.P.stampLayers[i].mask === null` and
   `snapshot.layerConfigs[i].mask === null`. (Import the history module; it exports `takeSnapshot` and the logs —
   read the file for the exact names; `updateGlobalButtons` touches the DOM — happy-dom handles a missing element.)
3. **`get_fb_metadata` ≡ derived from `get_fb_metadata_fields` (fb_shared/entity_helpers.py, E7b)** — new
   `bspline-frame-builder/template-maker/tests/test_fb_metadata_fields.py` using the conftest stubs: a fake entity
   whose `.attributes.itemByName('FrameBuilder', X)` returns objects with `.value` for StartID/EndID/CenterID and no
   `centerSketchPoint` → assert `get_fb_metadata_fields(e) == {'startId':…,'endId':…,'centerId':…}` and
   `get_fb_metadata(e) == 'StartID=… | EndID=… | CenterID=…'` (byte-identical to the pre-E7b format); and an entity
   with no attributes → `{}` / `''`.
4. **`deferred_compute` (frame-builder/fb_engine/parametric_engine.py, FB1)** — `test_deferred_compute.py` in the same
   tests folder: a fake sketch object with an `isComputeDeferred` attribute; inside the `with` it is `True`; after a
   normal exit it is `False`; **after an exception raised inside the block it is `False` AND the exception propagates**.
   Importing `parametric_engine` pulls the `fb_engine` package + `adsk` — the conftest stub covers `adsk.core/fusion`;
   if the import chain needs more than the stub provides, **STOP on this item**, say exactly which import failed, park it.
5. **B6 guard (`editor/editor-io.js:serializeEditor` keeps hidden layers)** — ONLY if it can be exercised without a
   real SVG.js editor instance (read the function: what does it read from `editor`? if a plain object with `_layers`
   and a `svg()`/`node` shape suffices, write it; if it needs SVG.js internals, park it and say so).

## Non-vacuity proof (required per spec, in the WORK-LOG, not in the commit)
For each green spec: temporarily break the guarded behaviour in the product file (e.g. make `persistableP` return `p`
unchanged; make the `finally` an `except`), run the spec, confirm it goes RED, then `git checkout -- <file>` to restore.
Never commit a product-file change. Quote the red assertion in the WORK-LOG.

## Verify
`npx vitest run` → 29 + your new count, all green (or a named RED = finding). `pytest … -q` → 83 + yours.
`git status --short` → only new spec files + WORK-LOG-lane-b.md (append there now, not WORK-LOG.md).

## When done
Commit by path, then FROM THIS FOLDER:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T1: <n> specs added (<list>), vitest <k>, pytest <m>; parked: <list+why>; RED findings: <none|assertion>. <sha>."`
and stop.
