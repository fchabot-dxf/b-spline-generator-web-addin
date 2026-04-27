# Open bugs — bspline + cam-builder consolidation

Three bugs that are STILL not fixed despite multiple attempts. This is a context
sheet for a fresh debugging session — pick up cold, do not assume the prior
fixes worked.

---

## Bug 1 — body still named `surface (1)` (or `surface_1 (1)`)

### Symptom
After running a 4-variant export (cleanSolid + stampedSolid + cleanSurface +
stampedSurface, sent as four back-to-back single-step calls with `isAppend: true`),
the consolidated `Stamped` (and `Clean`) component shows a body named:

- `surface (1)` — Fusion's space-parens auto-uniquifier
- or `surface_1 (1)` — a previous fix attempt produced this combined form

The desired name is just `surface`. The companion `panel` body always reads
correctly as `panel`.

### Where the code lives
- File: `bspline-frame-builder/b-spline-gen/b-spline-gen.py`
- Function: `_consolidate_bspline_variants(occurrences)` — main consolidation
- Function: `_apply_pending_renames(pending_renames, kind_counters)` — rename pass
- Function: `_stamp_body_name(occ, name)` — renames home's existing bodies
- Helpers: `_is_panel_body_name(bn)` and `_is_surface_body_name(bn)` —
  accept `surface`, `surface_N`, `surface (N)`

### What was already tried (and DID NOT solve it)
1. **3-phase order: copy all → deleteMe all sibs → rename**. Theory: source
   body alive at rename time was holding the name. Result: still suffixed.
2. **Defensive 2-step rename**: assign tmp name first, then desired name, to
   release any internal Fusion claim. Result: still suffixed in some cases.
3. **`kind_counters` computed BEFORE copy loop** (was after — was double-counting
   the just-copied body and bumping suffix to `surface_1`). Result: helped one
   case but bug still appears.
4. **Pre-rename source body**: `sb.name = target_body_name` BEFORE
   `copyToComponent` so the destination body inherits the correct name. Result:
   bug still appears.
5. **Skip-if-already-correct**: in the post-copy pass, read `new_b.name` and
   skip the setter entirely if it already matches target — re-assigning a
   body's existing name is what triggers Fusion's uniquifier. Result: bug still
   appears.
6. **BaseFeature wrap around copy + delete + rename**: failed catastrophically
   — surfaces vanished because BaseFeature edits don't permit cross-component
   ops (copyToComponent FROM sib, deleteMe ON sib). REVERTED.

### Diagnostics in code
The rename pass logs `[CONSOLIDATE] rename collision: wanted '<X>' got '<Y>'
(before='<Z>')` when the final name doesn't match the requested name. In the
latest user run, NO such line appeared in `b_spline_gen_log.txt`. That should
mean the body reads `surface` immediately after rename — but the user's tree
visibly shows `surface (1)`.

### Hypotheses NOT yet tested
- **Fusion auto-suffixes AFTER `_handle_generate` returns** — possibly during
  the next compute or document validation, the body gets uniquified retroactively.
  If so, our diagnostic check (which runs immediately after the rename) won't
  catch it. **Test:** add a deferred check via `app.executeTextCommand` or a
  custom event that runs ~1s later and re-reads the body name.
- **Design-wide name collision** — there's a `Clean` component AND a `Stamped`
  component, and EACH wants a body named `surface`. Could Fusion enforce body
  name uniqueness DESIGN-WIDE (across components) on certain operations?
  **Test:** name one component's body `surface_clean` and the other's `surface_stamped`
  and see if the `(1)` disappears.
- **The (1) is part of a sketch projection or attribute** that we copy along
  with the body. **Test:** dump every body's `attributes` after consolidation.
- **`copyToComponent` returns a body whose initial name is derived from
  source COMPONENT not source BODY** — i.e. Fusion looks at the source occ's
  component name `terrain stamped surface` and auto-names the new body
  `surface`. The pre-rename then runs on `sb` (source body) but the
  destination already grabbed an auto-name FIRST. **Test:** log
  `new_b.name` IMMEDIATELY after `copyToComponent` returns, before the
  rename pass.

### Files/lines
- Pre-rename + copy loop: `b-spline-gen.py` ~line 449-490
- Rename pass helper: `b-spline-gen.py` ~line 492-545
- Body name helpers: `b-spline-gen.py` ~line 150-175

---

## Bug 2 — Two reference-failure warnings on the timeline

### Symptom
Fusion shows a warning popup (yellow triangle) on the consolidation
`CopyPasteBodies1` timeline feature:

```
CopyPasteBodies1
  1 Reference Failures: The model is using cached geometry to solve.
    Please reselect reference geometry for failed features in the timeline.
  1 Reference Failures: Failed to get target occurrence transform
```

