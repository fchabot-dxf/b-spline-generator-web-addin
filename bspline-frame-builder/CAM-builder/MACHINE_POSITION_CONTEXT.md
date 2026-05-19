# Machine Position + Attach Point + Rest-Machining — Context Sheet

> **STATUS — workpiece anchoring RESOLVED.**
> See `CAM_BUILDER_CONTEXT.md` § "Fence-anchored WCS" for the current
> implementation. The addin now navigates the loaded Ultimate Bee
> machine sim doc, finds the inside-corner `BRepVertex` of the
> `'fence'` body inside `static_0:1+MDF:1`, and binds every Setup's
> `wcs_origin_point` to it. **Cross-doc live entity references bind
> cleanly** — the historical breakage was specific to the saved-token
> path (`Design.findEntityByToken`), which is no longer used.
>
> The `ui.selectEntity` button, the deferred SELORIG event handler,
> the `IronSetup` commandCreated tab-activator, and the
> `part_attach_token.json` settings file have all been **removed**
> from the codebase. This document is retained for archaeological
> context — every section below describes the OLD failure modes and
> WHY each "fix" didn't work, which is still useful when triaging
> regressions or proposing a new approach.

Companion to `CAM_BUILDER_CONTEXT.md`. Captures the two intertwined
hard-to-debug problems that share the same deferred-TPGen code path:

1. **Workpiece anchoring.** ~~How does the workpiece end up at a known,
   fence-anchored location on the Ultimate Bee table when the user
   clicks BUILD, and why every "automatic" approach so far has bled
   into the next.~~ **RESOLVED** — see status banner above.
2. **Rest-machining toolpath generation.** Why per-op
   `cam.generateToolpath()` silently drops Morphed Spiral ops, and
   why bulk `cam.generateAllToolpaths()` is the only mode that works.

Read this first whenever the workpiece lands wrong, the WCS looks
wild, or rest-machining ops come up empty. Quick-pointer to the
diagnostic dump that captures every relevant coordinate per run is
`log_position_diagnostics()` in `cam_engine/setup_builder.py`.

---

## The bug — one sentence

The user wants a workpiece that auto-anchors to the **inside corner of
the fence on the Ultimate Bee table** so the post-processed g-code lands
at a predictable physical X/Y/Z on the machine. Today, after BUILD, the
workpiece either floats at the design origin or appears at a per-setup
location that varies by 100+ mm between Stock / B-spline Back / B-spline
Top / Frame because Fusion derives each Setup's WCS independently from
stock geometry, *not* from anything the add-in or the `.mch` file
declares.

---

## Why it's hard — the three independent coordinate systems

Fusion treats these as three loosely-coupled subsystems. Changing one
does **not** propagate to the others.

| Subsystem                | Lives in                  | Controls                       | Set by                                        |
|--------------------------|---------------------------|--------------------------------|-----------------------------------------------|
| Machine **table frame**  | `.mch` JSON               | Where the machine geometry sits in *machine sim world*. `table_0.attach_frame.point` is a kinematic anchor — NOT the workpiece anchor. | Hand-edited in the `.mch` file. |
| **Part Position** (Attach Point) | `setup.parameters['job_positionAttach']` | Which entity on the machine the workpiece "sticks to" during sim. Cross-doc proxy bound to a vertex / construction point / face on the Ultimate Bee model. | `ui.selectEntity` in the Edit Setup → Part Position tab → Table Attach Point picker. |
| **WCS**                  | `setup.parameters['wcs_*']` | Where g-code zero lands relative to the workpiece (stock bbox + box-point + axis orientation + flipY/flipZ). | `wcs_origin_mode` + `wcs_origin_boxPoint` + stock geometry, computed per setup. |

The trap: the user thinks "fence corner" is one thing. Fusion thinks of
it as three things that must be set in three different places. Changing
`.mch table_0` doesn't move the workpiece. Setting the Attach Point
doesn't move WCS. Setting WCS doesn't change where the workpiece sits on
the table sim.

---

## What's known to NOT work

These have all been tried and rejected:

1. **Editing `.mch table_0.attach_frame.point`** to encode a fence offset.
   The point is part of the machine's *internal* kinematic chain; moving
   it shifts the visual machine relative to its own origin but does not
   move the workpiece. Verified in `log_position_diagnostics` runs.

