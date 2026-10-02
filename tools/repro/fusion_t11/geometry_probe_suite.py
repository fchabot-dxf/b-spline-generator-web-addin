# Fusion geometry probe suite (advisor, 2026-10-02, Fred: "continue testing commands for geometry, using likely
# geometry, other arc commands, constraints, and compare expected result").
# Run inside Fusion via fusion_execute:  REPO = r'<checkout>'; TESTS = ['A1', ...];
#   PTS9 / PTS7 = json.load of tools/repro/fusion_t11/t11_probe_points.py output (9 12 0.25 / 7 9 0.25)
#   exec(open(REPO + r'	ools
eprousion_t11\geometry_probe_suite.py').read())
# Results of the first run (2026-10-02) are recorded in the fusion360-quirks skill.
# Every test builds in its OWN new sketch of ONE fingerprinted scratch doc (user param adv_geo_fp), compares what
# Fusion produced to a closed-form expectation, and appends rows {test, check, expected, actual, ok} to RESULTS_FILE.
import os, sys, math, json, types, traceback
import adsk.core, adsk.fusion

CM = 2.54
TOL = 1e-4  # inches
RESULTS_FILE = os.path.join(REPO, 'bspline-frame-builder', 'scratch', 'geo_probe_results.jsonl')  # gitignored scratch

HOLD = sys.modules.get('__adv_geo')
if HOLD is None:
    HOLD = types.ModuleType('__adv_geo'); HOLD.doc = None; sys.modules['__adv_geo'] = HOLD


def get_doc():
    if HOLD.doc is not None:
        try:
            HOLD.doc.name
            HOLD.doc.activate()
            return HOLD.doc
        except Exception:
            HOLD.doc = None
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = doc.products.itemByProductType('DesignProductType')
    des.userParameters.add('adv_geo_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-geo-probe-2026-10-02')
    HOLD.doc = doc
    return doc


def new_sketch(name):
    des = get_doc().products.itemByProductType('DesignProductType')
    root = des.rootComponent
    sk = root.sketches.add(root.xYConstructionPlane)
    sk.name = name
    return sk


def P(x, y):
    return adsk.core.Point3D.create(x * CM, y * CM, 0)


def xy(p):  # SketchPoint or Point3D -> inches
    g = p.geometry if hasattr(p, 'geometry') else p
    return (g.x / CM, g.y / CM)


def arc_info(a):
    g = a.geometry
    return {'c': (g.center.x / CM, g.center.y / CM), 'r': g.radius / CM,
            's': xy(a.startSketchPoint), 'e': xy(a.endSketchPoint),
            'sweep': math.degrees(g.endAngle - g.startAngle)}


def near(a, b, tol=TOL):
    if isinstance(a, str) or isinstance(b, str) or a is None or b is None:
        return a == b
    if isinstance(a, (tuple, list)):
        return all(abs(p - q) <= tol for p, q in zip(a, b))
    return abs(a - b) <= tol


ROWS = []


def row(test, check, expected, actual, ok=None, tol=TOL):
    if ok is None:
        ok = near(expected, actual, tol)
    rn = lambda x: round(x, 5) if isinstance(x, float) else x
    r = lambda v: [rn(x) for x in v] if isinstance(v, (tuple, list)) else rn(v)
    ROWS.append({'test': test, 'check': check, 'expected': r(expected), 'actual': r(actual), 'ok': bool(ok)})


# ---------------------------------------------------------------------------------------------------------------
# A. arc-creation commands
# ---------------------------------------------------------------------------------------------------------------
def A1():
    """addByCenterStartSweep: +90 and -90 deg from (1,0) about the origin. CCW rule => -90 stores start at (0,-1)."""
    sk = new_sketch('A1_center_start_sweep')
    arcs = sk.sketchCurves.sketchArcs
    a = arc_info(arcs.addByCenterStartSweep(P(0, 0), P(1, 0), math.radians(90)))
    row('A1', '+90: start', (1, 0), a['s']); row('A1', '+90: end', (0, 1), a['e']); row('A1', '+90: sweep', 90.0, a['sweep'])
    b = arc_info(arcs.addByCenterStartSweep(P(3, 0), P(4, 0), math.radians(-90)))
    row('A1', '-90: start (CCW rule says the far end)', (3, -1), b['s']); row('A1', '-90: end', (4, 0), b['e'])
    row('A1', '-90: stored sweep (always +)', 90.0, b['sweep'])


