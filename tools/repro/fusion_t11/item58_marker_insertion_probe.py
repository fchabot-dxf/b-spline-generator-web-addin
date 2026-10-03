# H23 item 58 (fusion360-quirks confirmation): does design.timeline.markerPosition really make a
# NEWLY-CREATED feature land AT that position (not just append at the end), for MORE than the one
# combination item 52 already tried live (a sketch+extrude inside addNewComponent)? Confirms on 2
# different feature TYPES (a bare sketch; an extrude feature, needing its own profile created
# elsewhere first) at 2 different INSERTION POINTS (early -- position 1; late -- near the current
# end) in the SAME small doc, then confirms timeline.moveToEnd() actually reaches the true end
# live (items 53-55 only ever exercised moveToEnd() indirectly through production code's own
# restore_marker_position -- this calls it directly, in isolation).
#
# Run inside Fusion via fusion_execute:
#   OUT = r'<repo>/bspline-frame-builder/scratch/item58_marker_insertion.json'
#   exec(open(r'<repo>/tools/repro/fusion_t11/item58_marker_insertion_probe.py').read())
import sys, os, time, json, types, traceback
import adsk.core, adsk.fusion

HOLD = sys.modules.get('__item58_mark')
if HOLD is None:
    HOLD = types.ModuleType('__item58_mark'); HOLD.docs = {}; sys.modules['__item58_mark'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item58mark_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)

out = {'cases': []}
try:
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_item58mark_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item58-mark')
    HOLD.docs['doc'] = doc
    root = des.rootComponent
    tl = des.timeline

    def add_filler_plane(n):
        planes_in = root.constructionPlanes.createInput()
        planes_in.setByOffset(root.xYConstructionPlane, adsk.core.ValueInput.createByReal(float(n)))
        pl = root.constructionPlanes.add(planes_in)
        pl.name = f"filler_{n}"
        return pl

    # 6 filler items -> plenty of room for an "early" (position 1) and a "late" (position 5)
    # insertion point, both strictly before the current end.
    for n in range(1, 7):
        add_filler_plane(n)
    names_before = [tl.item(i).name for i in range(tl.count)]

    # ---- CASE 1: a bare sketch, inserted EARLY (position 1) ----
    prior1 = tl.markerPosition
    tl.markerPosition = 1
    count_before_1 = tl.count
    sk = root.sketches.add(root.xYConstructionPlane)
    sk.name = "probe_sketch_early"
    names_after_1 = [tl.item(i).name for i in range(tl.count)]
    out['cases'].append({
        'case': 'sketch @ position 1',
        'landed_at_index': names_after_1.index('probe_sketch_early'),
        'expected_index': 1,
        'marker_before_create': 1,
        'marker_after_create': tl.markerPosition,
        'count_before': count_before_1,
        'count_after': tl.count,
    })

    # ---- CASE 2: an extrude, inserted LATE -- before some TRAILING items, after its OWN sketch ----
    # Case 1 left the marker mid-timeline (auto-advanced to 2) -- reset to the true end FIRST, so
    # this case's own setup lands normally, by append. The extrude's own profile sketch must come
    # BEFORE it in the replay log (Fusion's timeline is history, not a free-standing index) -- an
    # earlier version of this probe set the marker BEFORE the just-created profile sketch too,
    # which would have put the extrude before its own prerequisite; fixed by adding trailing
    # filler items for the extrude to insert before instead, mirroring the REAL production
    # pattern (the frame's own sketch+extrude landing before the inlay's own trailing items).
    tl.moveToEnd()
    prof_plane = root.xZConstructionPlane
    prof_sketch = root.sketches.add(prof_plane)
    prof_sketch.name = "probe_extrude_profile"
    lines = prof_sketch.sketchCurves.sketchLines
    lines.addTwoPointRectangle(adsk.core.Point3D.create(0, 0, 0), adsk.core.Point3D.create(1, 1, 0))
    prof = prof_sketch.profiles.item(0)
    trailing_index = tl.count  # the profile sketch's own index + 1 -- the extrude must land AFTER this
    add_filler_plane(101)
    add_filler_plane(102)

    tl.markerPosition = trailing_index
    count_before_2 = tl.count
    extrudes = root.features.extrudeFeatures
    ext_in = extrudes.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    ext_in.setDistanceExtent(False, adsk.core.ValueInput.createByReal(0.5))
    feat = extrudes.add(ext_in)
    feat.name = "probe_extrude_late"
    names_after_2 = [tl.item(i).name for i in range(tl.count)]
    out['cases'].append({
        'case': f'extrude @ position {trailing_index} (after its own sketch, before 2 trailing fillers)',
        'landed_at_index': names_after_2.index('probe_extrude_late'),
        'expected_index': trailing_index,
        'trailing_fillers_pushed_back': names_after_2.index('filler_101') > names_after_2.index('probe_extrude_late'),
        'marker_before_create': trailing_index,
        'marker_after_create': tl.markerPosition,
        'count_before': count_before_2,
        'count_after': tl.count,
    })

    # ---- moveToEnd(), called directly (not through production code) ----
    before_move = tl.markerPosition
    before_count = tl.count
    tl.moveToEnd()
    out['move_to_end'] = {
        'marker_before': before_move,
        'count_at_call_time': before_count,
        'marker_after': tl.markerPosition,
        'count_after': tl.count,
        'reached_true_end': tl.markerPosition == tl.count,
    }

    out['names_before_any_insert'] = names_before
    out['has_movetoend_attr'] = hasattr(tl, 'moveToEnd')

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
