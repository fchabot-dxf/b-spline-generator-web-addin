# H23 item 40 (item 38's own owed all-template sweep): for every template's DEFAULT at 7x9, built
# bar bodies must equal the template's own DECLARED bar count. Templates 6/7/9/11 declare explicit
# FRAME_BARS names; the rest (1-5, 8, 10, 12, 13) use the generic per-miter bar convention with no
# name list at all -- MEASURED (frame-defs.json): every template where a name list IS declared has
# len(FRAME_BARS) == len(regions.miters) exactly, so len(regions.miters) is the one declared source
# that generalizes to every template, named or not -- not a re-derived/hand-counted number.
#
# Run inside Fusion via fusion_execute:
#   REPO = r'<checkout>'; OUT = r'<results.json>'
#   CASES = [('template_1', [...declared bar names or None], 5), ...]  # (id, declared_names_or_None, n_miters)
#   exec(open(r'<repo>\tools\repro\fusion_t11\item40_all_template_sweep.py').read())
import sys, os, json, types, traceback, re
import adsk.core, adsk.fusion

FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
BSG_DIR = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen")
PAYLOAD_DIR = os.path.join(REPO, "bspline-frame-builder", "scratch", "item40_all_template_payloads")
REPRO_DIR = os.path.join(REPO, "tools", "repro")
if REPRO_DIR not in sys.path:
    sys.path.insert(0, REPRO_DIR)
import timeline_health as th