def A2():
    """addByCenterStartEnd: (1,0)->(0,1) should be the 90-deg minor arc; reversed (0,1)->(1,0) runs CCW => 270."""
    sk = new_sketch('A2_center_start_end')
    arcs = sk.sketchCurves.sketchArcs
    a = arc_info(arcs.addByCenterStartEnd(P(0, 0), P(1, 0), P(0, 1)))
    row('A2', 'start->end CCW: sweep', 90.0, a['sweep'])
    b = arc_info(arcs.addByCenterStartEnd(P(3, 0), P(3, 1), P(4, 0)))
    row('A2', 'reversed order: sweep (CCW from start => major)', 270.0, b['sweep'])
    row('A2', 'reversed order: start kept', (3, 1), b['s'])


def A3():
    """addByThreePoints honours a near-semicircle: 179 deg and 181 deg sweeps on the unit circle, via at the midpoint."""
    sk = new_sketch('A3_three_point_semicircle')
    arcs = sk.sketchCurves.sketchArcs
    for k, sweep in enumerate((179.0, 181.0)):
        ox = 3 * k
        a0, a1 = math.radians(-sweep / 2), math.radians(sweep / 2)
        p0 = (ox + math.cos(a0), math.sin(a0)); p1 = (ox + math.cos(a1), math.sin(a1)); m = (ox + 1.0, 0.0)
        a = arc_info(arcs.addByThreePoints(P(*p0), P(*m), P(*p1)))
        row('A3', '%g deg: sweep' % sweep, sweep, a['sweep'], tol=1e-3)
        row('A3', '%g deg: radius' % sweep, 1.0, a['r'])


def A4():
    """addFillet: a 90-deg corner and the T11-eave-like 45-deg roof meeting a vertical, radius 0.3.
    Expected: arc of radius 0.3 tangent to both lines, lines trimmed to the tangent points."""
    sk = new_sketch('A4_fillet')
    lines, arcs, gc = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints
    r = 0.3
    # 90-deg corner at (0,0): legs along +x and +y
    l1 = lines.addByTwoPoints(P(0, 0), P(2, 0)); l2 = lines.addByTwoPoints(P(0, 0), P(0, 2))
    gc.addCoincident(l1.startSketchPoint, l2.startSketchPoint)
    n0 = gc.count
    f = arcs.addFillet(l1, P(1, 0), l2, P(0, 1), r * CM)
    a = arc_info(f)
    row('A4', '90: radius', r, a['r']); row('A4', '90: centre', (r, r), a['c'])
    ends = sorted([xy(l1.startSketchPoint), xy(l1.endSketchPoint)]) + sorted([xy(l2.startSketchPoint), xy(l2.endSketchPoint)])
    row('A4', '90: leg x trimmed to (r,0)', (r, 0), ends[0]); row('A4', '90: leg y trimmed to (0,r)', (0, r), ends[2])
    added = [type(gc.item(i)).__name__.replace('Constraint', '') for i in range(n0, gc.count)]
    row('A4', '90: constraints addFillet added (report)', 'Tangent x2', '%d: %s' % (len(added), ','.join(sorted(added))), ok=True)
    # 135-deg interior corner: roof going down-right at 45 deg meets a vertical going down (T11 eave shape)
    E = (5.0, 0.0)
    roof = lines.addByTwoPoints(P(E[0] - 1.5, E[1] + 1.5), P(*E)); side = lines.addByTwoPoints(P(*E), P(E[0], E[1] - 2))
    gc.addCoincident(roof.endSketchPoint, side.startSketchPoint)
    f2 = arcs.addFillet(roof, P(E[0] - 0.5, E[1] + 0.5), side, P(E[0], E[1] - 0.5), r * CM)
    b = arc_info(f2)
    # interior angle 135 => centre sits on the bisector at r/sin(67.5) from E, toward the inside (left/down)
    d = r / math.sin(math.radians(67.5)); bis = (-math.cos(math.radians(22.5)), -math.sin(math.radians(22.5)))  # unit((-1,1)/sqrt2 + (0,-1))
    row('A4', '135: radius', r, b['r']); row('A4', '135: centre on inner bisector', (E[0] + d * bis[0], E[1] + d * bis[1]), b['c'])
    row('A4', '135: sweep = 180 - 135', 45.0, b['sweep'], tol=1e-3)


