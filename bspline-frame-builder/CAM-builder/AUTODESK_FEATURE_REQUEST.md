# Feature Request — Programmatic Access to Machine Model Geometry & Part Position

**Where to post (in order of preference):**

1. **Autodesk Forum — Manufacturing (CAM) API Feedback** (primary):
   https://forums.autodesk.com/t5/fusion-api-and-scripts-forum/manufacturing-cam-api-feedback/td-p/11869814
2. **Autodesk Ideas — Fusion 360**:
   https://ideas.autodesk.com/fusion360
3. **"Comment on this page" link** at the bottom of the relevant API doc pages
   (e.g. [`Setup` object](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/Setup.htm),
   [`CAM.allMachines`](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/CAM_allMachines.htm)).
   These mail directly to `mfg.api.help.comments@autodesk.com`.

---

## Title

Expose machine model geometry & coordinate-based Part Position binding in the Fusion CAM API

## Body — paste this

I'm building a Fusion 360 add-in that scaffolds Manufacturing Models and
Setups for a 3-axis router (Ultimate Bee CNC, DDCS Expert controller).
The add-in handles MM body-filtering, WCS configuration, stock-mode
cascading for indexed work, and machine assignment — all via the public
CAM API. One last piece blocks full end-to-end automation: **setting the
Part Position attach point** so the workpiece lands at a known,
fence-anchored location on the table.

### The gap

`Setup.parameters['job_positionAttach']` is a `CadObjectParameterValue`
whose `.value.value` is a list of entities. To write to it I need a
reference to an entity *on the machine model* — typically a vertex,
construction point, or face on the table / fence. Today the only paths
to obtain that entity are:

1. **`UserInterface.selectEntity`** — interactive click. Works, but
   forces a human-in-the-loop step in what would otherwise be a
   one-click build. Also fragile from inside an HTML palette event
   handler context (the machine model doesn't render in that execution
   scope; requires `app.fireCustomEvent` + deferred handler to bounce
   into a context where the machine geometry is visible).
2. **`Design.findEntityByToken(savedToken)`** — replay a token captured
   in an earlier session. Partially broken cross-document: a saved
   token for a ConstructionPoint on a referenced machine component
   raises `InternalValidationError` when resolved from a different
   document, even when the same machine file is attached. This appears
   related to the known issue that all Root Components share an entity
   token (forum thread 12002436).

`CAM.allMachines` returns the machine list, but neither the `Machine`
object nor any descendant exposes the rendered BRep geometry as
queryable entities. The library documentation explicitly states that
library objects are "temporary copies of the data that defines that
library object" — which I read as: the machine kinematic JSON is
parsed and rendered, but the resulting geometry is not surfaced as
`BRepBody` / `BRepVertex` / `BRepFace` collections through the API.

### Proposed additions

Either of these would unblock automation. Both would be even better.

**A) Geometry accessor on the `Machine` object:**

```python
machine = setup.machine            # already exists
bodies  = machine.bRepBodies       # NEW — kinematic frame bodies
occs    = machine.allOccurrences   # NEW — kinematic component tree
# enables:
fence_vertex = pick_named_vertex(bodies, 'fence_inside_corner')
setup.parameters['job_positionAttach'].value.value = [fence_vertex]
```

This mirrors how `CAM.designRootOccurrence.bRepBodies` already works
for the design-side geometry. Machine geometry is rendered in the
viewport regardless; exposing it through the API would be additive,
not breaking.

**B) Coordinate-based variant of `job_positionAttach`:**

```python
# Either a new parameter:
setup.parameters['job_positionAttachXYZ'].value.value = (x, y, z)
# Or a method on Setup:
setup.setPartAttachPoint(adsk.core.Point3D.create(x, y, z))
```

Allow the attach point to be specified as an XYZ in the machine
coordinate frame, with Fusion resolving it against the table internally
(closest-point or table-plane projection). This sidesteps the
entity-binding problem entirely and works regardless of which machine
is attached.

