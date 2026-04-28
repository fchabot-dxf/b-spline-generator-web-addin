# B-Spline pipeline — context sheet for a fresh session

Use this if you come back to the bspline-frame-builder export pipeline after a break, or if a new debugging session needs to pick up cold. It's a snapshot of where things stand, what's been tried, what works, and what to test next.

## What this pipeline does

JS palette generates a terrain mesh, exports it as a STEP file, and Python imports it into Fusion. The CAM-builder add-in then turns the imported design into Manufacturing Models for machining. The **shape contract** the rest of the system depends on is:

```
B-Spline Set
├ Clean    [panel, surface]   (panel = solid body, surface = open shell)
└ Stamped  [panel, surface]
```

Two top-level components, two bodies each, names exact. Everything downstream (CAM filter, body lookups by name) walks `comp.bRepBodies` and matches by `panel` / `surface`.

## Architecture (post-rewrite)

After a long detour through cross-component body merges, we landed on the right design:

**JS side does the structural work.**
- `core/stepWriter.js`'s `generateThickenedStep()` takes options `{clean, stamped, cleanSurf, stampedSurf}` and emits ONE STEP file with all selected bodies.
- Each body carries a `label` (`'panel'` or `'surface'`) and a `base` (`'Clean'` or `'Stamped'`).
- Product assembly groups bodies by base — one PRODUCT per base, multiple SHAPE_REPRESENTATION items inside, one per body, typed correctly:
  - `ADVANCED_BREP_SHAPE_REPRESENTATION` for solids
  - `MANIFOLD_SURFACE_SHAPE_REPRESENTATION` for surfaces
- `main/main.js`'s `onFusionApply()` no longer batches. ONE call to `executeExport()` with all flags set, ONE chunked send to Python.

**Python side just verifies and renames.**
- `bspline-frame-builder/b-spline-gen/b-spline-gen.py`'s `_post_import_setup()`:
  - Phase 1 — recursively walks the imported subtree, finds Clean / Stamped wherever Fusion stuck them, normalizes component names to canonical, renames bodies based on `b.isSolid` (solid → panel, non-solid → surface).
  - Phase 2 — uplifts Clean / Stamped through the auto-wrapper Fusion creates around multi-product STEPs (named after the file, e.g. `B-Spline`). Moves them to be direct children of B-Spline Set, deletes the empty wrapper.
  - Phase 3 — currently a no-op for Unstitched (see "Open issues" below).

**No `_consolidate_bspline_variants` any more.** Deleted, along with `_apply_pending_renames` and `_stamp_body_name`. The whole class of cross-component body-merge bugs is gone because no body ever needs to move between components.

**`mm_builder.py`'s `_apply_bspline_panel_filter`** was simplified to two phases:
- Phase A — occurrence deletes inside a wrapper-component BaseFeature edit (cross-component occ delete is special-cased and works inside BaseFeature scope).
- Phase B — body deletes outside any BaseFeature (child-component bodies cannot be deleted from a wrapper BaseFeature edit; raises `InternalValidationError`).

## Current behavior

After a fresh OK click, the design tree is:

```
B-Spline Set
└ B-Spline                         ← Fusion's auto-wrapper (cosmetic, kept)
   ├ Clean
   │  └ Bodies
   │     ├ panel
   │     └ Unstitched > surface    ← Fusion display nesting (cosmetic)
   └ Stamped
      └ Bodies
         ├ panel
         └ Unstitched > surface
```

Two cosmetic wrappers remain — the `B-Spline` PRODUCT wrapper at the top, and the per-component `Unstitched` feature around each surface body. Both are functionally inert: downstream code (CAM filter, body lookups by name) walks by component name and ignores the extra hierarchy levels. Bodies and component names are correct.

Wrapper uplift (`_uplift_through_wrappers`) is **PARKED**. Multiple attempts to delete the `B-Spline` wrapper via `Occurrence.moveToComponent` produced silent failures or moved Clean/Stamped to the root component. Cause: `moveToComponent`'s docs are self-contradictory and empirically the source becomes a sibling of the target rather than a child of `target.component`. See "Stop trying these things" for the full record. The function is now a no-op stub; do not revive without rereading.

Unstitched dissolve (`_eliminate_unstitched`) is also a no-op. An earlier TBM + BaseFeature replacement attempt nuked the panel body alongside the surface. See "Stop trying these things" for what's been ruled out.