# ---------------------------------------------------------------------------------------------------------------
# B. constraints on likely geometry
# ---------------------------------------------------------------------------------------------------------------
def B1():
    """Tangent picks the S-curve (EXTERNAL) side for a concave arc continuing a convex one?
    arc1: centre (0,0) r=1, 0..60 deg, fully fixed. arc2 starts at arc1's end P, intended centre P + 1.5*u (external,
    |c1c2| = 2.5). Seed arc2 (a) exact, (b) via perturbed 10% toward the INTERNAL side; far end free, then fixed."""
    for variant, perturb, fix_far in (('exact/free', 0.0, False), ('2pct/free', 0.02, False), ('5pct/free', 0.05, False), ('2pct/far-fixed', 0.02, True), ('5pct/far-fixed', 0.05, True)):
        sk = new_sketch('B1_tangent_side_' + variant.replace('/', '_'))
        arcs, gc = sk.sketchCurves.sketchArcs, sk.geometricConstraints
        a1 = arcs.addByCenterStartSweep(P(0, 0), P(1, 0), math.radians(60))
        for p in (a1.centerSketchPoint, a1.startSketchPoint, a1.endSketchPoint): p.isFixed = True
        Pj = (math.cos(math.radians(60)), math.sin(math.radians(60))); u = Pj
        c2 = (Pj[0] + 1.5 * u[0], Pj[1] + 1.5 * u[1])
        # arc2 goes from Pj, curving the other way, 50 deg around c2
        ang0 = math.atan2(Pj[1] - c2[1], Pj[0] - c2[0])
        far = (c2[0] + 1.5 * math.cos(ang0 - math.radians(50)), c2[1] + 1.5 * math.sin(ang0 - math.radians(50)))
        mid = (c2[0] + 1.5 * math.cos(ang0 - math.radians(25)), c2[1] + 1.5 * math.sin(ang0 - math.radians(25)))
        mid = (mid[0] - perturb * 1.5 * math.cos(ang0 - math.radians(25)), mid[1] - perturb * 1.5 * math.sin(ang0 - math.radians(25)))
        a2 = arcs.addByThreePoints(P(*Pj), P(*mid), P(*far))
        row('B1', variant + ': SEED radius before any constraint (report)', 1.5, arc_info(a2)['r'], ok=True)
        pj2 = min((a2.startSketchPoint, a2.endSketchPoint), key=lambda q: math.hypot(xy(q)[0] - Pj[0], xy(q)[1] - Pj[1]))
        farp = a2.endSketchPoint if pj2 == a2.startSketchPoint else a2.startSketchPoint
        gc.addCoincident(a1.endSketchPoint, pj2)
        if fix_far: farp.isFixed = True
        err = None
        try:
            gc.addTangent(a1, a2)
        except Exception as e:
            err = str(e).splitlines()[0]
        i2 = arc_info(a2)
        dist = math.hypot(i2['c'][0], i2['c'][1])
        row('B1', variant + ': |c1c2| (2.5 = external S-curve, 0.5 = internal)', 2.5, dist, tol=1e-3)
        row('B1', variant + ': arc2 radius (seeded 1.5)', 1.5, i2['r'], tol=1e-3)
        if err: row('B1', variant + ': Tangent error', None, err, ok=False)


