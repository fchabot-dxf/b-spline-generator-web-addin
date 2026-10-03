# H23 item 58 (fusion360-quirks confirmation): seat B measured ONCE, live -- cam_coordinator.run()
# leaves the CAM product active, so app.activeProduct (and therefore Design.cast(app.active
# Product)) stops returning the Design until the FusionSolidEnvironment workspace is reactivated
# (INSET-WINDOW-LIVE_CHECK.md Sec5). Confirms the SAME underlying mechanism independently, via a
# DIFFERENT trigger (directly activating the CAM workspace through the UI API) instead of running
# the full cam_coordinator machinery -- a cheaper, more general reproduction of the same "a
# workspace switch changes app.activeProduct until you switch back" behavior, not tied to this
# project's own CAM code at all.
#
# Run inside Fusion via fusion_execute:
#   OUT = r'<repo>/bspline-frame-builder/scratch/item58_workspace_activeproduct.json'
#   exec(open(r'<repo>/tools/repro/fusion_t11/item58_workspace_activeproduct_probe.py').read())
import sys, json, os, types, traceback
import adsk.core, adsk.fusion

# Own scratch doc ONLY -- switching the active workspace is a GLOBAL, visible UI action (it
# changes the current tab for whichever document is focused). Doing this on whatever document
# happened to be active already would visibly disrupt Fred's own session if he's looking at
# Fusion; app.documents.add() below makes the NEW scratch doc the active/focused one first, so
# the workspace switch applies to that doc's own tab, not any of Fred's real open documents.
HOLD = sys.modules.get('__item58_ws')
if HOLD is None:
    HOLD = types.ModuleType('__item58_ws'); HOLD.docs = {}; sys.modules['__item58_ws'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item58ws_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)

out = {}
try:
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_item58ws_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item58-ws')
    HOLD.docs['doc'] = doc

    ui = app.userInterface
    design_ws_id = 'FusionSolidEnvironment'
    cam_ws_id = 'CAMEnvironment'

    before = app.activeProduct
    out['before_is_design'] = adsk.fusion.Design.cast(before) is not None
    out['before_product_type'] = type(before).__name__ if before else None

    cam_ws = ui.workspaces.itemById(cam_ws_id)
    out['cam_workspace_found'] = cam_ws is not None
    if cam_ws is not None:
        cam_ws.activate()
        mid = app.activeProduct
        out['after_cam_activate_is_design'] = adsk.fusion.Design.cast(mid) is not None
        out['after_cam_activate_product_type'] = type(mid).__name__ if mid else None

        design_ws = ui.workspaces.itemById(design_ws_id)
        out['design_workspace_found'] = design_ws is not None
        if design_ws is not None:
            design_ws.activate()
            after = app.activeProduct
            out['after_reactivate_is_design'] = adsk.fusion.Design.cast(after) is not None
            out['after_reactivate_product_type'] = type(after).__name__ if after else None

except Exception:
    out['CRASH'] = traceback.format_exc()[-2000:]
finally:
    # restore to Design before closing, same courtesy as never leaving Fred's own UI mid-switch
    try:
        ui = app.userInterface
        ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if ws:
            ws.activate()
    except Exception:
        pass
    _d = HOLD.docs.pop('doc', None)
    if _d:
        try: _d.close(False)
        except Exception: pass

OUT_PATH = OUT if 'OUT' in dir() else None
if OUT_PATH:
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=2, default=str)

print(json.dumps(out, indent=2, default=str))
