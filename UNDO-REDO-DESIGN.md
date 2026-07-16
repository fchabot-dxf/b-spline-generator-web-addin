# UNDO-REDO-DESIGN — why one frame build doesn't reverse as one undo (E8)

**Status:** investigation / design pass (E8). No code. For advisor review.
**Author:** worker, turn 99.
**Symptom (human-reported):** undo/redo "broken" in Fusion after the tilt feature (commit `6c1cce4`).
**Method:** code trace + a **read-only** live-Fusion probe (`fusion_execute`) to confirm the API facts.
The final visual proof is the human's (Fusion-only behaviour); the diagnosis + mechanism are here.

---

## 1. The frame-build op sequence (in order)

A sketch build is dispatched palette → `_schedule_hidden_build(data)` (`sketch_builder_ui.py:72`),
which sets `_pending_build_request` and calls `cmd_def.execute()` (`:83`) on a **hidden command**. That
fires `HiddenBuildCommandExecuteHandler.notify` (`:396-409`) — a real Command **Execute** handler —
which calls `_run_sketch_build_direct(data, style_id)` (`:464`). Inside that, the actual design
mutations happen, IN THIS ORDER (`fb_engine/parametric_engine.py` + `build_context.py`):

1. **`frame_tilt_deg` USER PARAMETER** — created (or reused) first, when the first sketch asks for its
   host plane: `_get_tilt_plane` (`parametric_engine.py:358`) → `create_or_update_param('frame_tilt_deg',
   '0 deg', 'deg')` (`:379`) → `userParameters.add(...)` (`build_context.py:269`). *This is design-level
   state, NOT a timeline feature.*
2. **Tilt construction plane** — `planes.setByAngle(xConstructionAxis, <param>, xYConstructionPlane)` →
   `planes.add(...)`, named `TILT_PLANE_NAME`, reused by name on later sketches/rebuilds
   (`parametric_engine.py:391-398`). A timeline feature; angle is DRIVEN BY the `frame_tilt_deg` param.
3. **Sketch 1 / 2 / 3** — `ctx.target.sketches.add(self._get_tilt_plane(ctx))` (`:187`, reusing the
   plane), each drawn inside an `isComputeDeferred` window (`:282-343`). Timeline features.
4. **(Solid builder)** — extrudes that follow the plane normal (`solid_builder_ui.py`, same hidden-command
   + dead-transaction pattern). Timeline features.
5. **Attribute stamping** — `FrameBuilder.ID` attributes onto the created entities.

The tilt commit `6c1cce4` touched **only** `parametric_engine.py` (+65/−4) — it introduced steps 1 & 2
and moved the sketches from raw XY onto the plane. Everything else pre-dates it.

## 2. Is any of it wrapped in an undo group / transaction? — NO (confirmed)

- **The `_start_undo_transaction('Build Skeleton')` wrapper is DEAD** (`sketch_builder_ui.py:473, 493-500`;
  same in solid `:496`). It calls `app.startTransaction(name)` behind `hasattr(app, 'startTransaction')`.
  **Live probe: `hasattr(app, 'startTransaction')` → `False`** (and `app.transactionManager` → `False`).
  So it ALWAYS returns `None`; `_commit`/`_abort` then early-return. No transaction is ever opened.
  Fusion has **no public undo-transaction API** on `Application` — this wrapper never did anything.
- **No `timelineGroups` / `TimelineGroups.add` anywhere** in the build (grep clean). **Live probe:
  `timeline.timelineGroups.add` EXISTS, existing groups = 0** — the API is available but unused.
- **The ONLY grouping today is implicit:** a programmatic `commandDefinition.execute()` makes Fusion
  treat that command's Execute-handler mutations as **one undo unit**. So the geometry (plane + sketches
  + extrudes) already collapses to a single Ctrl+Z — *for timeline features*.

**⇒ The build is ONE implicit command-undo unit for GEOMETRY, and ZERO explicit grouping. The gap is the
USER PARAMETER, which isn't a timeline feature.**

## 3. Root cause — evidence + verdict

The advisor's three candidates, judged against the evidence:

- **(a) N un-grouped ops → single Ctrl+Z reverses only the last:** *Partially.* True for the user
  parameter, NOT for the geometry. The geometry IS grouped (command Execute unit), so sketches+plane+
  extrudes reverse together. So the "9 ops, one undo" framing doesn't fit the geometry — it fits the
  param, which sits OUTSIDE the timeline.
- **(b) user-parameter creation doesn't undo like geometry:** **This is the leading cause.**
  `frame_tilt_deg` is a design-level user parameter (`userParameters.add`), not a timeline feature.
  Fusion user-parameter create/undo does not participate in the command's geometry undo unit the way a
  sketch/plane does — so a single Ctrl+Z that cleanly removes the frame's geometry can leave
  `frame_tilt_deg` **orphaned in the Parameters dialog**, and (because the plane's angle is DRIVEN BY
  that param) can desync the plane↔param relationship on the way back. Compounding it: both the param and
  the plane are **reused by name** on the next build (`itemByName`), so the design carries stale state
  that undo/redo can't cleanly walk — which reads to the user as "undo/redo broken."