def B2():
    """Symmetry about a construction Y line pulls a NOISY left arc onto the exact mirror of a fixed right arc."""
    sk = new_sketch('B2_symmetry')
    lines, arcs, gc = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints
    axis = lines.addByTwoPoints(P(0, -3), P(0, 3)); axis.isConstruction = True
    axis.startSketchPoint.isFixed = True; axis.endSketchPoint.isFixed = True
    c = (2.0, 0.0); r = 1.2
    pts = [(c[0] + r * math.cos(math.radians(t)), c[1] + r * math.sin(math.radians(t))) for t in (100, 160, 220)]
    aR = arcs.addByThreePoints(P(*pts[0]), P(*pts[1]), P(*pts[2]))
    for p in (aR.startSketchPoint, aR.endSketchPoint, aR.centerSketchPoint): p.isFixed = True
    noisy = [(-x + 0.05 * (k - 1), y + 0.04) for k, (x, y) in enumerate(pts)]
    aL = arcs.addByThreePoints(P(*noisy[0]), P(*noisy[1]), P(*noisy[2]))
    err = None
    try:
        gc.addSymmetry(aR, aL, axis)
    except Exception as e:
        err = str(e).splitlines()[0]
    L = arc_info(aL)
    row('B2', 'left centre = mirror', (-c[0], c[1]), L['c']); row('B2', 'left radius', r, L['r'])
    if err: row('B2', 'addSymmetry error', None, err, ok=False)


def _t11_right_chain(sk, pts):
    """The T11 right side, exact recipe: eave straight, shoulder, waist, hip, side straight; welds by position;
    Tangent x4; outer line ends fixed. Returns dict of entities."""
    lines, arcs, gc = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints
    A = pts['arcs']; E, SH, HHp = pts['E'], pts['SH'], pts['HHp']; base = [pts['HW'], -pts['HH']]
    ent = {'eave': lines.addByTwoPoints(P(*E), P(*SH))}
    for k in ('shoulder', 'waist', 'hip'):
        ent[k] = arcs.addByThreePoints(P(*A[k]['p0']), P(*A[k]['mid_exact']), P(*A[k]['p1']))
    ent['side'] = lines.addByTwoPoints(P(*HHp), P(*base))
    order = ['eave', 'shoulder', 'waist', 'hip', 'side']
    def ends(e): return [e.startSketchPoint, e.endSketchPoint]
    for a, b in zip(order, order[1:]):
        pa, pb = min(((p, q) for p in ends(ent[a]) for q in ends(ent[b])), key=lambda pq: math.hypot(xy(pq[0])[0] - xy(pq[1])[0], xy(pq[0])[1] - xy(pq[1])[1]))
        gc.addCoincident(pa, pb)
    ent['eave'].startSketchPoint.isFixed = True; ent['side'].endSketchPoint.isFixed = True
    ent['eave'].endSketchPoint  # horn positions left free: the chain must hold them
    for a, b in zip(order, order[1:]):
        gc.addTangent(ent[a], ent[b])
    return ent


def B3():
    """Drive the exact T11 chain by a dimension: add a radius dim to the waist (= its solved value: must NOT be
    over-constrained), then change it +10% and see what moves; tangency must survive."""
    sk = new_sketch('B3_drive_by_dimension')
    ent = _t11_right_chain(sk, PTS9)
    A = PTS9['arcs']
    before = {k: arc_info(ent[k]) for k in ('shoulder', 'waist', 'hip')}
    for k in before: row('B3', 'baseline %s radius' % k, A[k]['r'], before[k]['r'])
    err = None
    try:
        d = sk.sketchDimensions.addRadialDimension(ent['waist'], P(2, -2))
        row('B3', 'radius dim on a solved chain: value', A['waist']['r'], d.parameter.value / CM)
        d.parameter.value = A['waist']['r'] * 1.1 * CM
    except Exception as e:
        err = str(e).splitlines()[0]
    after = {k: arc_info(ent[k]) for k in ('shoulder', 'waist', 'hip')}
    row('B3', 'after +10%: waist radius', A['waist']['r'] * 1.1, after['waist']['r'], tol=1e-3)
    for k in ('shoulder', 'hip'):
        row('B3', 'after +10%%: %s radius (report: did it move?)' % k, before[k]['r'], after[k]['r'], ok=True)
    # tangency residual at the shoulder/waist joint: centres and joint collinear
    s, w = after['shoulder'], after['waist']
    row('B3', 'after +10%: |cS cW| = rS + rW (external tangency kept)', s['r'] + w['r'], math.hypot(s['c'][0] - w['c'][0], s['c'][1] - w['c'][1]), tol=1e-3)
    if err: row('B3', 'dimension error', None, err, ok=False)


