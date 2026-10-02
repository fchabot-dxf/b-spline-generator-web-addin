# UI vs API sketch-tool comparison (advisor, 2026-10-02; Fred: "go through constraints and see the difference between
# human UI and API, for drawing tools and constraints -- midpoint for example -- then the different arcs, slots,
# rect tools").
# Run inside Fusion via fusion_execute:  MODE = 'build' | 'read' | 'probe_api'; exec(open(<this file>).read())
#   build      : new fingerprinted doc (user param adv_uiapi_fp), one sketch API_<tool> per tool, built with the API
#   probe_api  : print which slot/rectangle/arc/polygon creation methods this Fusion version's API exposes
#   (the UI_ side is drawn by hand or by Claude Cowork following COWORK-UI-SKETCHES.md next to this file)
#   read       : inventory EVERY sketch in the active doc whose name starts API_ or UI_ (Fred draws the UI_ ones), and
#                print a side-by-side for each tool name: entities, construction flags, geometric constraints (type +
#                what they tie, by role), dimensions, and whether the sketch reports fully constrained.
import math, json, traceback
import adsk.core, adsk.fusion

CM = 2.54
P = lambda x, y: adsk.core.Point3D.create(x * CM, y * CM, 0)
OUT = None  # set OUT to a path before exec to also save the inventory as JSON


def _kind(e):
    n = type(e).__name__.replace('Sketch', '')
    if hasattr(e, 'isConstruction') and e.isConstruction:
        n += '(c)'
    return n


def _role(e, idx):
    """A stable, human label for an entity: its kind + index within that kind in this sketch."""
    return '%s#%d' % (_kind(e), idx.get(e.entityToken, -1))


def inventory(sk):
    curves = [sk.sketchCurves.item(i) for i in range(sk.sketchCurves.count)]
    idx, counter = {}, {}
    for c in curves:
        k = _kind(c); counter[k] = counter.get(k, 0) + 1; idx[c.entityToken] = counter[k]
    pts = [sk.sketchPoints.item(i) for i in range(sk.sketchPoints.count)]
    for i, p in enumerate(pts):
        idx[p.entityToken] = i
    cons = []
    for i in range(sk.geometricConstraints.count):
        g = sk.geometricConstraints.item(i)
        t = type(g).__name__.replace('Constraint', '')
        ents = []
        for attr in ('point', 'entity', 'entityOne', 'entityTwo', 'lineOne', 'lineTwo', 'curveOne', 'curveTwo',
                     'line', 'curve', 'midPointCurve', 'symmetryLine', 'pointOne', 'pointTwo'):
            v = getattr(g, attr, None) if hasattr(g, attr) else None
            if v is not None:
                try:
                    ents.append('%s=%s' % (attr, _role(v, idx) if not isinstance(v, adsk.fusion.SketchPoint) else 'pt'))
                except Exception:
                    pass
        cons.append('%s(%s)' % (t, ','.join(ents)))
    dims = [type(sk.sketchDimensions.item(i)).__name__.replace('Sketch', '').replace('Dimension', '') for i in range(sk.sketchDimensions.count)]
    kinds = {}
    for c in curves:
        kinds[_kind(c)] = kinds.get(_kind(c), 0) + 1
    return {'curves': kinds, 'constraints': sorted(cons), 'constraint_types': sorted(c.split('(')[0] for c in cons),
            'dims': sorted(dims), 'fully_constrained': getattr(sk, 'isFullyConstrained', None)}


def _ui_doc():
    """The document Claude Cowork drew in: the one open document holding UI_* sketches (None if not exactly one)."""
    hits = []
    for i in range(app.documents.count):
        d = app.documents.item(i)
        try:
            r = d.products.itemByProductType('DesignProductType').rootComponent
        except Exception:
            continue
        if any(r.sketches.item(j).name.startswith('UI_') for j in range(r.sketches.count)):
            hits.append(d)
    return hits[0] if len(hits) == 1 else None


