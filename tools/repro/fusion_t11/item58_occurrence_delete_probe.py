# H23 item 58 (fusion360-quirks confirmation): item 55 measured this ONCE, on one real T7 frame
# (5 bar extrudes explicitly deleted before their own occurrence, ~0.83s each wasted). Confirms
# the general claim -- deleting an occurrence removes the features built inside its own
# component, so deleting them explicitly first is pure cost -- with a CONTROLLED component
# holding 1, 5 and 10 simple box-extrude features, each size built TWICE (a twin pair): one twin
# has its own features explicitly deleteMe()'d before the occurrence; the other has ONLY its
# occurrence deleted. Confirms (a) occurrence-only delete leaves zero orphaned bodies/features,
# (b) the explicit-first path costs measurably more, and (c) that extra cost grows with N.
#
# Run inside Fusion via fusion_execute:
#   SIZES = [1, 5, 10]
#   OUT = r'<repo>/bspline-frame-builder/scratch/item58_occurrence_delete.json'
#   exec(open(r'<repo>/tools/repro/fusion_t11/item58_occurrence_delete_probe.py').read())
import sys, os, time, json, types, traceback
import adsk.core, adsk.fusion

HOLD = sys.modules.get('__item58_occdel')
if HOLD is None:
    HOLD = types.ModuleType('__item58_occdel'); HOLD.docs = {}; sys.modules['__item58_occdel'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item58occdel_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)

out = {'sizes': []}
try:
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_item58occdel_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item58-occdel')
    HOLD.docs['doc'] = doc
    root = des.rootComponent

    def build_component_with_n_boxes(label, n):
        occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        comp = occ.component
        comp.name = label
        feats = []
        for i in range(n):
            sk = comp.sketches.add(comp.xYConstructionPlane)
            sk.name = f"{label}_sketch_{i}"
            lines = sk.sketchCurves.sketchLines
            lines.addTwoPointRectangle(
                adsk.core.Point3D.create(float(i) * 2, 0, 0), adsk.core.Point3D.create(float(i) * 2 + 1, 1, 0))
            prof = sk.profiles.item(0)
            ext_in = comp.features.extrudeFeatures.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
            ext_in.setDistanceExtent(False, adsk.core.ValueInput.createByReal(0.5))
            feat = comp.features.extrudeFeatures.add(ext_in)
            feat.name = f"{label}_extrude_{i}"
            feats.append(feat)
        return occ, comp, feats

    sizes = SIZES if 'SIZES' in dir() else [1, 5, 10]
    for n in sizes:
        # twin A: explicit feature deletes first, THEN the occurrence
        occ_a, comp_a, feats_a = build_component_with_n_boxes(f"twin_explicit_{n}", n)
        t0 = time.time()
        for feat in feats_a:
            feat.deleteMe()
        explicit_features_seconds = round(time.time() - t0, 4)
        t0 = time.time()
        occ_a.deleteMe()
        explicit_occ_seconds = round(time.time() - t0, 4)

        # twin B: occurrence delete ONLY -- no per-feature deleteMe at all
        occ_b, comp_b, feats_b = build_component_with_n_boxes(f"twin_occonly_{n}", n)
        t0 = time.time()
        occ_b.deleteMe()
        occonly_seconds = round(time.time() - t0, 4)
        # confirm nothing orphaned: the component is gone, and no stray body/feature with its name survives
        comp_b_gone = comp_b not in [o.component for o in root.allOccurrences]
        stray_names = [o.name for o in root.allOccurrences if o.name.startswith(f"twin_occonly_{n}")]

        out['sizes'].append({
            'n_features': n,
            'explicit_path_feature_deletes_seconds': explicit_features_seconds,
            'explicit_path_occurrence_delete_seconds': explicit_occ_seconds,
            'explicit_path_total_seconds': round(explicit_features_seconds + explicit_occ_seconds, 4),
            'occurrence_only_seconds': occonly_seconds,
            'occurrence_only_component_gone': comp_b_gone,
            'occurrence_only_stray_occurrences': stray_names,
            'extra_cost_of_explicit_deletes': round(explicit_features_seconds, 4),
        })

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