**C) Stable cross-document entity tokens for machine model entities** —
fix the `InternalValidationError` on `findEntityByToken` for
ConstructionPoints on referenced machine components.

### Why this matters

- **Indexed machining automation** — any add-in that wants to spawn
  multiple Setups (one per fixture orientation, one per side of a
  two-sided part, etc.) needs the workpiece anchored consistently.
  Without API access, every Setup needs a manual click.
- **Multi-machine shops** — script-based switching between machines
  requires re-anchoring the part for each. UI-only Part Position
  breaks the workflow.
- **Reproducible builds across projects** — saved entity tokens are
  fragile cross-document; XYZ coordinates aren't.

### What I've tried (so the workarounds aren't reinvented)

- Editing `.mch table_0.attach_frame.point` — moves the machine visual
  in sim space, does NOT move the workpiece.
- Hardcoded per-setup offsets — doesn't generalize across stock sizes.
- `ui.selectEntity` from inside an HTML palette handler — empty
  viewport, click fails.
- Capturing entity token via deferred-event `ui.selectEntity` then
  replaying via `findEntityByToken` on subsequent builds — works for
  most entity types, fails with `InternalValidationError` for some
  ConstructionPoint references.
- Triggering Edit Setup programmatically via `IronSetup.execute()` — `IronSetup` is the New Setup command, not Edit Setup. However, we discovered that **`IronEditOperation`** acts as the context-sensitive Edit command. By selecting an existing Setup in `ui.activeSelections` and executing `IronEditOperation`, we can successfully open the native Edit Setup dialog programmatically.
- Direct programmatic tab focusing on native dialogs — The public Fusion 360 API does not expose native C++ UI tabs for programmatic focus. However, we confirmed that standard OS keyboard automation (e.g., sending `Ctrl + Tab` twice via Windows `SendKeys`/PowerShell) can successfully switch the active dialog to the **Part Position** tab once open.

### Environment

- Fusion 360 build: [paste your current build number]
- Add-in language: Python (adsk.core / adsk.fusion / adsk.cam)
- Hardware: Ultimate Bee CNC (BulkMan3D), DDCS Expert 1.1 (M350 firmware)
- Post-processor: Fusion standard with DDCS-specific tweaks

Happy to share a minimal reproducible add-in if useful.

---

## Optional shorter version (for forum reply length limits)

> The Fusion CAM API exposes `CAM.allMachines` but doesn't expose the
> machine model geometry (`Machine.bRepBodies`, `Machine.allOccurrences`,
> or equivalent). That makes `Setup.parameters['job_positionAttach']`
> only settable via `ui.selectEntity` (manual click) or saved entity
> tokens (cross-document `findEntityByToken` raises
> `InternalValidationError` for ConstructionPoints on referenced
> components). Two asks:
>
> 1. Expose machine model geometry through `Machine.bRepBodies` /
>    `Machine.allOccurrences`, mirroring `CAM.designRootOccurrence`
>    on the design side.
> 2. Add a coordinate-based variant of `job_positionAttach`
>    (`setup.setPartAttachPoint(point3d)` or a `job_positionAttachXYZ`
>    parameter) so attach points can be specified by XYZ without
>    entity binding.
>
> Use case: indexed CAM automation for a 3-axis router (Ultimate Bee /
> DDCS Expert). Without one of these, every Setup needs a manual
> Part Position click — breaks one-click build workflows.

---

## After posting

If you want to push harder:

1. **Cross-link the bug**: post the same request on the
   [Fusion 360 Manufacture forum](https://forums.autodesk.com/t5/fusion-manufacture/bd-p/615) too — different reader audience than
   the API forum, sometimes pulls in Autodesk PMs.
2. **Tag the Manufacture API team** if you know any of their handles
   from past forum threads.
3. **File a support ticket** referencing the forum post — sometimes
   that escalates internal visibility.
