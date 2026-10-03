# T84 item 10, part 2: INSET WINDOW live sweep. Same proven shape as item61_full_matrix_sweep.py
# (same re-entry lock, same fingerprinted doc safety, same merge-on-write _write()), but the BUILT
# verdict also requires exactly 4 frame_window_* bodies (T82 item 6's own established acceptance:
# "exactly 4 frame_window_* bodies + the main bars, built bars == declared, no '(1)' bodies,
# nothing < 0.5 cm3, 0 overlap, timeline healthy") alongside the main bars' own TEMPLATE_META count.
#
# Run inside Fusion via fusion_execute:
#   REPO = r'<checkout>'; PAYLOAD_DIR = r'<repo>/bspline-frame-builder/scratch/item10_part2_payloads'
#   OUT = r'<repo>/bspline-frame-builder/scratch/item10_part2_results.json'
#   CASES = [...case names, no .json...]  # a small slice, <=3 per call
#   exec(open(r'<repo>\tools\repro\fusion_t11\item10_part2_window_sweep.py').read())
import sys, os, json, types, traceback, re
import adsk.core, adsk.fusion

TEMPLATE_META = {
    'template_1': (None, 4), 'template_2': (None, 4), 'template_3': (None, 4),
    'template_4': (None, 4), 'template_5': (None, 4),
    'template_6': (['frame_tab_top', 'frame_tab_right', 'frame_shoulder_right', 'frame_side_right',
                     'frame_base', 'frame_side_left', 'frame_shoulder_left', 'frame_tab_left'], 8),
    'template_7': (['frame_roof_right', 'frame_side_right', 'frame_base', 'frame_side_left', 'frame_roof_left'], 5),
    'template_8': (None, 4),
    'template_9': (['frame_top', 'frame_flange_TR', 'frame_shoulder_TR', 'frame_stem_right', 'frame_shoulder_BR',
                     'frame_flange_BR', 'frame_bottom', 'frame_flange_BL', 'frame_shoulder_BL', 'frame_stem_left',
                     'frame_shoulder_TL', 'frame_flange_TL'], 12),
    'template_10': (None, 4),
    'template_11': (['frame_roof_right', 'frame_side_right', 'frame_base', 'frame_side_left', 'frame_roof_left'], 5),
    'template_12': (None, 4), 'template_13': (None, 4),
    'template_16': (['frame_upper_right', 'frame_lower_right', 'frame_base', 'frame_lower_left',
                      'frame_upper_left', 'frame_arch'], 6),
    'template_17': (['frame_upper_right', 'frame_lower_right', 'frame_base', 'frame_lower_left',
                      'frame_upper_left', 'frame_arch'], 6),
    'template_14': (['frame_upper_right', 'frame_lower_right', 'frame_base', 'frame_lower_left',
                      'frame_upper_left', 'frame_top'], 6),
    'template_15': (['frame_neck_right', 'frame_dome_right', 'frame_base', 'frame_dome_left',
                      'frame_neck_left', 'frame_top'], 6),
}
WINDOW_BAR_COUNT = 4

HOLD = sys.modules.get('__item10p2sw')
if HOLD is None:
    HOLD = types.ModuleType('__item10p2sw'); HOLD.docs = {}; HOLD.busy = False
    sys.modules['__item10p2sw'] = HOLD

if getattr(HOLD, 'busy', False):
    print('busy')
