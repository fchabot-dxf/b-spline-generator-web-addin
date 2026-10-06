# H23 item 90: Send + BUILD + APPLY of a captured board through the DEPLOYED add-ins, one tagged scratch doc held in
# sys.modules['claude77_e90'].  PAYLOAD = <json>; PHASE = 'send'|'build'|'apply'|'ops'|'times'|'close'; exec(open(this).read())
import sys, types, json, time, os, re
h = sys.modules.get('claude77_e90')
if h is None:
    h = types.ModuleType('claude77_e90'); sys.modules['claude77_e90'] = h
CAM_LOG = os.path.expanduser('~') + r'\AppData\Roaming\Autodesk\Autodesk Fusion 360\API\AddIns\bspline-frame-builder\CAM-builder\cam-builder-cam-debug.log'


def _cbm():
    return next(m for m in list(sys.modules.values()) if m is not None and hasattr(m, '_classify_body') and hasattr(m, '_load_engine'))


def _cam():
    return adsk.cam.CAM.cast(h.doc.products.itemByProductType('CAMProductType'))


if PHASE == 'send':
    h.fred = app.activeDocument
    h.label = LABEL
    p = json.load(open(PAYLOAD, encoding='utf-8'))
    h.doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    h.doc.attributes.add('claude', 'scratch', 'item90-' + LABEL)
    t0 = time.time()
    sys.modules['bspline_ui'].PaletteHTMLEventHandler()._handle_generate(p)
    h.send_s = round(time.time() - t0, 1)
    print(LABEL, 'send s', h.send_s)

elif PHASE == 'build':
    assert app.activeDocument == h.doc, 'scratch doc not active'
    cbm = _cbm(); cbm._load_engine()
    t0 = time.time()
    rep = cbm._engine.run(classifier=cbm._classify_body, logger=cbm._logger, mode='bspline', skip_templates=True, skip_machine=True)
    h.build_s = round(time.time() - t0, 1)
    print(h.label, 'BUILD s', h.build_s, 'ok', rep.get('ok'), 'reused', rep.get('reused'), 'errors', rep.get('errors'))

elif PHASE == 'apply':
    assert app.activeDocument == h.doc, 'scratch doc not active'
    h.log_offset = os.path.getsize(CAM_LOG)
    h.apply_t0 = time.time()
    _cbm()._do_apply_toolpaths()          # the palette's APPLY TOOLPATHS: templates, then the deferred TPGen event
    print(h.label, 'apply fired; templates s', round(time.time() - h.apply_t0, 1))

elif PHASE == 'times':
    with open(CAM_LOG, encoding='utf-8', errors='replace') as f:
        f.seek(h.log_offset); txt = f.read()
    gen = re.findall(r"DEFERRED TPGEN: setup '([^']+)' generated in ([\d.]+)s", txt)
    audit = re.findall(r'post-audit ok=(\d+) missing=(\d+)', txt)
    warn = [l for l in txt.split('\n') if '[WARNING]' in l or '[ERROR]' in l]
    print(h.label, 'generated', gen, 'audit', audit, 'warnings/errors in log', len(warn))
    for l in warn[:8]: print('  ', l[:200])

elif PHASE == 'ops':
    cam = _cam(); out = []
    for i in range(cam.setups.count):
        s = cam.setups.item(i)
        for j in range(s.operations.count):
            op = s.operations.item(j)
            mt = None
            if op.hasToolpath:
                try:   # Fusion's own estimate, same feed scale / rapid / tool change for every board (comparable, not absolute)
                    m = cam.getMachiningTime(op, 1.0, 1000.0, 0.0)
                    mt = (round(m.machiningTime, 1), round(m.feedDistance / 2.54, 1))   # seconds, feed inches
                except Exception as e:
                    mt = 'n/a: ' + str(e)[:40]
            out.append((s.name, op.name, op.hasToolpath, op.isToolpathValid, op.hasError, op.hasWarning, op.operationState, mt))
    h.ops = out
    print(h.label, 'ops', len(out)); [print('  ', o) for o in out]

elif PHASE == 'close':
    mine = h.doc
    assert mine.attributes.itemByName('claude', 'scratch').value.startswith('item90-')
    ui.workspaces.itemById('FusionSolidEnvironment').activate()
    ok = mine.close(False)
    if getattr(h, 'fred', None) is not None and h.fred.isValid:
        h.fred.activate()
    del sys.modules['claude77_e90']
    print('closed', ok, [d.name for d in app.documents], app.activeDocument.name)