2. **Hardcoding per-setup XYZ offsets** in `setup_builder.py`. User
   explicitly rejected ("no hardcoding, these models are variable"). Each
   project has different stock dimensions; an offset that works for one
   panel size won't work for the next.

3. **Sequential per-op `cam.generateToolpath(op)`** — when used to drive
   rest-machining cascades, Morphed Spiral ops fail in ~1 second with no
   error and no toolpath. The IPV (In-Process View) doesn't propagate
   synchronously between ops, so the rest-machining input is empty.
   `cam.generateAllToolpaths(False)` (bulk) works because Fusion manages
   the cascade internally. Settle delays (`adsk.doEvents` + `time.sleep`)
   between per-op calls did NOT fix it.

4. **`findEntityByToken` cross-doc binding** for the fence corner
   entity. Some entity types (ConstructionPoint on a referenced
   component) raise `InternalValidationError` when looked up by token
   from a different document. The workaround is to ask the user to
   click once, then persist the token in `part_attach_token.json` and
   replay it via `setup.parameters['job_positionAttach'].value.value =
   [resolved_entity]` on subsequent BUILDs.

5. **Triggering Edit Setup programmatically via `IronSetup.execute()`**
   to drive the Part Position tab from code. `IronSetup` is the command
   ID for the *New Setup* dialog, not Edit Setup. However, we discovered
   that **`IronEditOperation`** acts as the context-sensitive Edit command.
   Selecting an existing Setup in `ui.activeSelections` and executing
   `IronEditOperation` successfully launches the native Edit Setup dialog
   programmatically. While there is no native API method to change the
   active tab of this dialog, standard OS keyboard automation (sending
   `Ctrl + Tab` twice via Windows `SendKeys`/PowerShell) can automatically
   focus the **Part Position** tab once the dialog is active.

6. **`ui.selectEntity` from inside an HTML palette event handler.** The
   machine geometry doesn't render in that execution context — the user
   sees an empty viewport and can't click the fence. Workaround:
   `app.fireCustomEvent(SELORIG_EVENT_ID, '{}')` and run the
   `selectEntity` call from the deferred handler, which executes in the
   main event-loop context where the CAM machine renders correctly.

---

## What DOES work (current SELECT ATTACH POINT flow)

1. **User clicks BUILD.** Add-in builds 3 MMs + 4 Setups; no machine,
   no templates, no toolpath gen yet. (`skip_templates=True,
   skip_machine=True` propagated through `cam_coordinator.run`.)

2. **User clicks ADD MACHINE.** Add-in calls
   `_sb._assign_default_machine(setup, ...)` per setup, which sets
   `setup.machine` to the Ultimate Bee 3 axis `.mch` config. Machine
   geometry now lives in each Setup but the workpiece-to-machine
   binding is unset.

3. **User clicks SELECT ATTACH POINT.** Add-in fires
   `SELORIG_EVENT_ID` → `_DeferredSelectOriginHandler.notify()` →
   `_do_select_origin_impl()` which:
   - Switches to the Manufacture workspace if not already there.
   - Turns on every setup's `isLightBulbOn`.
   - Calls `target_setup.activate()` to make the machine geometry
     render in the viewport.
   - Prompts via `ui.selectEntity('...', 'Vertices,ConstructionPoints,
     SketchPoints,Edges,Faces')`.
   - On a successful pick, walks every setup and sets
     `setup.parameters['job_positionAttach'].value.value = [ent]`.
   - Persists `ent.entityToken` to `part_attach_token.json` for
     future BUILD runs (replayed in `apply_table_attach_to_all_setups`).

4. **User clicks APPLY TOOLPATHS.** Add-in applies cloud templates,
   then fires `TPGEN_EVENT_ID`. The deferred handler:
   - Pumps `adsk.doEvents()` for 1.5 s of warmup.
   - Calls `log_position_diagnostics(cam, logger)` to record every
     coordinate to the debug log for forensics.
   - Calls `apply_table_attach_to_all_setups(cam, logger)` to replay
     the saved token if any setup's `job_positionAttach` is empty
     (self-heals after a hot-reload or a partial pick).
   - Calls `force_all_tool_numbers_to_one(cam, logger)` to renumber
     every op's `tool_number` (and `op.tool.tool_number`) to 1, since
     the user is on a manual tool-change workflow.
   - Calls `cam.generateAllToolpaths(False)` in BULK and waits on
     `future.isGenerationCompleted`.
   - Post-audit walks every op and logs `hasToolpath` ✓ / ✗.

