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

            handler = bsg.PaletteHTMLEventHandler()
            handler._handle_send_frame(payload)

            r = bars_report(des, declared_names, n_miters)
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
       or results[k]['missing_declared_names'] or not results[k]['timeline_healthy']]
print('done=%d crashed=%s bad=%s' % (len(done), crashed, bad))