Two warnings, both on the same `CopyPasteBodies1` feature. They appear after
EVERY consolidation run.

### Cause (reasonably certain)
`BRepBody.copyToComponent(target_occurrence)` creates a parametric "Copy/Paste
Bodies" timeline feature that holds a back-reference to BOTH the source body
AND the target occurrence. We then immediately call `sib_occ.deleteMe()` —
which destroys the source body AND the target occurrence reference — leaving
the parametric reference in the CopyPasteBodies feature DANGLING. Fusion
flags it on the next compute.

### What was already tried
1. **Wrap copy + delete in BaseFeature edit** — the BaseFeature would collapse
   into a direct-edit feature with no parametric back-references, suppressing
   the warnings. FAILED: cross-component ops (copyToComponent from sib,
   deleteMe on sib) don't survive `finishEdit()` — surfaces vanished entirely.
2. **TimelineGroup wrap** — `_wrap_timeline_in_group` collapses N entries into
   one named `B-Spline Consolidate` row. Cosmetic — the underlying CopyPasteBodies
   features still exist and still warn. Implemented and works visually.

### Hypotheses NOT yet tested
- **`adsk.fusion.TemporaryBRepManager.copy(body)` + `home.bRepBodies.add(transient_body, base_feat)`**:
  bypass copyToComponent entirely. Get a transient (in-memory) copy of the
  source body, add it as a new body inside a BaseFeature edit on the HOME
  component (not cross-component). The BaseFeature has no back-reference to
  the source. Then deleteMe sib OUTSIDE the BaseFeature edit (separate
  timeline feature, but no dangling ref).

  **Concern:** transient bodies are in source-component LOCAL coords. If sib
  and home occurrences have different transforms, the body lands in the wrong
  place. In our case both are children of `B-Spline Set` and STEP imports
  usually have identity transforms — likely safe but verify.

- **Move ops to the design's root and handle via direct manipulation** —
  involves more rework but eliminates the parametric ref entirely.

- **Suppress the CopyPasteBodies parametric reference via API**: there may be
  a flag on `Design` or the feature itself to mark it as direct-edit retroactively.
  Worth checking the `BaseFeature` API for an "absorb existing feature" method.

### Files/lines
- copyToComponent call site: `b-spline-gen.py` ~line 469-473
- TimelineGroup helper: `b-spline-gen.py` `_wrap_timeline_in_group` ~line 220
- TimelineGroup invocation: `b-spline-gen.py` end of `_consolidate_bspline_variants`

---

## Bug 3 — MM filter can't delete the surface body from the bspline_set MM

### Symptom
In the `MM - B-spline set` Manufacturing Model, after `_apply_bspline_panel_filter`
runs, the `Stamped:1 → Bodies` still contains a `surface (1)` body (or whatever
the bspline-side bug 1 produces). The Clean occurrence DOES get deleted (Stamped
takes primary) — that part works. But the surface body inside Stamped survives.

### Where the code lives
- File: `bspline-frame-builder/CAM-builder/cam_engine/mm_builder.py`
- Function: `_apply_bspline_panel_filter(mm, logger)` — the filter
- Helpers: `_is_surface_body_name(bn)` and `_is_panel_body_name(bn)` — same
  pattern matchers as bspline-gen, accept `surface`, `surface_N`, `surface (N)`

### What was already tried
1. **Wide name matcher** (`surface`, `surface_N`, `surface (N)`) — added so we
   catch all the variant naming the bspline side produces. Verified locally
   that `_is_surface_body_name('surface (1)')` returns True.
2. **Engine reload on every Generate** — `_do_generate` in `cam-builder.py`
   now always calls `_load_engine()` so module changes pick up without an
   addin restart. Should mean the latest filter code runs.
3. **BaseFeature wrap** — the body deletion is wrapped in a BaseFeature edit
   on the MM's component so deletions collapse into one timeline entry.
   This pattern works for the existing `_apply_occurrence_filter` so should
   work here too.

### What we DON'T know yet (need to verify)
- **Did the filter actually run?** Look in `cam-builder-cam-debug.log` for
  lines matching `BSPLINE FILTER:` after the latest Generate. Possible outcomes:
    - No `BSPLINE FILTER:` lines at all → filter wasn't called → check the
      `if rule == 'bspline_set':` gate in `build_mm` and the engine reload.
    - Line `BSPLINE FILTER: no B-Spline Set occurrence found in MM snapshot`
      → the recursive walk via `mm.occurrence.component.allOccurrences` didn't
      find a component whose name contains `b-spline set` / `bspline set`.
      Maybe the wrapper occurrence renames the component on snapshot.
    - Line `BSPLINE FILTER: nothing to prune` → both `occs_to_delete` and
      `surface_bodies_to_delete` were empty. Means the body name didn't match
      any of our patterns OR the survivors loop didn't pick up any occurrences.
    - Line `BSPLINE FILTER: pruned 1 Clean occurrence(s) and 0 surface body/bodies`
      → Clean was deleted but no surface bodies were collected. Body name
      patterns aren't catching the actual body name.
    - Line `BSPLINE FILTER: surface body delete raised` → deleteMe failed at
      runtime — read the exception.

