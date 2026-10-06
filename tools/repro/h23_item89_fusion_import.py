# H23 item 89, the Fusion half of tools/repro/h23_item89_band_sweep.mjs: import each case's Bricks svg through the
# deployed add-in's OWN _apply_bricks_sketch (the Send's import step) into ONE tagged scratch doc ('B-Spline Set' >
# 'Stamped', board params widthIn/heightIn -- the import reads them), measure the sketch, then remove it + its plane.
# Resume-able: results append to <E89_DIR>/fusion_results.jsonl, a done case is skipped.
# In fusion_execute:  E89_DIR = r'<the sweep outDir>'; PHASE = 'setup' | 'run' (BATCH = 2) | 'keep' (CASE = ...) |
# 'close'; exec(open(<this file>).read()). Keep BATCH <= 2: an import can spike past the bridge timeout.
import sys, os, json, time, types
D = globals().get('E89_DIR')
assert D, 'set E89_DIR to the sweep outDir'
RES = D + r'\fusion_results.jsonl'
IN2 = 2.54 ** 2
SLIVER_IN2 = 1e-4
BOARD = globals().get('BOARD', (7, 9))
h = sys.modules.get('claude77_e89')
if h is None:
    h = types.ModuleType('claude77_e89'); sys.modules['claude77_e89'] = h


def _cases():
    return sorted(f[:-5] for f in os.listdir(D) if f.endswith('.json') and '__' in f)


def _done():
    if not os.path.exists(RES):
        return set()
    return {json.loads(l)['case'] for l in open(RES, encoding='utf-8') if l.strip()}


def _stamped():
    return h.group.childOccurrences.item(0).component


def _import(case):
    c = json.load(open(D + '\\' + case + '.json', encoding='utf-8'))
    handler = sys.modules['bspline_ui'].PaletteHTMLEventHandler()
    t0 = time.time()
    handler._apply_bricks_sketch(h.group, {'bricks': c['bricks']}, {'widthIn': c['board'][0], 'heightIn': c['board'][1]})
    return c, round(time.time() - t0, 2)


def _measure(comp):
    sk = next((s for s in comp.sketches if s.name == 'Bricks'), None)
    if sk is None:
        return {'sketch': False}
    t0 = time.time()
    pr = sk.profiles
    areas, multi = [], 0
    for i in range(pr.count):
        p = pr.item(i)
        if p.profileLoops.count > 1:
            multi += 1
        areas.append(p.areaProperties(adsk.fusion.CalculationAccuracy.LowCalculationAccuracy).area / IN2)
    ends = {}
    for cv in sk.sketchCurves:
        for pt in (cv.startSketchPoint, cv.endSketchPoint):
            k = (round(pt.geometry.x, 5), round(pt.geometry.y, 5))
            ends[k] = ends.get(k, 0) + 1
    slivers = sorted(a for a in areas if a < SLIVER_IN2)
    return {'sketch': True, 'curves': sk.sketchCurves.count, 'profiles': pr.count, 'multi_loop': multi,
            'slivers': len(slivers), 'sliver_min_in2': slivers[0] if slivers else None,
            'small_lt_1e-3': sum(1 for a in areas if a < 1e-3), 'open_ends': sum(1 for v in ends.values() if v == 1),
            'measure_s': round(time.time() - t0, 2)}


def _remove(comp):
    for s in [s for s in comp.sketches if s.name == 'Bricks']:
        s.deleteMe()
    for p in [p for p in comp.constructionPlanes if p.name == 'Plane for Bricks']:
        p.deleteMe()


if PHASE == 'setup':
    h.fred = app.activeDocument
    h.doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    h.doc.attributes.add('claude', 'scratch', 'item89-sweep')
    des = adsk.fusion.Design.cast(h.doc.products.itemByProductType('DesignProductType'))
    h.group = des.rootComponent.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    h.group.component.name = 'B-Spline Set'
    st = h.group.component.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    st.component.name = 'Stamped'
    for n, v in (('widthIn', '%g in' % BOARD[0]), ('heightIn', '%g in' % BOARD[1])):
        des.userParameters.add(n, adsk.core.ValueInput.createByString(v), 'in', 'item89 scratch board')
    print('setup', h.doc.name, [o.component.name for o in h.group.childOccurrences])

elif PHASE == 'run':
    assert app.activeDocument == h.doc, 'scratch doc not active'
    done = _done()
    todo = [c for c in _cases() if c not in done][:BATCH]
    for case in todo:
        c, imp_s = _import(case)
        m = _measure(_stamped())
        _remove(_stamped())
        row = dict(case=case, template=c['template'], preset=c['preset'], pieces=c['pieces'], import_s=imp_s, **m)
        open(RES, 'a', encoding='utf-8').write(json.dumps(row) + '\n')
        print(json.dumps(row))
    print('remaining', len([c for c in _cases() if c not in _done()]))

elif PHASE == 'keep':   # re-import one case and leave it in place (for a shot)
    _remove(_stamped())
    c, imp_s = _import(CASE)
    print(CASE, imp_s, _measure(_stamped()))

elif PHASE == 'close':
    mine = h.doc
    assert mine.attributes.itemByName('claude', 'scratch').value == 'item89-sweep'
    ok = mine.close(False)
    if getattr(h, 'fred', None) is not None and h.fred.isValid:
        h.fred.activate()
    del sys.modules['claude77_e89']
    print('closed', ok, [d.name for d in app.documents], app.activeDocument.name)