# ---------------------------------------------------------------------------------------------------------------
# C. offsets of the real T11 loop (the T10 enclosure failure class)
# ---------------------------------------------------------------------------------------------------------------
def _t11_loop(sk, pts):
    """The full 13-piece T11 loop, exact recipe (see p02_02/p02_03 on lane-b). Returns the curve list in loop order."""
    lines, arcs, gc = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints
    A = pts['arcs']; HW, HH = pts['HW'], pts['HH']
    peak, E, SH, HHp = pts['peak'], pts['E'], pts['SH'], pts['HHp']
    mx = lambda p: [-p[0], p[1]]
    seq = [lines.addByTwoPoints(P(*peak), P(*E)), lines.addByTwoPoints(P(*E), P(*SH))]
    for k in ('shoulder', 'waist', 'hip'):
        seq.append(arcs.addByThreePoints(P(*A[k]['p0']), P(*A[k]['mid_exact']), P(*A[k]['p1'])))
    seq += [lines.addByTwoPoints(P(*HHp), P(HW, -HH)), lines.addByTwoPoints(P(HW, -HH), P(-HW, -HH)),
            lines.addByTwoPoints(P(-HW, -HH), P(*mx(HHp)))]
    for k in ('hip', 'waist', 'shoulder'):
        seq.append(arcs.addByThreePoints(P(*mx(A[k]['p1'])), P(*mx(A[k]['mid_exact'])), P(*mx(A[k]['p0']))))
    seq += [lines.addByTwoPoints(P(*mx(SH)), P(*mx(E))), lines.addByTwoPoints(P(*mx(E)), P(*peak))]
    def ends(e): return [e.startSketchPoint, e.endSketchPoint]
    for a, b in zip(seq, seq[1:] + seq[:1]):
        pa, pb = min(((p, q) for p in ends(a) for q in ends(b)), key=lambda pq: math.hypot(xy(pq[0])[0] - xy(pq[1])[0], xy(pq[0])[1] - xy(pq[1])[1]))
        gc.addCoincident(pa, pb)
    seq[6].startSketchPoint.isFixed = True; seq[6].endSketchPoint.isFixed = True  # base corners
    for i in (1, 2, 3, 4, 7, 8, 9, 10):  # eave|shoulder|waist|hip|side on each side (line-line pairs are not tangent)
        gc.addTangent(seq[i], seq[i + 1])
    return seq


def _offset_report(test, sk, seq, pts, t, how):
    A = pts['arcs']
    expect = {'shoulder': A['shoulder']['r'] - t, 'waist': A['waist']['r'] + t, 'hip': A['hip']['r'] - t}
    err, kids = None, []
    try:
        if how == 'addOffset2':
            inp = sk.geometricConstraints.createOffsetInput(list(seq), adsk.core.ValueInput.createByString('%g in' % t))
            oc = sk.geometricConstraints.addOffset2(inp)
            kids = [oc.childCurves[i] for i in range(len(oc.childCurves))] if oc else []
            # inward? (the engine's own _ensure_side idea: inner bbox must be smaller)
            span = lambda cs: max(abs(xy(c.startSketchPoint)[0]) for c in cs)
            if kids and span(kids) > span(seq) + 1e-6:
                oc.deleteMe()
                inp = sk.geometricConstraints.createOffsetInput(list(seq), adsk.core.ValueInput.createByString('-%g in' % t))
                oc = sk.geometricConstraints.addOffset2(inp)
                kids = [oc.childCurves[i] for i in range(len(oc.childCurves))]
                row(test, how + ': needed a negative distance for inward', 'positive works', 'negative', ok=True)
        else:
            coll = adsk.core.ObjectCollection.create()
            for c in seq: coll.add(c)
            res = sk.offset(coll, P(0, 0), t * CM)
            kids = [res.item(i) for i in range(res.count)]
    except Exception as e:
        err = str(e).splitlines()[0]
    n_arcs = sum(1 for k in kids if isinstance(k, adsk.fusion.SketchArc))
    row(test, how + ': curve count (13 = topology kept)', 13, len(kids), ok=(len(kids) == 13))
    row(test, how + ': arc count', 6, n_arcs, ok=(n_arcs == 6))
    if err: row(test, how + ': error', None, err, ok=False)
    arcs = [arc_info(k) for k in kids if isinstance(k, adsk.fusion.SketchArc)]
    for name, src in (('shoulder', A['shoulder']), ('waist', A['waist']), ('hip', A['hip'])):
        cands = [a for a in arcs if near(a['c'], tuple(src['centre']), 1e-3)]
        if expect[name] <= 0:
            row(test, '%s %s: r-t <= 0, expected to vanish' % (how, name), 'vanished', 'present r=%.4f' % cands[0]['r'] if cands else 'vanished', ok=not cands)
        elif cands:
            row(test, '%s %s: inner radius (concentric)' % (how, name), expect[name], cands[0]['r'])
        else:
            row(test, '%s %s: concentric inner arc' % (how, name), 'found', 'MISSING', ok=False)


