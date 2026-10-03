# H23 item 58 (fusion360-quirks confirmation, Fred's own rule: confirm on varied cases before
# recording a finding): does a timeline operation's own per-call cost (a .reorder() call,
# matching items 51/55's own real-T7-payload measurement of ~0.85-0.90s each) actually SCALE with
# the document's own history size, or was that one data point (empty doc vs ~21-item real doc)
# a coincidence? Builds a growing timeline of INDEPENDENT construction planes (each a single
# timeline entry with no cross-feature dependency -- a sketch+extrude PAIR was tried first and
# rejected: reordering just the extrude half left it before its own sketch, so canReorder refused
# the very next move; a construction POINT was tried second and rejected too: `setByPoint` with a
# raw Point3D threw "Environment is not supported" live -- construction planes via `setByOffset`
# have no such chain and worked) in a fresh scratch doc, and at
# several checkpoints times ONE full-span .reorder() call (move the newest plane to just after
# the first, then back to the end) -- isolates the cost from any real geometry complexity
# (lattice/stamp/frame), so a trend across checkpoints is attributable to document HISTORY SIZE
# alone, not to what the features actually are.
#
# Run inside Fusion via fusion_execute:
#   CHECKPOINTS = [2, 10, 20, 30, 40]   # timeline item counts to measure at
#   OUT = r'<repo>/bspline-frame-builder/scratch/item58_timeline_cost_scaling.json'
#   exec(open(r'<repo>/tools/repro/fusion_t11/item58_timeline_cost_scaling_probe.py').read())
import sys, os, time, json, types, traceback
import adsk.core, adsk.fusion

HOLD = sys.modules.get('__item58_tcs')
if HOLD is None:
    HOLD = types.ModuleType('__item58_tcs'); HOLD.docs = {}; sys.modules['__item58_tcs'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item58tcs_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)

out = {'checkpoints': []}
try:
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_item58tcs_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item58-tcs')
    HOLD.docs['doc'] = doc
    root = des.rootComponent
    tl = des.timeline

    def add_construction_plane(n):
        planes_in = root.constructionPlanes.createInput()
        planes_in.setByOffset(root.xYConstructionPlane, adsk.core.ValueInput.createByReal(float(n)))
        pl = root.constructionPlanes.add(planes_in)
        pl.name = f"pl_{n}"
        return pl

    sizes = CHECKPOINTS if 'CHECKPOINTS' in dir() else [2, 10, 20, 30]
    n = 0
    for target in sizes:
        while tl.count < target:
            n += 1
            add_construction_plane(n)
        # ONE forward move per checkpoint only -- move the NEWEST item from the end to just after
        # the very first item (a full-span reorder). No "move it back" round trip: that was tried
        # and refused live at checkpoint 10 (InternalValidationError: featureAtIndex) for reasons
        # not fully understood -- not needed anyway, since each checkpoint only needs to measure
        # ONE full-span reorder's own cost at that doc size, regardless of interior order after.
        count_before = tl.count
        last_item = tl.item(tl.count - 1)
        can_front = last_item.canReorder(1)
        if can_front:
            t0 = time.time()
            last_item.reorder(1)  # to just after the very first item -- index 0 itself was refused live
            to_front_s = round(time.time() - t0, 4)
        else:
            to_front_s = None
        out['checkpoints'].append({
            'timeline_count': count_before,
            'reorder_seconds': to_front_s,
            'reorder_ok': can_front,
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