## Files touched (current branch state)

- `bspline-frame-builder/b-spline-gen/html/core/stepWriter.js` — bodies tagged with `base`, products grouped by base, multi-rep with type per body class
- `bspline-frame-builder/b-spline-gen/html/main/main.js` — `onFusionApply()` collapsed to one batch
- `bspline-frame-builder/b-spline-gen/b-spline-gen.py` — `_post_import_setup()` and helpers (`_find_clean_stamped`, `_normalize_occurrence`, `_uplift_through_wrappers`, `_eliminate_unstitched`); old consolidate functions deleted
- `bspline-frame-builder/CAM-builder/cam_engine/mm_builder.py` — simplified `_apply_bspline_panel_filter` (two phases, no orphan handling)

## Verified Fusion API knowledge

These are the calls the Python pipeline depends on, with what we've confirmed about each:

- `BRepBody.copyToComponent(targetOcc)` — creates a Copy/Paste Bodies parametric feature with refs to the source body and source occurrence. If the source occurrence is later deleted, refs dangle → yellow-triangle warnings on next compute. **Avoid in this pipeline.**
- `TemporaryBRepManager.copy(body)` — independent in-memory copy, no parametric back-ref.
- `Component.bRepBodies.add(transient, baseFeature)` — adds a transient body inside an active `BaseFeature.startEdit()` / `finishEdit()` block. The body ref returned by `.add()` is bound to the active edit; **after `finishEdit()` writes through it silently no-op**. To rename post-edit, capture the body's positional index inside the edit and refetch via `comp.bRepBodies.item(idx)`.
- `Occurrence.fullPathName` — stable assembly-path string identifier (e.g. `"B-Spline Set:1+Clean:1"`). Use this for entity comparison, NOT `id()`.
- `Occurrence.assemblyContext` — returns the parent occurrence in the assembly path. `None` if the container is the root component. **Also returns `None` for native (unproxied) occurrences accessed via `component.occurrences.item(i)`** — that's documented behavior, not a sign of being root-level. To get a proxy with `assemblyContext` populated, iterate `parent_occ.childOccurrences.item(i)` instead.
- `Occurrence.moveToComponent(targetOcc)` — **broken / do not use.** Docs disagree with each other on where the source ends up. Field test: when `targetOcc` is the wrapper's parent (B-Spline Set), the source is moved to root (sibling of B-Spline Set), NOT into B-Spline Set's component. Source becomes a SIBLING of target, not a child of `target.component`. Returns `None` on failure (no exception). The `_uplift_through_wrappers` function is parked because of this. If you need to relocate occurrences, look for a different mechanism (`Occurrences.addExistingComponent` is the obvious candidate — adds a fresh occurrence under a target component — but combining it with deletion of the original creates `:2`-suffixed names since `:1` is in use until the original is deleted).
- `BaseFeature` edits — scoped to the host component for body operations. Cross-component occurrence deletes work; cross-component body deletes raise `InternalValidationError`. Body adds to a child component from a wrapper BaseFeature don't work either.
- `UnstitchFeature.dissolve()` — documented method. Note: "only valid for non-parametric features." Probably means it raises in parametric mode (the default). Untested.

## Open issues

**Two cosmetic wrappers in the design tree** — the `B-Spline` PRODUCT wrapper between B-Spline Set and Clean/Stamped, and the per-component `Unstitched` feature around each surface body. Both are functionally inert. Eliminating either has eaten significant time without a working solution; see "Stop trying these things". Filed as cosmetic-only until a reliable mechanism surfaces.

**`help.autodesk.com` not on Cowork allowlist.** When fetching API docs, requests get blocked. User can add it via Settings → Capabilities → Network access. Useful complementary domains: `forums.autodesk.com`, `autodeskfusion360.github.io`, `www.autodesk.com`.

## Verification checklist for next session

Before changing anything, run a fresh OK click and capture:

1. **`b_spline_gen_log.txt`** — `[POST-IMPORT]` block. Looking for:
   - `found 2 Clean/Stamped target(s) in subtree`
   - `body rename 'BodyN' -> 'panel' in 'X' (isSolid=True)`
   - `body rename 'BodyN' -> 'surface' in 'X' (isSolid=False)`
   - **No** `wrapper detected` / `moveToComponent` / `deleted empty wrapper` lines — uplift is parked.