def C1():
    """addOffset2 (the engine's parametric path) inward by the bar width on the exact T11 loop, 9x12 then 7x9
    (7x9: shoulder r=0.715 < t=0.75 -> the inner shoulder arc must vanish = a topology change)."""
    for tag, pts in (('9x12', PTS9), ('7x9', PTS7)):
        sk = new_sketch('C1_addOffset2_' + tag)
        seq = _t11_loop(sk, pts)
        _offset_report('C1 ' + tag, sk, seq, pts, 0.75, 'addOffset2')


def C2():
    """The engine's FALLBACK (non-parametric sketch.offset) on the same loops."""
    for tag, pts in (('9x12', PTS9), ('7x9', PTS7)):
        sk = new_sketch('C2_sketch_offset_' + tag)
        seq = _t11_loop(sk, pts)
        _offset_report('C2 ' + tag, sk, seq, pts, 0.75, 'sketch.offset')


def C3():
    """Does the offset FOLLOW when the source moves? addOffset2 on the 9x12 loop, then drive the waist with a
    radius dim +10%: the inner waist must stay concentric at r+t."""
    sk = new_sketch('C3_offset_follows')
    seq = _t11_loop(sk, PTS9)
    inp = sk.geometricConstraints.createOffsetInput(list(seq), adsk.core.ValueInput.createByString('0.75 in'))
    oc = sk.geometricConstraints.addOffset2(inp)
    kids = [oc.childCurves[i] for i in range(len(oc.childCurves))]
    if max(abs(xy(c.startSketchPoint)[0]) for c in kids) > PTS9['HW'] + 1e-6:
        oc.deleteMe()
        oc = sk.geometricConstraints.addOffset2(sk.geometricConstraints.createOffsetInput(list(seq), adsk.core.ValueInput.createByString('-0.75 in')))
        kids = [oc.childCurves[i] for i in range(len(oc.childCurves))]
    err = None
    try:
        d = sk.sketchDimensions.addRadialDimension(seq[3], P(2, -2))
        d.parameter.value = PTS9['arcs']['waist']['r'] * 1.1 * CM
    except Exception as e:
        err = str(e).splitlines()[0]
    w = arc_info(seq[3])
    inner = [arc_info(k) for k in kids if isinstance(k, adsk.fusion.SketchArc) and near(arc_info(k)['c'], w['c'], 1e-3)]
    row('C3', 'source waist radius after drive', PTS9['arcs']['waist']['r'] * 1.1, w['r'], tol=1e-3)
    row('C3', 'inner waist follows (concentric, r+t)', w['r'] + 0.75, inner[0]['r'] if inner else -1, tol=1e-3)
    if err: row('C3', 'drive error', None, err, ok=False)


# ---------------------------------------------------------------------------------------------------------------
TESTS_ALL = {'A1': A1, 'A2': A2, 'A3': A3, 'A4': A4, 'B1': B1, 'B2': B2, 'B3': B3, 'C1': C1, 'C2': C2, 'C3': C3}
for _name in TESTS:
    try:
        TESTS_ALL[_name]()
    except Exception:
        ROWS.append({'test': _name, 'check': 'CRASH', 'expected': None, 'actual': traceback.format_exc().splitlines()[-1], 'ok': False})
with open(RESULTS_FILE, 'a', encoding='utf-8') as fh:
    for r_ in ROWS:
        fh.write(json.dumps(r_) + '\n')
for r_ in ROWS:
    print('%-4s %-9s %-62s exp=%-24s act=%s' % ('ok' if r_['ok'] else 'FAIL', r_['test'], r_['check'][:62], str(r_['expected'])[:24], str(r_['actual'])[:60]))
