# H23 item 44: re-record T10's own golden fixtures using the SAME proven-working live-send path
# as item 43's own verification (_handle_send_frame against a synthetic panel, loaded fresh from
# this checkout) -- NOT record_frame_parity.py's own build_frame_logic entry point, which this
# session measured to silently stop right after template resolution (no sketch/solid logs at all,
# same result whether called via record_case or FrameBuilder.run_sketch_only directly against the
# deployed add-in) for a cause this item does not need to chase down to get correct goldens.
# Produces the SAME golden JSON SHAPE record_frame_parity.py writes (meta/sketch2_shape_outline/
# sketch3_frame_enclosure/sketch3_profiles/bars/panelAfterTrim), from a REAL send_frame.send_frame
# build (the actual production path), so these numbers are at least as trustworthy as the ones
# item 43's own live checks already verified.
#
# Run inside Fusion via fusion_execute:
#   REPO = r'<checkout>'; CASES = [(6, 9), (7, 9), (9, 12)]; OUT_DIR = r'<scratch dir>'
#   exec(open(r'<repo>\tools\repro\fusion_t11\item44_record_t10_goldens.py').read())
import sys, os, json, types, traceback, time
import adsk.core, adsk.fusion

FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
BSG_DIR = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen")
CM = 2.54

HOLD = sys.modules.get('__item44_rec')
if HOLD is None:
    HOLD = types.ModuleType('__item44_rec'); HOLD.docs = {}; sys.modules['__item44_rec'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item44rec_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)

os.makedirs(OUT_DIR, exist_ok=True)


import importlib.util as _ilu
_rfp_spec = _ilu.spec_from_file_location('record_frame_parity_item44helpers', os.path.join(REPO, 'tools', 'repro', 'record_frame_parity.py'))
_rfp = _ilu.module_from_spec(_rfp_spec)
_rfp_spec.loader.exec_module(_rfp)
_bbox = _rfp._bbox
_curves = _rfp._curves  # the ESTABLISHED schema (keyed by FrameBuilder ID, start/end/mid/center/radius) --
                        # reused, not reinvented, after this script's own first draft duplicated it wrongly
                        # and broke test_frame_parity_goldens.py / gen_frame_defs.py's own shape-fit readers.


mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
written = []
try:
    for W, H in CASES:
        key = f'template_10_{W}x{H}'
        try:
            for m in list(saved_mods):
                if m in sys.modules: del sys.modules[m]
            sys.path[:] = saved_path
            sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(FB)); sys.path.insert(0, BSG_DIR)

            import importlib.util
            spec = importlib.util.spec_from_file_location("bsg_item44_" + key, os.path.join(BSG_DIR, "b-spline-gen.py"))
            bsg = importlib.util.module_from_spec(spec)
            sys.modules["bsg_item44_" + key] = bsg
            spec.loader.exec_module(bsg)
            from fb_engine import frame_engine as fe
            bsg.frame_engine = fe

            doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
            des = adsk.fusion.Design.cast(app.activeProduct)
            des.userParameters.add('adv_item44rec_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item44rec-' + key)
            for name, val in (('widthIn', W), ('heightIn', H)):
                des.userParameters.add(name, adsk.core.ValueInput.createByString('%s in' % val), 'in', 'board size (item 44 golden record)')
            HOLD.docs[key] = doc

            root = des.rootComponent
            # SAME core convention record_frame_parity.py's own established goldens use (underside
            # EXACTLY at z=0, panel extruded upward) -- test_frame_parity_goldens.py's own
            # test_golden_is_consistent hard-asserts every bar's bbox spans z=[-1.0, 0.0] exactly;
            # reused directly, not re-derived, after this script's own first draft built a
            # differently-conventioned panel (underside at z=-1.905) and tripped that assertion.
            _rfp._make_core(des, W, H)

            handler = bsg.PaletteHTMLEventHandler()
            payload = {'templateId': 'template_10', 'params': {}, 'seeds': {}, 'frameBottomZ': -1,
                       'panelLip': 0, 'appearance': None, 'insetWindow': {'enabled': False}}
            handler._handle_send_frame(payload)

            fc = [o for o in root.occurrences if o.component.name.startswith('Frame_')][0].component
            sk = {s.name.split('_', 1)[1]: s for s in fc.sketches}
            sk3 = sk['3_frame_enclosure']
            profiles = []
            for i in range(sk3.profiles.count):
                p = sk3.profiles.item(i)
                profiles.append({'area': round(p.areaProperties().area / CM ** 2, 5), 'bbox': _bbox(p.boundingBox)})
            profiles.sort(key=lambda e: (e['bbox']['min'], e['area']))
            bars = {b.name: {'bbox': _bbox(b.boundingBox), 'volume': round(b.volume / CM ** 3, 5)}
                    for occ in root.allOccurrences for b in occ.bRepBodies if b.name.startswith('frame_')}
            panel = [b for occ in root.allOccurrences for b in occ.bRepBodies if b.name == 'panel'][0]
            result = {
                'meta': {'template': 'template_10', 'widthIn': W, 'heightIn': H,
                          'frame_thickness': 'template default (0.75 in)', 'frame_height_offset': '-1 in',
                          'core': f'flat box {W}x{H}x0.75 in, underside at z=0 (record_frame_parity._make_core convention, extruded upward) (item 44 re-record, send_frame path)',
                          'units': 'in / in^2 / in^3', 'recorded': time.strftime('%Y-%m-%d'),
                          'recorder': 'tools/repro/fusion_t11/item44_record_t10_goldens.py',
                          'timelineHealthy': _rfp._timeline_healthy(des.timeline)},
                'sketch2_shape_outline': _curves(sk['2_shape_outline']),
                'sketch3_frame_enclosure': _curves(sk3),
                'sketch3_profiles': profiles,
                'bars': dict(sorted(bars.items())),
                'panelAfterTrim': {'bbox': _bbox(panel.boundingBox), 'volume': round(panel.volume / CM ** 3, 5)},
            }
            path = os.path.join(OUT_DIR, key + '.json')
            with open(path, 'w', encoding='utf-8', newline='\n') as f:
                f.write(json.dumps(result, indent=2, sort_keys=True) + '\n')
            written.append((key, len(bars), len(profiles)))

            HOLD.docs.pop(key).close(False)
        except Exception:
            written.append((key, 'CRASH', traceback.format_exc()[-1500:]))
            d = HOLD.docs.pop(key, None)
            if d: d.close(False)
finally:
    for m in mod_keys():
        if m in sys.modules: del sys.modules[m]
    sys.modules.update(saved_mods)
    sys.path[:] = saved_path

for w in written:
    print(w)