2. **Design tree screenshot** — confirm B-Spline Set contains exactly one child (`B-Spline` wrapper), and that wrapper contains exactly two children (Clean, Stamped), each with `panel` and `surface` bodies.
3. **`cam-builder-cam-debug.log`** — run CAM Builder, look for `BSPLINE FILTER:` lines. Should show `pruned 1 Clean occurrence(s)` (when Stamped is primary) and `pruned 1 surface body/bodies`. The filter walks by component name so the `B-Spline` wrapper level is transparent to it.
4. **No `WARNING` lines on `CopyPasteBodies`** in either log. Should be zero — we don't use `copyToComponent` any more.

## Git state

Most recent commit: `762c337 fix(bspline): wrapper uplift via fullPathName + park Unstitched dissolve`

Working-tree changes since `762c337` (not yet committed): wrapper uplift backed out. `_uplift_through_wrappers` is a no-op stub, `_post_import_setup` no longer calls it, both call sites pass no `parent_hint`, single-step path keeps the proxy-via-`childOccurrences` iteration (harmless, leaves room for future re-attempts). Effective behavior matches commit `562b977` ("collapse export pipeline to single STEP, 2 components") for the post-import phase.

Suggested commit message for these changes:
```
revert(bspline): park wrapper uplift, restore stable B-Spline wrapper

moveToComponent's documented behavior contradicts itself and
empirically makes source a sibling of target, not a child of
target.component. Two field runs left B-Spline Set empty after the
move-then-delete sequence, requiring undo. Reverting to the post-
import behavior of 562b977 (rename in place, keep wrapper).
Cosmetic 'B-Spline' wrapper between B-Spline Set and Clean/Stamped
remains; downstream code (CAM filter, body lookups by name) is
indifferent to it.

_uplift_through_wrappers is now a no-op stub with a 'do not revive'
docstring documenting the failure modes. CONTEXT.md and 'Stop trying
these things' section updated.
```

The branch is several commits ahead of `origin/main`. Push with GitHub Desktop "Push origin" or `git push origin main` from PowerShell after closing any other git tool that holds `.git/index.lock`.

## Stop trying these things

These approaches were tried and failed in interesting ways. Save the next session some time:

- **Deleting the `B-Spline` wrapper via `Occurrence.moveToComponent`** — the docs contradict themselves on whether the source becomes a child of `target.component` or a sibling of `target`. Field test (commits up to `762c337`): with `target = parent of wrapper` (B-Spline Set), Clean/Stamped were moved to root, not into B-Spline Set. With `target = wrapper`, the same-context requirement isn't satisfied (gc and wrapper have different `assemblyContext`) and the call returns `None` silently. Multiple iterations broke the design tree, requiring undo. Function `_uplift_through_wrappers` is now a no-op stub. Untested-but-likely-to-also-fail: `Occurrences.addExistingComponent(comp, transform)` to add fresh occurrences under B-Spline Set then delete the wrapper — adds `:2`-suffixed names because `:1` is in use during the operation, and the original references inside the wrapper get nuked when the wrapper is deleted (cosmetic naming issue at best, broken-state risk at worst).
- **Wrapping `copyToComponent` + `deleteMe` in a BaseFeature edit** — cross-component ops don't survive `finishEdit()`. Surface bodies vanish entirely.
- **`comp.features.unstitchFeatures` collection** — empty in the field log. The feature Fusion creates from STEP imports isn't in this collection (or the API doesn't expose it under that name).
- **Holding the body ref returned by `bRepBodies.add(transient, baseFeature)` across `finishEdit()`** — ref invalidates. Renames silently no-op. Use index-based refetch.
- **`id()`-based occurrence comparison** — Fusion creates a new Python wrapper object every `.item(i)`. Use `fullPathName`.

## Useful entry points if you need to dive in

- `_handle_generate()` in `b-spline-gen.py` — the post-import handler that calls `_post_import_setup()`. Around line 1000+.
- `generateThickenedStep()` in `core/stepWriter.js` — the STEP writer. Body list construction is at the top, product assembly at the bottom.
- `onFusionApply()` in `main/main.js` — the export trigger.
- `_apply_bspline_panel_filter()` in `cam_engine/mm_builder.py` — the CAM-side filter, the consumer of the body name contract.
