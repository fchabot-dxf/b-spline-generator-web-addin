# H23 item 40 (REQUIRED live proof): sends a REAL T7 [Send frame] payload (built without a browser --
# generateValidFrameSeeds + frameSeedGeometry + framePayload, the exact pure functions
# frameSendPayload() calls, run under vitest; headless-Chrome CDP capture is not reachable from this
# sandboxed session -- Node's own fetch to a freshly-spawned child's loopback port failed consistently,
# and dangerouslyDisableSandbox was explicitly denied) straight at fb_engine's own _handle_send_frame,
# bypassing _handle_generate's STEP-import requirement entirely (the frame's own bars never depend on
# the B-spline body's SHAPE, only on a body existing with a usable downward face -- send_frame.py's own
# find_core_body/underside_face contract) -- so a simple synthetic flat panel, built fresh in Fusion by
# this script, stands in for an app-rendered B-spline sculpt, and the frame's own bar geometry is
# identical to what a full app Send would produce.
#
# Run inside Fusion via fusion_execute:
#   REPO = r'<checkout>'; OUT = r'<results.json>'
#   CASES = [('t7_7x9_1', 7, 9), ...]  # (payload stem under scratch/item40_t7_payloads/, W, H)
#   exec(open(r'<repo>\tools\repro\fusion_t11\item40_send_frame_live.py').read())
import sys, os, json, types, traceback
import adsk.core, adsk.fusion

FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
BSG_DIR = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen")
PAYLOAD_DIR = os.path.join(REPO, "bspline-frame-builder", "scratch", "item40_t7_payloads")
REPRO_DIR = os.path.join(REPO, "tools", "repro")
if REPRO_DIR not in sys.path:
    sys.path.insert(0, REPRO_DIR)
import timeline_health as th

HOLD = sys.modules.get('__item40_live')
if HOLD is None:
    HOLD = types.ModuleType('__item40_live'); HOLD.docs = {}; sys.modules['__item40_live'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item40live_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)

results = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}


def _write():
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, default=str)


def make_synthetic_panel(des, width_in, height_in):
    """A simple flat box standing in for the B-spline sculpt: 'B-Spline Set' > 'Clean' > body 'panel',
    the exact hierarchy _find_bspline_core_body (b-spline-gen.py) looks for. Centred at the Fusion
    sketch origin (matching frameSeedGeometry's own F(p) = [p.x - W/2, H/2 - p.y] convention), one
    unambiguous downward face (a plain box has no competing near-flat faces)."""
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
    extInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(-1.5))  # downward, 1.5cm thick
    extInput.participantBodies = []
    feat = ext.add(extInput)
    body = feat.bodies.item(0)
    body.name = 'panel'
    return body


def bars_report(des):
    root = des.rootComponent
    bars = [b for occ in root.allOccurrences for b in occ.bRepBodies if b.name.startswith('frame_')]
    tbm = adsk.fusion.TemporaryBRepManager.get()
    vols = {b.name: round(b.volume, 4) for b in bars}
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
    tl_bad = [] if tl_ok else th.unhealthy_names(des.timeline)
    slivers = [n for n, v in vols.items() if v < 0.5]
    dup_bodies = [n for n in vols if '(' in n]  # Fusion's own auto-suffix for a 2nd body of the same declared name
    return {'count': len(bars), 'vols': vols, 'overlaps': overlaps, 'timeline_healthy': tl_ok,
            'timeline_unhealthy': tl_bad, 'slivers_under_0.5cm3': slivers, 'dup_named_bodies': dup_bodies}


mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
try:
    for key, W, H in CASES:
        if key in results and 'CRASH' not in results[key]:
            continue
        try:
            for m in list(saved_mods):
                if m in sys.modules: del sys.modules[m]
            sys.path[:] = saved_path
            sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(FB)); sys.path.insert(0, BSG_DIR)

            payload = json.load(open(os.path.join(PAYLOAD_DIR, key + '.json'), encoding='utf-8'))

            import importlib.util
            spec = importlib.util.spec_from_file_location("bsg_item40_" + key, os.path.join(BSG_DIR, "b-spline-gen.py"))
            bsg = importlib.util.module_from_spec(spec)
            sys.modules["bsg_item40_" + key] = bsg
            spec.loader.exec_module(bsg)
            from fb_engine import frame_engine as fe
            bsg.frame_engine = fe

            doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
            des = adsk.fusion.Design.cast(app.activeProduct)
            des.userParameters.add('adv_item40live_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item40live-' + key)
            # FB-ORDER (frame_engine.py's own _require_board_params): the frame builder refuses unless
            # widthIn/heightIn already exist as REAL Fusion user parameters -- normally created by "Send
            # B-spline" before the frame send; the synthetic panel below stands in for that body, but
            # these 2 params still need to exist explicitly (same as live_captured_send_readback.py's
            # own established pattern).
            for name, val in (('widthIn', W), ('heightIn', H)):
                des.userParameters.add(name, adsk.core.ValueInput.createByString('%s in' % val), 'in', 'board size (item 40 live check)')
            HOLD.docs[key] = doc

            make_synthetic_panel(des, W, H)

            handler = bsg.PaletteHTMLEventHandler()
            handler._handle_send_frame(payload)

            r = bars_report(des)
            r['board'] = [W, H]
            results[key] = r
            _write()

            HOLD.docs.pop(key).close(False)
        except Exception:
            results[key] = {'CRASH': traceback.format_exc()[-2000:], 'board': [W, H]}
            _write()
            d = HOLD.docs.pop(key, None)
            if d: d.close(False)
finally:
    for m in mod_keys():
        if m in sys.modules: del sys.modules[m]
    sys.modules.update(saved_mods)
    sys.path[:] = saved_path
    _write()

done = [k for k, v in results.items() if 'CRASH' not in v]
crashed = [k for k, v in results.items() if 'CRASH' in v]
bad = [k for k in done if results[k]['count'] != 5 or results[k]['overlaps'] or results[k]['slivers_under_0.5cm3']
       or results[k]['dup_named_bodies'] or not results[k]['timeline_healthy']]
print('done=%d crashed=%d bad=%s' % (len(done), len(crashed), bad))
