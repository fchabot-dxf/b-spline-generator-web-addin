# F20 live (run INSIDE Fusion, exec'd with globals app, CASE=<case json from f20_seed_case.mjs>, optional SHOT=<png>):
# build T1 (or the case's `templateId`, T3 / T4 / T5 / T6) with the app's seed geometry in ONE tagged scratch doc (the Send path, build_sketch_logic_v3; NOT
# build_frame_logic, which ignores seeds), read every outline arc + each constraint/dimension touching the corner
# geometry, compare with the app, close the doc by its own handle. Nothing is added to sys.path / sys.modules.
import json, os, sys, math
import adsk.core, adsk.fusion

SP = r'C:\Users\danse\AppData\Local\Temp\claude\c--Users-danse-APPS-b-spline-generator-web-addin\4670a598-bbb6-4719-b490-cb8e4b2a824a\scratchpad\f20'
PARITY = r'C:\Users\danse\APPS\b-spline-generator-web-addin\tools\repro\record_frame_parity.py'
CM = 2.54
CORNER = ('arc_shoulder_R', 'arc_shoulder_L', 'arc_hip_R', 'arc_hip_L',
          'skel_shoulder_pin_R', 'skel_shoulder_pin_L', 'skel_hip_pin_R', 'skel_hip_pin_L')


def fid(e):
    try:
        a = e.attributes.itemByName('FrameBuilder', 'ID')
        return a.value if a else None
    except Exception:
        return None


def owner_ids(e):
    """FrameBuilder ids of an entity, or of the curves a sketch point belongs to."""
    i = fid(e)
    if i:
        return [i]
    out = []
    try:
        for c in e.connectedEntities:
            j = fid(c)
            if j:
                out.append(j + ':pt')
    except Exception:
        pass
    return out


def ents_of(c):
    out = []
    for attr in ('curveOne', 'curveTwo', 'point', 'entity', 'line', 'lineOne', 'lineTwo', 'curve', 'pointOne', 'pointTwo'):
        try:
            v = getattr(c, attr)
        except Exception:
            continue
        if v is not None:
            out += owner_ids(v)
    return out


def run_case(case_file, tag, shot=None):
    ns = {'__name__': 'f20_parity'}
    exec(compile(open(PARITY, encoding='utf-8').read(), PARITY, 'exec'), ns)
    case = json.load(open(os.path.join(SP, case_file), encoding='utf-8'))
    W, H = case['W'], case['H']
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    try:
        d = adsk.fusion.Design.cast(doc.products.itemByProductType('DesignProductType'))
        d.attributes.add('claude', 'scratch', tag)
        d.designType = adsk.fusion.DesignTypes.ParametricDesignType
        up = d.userParameters
        up.add('widthIn', adsk.core.ValueInput.createByString(f'{W} in'), 'in', 'F20')
        up.add('heightIn', adsk.core.ValueInput.createByString(f'{H} in'), 'in', 'F20')
        ns['_make_core'](d, W, H)
        fe = sys.modules['frame_engine_core']
        lg = sys.modules['fb_utils.fb_logger'].DebugLogger(os.path.dirname(os.path.dirname(fe.__file__)))
        fe.build_sketch_logic_v3(case.get('templateId', 'template_1'), 'joint', external_logger=lg,
                             data={'ui_data': {}, 'seed_geometry': case['seedGeometry']})
        root = d.rootComponent
        fc = [o for o in root.occurrences if o.component.name.startswith('Frame_')][0].component
        sk = {s.name.split('_', 1)[1]: s for s in fc.sketches}['2_shape_outline']
        arcs = {}
        for c in sk.sketchCurves.sketchArcs:
            i = fid(c)
            if i in case['arcs']:
                p = c.centerSketchPoint.geometry
                arcs[i] = {'center': [round(p.x / CM, 4), round(p.y / CM, 4)], 'radius': round(c.radius / CM, 4)}
        # T6 (all lines): each expected line's ends (the case's `lines`, absent in older cases) against Fusion's
        lines = {}
        for c in sk.sketchCurves.sketchLines:
            i = fid(c)
            if i in case.get('lines', {}):
                lines[i] = [[round(q.x / CM, 4), round(q.y / CM, 4)] for q in (c.startSketchPoint.geometry, c.endSketchPoint.geometry)]
        cons = []
        for c in sk.geometricConstraints:
            ids = ents_of(c)
            if any(x.split(':')[0] in CORNER for x in ids):
                cons.append([c.objectType.split('::')[-1], sorted(set(ids))])
        dims = []
        for dm in sk.sketchDimensions:
            ids = ents_of(dm)
            try:
                ids += owner_ids(dm.entity)
            except Exception:
                pass
            if any(x.split(':')[0] in CORNER for x in ids):
                dims.append([dm.objectType.split('::')[-1], round(dm.parameter.value / CM, 4) if dm.parameter else None, sorted(set(ids))])
        tl = d.timeline
        errs = [max(abs(case['arcs'][k]['radius'] - arcs[k]['radius']), math.dist(case['arcs'][k]['center'], arcs[k]['center']))
                for k in case['arcs']]
        errs += [max(math.dist(a, b) for a, b in zip(v, lines[k])) for k, v in case.get('lines', {}).items()]
        res = {'case': case_file, 'seeds': case['seeds'], 'expected': case['arcs'], 'fusion': arcs,
               'expectedLines': case.get('lines', {}), 'fusionLines': lines,
               'maxErr': max(errs) if errs else None,
               'constraints': cons, 'dims': dims, 'fullyConstrained': sk.isFullyConstrained,
               'healthy': all(tl.item(i).healthState == 0 for i in range(tl.count)),
               'userParams': [p.name for p in d.userParameters]}
        if shot:
            vp = app.activeViewport
            cam = vp.camera
            cam.viewOrientation = adsk.core.ViewOrientations.TopViewOrientation
            cam.isFitView = True
            vp.camera = cam
            vp.saveAsImageFile(shot, 1400, 1000)
        return res
    finally:
        doc.close(False)


print(json.dumps(run_case(CASE, 'F20', globals().get('SHOT'))))
