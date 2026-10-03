# T84 item 10, part 4: END-TO-END. On each of T1/T15/T17: Send -> re-Send (SAME doc, no fresh
# document) -> CAM setups/layout (no toolpath generation). Confirms the re-Send replaces rather
# than duplicates (fb_engine.send_frame.delete_previous_frames, already fake-Fusion-tested in
# test_send_frame.py but never live), and that cam_engine.cam_coordinator.run(skip_templates=True,
# skip_machine=True) reaches 4 setups without ever calling toolpath generation (a genuinely
# separate step, confirmed by reading cam-builder.py directly -- only its own APPLY TOOLPATHS
# button calls _kick_off_toolpath_generation).
#
# "Ends cleanly, no leftovers" (the dispatch's own "marker at end") is NOT a literal marker --
# nothing in the build writes one. Checked instead, after the re-Send: exactly one find_frames()
# result, result['deleted'] == [the prior frame's own name], no '(' in any bar name (Fusion's own
# auto-suffix for an undeleted duplicate), markerPosition == timeline.count, healthy timeline.
#
# Run inside Fusion via fusion_execute:
#   REPO = r'<checkout>'; PAYLOAD_DIR = r'<repo>/bspline-frame-builder/scratch/item8_full_matrix_payloads'
#   OUT = r'<repo>/bspline-frame-builder/scratch/item10_part4_results.json'
#   CASES = ['template_1_default_7x9', 'template_15_default_7x9', 'template_17_default_7x9']
#   exec(open(r'<repo>\tools\repro\fusion_t11\item10_part4_end_to_end.py').read())
import sys, os, json, types, traceback, re
import adsk.core, adsk.fusion

HOLD = sys.modules.get('__item10p4e2e')
if HOLD is None:
    HOLD = types.ModuleType('__item10p4e2e'); HOLD.docs = {}; HOLD.busy = False
    sys.modules['__item10p4e2e'] = HOLD

if getattr(HOLD, 'busy', False):
    print('busy')
else:
    HOLD.busy = True
    try:
        FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
        BSG_DIR = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen")
        CAM_DIR = os.path.join(REPO, "bspline-frame-builder", "CAM-builder")
        REPRO_DIR = os.path.join(REPO, "tools", "repro")
        if REPRO_DIR not in sys.path:
            sys.path.insert(0, REPRO_DIR)
        import timeline_health as th

        for _i in range(app.documents.count - 1, -1, -1):
            _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
            _p = _des.userParameters.itemByName('adv_item10p4_fp') if _des else None
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

        def bars_report(des):
            root = des.rootComponent
            bars = [b for occ in root.allOccurrences for b in occ.bRepBodies if b.name.startswith('frame_')]
            vols = {b.name: round(b.volume, 4) for b in bars}
            dup_bodies = [n for n in vols if '(' in n]
            tl_ok = th.is_timeline_healthy(des.timeline)
            slivers = [n for n, v in vols.items() if v < 0.5]
            return {'count': len(bars), 'vols': vols, 'dup_named_bodies': dup_bodies,
                    'timeline_healthy': tl_ok, 'slivers_under_0.5cm3': slivers}

        mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.') or m == 'cam_engine' or m.startswith('cam_engine.') or m == 'cam_utils' or m.startswith('cam_utils.')]
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

                    import importlib.util
                    spec = importlib.util.spec_from_file_location("bsg_item10p4_" + case, os.path.join(BSG_DIR, "b-spline-gen.py"))
                    bsg = importlib.util.module_from_spec(spec)
                    sys.modules["bsg_item10p4_" + case] = bsg
                    spec.loader.exec_module(bsg)
                    from fb_engine import frame_engine as fe
                    from fb_engine.send_frame import find_frames
                    bsg.frame_engine = fe

                    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
                    des = adsk.fusion.Design.cast(app.activeProduct)
                    des.userParameters.add('adv_item10p4_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item10p4-' + case)
                    for name, val in (('widthIn', W), ('heightIn', H)):
                        des.userParameters.add(name, adsk.core.ValueInput.createByString('%s in' % val), 'in', 'board size (item 10 part 4)')
                    HOLD.docs[case] = doc

                    make_synthetic_panel(des, W, H)

                    handler = bsg.PaletteHTMLEventHandler()

                    # --- Send #1 ---
                    handler._handle_send_frame(payload)
                    send1 = bars_report(des)
                    frames_after_1 = find_frames(des)
                    send1['frame_count'] = len(frames_after_1)
                    send1['frame_name'] = frames_after_1[0].name if frames_after_1 else None

                    # --- Send #2, SAME doc, SAME payload (a re-Send) ---
                    handler._handle_send_frame(payload)
                    send2 = bars_report(des)
                    frames_after_2 = find_frames(des)
                    send2['frame_count'] = len(frames_after_2)
                    send2['marker_at_end'] = (des.timeline.markerPosition == des.timeline.count)
                    resend_clean = (
                        send2['frame_count'] == 1
                        and not send2['dup_named_bodies']
                        and send2['timeline_healthy']
                        and send2['marker_at_end']
                        and send2['count'] == send1['count']
                    )

                    # --- CAM: setups + layout, no toolpath generation ---
                    cam_result = {}
                    try:
                        if CAM_DIR not in sys.path:
                            sys.path.insert(0, CAM_DIR)
                        import importlib.util as _ilu
                        cam_spec = _ilu.spec_from_file_location("cam_builder_item10p4_" + case, os.path.join(CAM_DIR, "cam-builder.py"))
                        cam_mod = _ilu.module_from_spec(cam_spec)
                        sys.modules["cam_builder_item10p4_" + case] = cam_mod
                        cam_spec.loader.exec_module(cam_mod)
                        from cam_engine import cam_coordinator

                        class _L:
                            def log(self, msg, level=None):
                                pass

                        report = cam_coordinator.run(classifier=cam_mod._classify_body, app=app, logger=_L(),
                                                      mode='bspline', skip_templates=True, skip_machine=True)
                        cam = des.products.itemByProductType('CAMProductType')
                        cam_result = {
                            'ok': bool(report.get('ok')) if isinstance(report, dict) else None,
                            'setups_count': cam.setups.count if cam else None,
                            'report_keys': list(report.keys()) if isinstance(report, dict) else None,
                        }
                        # Reactivate the Design workspace before anything else touches this doc.
                        try:
                            design_ws = app.userInterface.workspaces.itemById('FusionSolidEnvironment')
                            if design_ws:
                                design_ws.activate()
                        except Exception:
                            pass
                    except Exception:
                        cam_result = {'CRASH': traceback.format_exc()[-1500:]}

                    results[case] = {
                        'board': [W, H], 'send1': send1, 'send2': send2,
                        'resend_clean': resend_clean, 'cam': cam_result,
                    }
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

        print(json.dumps({k: v.get('resend_clean', False) and bool((v.get('cam') or {}).get('ok')) for k, v in results.items()}))
    finally:
        HOLD.busy = False