### Hypotheses to test in order
1. **Read `cam-builder-cam-debug.log`** at the END of the file, look for
   `BSPLINE FILTER:` lines from the latest run. Most info comes from this.
2. **Bodies inside an MM might NOT support `deleteMe()` outside a BaseFeature
   edit**. The wrapper IS in a BaseFeature, but the bodies belong to a child
   component (Stamped). Possibly `body.deleteMe()` only works on bodies OF
   the BaseFeature's host component — so deleting Stamped's bodies needs a
   BaseFeature edit on Stamped, not on the wrapper. **Fix:** open a BaseFeature
   on each survivor occurrence's component (Stamped, Clean) and delete the
   surface bodies inside that.
3. **The body lookup walks `surv.component.bRepBodies`** but `surv` is an
   Occurrence inside an MM. The body refs through `surv.component` may resolve
   to the SOURCE design's component, not the MM's snapshot. Deleting them
   would either fail or affect the wrong product. **Fix:** access bodies via
   the MM's snapshot graph specifically — `surv.bRepBodies` (occurrence-level,
   if available) or walk `mm.occurrence.component.allOccurrences[i].bRepBodies`
   directly.
4. **`body.isValid` should be checked before deleteMe** — if the body got
   invalidated by an earlier op in the same pass, deleteMe raises. Already
   done in code, but maybe also log when it's False so we can see.

### Files/lines
- Filter function: `mm_builder.py` `_apply_bspline_panel_filter` ~line 282
- Body name helpers: `mm_builder.py` `_is_panel_body_name` / `_is_surface_body_name` ~line 410
- Engine reload (always): `cam-builder.py` `_do_generate` ~line 300

---

## Quick verification checklist for next session

Before writing any new code, gather these facts from a fresh run:

1. **From `bspline-frame-builder/b-spline-gen/b_spline_gen_log.txt`** (after a
   fresh 4-variant export):
   - Search for `[CONSOLIDATE] rename collision` — does it appear? What's
     `before='...'`?
   - Add a temp diagnostic: log `new_b.name` immediately after each
     `copyToComponent` returns, BEFORE any rename. This tells us what Fusion
     auto-named the destination body.

2. **From `bspline-frame-builder/CAM-builder/cam-builder-cam-debug.log`** (after
   a fresh CAM Builder Generate):
   - Search for `BSPLINE FILTER:` — which of the four outcomes documented
     above appears?
   - If `pruned 1 Clean ... and 0 surface`, add a temp diagnostic that logs
     EVERY body name encountered in the survivors loop, lowercased, so we can
     see what's actually there.

3. **From the Fusion design tree** (after a fresh export):
   - Click the `surface (1)` body and check the rename field — is it actually
     stored as `surface (1)` or is the `(1)` a UI-side disambiguator only?
     (Press F2 to edit. If the editable text is just `surface`, it's a UI
     phantom we can ignore.)

4. **If running the bspline-gen multiple times in the same document**, make
   sure the timeline isn't carrying leftover bodies named `surface` from
   prior runs that we're now colliding with. `_remove_last_import` should
   handle this but verify.

---

## Files touched in latest fix attempts (for git diff)

- `bspline-frame-builder/b-spline-gen/b-spline-gen.py`
  - Added `_is_panel_body_name` / `_is_surface_body_name` helpers
  - Added `_timeline_marker_safe` / `_wrap_timeline_in_group` helpers
  - Rewrote `_consolidate_bspline_variants` rename strategy multiple times
  - Added `_apply_pending_renames` helper
  - Replaced 5 narrow body-name checks with helper calls

- `bspline-frame-builder/CAM-builder/cam_engine/mm_builder.py`
  - Added `_apply_bspline_panel_filter` function
  - Added `_is_panel_body_name` / `_is_surface_body_name` helpers
  - Added `_component_has_panel_body` helper
  - Wired filter into `build_mm` for `rule == 'bspline_set'`

- `bspline-frame-builder/CAM-builder/cam_engine/cam_workspace.py`
  - Added `activate_manufacture_workspace` (auto-switch instead of erroring)

- `bspline-frame-builder/CAM-builder/cam_engine/cam_coordinator.py`
  - Wired auto-switch + retry into `run`

- `bspline-frame-builder/CAM-builder/cam-builder.py`
  - `_do_generate`: always call `_load_engine` (so module changes pick up)
  - Auto-close palette on `report['ok']`
  - Hardened `run()` and `stop()` for idempotent start/stop