else:
    HOLD.busy = True
    try:
        FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
        BSG_DIR = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen")
        REPRO_DIR = os.path.join(REPO, "tools", "repro")
        if REPRO_DIR not in sys.path:
            sys.path.insert(0, REPRO_DIR)
        import timeline_health as th

        for _i in range(app.documents.count - 1, -1, -1):
            _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
            _p = _des.userParameters.itemByName('adv_item10p2sw_fp') if _des else None
            if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
                _d.close(False)

        results = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}

        def _write():
            global results
            try:
                disk = json.load(open(OUT, encoding='utf-8'))
            except Exception:
                disk = {}
            disk.update(results)
            results = disk
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

        def bars_report(des, declared_names, n_expected, window_expected):
            root = des.rootComponent
            all_bars = [b for occ in root.allOccurrences for b in occ.bRepBodies if b.name.startswith('frame_')]
            main_bars = [b for b in all_bars if not b.name.startswith('frame_window_')]
            win_bars = [b for b in all_bars if b.name.startswith('frame_window_')]
            vols = {b.name: round(b.volume, 4) for b in all_bars}
            base_names = [_SUFFIX_RE.sub('', n) for n in vols]
            dup_bodies = [n for n in vols if _SUFFIX_RE.search(n)]
            tbm = adsk.fusion.TemporaryBRepManager.get()
            overlaps = {}
            for i in range(len(all_bars)):
                for j in range(i + 1, len(all_bars)):
                    a = tbm.copy(all_bars[i]); c = tbm.copy(all_bars[j])
                    try:
                        tbm.booleanOperation(a, c, adsk.fusion.BooleanTypes.IntersectionBooleanType)
                        v = round(a.volume, 4)
                    except Exception:
                        v = 0.0
                    if v > 0.01:
                        overlaps['%s&%s' % (all_bars[i].name, all_bars[j].name)] = v
            tl_ok = th.is_timeline_healthy(des.timeline)
            slivers = [n for n, v in vols.items() if v < 0.5]
            missing_names = sorted(set(declared_names) - set(base_names)) if declared_names else []
            return {'main_count': len(main_bars), 'expected_main': n_expected,
                    'window_count': len(win_bars), 'expected_window': window_expected,
                    'vols': vols, 'overlaps': overlaps, 'timeline_healthy': tl_ok,
                    'slivers_under_0.5cm3': slivers, 'dup_named_bodies': dup_bodies,
                    'missing_declared_names': missing_names}

        mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
        saved_mods = {m: sys.modules[m] for m in mod_keys()}
        saved_path = list(sys.path)
        try:
            for case in CASES:
                if case in results and 'CRASH' not in results[case]:
                    continue
                templateId = re.match(r'(template_\d+)_', case).group(1)
                declared_names, n_expected = TEMPLATE_META[templateId]
                try:
                    for m in list(saved_mods):
                        if m in sys.modules: del sys.modules[m]
                    sys.path[:] = saved_path
                    sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(FB)); sys.path.insert(0, BSG_DIR)

                    payload = json.load(open(os.path.join(PAYLOAD_DIR, case + '.json'), encoding='utf-8'))
                    W, H = payload['widthIn'], payload['heightIn']
                    window_expected = WINDOW_BAR_COUNT if (payload.get('insetWindow') or {}).get('enabled') else 0

                    import importlib.util
                    spec = importlib.util.spec_from_file_location("bsg_item10p2_" + case, os.path.join(BSG_DIR, "b-spline-gen.py"))
                    bsg = importlib.util.module_from_spec(spec)
                    sys.modules["bsg_item10p2_" + case] = bsg
                    spec.loader.exec_module(bsg)
                    from fb_engine import frame_engine as fe
                    bsg.frame_engine = fe

                    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
                    des = adsk.fusion.Design.cast(app.activeProduct)
                    des.userParameters.add('adv_item10p2sw_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item10p2-' + case)
                    for name, val in (('widthIn', W), ('heightIn', H)):
                        des.userParameters.add(name, adsk.core.ValueInput.createByString('%s in' % val), 'in', 'board size (item 10 part 2 window sweep)')
                    HOLD.docs[case] = doc

                    make_synthetic_panel(des, W, H)

                    log_path = os.path.join(FB, 'frame-builder-debug.log')
                    handler = bsg.PaletteHTMLEventHandler()
                    handler._handle_send_frame(payload)

                    with open(log_path, encoding='utf-8', errors='replace') as f:
                        log_lines = [l.strip() for l in f]
                    not_built_lines = [l for l in log_lines if 'NOT BUILT' in l]
                    miter_miss_lines = [l for l in log_lines if 'MITER MISS' in l]
                    reflex_arc_lines = [l for l in log_lines if 'REFLEX ARC' in l]

                    r = bars_report(des, declared_names, n_expected, window_expected)
                    r['not_built_lines'] = not_built_lines
                    r['miter_miss_lines'] = miter_miss_lines
                    r['reflex_arc_lines'] = reflex_arc_lines
                    r['built'] = (r['main_count'] == r['expected_main'] and r['window_count'] == r['expected_window']
                                  and not r['overlaps'] and not r['slivers_under_0.5cm3']
                                  and not r['dup_named_bodies'] and not r['missing_declared_names'] and r['timeline_healthy']
                                  and not not_built_lines and not miter_miss_lines and not reflex_arc_lines)
                    results[case] = r
                    _write()

                    HOLD.docs.pop(case).close(False)
                except Exception:
                    results[case] = {'CRASH': traceback.format_exc()[-2000:], 'built': False}
                    _write()
                    d = HOLD.docs.pop(case, None)
                    if d: d.close(False)
        finally:
            for m in mod_keys():
                if m in sys.modules: del sys.modules[m]
            sys.modules.update(saved_mods)
            sys.path[:] = saved_path
            _write()

        print(json.dumps({k: v.get('built', False) for k, v in results.items()}))
        print('done=%d built=%d not_built=%d' % (
            len(results), sum(1 for v in results.values() if v.get('built')), sum(1 for v in results.values() if not v.get('built'))))
    finally:
        HOLD.busy = False