def build():
    # Build NEXT TO the UI sketches when Cowork's document exists; otherwise a new fingerprinted doc.
    doc = _ui_doc()
    if doc is not None:
        doc.activate()
    else:
        doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    if des.userParameters.itemByName('adv_uiapi_fp') is None:
        des.userParameters.add('adv_uiapi_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-ui-vs-api')
    root = des.rootComponent
    made, failed = [], []

    def sk(name):
        s = root.sketches.add(root.xYConstructionPlane); s.name = 'API_' + name; return s

    def attempt(name, fn):
        try:
            fn(sk(name)); made.append(name)
        except Exception as e:
            failed.append('%s: %s' % (name, str(e).splitlines()[0][:90]))

    L = lambda s: s.sketchCurves.sketchLines
    A = lambda s: s.sketchCurves.sketchArcs
    C = lambda s: s.sketchCurves.sketchCircles
    attempt('rect_2point', lambda s: L(s).addTwoPointRectangle(P(0, 0), P(3, 2)))
    attempt('rect_3point', lambda s: L(s).addThreePointRectangle(P(0, 0), P(3, 1), P(2.5, 2.5)))
    attempt('rect_center', lambda s: L(s).addCenterPointRectangle(P(0, 0), P(1.5, 1)))
    attempt('arc_3point', lambda s: A(s).addByThreePoints(P(0, 0), P(1, 1), P(2, 0)))
    attempt('arc_center', lambda s: A(s).addByCenterStartSweep(P(0, 0), P(1, 0), math.radians(90)))
    attempt('arc_center_start_end', lambda s: A(s).addByCenterStartEnd(P(0, 0), P(1, 0), P(0, 1)))
    def tangent_arc(s):
        ln = L(s).addByTwoPoints(P(0, 0), P(2, 0))
        A(s).addFillet  # exists; a true "tangent arc" tool has no direct API -- emulate the UI result:
        a = A(s).addByThreePoints(ln.endSketchPoint.geometry, P(3, 1), P(2, 2))
        s.geometricConstraints.addCoincident(ln.endSketchPoint, a.startSketchPoint if a.startSketchPoint.geometry.isEqualTo(ln.endSketchPoint.geometry) else a.endSketchPoint)
        s.geometricConstraints.addTangent(ln, a)
    attempt('arc_tangent_emulated', tangent_arc)
    def midpoint(s):
        ln = L(s).addByTwoPoints(P(0, 0), P(3, 1))
        p = s.sketchPoints.add(P(1.4, 0.6))
        s.geometricConstraints.addMidPoint(p, ln)
    attempt('constraint_midpoint', midpoint)
    def midpoint_line_end(s):
        ln = L(s).addByTwoPoints(P(0, 0), P(3, 1))
        l2 = L(s).addByTwoPoints(P(1.4, 0.6), P(1.4, 2))
        s.geometricConstraints.addMidPoint(l2.startSketchPoint, ln)
    attempt('constraint_midpoint_line_end', midpoint_line_end)
    attempt('circle_center', lambda s: C(s).addByCenterRadius(P(0, 0), 1 * CM))
    attempt('circle_2point', lambda s: C(s).addByTwoPoints(P(0, 0), P(2, 0)))
    attempt('circle_3point', lambda s: C(s).addByThreePoints(P(0, 0), P(1, 1), P(2, 0)))
    def fillet(s):
        a = L(s).addByTwoPoints(P(0, 0), P(2, 0)); b = L(s).addByTwoPoints(P(0, 0), P(0, 2))
        s.geometricConstraints.addCoincident(a.startSketchPoint, b.startSketchPoint)
        A(s).addFillet(a, P(1, 0), b, P(0, 1), 0.3 * CM)
    attempt('fillet', fillet)
    # Slots live on the Sketch itself (probe_api, 2026-10-02); width 0.5 in, NO auto width dimension (the UI tool
    # only adds one when a value is typed), so both sides are compared constraint-for-constraint.
    W = lambda: adsk.core.ValueInput.createByReal(0.5 * CM)
    attempt('slot_center_to_center', lambda s: s.addCenterToCenterSlot(P(-1.25, 0), P(1.25, 0), W(), False))
    attempt('slot_overall', lambda s: s.addOverallSlot(P(-1.5, 0), P(1.5, 0), W(), False))
    attempt('slot_center_point', lambda s: s.addCenterPointSlot(P(0, 0), P(1.5, 0), W(), False))
    attempt('slot_3point_arc', lambda s: s.addThreePointArcSlot(P(-1.5, -1), P(1.5, -1), P(0, -0.5), W(), False))
    attempt('slot_center_point_arc', lambda s: s.addCenterPointArcSlot(P(0, 0), P(0, -1), P(1, 0), W()))
    # Polygons: 6 sides, ~2 in across, like the UI ones
    attempt('polygon_circumscribed', lambda s: L(s).addScribedPolygon(P(0, 0), 6, 0, 1 * CM, False))
    attempt('polygon_inscribed', lambda s: L(s).addScribedPolygon(P(0, 0), 6, 0, 1 * CM, True))
    attempt('polygon_edge', lambda s: L(s).addEdgePolygon(P(-0.5, 0), P(0.5, 0), False, 6))
    print('built:', made); print('failed:', failed)
    return doc


def probe_api():
    des = adsk.fusion.Design.cast(app.activeProduct)
    s = des.rootComponent.sketches.add(des.rootComponent.xYConstructionPlane); s.name = 'tmp_probe_api'
    for label, obj in (('sketchLines', s.sketchCurves.sketchLines), ('sketchArcs', s.sketchCurves.sketchArcs),
                       ('sketchCircles', s.sketchCurves.sketchCircles), ('sketchCurves', s.sketchCurves),
                       ('geometricConstraints', s.geometricConstraints), ('sketch', s)):
        names = [n for n in dir(obj) if n.startswith('add') or 'slot' in n.lower() or 'polygon' in n.lower() or 'rectangle' in n.lower()]
        print(label, ':', names)
    s.deleteMe()


def read():
    des = adsk.fusion.Design.cast(app.activeProduct)
    comps = [des.rootComponent] + [des.rootComponent.occurrences.item(i).component for i in range(des.rootComponent.occurrences.count)]
    inv = {}
    for c in comps:
        for i in range(c.sketches.count):
            s = c.sketches.item(i)
            if s.name.startswith(('API_', 'UI_')):
                inv[s.name] = inventory(s)
    tools = sorted(set(n.split('_', 1)[1] for n in inv))
    for t in tools:
        a, u = inv.get('API_' + t), inv.get('UI_' + t)
        print('=== %s' % t)
        for side, d in (('API', a), ('UI ', u)):
            if d is None:
                print('  %s: (no sketch)' % side); continue
            print('  %s curves=%s dims=%s fully=%s' % (side, d['curves'], d['dims'], d['fully_constrained']))
            print('      constraints: %s' % ', '.join(d['constraint_types']))
        if a and u:
            only_ui = sorted(set(u['constraint_types']) - set(a['constraint_types']))
            only_api = sorted(set(a['constraint_types']) - set(u['constraint_types']))
            print('  DIFF: UI-only %s | API-only %s | curves same=%s' % (only_ui, only_api, a['curves'] == u['curves']))
    if OUT:
        with open(OUT, 'w') as fh:
            json.dump(inv, fh, indent=1)


try:
    {'build': build, 'read': read, 'probe_api': probe_api}[MODE]()
except Exception:
    print(traceback.format_exc())