---

## Diagnostic dump — `log_position_diagnostics`

`cam_engine/setup_builder.py` exposes a single function that captures
everything you might want to inspect after a misbehaving run. Triggered
automatically inside the deferred TPGen handler, also safe to call
manually after a build. Output goes to `cam-builder-cam-debug.log`.

Recorded per run:

| Section          | Content                                                  |
|------------------|----------------------------------------------------------|
| `.mch`           | `model_urn`, `table_0.attach_frame.point`, `x_direction`, `z_direction` |
| Sim model        | `static_0` occurrence translation, world bbox, MDF spoilboard + fence body bboxes, fence-inside-corner-bottom vertex world position |
| Kinematic chain  | Each axis component, its parent, and its translation     |
| Per setup        | WCS Matrix3D (translation + axes via `getCell` and `asArray`), stock bbox, stock mode, `job_positionAttach` state (bound? to what?) |
| Derived          | Stock `bottom 1` position + required "TO MOVE TO FENCE" shift |

Use this whenever the workpiece lands wrong. The "TO MOVE TO FENCE"
field is the per-setup delta you'd need to inject to anchor the stock
to the fence corner — and the fact that it varies per setup is the
clearest evidence that `.mch table_0` editing alone can't solve this.

---

## Key files

| File                                              | Role                                                              |
|---------------------------------------------------|-------------------------------------------------------------------|
| `CAM-builder/cam-builder.py`                      | Palette UI dispatch, button handlers, CustomEvent registration, deferred handlers (`_DeferredSelectOriginHandler`, `_DeferredTPGenHandler`). |
| `CAM-builder/cam_engine/cam_coordinator.py`       | Pipeline orchestrator. Accepts `skip_templates` / `skip_machine` flags. Auto-cleanup of prior build before re-run. |
| `CAM-builder/cam_engine/setup_builder.py`         | `build_setup`, `_assign_default_machine`, `apply_table_attach_to_all_setups`, `_load_part_attach_token`, `_save_part_attach_token`, `_resolve_or_capture_table_attach_entity`, `force_all_tool_numbers_to_one`, `log_position_diagnostics`. |
| `CAM-builder/part_attach_token.json`              | Persisted `entityToken` of the user-clicked fence corner. Replayed on future BUILDs. |
| `CAM-builder/ui/html/cam_builder_palette.html`    | 3-section palette: SETUPS (BUILD), MACHINE (ADD MACHINE + SELECT ATTACH POINT), TOOLPATHS (APPLY TOOLPATHS). |
| `<project>/Machines/Ultimate Bee 3 axis.mch`      | Machine config (local + cloud copies must stay in sync). Contains `model_urn` and `table_0.attach_frame.point` (UNUSED for workpiece placement — kinematic only). |
| Ultimate Bee sim model (Fusion cloud)             | The actual 3D model of the machine. `model_urn` in `.mch` points to a specific version (currently v31). Closing v29 was required to break a stale-cache issue. |

---

## CustomEvent IDs

All deferred handlers register with these IDs. Stop / Start of the
add-in unregisters each defensively before re-adding (idempotent).

| Event ID                           | Defined in        | Purpose |
|------------------------------------|-------------------|---------|
| `CamBuilder_DeferredRefresh`       | `cam-builder.py`  | Hot-reload `run(None)` after Stop. |
| `CamBuilder_DeferredTPGen`         | `cam-builder.py`  | Run `generateAllToolpaths` outside the HTML handler context. |
| `CamBuilder_DeferredSelectOrigin`  | `cam-builder.py`  | Run `ui.selectEntity` outside the HTML handler context so the CAM machine renders during pick. |

---

## Rest-machining bug — Morphed Spiral empty toolpaths

Adjacent but separate failure surface. Lives in the same `_DeferredTP
GenHandler.notify()` code path that runs after SELECT ATTACH POINT →
APPLY TOOLPATHS, so it's caught up in the same rabbit hole every time
the position bug is being chased.