- **(c) hidden-command dispatch / `_schedule_hidden_build`:** **Not the culprit** — it's precisely what
  provides the working one-unit geometry grouping (a `cmd_def.execute()` IS the undo unit). Worth noting
  only that this implicit grouping is Fusion-version-sensitive and undocumented.

**Pre-existing vs tilt-introduced:** **tilt-introduced.** Before `6c1cce4` the build created only timeline
geometry inside one command Execute → one clean undo. The tilt commit added the *first design-level user
parameter created mid-build*; that is the new element that doesn't reverse with the geometry.

## 4. Proposal

### 4a. The mechanism reality (research result)
- Fusion has **no public "undo transaction"** to wrap a build in — `app.startTransaction` /
  `transactionManager` do **not exist** (probed). The undo unit IS the command execution; the hidden
  dispatch already gives that for geometry. So "add a real transaction around the build" is **not an
  available option** — remove that expectation (and the dead wrapper).
- **`timeline.timelineGroups.add(startIndex, endIndex)` exists** but is **organizational** (collapse/expand
  a run of timeline features) — it is **NOT an undo mechanism** and **does not include user parameters**.
  Useful for timeline tidiness, useless for the actual bug.
- **User parameters and undo** are the crux: they're design-global, and their create/undo is not bound to
  the timeline/command geometry unit. So the fix has to be about the PARAMETER's lifecycle, not a wrapper.

### 4b. GATED FORKS (for the advisor)

**F1 — how to stop the orphaned-param / broken-undo:**
- **F1-A — drop the standalone user parameter.** Drive the plane's angle with a literal `ValueInput`
  (e.g. `createByString('0 deg')`) or the plane feature's own driven dimension instead of
  `userParameters.add('frame_tilt_deg')`. No user param ⇒ nothing to orphan; the plane is a timeline
  feature that reverses with the command. **Cost:** loses "edit tilt from the Parameters dialog after the
  build" — the commit's headline affordance.
- **F1-B (recommended) — treat `frame_tilt_deg` as a persistent design SETTING, and make the build
  param-idempotent + undo-tolerant.** Create it once, default `0 deg` (behaviourally a no-op = old flat
  build); on rebuild, reuse by name (already done); make `_get_tilt_plane` tolerate "param exists but
  plane was undone" (recreate plane, keep param). Accept that a lingering `0 deg` param is harmless. The
  geometry still reverses as one command unit; the only residue is a benign 0-deg param. **Cost:** an
  orphaned (harmless) param can persist after undo.
- **F1-C — create the param at add-in/palette-open, not during the build.** Then no build's undo unit
  ever contains a param create; every build only mutates geometry (clean command undo) and reuses the
  pre-existing param/plane. **Cost:** the param appears before the user builds anything.

**F2 — scope:** also **delete the dead `_start_undo_transaction`/`_commit`/`_abort` wrappers** (both
builders) since `app.startTransaction` provably never exists and the wrapper falsely implies grouping —
*(recommended: yes, it's misleading dead code)* — vs leave them.

**Optional tidiness (independent of the bug):** wrap the build's timeline features in a
`timelineGroups.add(start, end)` group so a frame reads as one collapsible timeline node. If taken:
capture `start = design.timeline.count` (or `markerPosition`) **before** `_get_tilt_plane`/the first
sketch, and `design.timeline.timelineGroups.add(start, design.timeline.count - 1)` **after** the last op,
all inside the command Execute. Caveat: the user param is not in the timeline, so it's excluded from the
group — this does NOT fix undo, only appearance.

### 4c. Interaction notes
- **Hidden-command dispatch:** keep it — it's the source of the working geometry undo unit. Don't move the
  build out of the Execute handler.
- **Tilt-plane / param reuse:** the fix must not re-add the plane/param on rebuild (the `itemByName` reuse
  already prevents that) and must handle the post-undo "param present, plane gone" state (F1-B recreates
  the plane from the surviving param).

## 5. What the human must confirm in Fusion (repro)

With the tilt add-in deployed, in a fresh design:
1. **Build a frame.** Note the timeline (plane + 3 sketches + extrudes) and open **Modify → Change
   Parameters** — confirm `frame_tilt_deg` is listed.
2. **Ctrl+Z once.** Does the ENTIRE build reverse (plane + all sketches + extrudes), or only part? Re-open
   Change Parameters — **is `frame_tilt_deg` still there (orphaned)?** (Expected per the diagnosis: geometry
   reverses, the param lingers.)
3. **Ctrl+Y (redo).** Does the build cleanly restore, or error / double up?
4. **Build again after the undo.** Does it reuse the lingering param/plane, or duplicate them?

Report which ops survive the single undo and whether `frame_tilt_deg` orphans — that distinguishes F1-B
(param lingers, geometry clean) from a deeper geometry-grouping problem.

---

*No application or build code was modified in this pass — investigation/design only. The one live-Fusion
action taken was a strictly read-only API probe (no design mutation).*
