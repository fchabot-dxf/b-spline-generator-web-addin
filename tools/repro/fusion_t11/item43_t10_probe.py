# H23 item 43 probe: T10's default build at 7x9 -- dump T10_3_frame_enclosure's own entity_map
# (every id -> coords/geometry) right after the offset phase, PLUS proj_top_edge's own arc
# (center/radius) and proj_horn_TR/proj_horn_TL's own line endpoints, so the TRUE top-corner
# geometry (line meets arc, same family as item 38 part 1's T7 eave) can be computed and compared
# against whatever (if anything) Fusion's native offset happened to tag nearby.
#
# Run inside Fusion via fusion_execute:
#   REPO = r'<checkout>'; OUT = r'<results.json>'
#   exec(open(r'<repo>\tools\repro\fusion_t11\item43_t10_probe.py').read())
import sys, os, json, types, traceback
import adsk.core, adsk.fusion

FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
BSG_DIR = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen")

HOLD = sys.modules.get('__item43_probe')
if HOLD is None:
    HOLD = types.ModuleType('__item43_probe'); HOLD.docs = {}; sys.modules['__item43_probe'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_item43probe_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)

mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
out = {}
try:
    for m in list(saved_mods):
        if m in sys.modules: del sys.modules[m]
    sys.path[:] = saved_path
    sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(FB)); sys.path.insert(0, BSG_DIR)

    payload = json.load(open(os.path.join(REPO, "bspline-frame-builder", "scratch", "item40_all_template_payloads", "template_10_default_7x9.json"), encoding='utf-8'))

    import importlib.util
    spec = importlib.util.spec_from_file_location("bsg_item43probe", os.path.join(BSG_DIR, "b-spline-gen.py"))
    bsg = importlib.util.module_from_spec(spec)
    sys.modules["bsg_item43probe"] = bsg
    spec.loader.exec_module(bsg)
    from fb_engine import frame_engine as fe

    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_item43probe_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-item43probe')
    for name, val in (('widthIn', payload['widthIn']), ('heightIn', payload['heightIn'])):
        des.userParameters.add(name, adsk.core.ValueInput.createByString('%s in' % val), 'in', 'board size (item 43 probe)')
    HOLD.docs['probe'] = doc

    captured = []
    OrigFB = fe.FrameBuilder
    class _CapFB(OrigFB):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            captured.append(self)
    fe.FrameBuilder = _CapFB
    try:
        ui_data = {'widthIn': payload['widthIn'], 'heightIn': payload['heightIn'], **payload.get('params', {})}
        fb = fe.FrameBuilder(external_logger=None)
        fb.run_sketch_only(style_id='template_10', ui_data=ui_data, seed_geometry=payload.get('seedGeometry'),
                            panel_lip=payload.get('panelLip') or None)
    finally:
        fe.FrameBuilder = OrigFB

    builder = captured[-1] if captured else None
    ctx = builder.last_ctx if builder and hasattr(builder, 'last_ctx') else None
    # The entity_map lives on whatever BuildContext the ParametricSketchBuilder used -- find it via
    # the sketch the phases named (T10_3_frame_enclosure), scanning root + occurrences for it, then
    # reading every SketchPoint/SketchLine/SketchArc directly from FUSION (ground truth), not from
    # Python's own entity_map (which we don't have a handle to from outside parametric_engine).
    root = des.rootComponent
    sk3 = None
    for occ in root.allOccurrences:
        for i in range(occ.component.sketches.count):
            s = occ.component.sketches.item(i)
            if '3_frame_enclosure' in s.name.lower():
                sk3 = s
    out['sketch_found'] = sk3.name if sk3 else None
    def _id_of(entity):
        try:
            at = entity.attributes.itemByName('FrameBuilder', 'ID')
            if at: return at.value
        except Exception:
            pass
        try:
            return entity.name
        except Exception:
            return None

    if sk3:
        pts = []
        for i in range(sk3.sketchPoints.count):
            p = sk3.sketchPoints.item(i)
            pts.append({'id': _id_of(p), 'x': round(p.geometry.x, 4), 'y': round(p.geometry.y, 4)})
        out['points'] = pts
        arcs = []
        for i in range(sk3.sketchCurves.sketchArcs.count):
            a = sk3.sketchCurves.sketchArcs.item(i)
            g = a.geometry
            arcs.append({'id': _id_of(a), 'center': [round(g.center.x, 4), round(g.center.y, 4)], 'radius': round(g.radius, 4),
                         'startPt': [round(a.startSketchPoint.geometry.x, 4), round(a.startSketchPoint.geometry.y, 4)],
                         'endPt': [round(a.endSketchPoint.geometry.x, 4), round(a.endSketchPoint.geometry.y, 4)]})
        out['arcs'] = arcs
        lines = []
        for i in range(sk3.sketchCurves.sketchLines.count):
            l = sk3.sketchCurves.sketchLines.item(i)
            lines.append({'id': _id_of(l), 'p0': [round(l.startSketchPoint.geometry.x, 4), round(l.startSketchPoint.geometry.y, 4)],
                           'p1': [round(l.endSketchPoint.geometry.x, 4), round(l.endSketchPoint.geometry.y, 4)]})
        out['lines'] = lines
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, default=str)
    print('wrote', OUT, 'points=', len(out.get('points', [])), 'arcs=', len(out.get('arcs', [])), 'lines=', len(out.get('lines', [])))
except Exception:
    print(traceback.format_exc()[-3000:])
finally:
    for m in mod_keys():
        if m in sys.modules: del sys.modules[m]
    sys.modules.update(saved_mods)
    sys.path[:] = saved_path