### The bug — one sentence

When the deferred TPGen handler runs **sequential per-op**
`cam.generateToolpath(op)` calls on a setup that includes Morphed
Spiral rest-machining ops, those ops complete in ~1 second with no
error and no toolpath. The same setup processed by
`cam.generateAllToolpaths(False)` (bulk) produces toolpaths for every
op including the Morphed Spirals.

### Why it happens

Rest-machining ops consume the **In-Process View** (IPV) — the stock
remainder after prior ops have run. Fusion computes the IPV lazily and
the result of one op's toolpath generation does NOT synchronously
propagate to the IPV input of the next op. When the add-in fires
per-op generation in a tight loop:

1. Op N (e.g. pocket-clearing) generates a toolpath; IPV update pending.
2. Op N+1 (Morphed Spiral rest machining) reads an empty IPV → no
   geometry to cut against → returns `hasToolpath=False` after ~1 s.

Bulk `cam.generateAllToolpaths(False)` works because Fusion's internal
batch engine manages IPV propagation between ops; the per-op API does
not expose that scheduler. Settle delays between per-op calls
(`adsk.doEvents()` + `time.sleep(0.5)`) did NOT fix it — the IPV recompute
isn't triggered by the event pump, it's only triggered by the bulk
generator.

### What was tried

| Approach | Result |
|----------|--------|
| Sequential per-op `cam.generateToolpath(op)`                       | 5 of 7 ops succeed; both Morphed Spirals fail in 1 s |
| Per-op + 500 ms `adsk.doEvents()` settle between ops              | Same failure — settle delay doesn't trigger IPV recompute |
| `cam.generateAllToolpaths(False)` (bulk, `skipValid=False`)        | All 7 ops produce toolpaths — **used today** |
| `future.isGenerationCompleted` polling with 1800 s timeout         | Works as the completion gate for bulk |

### Current implementation

`_DeferredTPGenHandler.notify()` in `cam-builder.py` — the bulk + poll
shape:

```python
future = cam.generateAllToolpaths(False)
bulk_timeout = 1800.0
last_progress_log = 0
while True:
    if future.isGenerationCompleted:
        break
    adsk.doEvents()
    time.sleep(0.1)
    elapsed = time.time() - t_start
    if elapsed - last_progress_log > 5.0:
        done  = getattr(future, 'numberOfCompleted',  '?')
        total = getattr(future, 'numberOfOperations', '?')
        _log(f"DEFERRED TPGEN: bulk progress {done}/{total} ({elapsed:.0f}s)")
        last_progress_log = elapsed
    if elapsed > bulk_timeout:
        break
```

A post-generation audit walks every op and logs `hasToolpath` ✓ / ✗
so a regression to the sequential failure mode shows up immediately:

```python
for i in range(cam.setups.count):
    setup = cam.setups.item(i)
    for j in range(setup.operations.count):
        op = setup.operations.item(j)
        if getattr(op, 'hasToolpath', False):
            dispatched += 1
        else:
            errors += 1
            _log(f"DEFERRED TPGEN AUDIT: ✗ '{op.name}' in '{setup.name}' MISSING toolpath", "WARNING")
```

### What to look for in the log

**Successful** run signature:

```
DEFERRED TPGEN: starting BULK generation of 7 ops
DEFERRED TPGEN: bulk progress 4/7 (5s)
DEFERRED TPGEN: bulk completed in 12.3s
DEFERRED TPGEN AUDIT: ✓ '<op>' in 'B-spline Top' has toolpath
... (×7)
DEFERRED TPGEN: post-audit ok=7 missing=0
TOOLPATHS complete — 7 ops ok
```

**Failure** signature (sequential-mode regression):

```
DEFERRED TPGEN: gen -> 'Morphed Spiral' in 'B-spline Top' ...
(no exception, no further output for that op)
DEFERRED TPGEN: post-audit ok=5 missing=2
TOOLPATHS complete — 5 ops ok, 2 missing
```

If you see `missing > 0` after a confirmed-bulk run, the issue is
*not* this bug — likely setup misconfiguration (no machine assigned,
empty stock, missing tool reference). Inspect the failing op's
`op.parameters` to triage.

### Don't break this

