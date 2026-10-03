# H23 item 60 (C): LIVE Fusion check -- do the ALREADY-SHIPPED taper templates (T12, T13) build
# the WRONG (untapered) shape at their own declared taperAngle range ends, the same way T10 does?
# Generic across templates: reads tpl.seedMap dynamically (not hardcoded to T10's own piece names).
#
# Run inside Fusion via fusion_execute:
#   REPO = r'<checkout>'; PAYLOAD_DIR = r'<repo>/bspline-frame-builder/scratch/item60_payloads'
#   OUT = r'<repo>/bspline-frame-builder/scratch/item60_shipped_taper_sweep_results.json'
#   exec(open(r'<repo>\tools\repro\fusion_t11\item60_shipped_taper_sweep.py').read())
import sys, os, json, types, traceback
import adsk.core, adsk.fusion

FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
BSG_DIR = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen")

HOLD = sys.modules.get('__item60_shipsw')
if HOLD is None:
    HOLD = types.ModuleType('__item60_shipsw'); HOLD.docs = {}; sys.modules['__item60_shipsw'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item60shipsw_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)

results = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}


def _write():
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, default=str)


def make_synthetic_panel(des, width_in, height_in):
    root = des.rootComponent
    occ1 = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    occ1.component.name = 'B-Spline Set'
    occ2 = occ1.component.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    occ2.component.name = 'Clean'
    comp = occ2.component
    sk = comp.sketches.add(comp.xYConstructionPlane)
    w_cm, h_cm = width_in * 2.54, height_in * 2.54
    sk.sketchCurves.sketchLines.addTwoPointRectangle(
        adsk.core.Point3D.create(-w_cm / 2, -h_cm / 2, 0), adsk.core.Point3D.create(w_cm / 2, h_cm / 2, 0))
    prof = sk.profiles.item(0)
    ext = comp.features.extrudeFeatures
    extInput = ext.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    extInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(-1.5))
    extInput.participantBodies = []
    feat = ext.add(extInput)
    feat.bodies.item(0).name = 'panel'


def _id_of(entity):
    try:
        attr = entity.attributes.itemByName('FrameBuilder', 'ID')
        if attr:
            return attr.value
    except Exception:
        pass
    return getattr(entity, 'name', None)


CM = 2.54


def preview_vs_build_check(fc, seed_map, seed_geometry, tol_in=0.01):
    sk2 = next((s for s in fc.sketches if '2_shape_outline' in s.name), None)
    if sk2 is None:
        return ['no 2_shape_outline sketch found']
    by_id = {}
    for ln in sk2.sketchCurves.sketchLines:
        by_id[_id_of(ln)] = ln
    for ar in sk2.sketchCurves.sketchArcs:
        by_id[_id_of(ar)] = ar

    def _close(a, b):
        return abs(a[0] - b[0]) <= tol_in and abs(a[1] - b[1]) <= tol_in

    mismatches = []
    for e in seed_map:
        kind, sid = e.get('kind'), e.get('id')
        if kind not in ('line', 'arc') or sid not in seed_geometry:
            continue
        pts = seed_geometry[sid].get('points')
        if not pts:
            continue
        entity = by_id.get(sid)
        if entity is None:
            mismatches.append(f'{sid}: no built {kind} entity with this ID')
            continue
        want_s, want_e = pts[0], pts[-1]
        got_s = (entity.startSketchPoint.geometry.x / CM, entity.startSketchPoint.geometry.y / CM)
        got_e = (entity.endSketchPoint.geometry.x / CM, entity.endSketchPoint.geometry.y / CM)
        if kind == 'line':
            ok = _close(want_s, got_s) and _close(want_e, got_e)
        else:
            ok = (_close(want_s, got_s) and _close(want_e, got_e)) or \
                 (_close(want_s, got_e) and _close(want_e, got_s))
        if not ok:
            mismatches.append(
                f'{sid} preview=({tuple(round(v, 4) for v in want_s)},{tuple(round(v, 4) for v in want_e)}) '
                f'build=({tuple(round(v, 4) for v in got_s)},{tuple(round(v, 4) for v in got_e)})')
    return mismatches


CASES = CASES if 'CASES' in dir() else [
    'template_12_tapermin_7x9', 'template_12_taperdefault_7x9', 'template_12_tapermax_7x9',
    'template_13_tapermin_7x9', 'template_13_taperdefault_7x9', 'template_13_tapermax_7x9']

mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
try:
    for case in CASES:
        if case in results and 'CRASH' not in results[case]:
            continue
        try:
            for m in list(saved_mods):
                if m in sys.modules: del sys.modules[m]
            sys.path[:] = saved_path
            sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(FB)); sys.path.insert(0, BSG_DIR)

            payload = json.load(open(os.path.join(PAYLOAD_DIR, case + '.json'), encoding='utf-8'))
            W, H = payload['widthIn'], payload['heightIn']
            template_id = payload['templateId']

            import importlib.util
            spec = importlib.util.spec_from_file_location("bsg_item60_" + case, os.path.join(BSG_DIR, "b-spline-gen.py"))
            bsg = importlib.util.module_from_spec(spec)
            sys.modules["bsg_item60_" + case] = bsg
            spec.loader.exec_module(bsg)
            from fb_engine import frame_engine as fe
            bsg.frame_engine = fe

            doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
            des = adsk.fusion.Design.cast(app.activeProduct)
            des.userParameters.add('adv_item60shipsw_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item60-' + case)
            for name, val in (('widthIn', W), ('heightIn', H)):
                des.userParameters.add(name, adsk.core.ValueInput.createByString('%s in' % val), 'in', 'board size (item 60 shipped sweep)')
            HOLD.docs[case] = doc

            make_synthetic_panel(des, W, H)

            log_path = os.path.join(FB, 'frame-builder-debug.log')
            handler = bsg.PaletteHTMLEventHandler()
            handler._handle_send_frame(payload)

            with open(log_path, encoding='utf-8', errors='replace') as f:
                log_text = f.read()
            error_lines = [l.strip() for l in log_text.splitlines() if '[ERROR]' in l]

            from fb_engine.template_resolver import resolve_template as _resolve_tpl
            seed_map = _resolve_tpl(template_id)[0]['Frame'].get('seedMap', [])
            fc_candidates = [o for o in des.rootComponent.occurrences if o.component.name.startswith('Frame_')]
            fc = fc_candidates[0].component if fc_candidates else None
            mismatches = preview_vs_build_check(fc, seed_map, payload.get('seedGeometry') or {}) if fc else ['no Frame_ occurrence found']

            results[case] = {'preview_build_mismatches': mismatches, 'error_lines': error_lines}
            _write()

            HOLD.docs.pop(case).close(False)
        except Exception:
            results[case] = {'CRASH': traceback.format_exc()[-2000:]}
            _write()
            d = HOLD.docs.pop(case, None)
            if d: d.close(False)
finally:
    for m in mod_keys():
        if m in sys.modules: del sys.modules[m]
    sys.modules.update(saved_mods)
    sys.path[:] = saved_path
    _write()

print(json.dumps({k: {'mismatch_count': len(v.get('preview_build_mismatches', [])), 'crash': 'CRASH' in v} for k, v in results.items()}, indent=2))
