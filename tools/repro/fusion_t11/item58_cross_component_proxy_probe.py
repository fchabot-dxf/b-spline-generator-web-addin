# H23 item 58 (fusion360-quirks confirmation): seat B measured ONCE, live, on the inset-window
# bars (INSET-WINDOW-LIVE_CHECK.md Sec5) -- a cross-component extrude targeting a face on a
# SIBLING component's body fails late and obscurely (EXTRUDE_CREATION_FAIL_ERROR, invalid
# argument toEntityOne) when the face comes from `occurrence.component.bRepBodies` (the body's
# OWN/native definition context), and succeeds when it comes from `occurrence.bRepBodies` (the
# ROOT-CONTEXT PROXY). This project's own production code already gets it right in the ORIGINAL
# frame-bars path (b-spline-gen.py's own _find_bspline_core_body uses `child.bRepBodies`, docstring:
# "its occurrence's proxy") -- confirmed working across every live Send this whole session. This
# probe confirms the SAME mechanism independently, on DIFFERENT geometry (two plain sibling
# components, a box each, no inlay/frame/CAM machinery at all) so the claim doesn't rest only on
# the one window-bars case and the one (already-correct) frame-bars case.
#
# Run inside Fusion via fusion_execute:
#   OUT = r'<repo>/bspline-frame-builder/scratch/item58_cross_component_proxy.json'
#   exec(open(r'<repo>/tools/repro/fusion_t11/item58_cross_component_proxy_probe.py').read())
import sys, os, time, json, types, traceback
import adsk.core, adsk.fusion

HOLD = sys.modules.get('__item58_proxy')
if HOLD is None:
    HOLD = types.ModuleType('__item58_proxy'); HOLD.docs = {}; sys.modules['__item58_proxy'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item58proxy_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)

out = {}

def _make_box(comp, name, origin_x):
    sk = comp.sketches.add(comp.xYConstructionPlane)
    sk.name = f"{name}_sketch"
    lines = sk.sketchCurves.sketchLines
    lines.addTwoPointRectangle(
        adsk.core.Point3D.create(origin_x, 0, 0), adsk.core.Point3D.create(origin_x + 1, 1, 0))
    prof = sk.profiles.item(0)
    ext_in = comp.features.extrudeFeatures.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    ext_in.setDistanceExtent(False, adsk.core.ValueInput.createByReal(1.0))
    feat = comp.features.extrudeFeatures.add(ext_in)
    feat.bodies.item(0).name = name
    return feat

try:
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_item58proxy_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item58-proxy')
    HOLD.docs['doc'] = doc
    root = des.rootComponent

    # Two SIBLING components -- neither nested in the other, same as "B-Spline Set" / "Frame_1".
    occ_holder = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    occ_holder.component.name = "BodyHolder"
    _make_box(occ_holder.component, "holder_box", 0.0)

    mat = adsk.core.Matrix3D.create()
    mat.translation = adsk.core.Vector3D.create(5, 0, 0)
    occ_extruder = root.occurrences.addNewComponent(mat)
    occ_extruder.component.name = "Extruder"
    extruder_sketch = occ_extruder.component.sketches.add(occ_extruder.component.xYConstructionPlane)
    extruder_sketch.name = "extruder_profile"
    lines = extruder_sketch.sketchCurves.sketchLines
    lines.addTwoPointRectangle(adsk.core.Point3D.create(-5, 0, 0), adsk.core.Point3D.create(-4, 1, 0))
    extruder_prof = extruder_sketch.profiles.item(0)

    # Pick the holder box's own TOP face (the one at z=1) as the extrude target -- same role as
    # the real frame's own "extrude to the panel's underside face" pattern.
    def _top_face(body):
        # the TRUE top cap is FLAT in Z (min==max, a horizontal plane) at the GREATEST such Z --
        # a side wall also reaches the same max Z at its own top edge but isn't flat, so a plain
        # "largest maxPoint.z" comparison picks a side face instead (confirmed live: this exact
        # bug produced "extrusion profile falls outside the boundary" on the first attempt).
        best = None
        for f in body.faces:
            bb = f.boundingBox
            if abs(bb.maxPoint.z - bb.minPoint.z) > 1e-9:
                continue  # not flat in Z -- a side wall, not a cap
            if best is None or bb.maxPoint.z > best.boundingBox.maxPoint.z:
                best = f
        return best

    # ---- ATTEMPT 1: the NATIVE reference (occurrence.component.bRepBodies) ----
    native_body = occ_holder.component.bRepBodies.item(0)
    native_face = _top_face(native_body)
    native_result = {}
    try:
        ext_in = occ_extruder.component.features.extrudeFeatures.createInput(
            extruder_prof, adsk.fusion.FeatureOperations.JoinFeatureOperation)
        ext_in.setOneSideExtent(
            adsk.fusion.ToEntityExtentDefinition.create(native_face, False), adsk.fusion.ExtentDirections.PositiveExtentDirection)
        occ_extruder.component.features.extrudeFeatures.add(ext_in)
        native_result['ok'] = True
    except Exception as e:
        native_result['ok'] = False
        native_result['error'] = str(e)
    out['native_reference_attempt'] = native_result

    # ---- ATTEMPT 2: the ROOT-CONTEXT PROXY (occurrence.bRepBodies) ----
    proxy_body = occ_holder.bRepBodies.item(0)
    proxy_face = _top_face(proxy_body)
    proxy_result = {}
    try:
        ext_in2 = occ_extruder.component.features.extrudeFeatures.createInput(
            extruder_prof, adsk.fusion.FeatureOperations.JoinFeatureOperation)
        ext_in2.setOneSideExtent(
            adsk.fusion.ToEntityExtentDefinition.create(proxy_face, False), adsk.fusion.ExtentDirections.PositiveExtentDirection)
        occ_extruder.component.features.extrudeFeatures.add(ext_in2)
        proxy_result['ok'] = True
    except Exception as e:
        proxy_result['ok'] = False
        proxy_result['error'] = str(e)
    out['proxy_reference_attempt'] = proxy_result

except Exception:
    out['CRASH'] = traceback.format_exc()[-2000:]
finally:
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
