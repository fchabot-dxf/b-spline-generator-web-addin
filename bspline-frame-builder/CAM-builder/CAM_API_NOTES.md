# CAM API research notes

Findings from Autodesk help + forum samples (Apr 2026) that shaped this
architecture. Re-verify before changing any of the load-bearing
assumptions below.

## What works

- **Workspace gate**: `cam = adsk.cam.CAM.cast(doc.products.itemByProductType('CAMProductType'))`. Returns `None` outside the Manufacture workspace. Activate via `app.documents.activeDocument.products` after switching workspace, or call `workspaces.itemById('CAMEnvironment').activate()` first.
- **Manufacturing Model creation**: `cam.manufacturingModels.add(input)` where `input = cam.manufacturingModels.createInput()`. The input only exposes `name` — no source-component / transform args. Result has `mm.occurrence` pointing into the cam tree.
- **Setup creation**: `cam.setups.createInput(operationType)` with `operationType = adsk.cam.OperationTypes.MillingOperation`. Then `setupInput.models = [body_or_occurrence, ...]` and `cam.setups.add(setupInput)`.
- **Setup ↔ MM linkage**: implicit via `setupInput.models` — bodies/occurrences inside an MM's occurrence make the Setup "of" that MM. **No explicit `setupInput.manufacturingModel` property exists.**
- **WCS**: set on the LIVE `setup.parameters` *AFTER* `cam.setups.add()`. Choice parameters on a `SetupInput` expose `value.choices == []` (verified by runtime log) so any pre-add `set_choice` falls back to the placeholder `<UNSPECIFIED>` and fails on write. Both Autodesk samples (`SetViseOriginAsSetupWCSOrigin`, `CreateSetupsFromHoleRecognition`) follow the post-add pattern. Param names: `wcs_orientation_mode`, `wcs_origin_mode`, `wcs_origin_boxPoint`, `wcs_orientation_axisX/Y`, `wcs_orientation_flipY`. Two write idioms (both work):
  - **Mode/enum**: `param.expression = "'axesXY'"` (note double-quoted -- inner single quotes are part of the Fusion expression). Or `param.value.value = 'axesXY'` (docs call this "typically better").
  - **Entity binding**: `param.value.value = [entity]` (a *list*, even for a single axis). Used for `wcs_orientation_axisX/Y` and `wcs_origin_point`.
- **Empty Setups are legal**: zero operations is fine, persists in browser.

## What's PARTIAL / risky

- **Body removal inside an MM**: in principle `mm.occurrence.component.bRepBodies` exposes the bodies and `BRepBody.deleteMe()` should work, but no Autodesk sample does this. **Treat as unverified — spike before architecting around it.** Fallback: build the trimmed geometry in a Design component first, then create the MM from that already-trimmed component (no MM-internal mutation needed).
- **Transforms inside an MM**: two paths
  - cheap: `mm.occurrence.transform2 = matrix` (whole-MM move)
  - inside: `MoveFeatures.createInput(...)` on `mm.occurrence.component.features.moveFeatures`. Forum reports `MoveFeature` failing when called from non-root component — must call on the *owning* component's `moveFeatures`.
- **Stock mode**: The typed enum is the verified-clean path. `setup.stockMode = adsk.cam.SetupStockModes.RelativeBoxStock` (or `FixedBoxStock` / `FromSolidStock` / `FromPreviousSetup`) sidesteps the whole enum-string resolution problem. The Autodesk `CreateSetupsFromHoleRecognition` sample uses both idioms but the typed enum is what it uses for the *primary* setup. The `job_stockMode` parameter-dictionary path is empirically fragile -- `'relativebox'` is REJECTED at write time on current builds (live audit shows current value `'fixedbox'` after the param accepts no relativebox candidate). `'previoussetup'` / `'fixedbox'` / `'fromsolid'` *do* work via the param dict (verified). Order of preference: typed enum first, param dict only as fallback. Companion params for fixed-size dims still go through the dict: `job_stockSolids`, `job_stockOffsetMode`, `job_stockFixedX/Y/Z`. Set on the **live `setup.parameters` after `cam.setups.add()`**.

## Architecture implications

1. **Don't trust MM-internal mutation**. Plan A: build per-MM trimmed Design components first, then `manufacturingModels.add(...)` from each. Plan B (only if spike confirms it works): create one MM, mutate bodies inside.
2. **All CAM parameter strings introspected at runtime**, not hardcoded. See `cam_engine/parameter_introspect.py`.
3. **Operation type defaults to milling** (`OperationTypes.MillingOperation`) — Ultimate Bee is a router, no turning/additive needed.
4. **All entry points null-check `cam`** — the document might not have a CAM product loaded, or we might be in the wrong workspace.

## Sources

- [Additive MJF Manufacturing Sample](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/AdditiveMJFManufacturingSample_Sample.htm)
- [Manufacturing Workflow Sample](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/ManufacturingWorkflowAPISample_Sample.htm)
- [Setups.createInput](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/Setups_createInput.htm)
- [Set Vise Origin As Setup WCS Origin](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/SetViseOriginAsSetupWCSOrigin_Sample.htm)
- [Create Setups From Hole Recognition](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/CreateSetupsFromHoleRecognition_Sample.htm)
- [Forum: WCS via API](https://forums.autodesk.com/t5/fusion-api-and-scripts/is-it-possible-to-specify-cam-setup-wcs-work-coordinate-system/td-p/12207234)
- [Forum: CAM stock setup failed](https://forums.autodesk.com/t5/fusion-api-and-scripts/fusion-cam-api-failed-to-set-up-stock-body/td-p/12105555)
- [Forum: Edit manufacturing model](https://forums.autodesk.com/t5/fusion-manufacture/edit-manufacturing-model/td-p/10041423)
- [Forum: MoveFeature out of rootComponent](https://forums.autodesk.com/t5/fusion-api-and-scripts/movefeature-does-not-work-when-i-am-out-of-the-rootcomponent/td-p/11767841)
