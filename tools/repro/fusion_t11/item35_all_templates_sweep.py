# H23 item 35 (Fred's amendment 2, point 8): all 13 templates x 3 board sizes through the REAL
# engine, loaded fresh from THIS repo checkout (not the deployed add-in copy -- that copy does not
# have the isTopologyMatched=False fix). For each captured Send payload: offset_fallbacks must be
# empty, the frame bars must have zero pairwise overlap, and the timeline must be healthy (judged
# by recursing into group children -- a TimelineGroup's own healthState is always Unknown, H23 item
# 32 / tools/repro/timeline_health.py).
#
# Run inside Fusion via fusion_execute, one call per CASES chunk (each build is slow enough that a
# single call times out the bridge reply well before the work itself is done -- that is expected and
# harmless; results are written to OUT incrementally after every case so a timeout never loses
# completed work):
#   REPO = r'<checkout>'; PAYLOAD_DIR = r'<dir with t<N>_<board>.json files>'; OUT = r'<results.json>'
#   CASES = [('t1_6x9', 'template_1'), ...]   # (payload stem, template id) pairs for THIS chunk
#   exec(open(r'<repo>\tools\repro\fusion_t11\item35_all_templates_sweep.py').read())
import sys, os, json, types, traceback
import adsk.core, adsk.fusion

FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
BSG_DIR = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen")
REPRO_DIR = os.path.join(REPO, "tools", "repro")
if REPRO_DIR not in sys.path:
    sys.path.insert(0, REPRO_DIR)
import timeline_health as th

HOLD = sys.modules.get('__item35_sweep')
if HOLD is None:
    HOLD = types.ModuleType('__item35_sweep'); HOLD.docs = {}; sys.modules['__item35_sweep'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item35sw_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)

results = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}


def _write():
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, default=str)


def bars_report(des):
    root = des.rootComponent
    bars = [b for occ in root.allOccurrences for b in occ.bRepBodies if b.name.startswith('frame_')]
    tbm = adsk.fusion.TemporaryBRepManager.get()
    vols = {b.name: round(b.volume, 2) for b in bars}
    overlaps = {}
    for i in range(len(bars)):
        for j in range(i + 1, len(bars)):
            a = tbm.copy(bars[i]); c = tbm.copy(bars[j])
            try:
                tbm.booleanOperation(a, c, adsk.fusion.BooleanTypes.IntersectionBooleanType)
                v = round(a.volume, 2)
            except Exception:
                v = 0.0
            if v > 0.01:
                overlaps['%s&%s' % (bars[i].name, bars[j].name)] = v
    tl_ok = th.is_timeline_healthy(des.timeline)
    tl_bad = [] if tl_ok else th.unhealthy_names(des.timeline)
    return {'count': len(bars), 'vols': vols, 'overlaps': overlaps, 'timeline_healthy': tl_ok, 'timeline_unhealthy': tl_bad}


mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
try:
    for key, template_id in CASES:
        if key in results and 'CRASH' not in results[key]:
            continue  # already done in an earlier chunk of this sweep
        try:
            for m in list(saved_mods):
                if m in sys.modules: del sys.modules[m]
            sys.path[:] = saved_path
            sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(FB)); sys.path.insert(0, BSG_DIR)

            payload = json.load(open(os.path.join(PAYLOAD_DIR, key + '.json')))

            import importlib.util
            spec = importlib.util.spec_from_file_location("bsg_item35sw_" + key, os.path.join(BSG_DIR, "b-spline-gen.py"))
            bsg = importlib.util.module_from_spec(spec)
            sys.modules["bsg_item35sw_" + key] = bsg
            spec.loader.exec_module(bsg)
            from fb_engine import frame_engine as fe
            bsg.frame_engine = fe

            captured = []
            OrigFB = fe.FrameBuilder
            class _CapFB(OrigFB):
                def __init__(self, *a, **k):
                    super().__init__(*a, **k)
                    captured.append(self)
            fe.FrameBuilder = _CapFB

            doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
            des = adsk.fusion.Design.cast(app.activeProduct)
            des.userParameters.add('adv_item35sw_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item35sw-' + key)
            HOLD.docs[key] = doc

            handler = bsg.PaletteHTMLEventHandler()
            try:
                handler._handle_generate(payload)
            finally:
                fe.FrameBuilder = OrigFB

            fallbacks = captured[-1].offset_fallbacks if captured else 'NO_INSTANCE_CAPTURED'
            r = bars_report(des)
            r['offset_fallbacks'] = fallbacks
            r['template_id'] = template_id
            r['frame_payload_templateId'] = payload.get('frame', {}).get('templateId')
            results[key] = r
            _write()

            HOLD.docs.pop(key).close(False)
        except Exception:
            results[key] = {'CRASH': traceback.format_exc()[-1500:], 'template_id': template_id}
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
fallback_cases = [k for k in done if results[k]['offset_fallbacks']]
overlap_cases = [k for k in done if results[k]['overlaps']]
unhealthy_cases = [k for k in done if not results[k]['timeline_healthy']]
print('done=%d crashed=%d fallback_cases=%s overlap_cases=%s unhealthy_cases=%s' % (
    len(done), len(crashed), fallback_cases, overlap_cases, unhealthy_cases))