HOLD = sys.modules.get('__item40_allsw')
if HOLD is None:
    HOLD = types.ModuleType('__item40_allsw'); HOLD.docs = {}; sys.modules['__item40_allsw'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item40allsw_fp') if _des else None
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


_SUFFIX_RE = re.compile(r'\s*\(\d+\)$')


def bars_report(des, declared_names, n_expected):
    root = des.rootComponent
    bars = [b for occ in root.allOccurrences for b in occ.bRepBodies if b.name.startswith('frame_')]
    vols = {b.name: round(b.volume, 4) for b in bars}
    base_names = [_SUFFIX_RE.sub('', n) for n in vols]
    dup_bodies = [n for n in vols if _SUFFIX_RE.search(n)]
    tbm = adsk.fusion.TemporaryBRepManager.get()
    overlaps = {}
    for i in range(len(bars)):
        for j in range(i + 1, len(bars)):
            a = tbm.copy(bars[i]); c = tbm.copy(bars[j])
            try:
                tbm.booleanOperation(a, c, adsk.fusion.BooleanTypes.IntersectionBooleanType)
                v = round(a.volume, 4)
            except Exception:
                v = 0.0
            if v > 0.01:
                overlaps['%s&%s' % (bars[i].name, bars[j].name)] = v
    tl_ok = th.is_timeline_healthy(des.timeline)
    slivers = [n for n, v in vols.items() if v < 0.5]
    missing_names = sorted(set(declared_names) - set(base_names)) if declared_names else []
    extra_names = sorted(set(base_names) - set(declared_names)) if declared_names else []
    return {'count': len(bars), 'expected_count': n_expected, 'vols': vols, 'overlaps': overlaps,
            'timeline_healthy': tl_ok, 'slivers_under_0.5cm3': slivers, 'dup_named_bodies': dup_bodies,
            'missing_declared_names': missing_names, 'extra_names': extra_names}


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
    """H23 item 46 (2): item 45's own T10 finding generalized into a standing live guard for every
    template -- what the BUILT Shape Outline actually has at a seedMap-covered line/arc's own :S/:E
    must match what the payload's own seedGeometry (the app's own preview) said it would be, within
    tol_in inches. 'pin'/'radius' seedMap kinds aren't curve endpoints and are out of this check's
    scope. Returns a list of mismatch strings (empty = clean)."""
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
            # addByTwoPoints preserves argument order (measured) -- a direct, ordered check.
            ok = _close(want_s, got_s) and _close(want_e, got_e)
        else:
            # addByThreePoints does NOT: MEASURED live, Fusion tags startSketchPoint/endSketchPoint
            # by the arc's own geometric direction, not by argument order -- :S can legitimately end
            # up physically AT the sent end point and vice versa. Compare the endpoint PAIR as a set,
            # not an ordered pair, so this check verifies the built SHAPE, not an internal tag name.
            ok = (_close(want_s, got_s) and _close(want_e, got_e)) or \
                 (_close(want_s, got_e) and _close(want_e, got_s))
        if not ok:
            mismatches.append(
                f'{sid} preview=({tuple(round(v, 4) for v in want_s)},{tuple(round(v, 4) for v in want_e)}) '
                f'build=({tuple(round(v, 4) for v in got_s)},{tuple(round(v, 4) for v in got_e)})')
    return mismatches


mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
try:
    for template_id, declared_names, n_miters in CASES:
        if template_id in results and 'CRASH' not in results[template_id]:
            continue
        try:
            for m in list(saved_mods):
                if m in sys.modules: del sys.modules[m]
            sys.path[:] = saved_path
            sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(FB)); sys.path.insert(0, BSG_DIR)

            payload = json.load(open(os.path.join(PAYLOAD_DIR, template_id + '_default_7x9.json'), encoding='utf-8'))
            W, H = payload['widthIn'], payload['heightIn']

            import importlib.util
            spec = importlib.util.spec_from_file_location("bsg_item40allsw_" + template_id, os.path.join(BSG_DIR, "b-spline-gen.py"))
            bsg = importlib.util.module_from_spec(spec)
            sys.modules["bsg_item40allsw_" + template_id] = bsg
            spec.loader.exec_module(bsg)
            from fb_engine import frame_engine as fe
            bsg.frame_engine = fe

            doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
            des = adsk.fusion.Design.cast(app.activeProduct)
            des.userParameters.add('adv_item40allsw_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item40allsw-' + template_id)
            for name, val in (('widthIn', W), ('heightIn', H)):
                des.userParameters.add(name, adsk.core.ValueInput.createByString('%s in' % val), 'in', 'board size (item 40 sweep)')
            HOLD.docs[template_id] = doc

            make_synthetic_panel(des, W, H)

            # H23 item 44 (2): MITER MISS (fb_engine/miters.py) is the exact, silent symptom items
            # 38/43 each found live -- a declared corner relying on Fusion's native offset tagging
            # instead of an explicit ResolveInnerCorners/ResolveLineCircleCorner step. The pure
            # test (test_no_miter_miss_possible.py) already proves this can't happen for any of
            # the 13 templates as DECLARED; this is the matching LIVE confirmation -- count real
            # "MITER MISS" log lines this case's own build produces (must be 0).
            # NOTE: _handle_send_frame's own DebugLogger(...) truncates frame-builder-debug.log to
            # empty at construction (b-spline-gen.py's own "clean slate" -- confirmed in fb_logger.py)
            # EVERY call, not just on add-in start -- so the file after this one call already holds
            # ONLY this build's own lines; no before/after snapshot needed (an earlier draft of this
            # diff tried snapshotting line counts before the call, which would have silently SKIPPED
            # real new lines once the file had been truncated shorter than that snapshot).
            log_path = os.path.join(FB, 'frame-builder-debug.log')

            handler = bsg.PaletteHTMLEventHandler()
            handler._handle_send_frame(payload)

            with open(log_path, encoding='utf-8', errors='replace') as f:
                miter_miss_lines = [l.strip() for l in f if 'MITER MISS' in l]

            # H23 item 46 (2): does the BUILT Shape Outline actually match what this payload's own
            # seedGeometry (the app's own preview) promised? resolve_template is already on sys.path
            # from the fresh-checkout load above.
            from fb_engine.template_resolver import resolve_template as _resolve_tpl
            seed_map = _resolve_tpl(template_id)[0]['Frame'].get('seedMap', [])
            fc = [o for o in des.rootComponent.occurrences if o.component.name.startswith('Frame_')][0].component
            preview_build_mismatches = preview_vs_build_check(fc, seed_map, payload.get('seedGeometry') or {})

            r = bars_report(des, declared_names, n_miters)
            r['miter_miss_lines'] = miter_miss_lines
            r['preview_build_mismatches'] = preview_build_mismatches
            results[template_id] = r
            _write()

            HOLD.docs.pop(template_id).close(False)
        except Exception:
            results[template_id] = {'CRASH': traceback.format_exc()[-2000:]}
            _write()
            d = HOLD.docs.pop(template_id, None)
            if d: d.close(False)
finally:
    for m in mod_keys():
        if m in sys.modules: del sys.modules[m]
    sys.modules.update(saved_mods)
    sys.path[:] = saved_path
    _write()

done = [k for k, v in results.items() if 'CRASH' not in v]
crashed = [k for k, v in results.items() if 'CRASH' in v]
bad = [k for k in done if results[k]['count'] != results[k]['expected_count'] or results[k]['overlaps']
       or results[k]['slivers_under_0.5cm3'] or results[k]['dup_named_bodies']
       or results[k]['missing_declared_names'] or not results[k]['timeline_healthy']
       or results[k].get('miter_miss_lines') or results[k].get('preview_build_mismatches')]
print('done=%d crashed=%s bad=%s' % (len(done), crashed, bad))