The single most common way to re-introduce this bug is to "improve"
the deferred TPGen handler by switching back to per-op generation for
progress reporting or finer-grained error handling. Don't. The
in-conversation history shows this regression happening twice already.
If you need progress UI, poll `future.numberOfCompleted` /
`numberOfOperations` on the bulk future — those are already logged at
5 s intervals.

### Open (lower priority — bulk works today)

1. **Programmatic IPV refresh.** Fusion may expose a private /
   undocumented way to force IPV recompute between per-op calls. Only
   worth investigating if a future feature needs per-op observability
   (e.g., live progress UI with per-op cancel).
2. **`continueMachining` flag inspection.** The per-side stock cascade
   for indexed machining (in `setup_builder.build_setups_generic`)
   sets `continueMachining=true` from side 1 onward. The hardcoded
   B-spline pipeline doesn't use that flag — verify that the B-spline
   Top setup's IPV input from B-spline Back is happening via the
   stock-mode path, not the per-side flag.

---

## Investigation state

**Closed (don't re-explore):**
- `.mch table_0` is *not* the workpiece anchor. Don't edit it expecting
  the workpiece to move.
- Sequential per-op generation is *not* a viable workaround for
  rest-machining timing — bulk is the right answer.
- `IronSetup.execute()` is *not* an Edit Setup entry point.
- Hardcoded per-setup offsets are off-limits.

**Open (worth re-trying with new info):**
1. **`setup.parameters['job_positionAttach']` direct binding without
   user pick.** Currently the user clicks once per project and the
   token is persisted. The persisted-token replay code path
   (`_resolve_or_capture_table_attach_entity`) silently fails for some
   entity types via `findEntityByToken`. Verifying which entity types
   *do* round-trip cleanly across docs would let us auto-bind from a
   single saved token without re-prompting.
2. **Per-setup WCS unification.** Even after Part Position is bound,
   each setup's WCS still derives independently from stock geometry.
   A future pass could explicitly set every setup's WCS to the same
   fence-corner construction point in the design — eliminating the
   per-setup spread visible in the diagnostics dump.
3. **Origin-mode `selectedPoint` for WCS.** Fusion supports
   `wcs_origin_mode = 'selectedPoint'` which lets WCS bind to a
   specific entity instead of a stock-bbox corner. Could let us anchor
   all four setups to the same construction point on the design.
4. **Driving Part Position via setup attributes instead of
   `selectEntity`.** Need to inspect whether `setup.attributes` can
   carry an entity reference that survives a doc save / reopen.

**Reproducibility checklist** when reopening this rabbit hole:
- Confirm `model_urn` in both local *and* cloud `.mch` files match the
  current v31 (or whatever) Ultimate Bee sim model version.
- Confirm any stale older-version Ultimate Bee documents are closed in
  Fusion (a v29 cache caused diagnostic confusion earlier).
- Confirm `part_attach_token.json` exists and contains a real token.
- Run a BUILD → ADD MACHINE → SELECT ATTACH POINT → APPLY TOOLPATHS
  cycle and read `log_position_diagnostics` output before drawing
  conclusions.

---

## Failure modes and what they mean

| Symptom                                                  | Likely cause                                                                                                  |
|----------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| Workpiece appears at design origin, not on the machine. | `job_positionAttach` is unset on the setups. Re-click SELECT ATTACH POINT. |
| Workpiece is on the machine but offset wildly per setup. | Each setup's WCS is independently computed from stock bbox + `wcs_origin_boxPoint`. Expected today; tracked under "Open" above. |
| Morphed Spiral ops have no toolpath.                     | Switched away from bulk generation by mistake; check that `cam.generateAllToolpaths(False)` is the active code path in `_DeferredTPGenHandler`. |
| Machine is invisible during SELECT ATTACH POINT prompt.  | `selectEntity` was called from the HTML handler context. Must fire `SELORIG_EVENT_ID` first so the pick runs in the deferred handler. |
| `findEntityByToken` returns None or raises `InternalValidationError`. | Entity type isn't cross-doc proxiable. Re-pick the entity (a vertex on a body usually round-trips better than a ConstructionPoint). |
| `.mch` change doesn't show in Fusion after edit.        | Cloud `.mch` cached; either bump version or check `model_urn` matches an open document version. |
