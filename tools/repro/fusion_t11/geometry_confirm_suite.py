# Confirmation suite (advisor, 2026-10-02, Fred: "any finding we make we need to confirm by making different tests to
# make sure it is not a situational effect"). Each finding from geometry_probe_suite.py is re-tested on DIFFERENT
# geometry: other sketch planes, other shapes, both bulge directions, values straddling the threshold.
# Needs geometry_probe_suite.py's helpers already exec'd in the same call (get_doc, new_sketch, P, xy, arc_info, near,
# row, ROWS). Run: TESTS = [...]; exec(probe suite with TESTS=[]); exec(this file).
import math, json, traceback
import adsk.core, adsk.fusion


def sketch_on(name, plane):
    des = get_doc().products.itemByProductType('DesignProductType')
    root = des.rootComponent
    pl = {'XY': root.xYConstructionPlane, 'XZ': root.xZConstructionPlane, 'YZ': root.yZConstructionPlane}.get(plane)
    if pl is None:  # a rotated plane: XY rotated about the X axis (TILT30 = 30 deg, FLIP180 = facing -Z)
        ang = {'TILT30': '30 deg', 'FLIP180': '180 deg'}[plane]
        inp = root.constructionPlanes.createInput()
        inp.setByAngle(root.xConstructionAxis, adsk.core.ValueInput.createByString(ang), root.xYConstructionPlane)
        pl = root.constructionPlanes.add(inp)
    sk = root.sketches.add(pl)
    sk.name = name
    return sk


def V1():
    """Finding 1 (arc :S/:E always CCW) on 4 sketch planes x 4 triplets (CW/CCW, different quadrants and radii)."""
    triplets = [((0, 0), (1, 1), (2, 0)), ((0, 0), (1, -1), (2, 0)), ((5, 5), (6.5, 3), (5, 1)), ((-2, -1), (-4, -3), (-2, -5))]
    for plane in ('XY', 'XZ', 'YZ', 'TILT30'):
        sk = sketch_on('V1_ccw_' + plane, plane)
        for a, b, c in triplets:
            e = sk.sketchCurves.sketchArcs.addByThreePoints(P(*a), P(*b), P(*c))
            ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0
            exp_start = a if ccw else c
            # read in SKETCH space (the arc's own sketch-space geometry), not model space
            s = e.startSketchPoint.geometry
            row('V1', '%s %s: start (%s)' % (plane, str(a), 'CCW as given' if ccw else 'CW -> swapped'), exp_start, (s.x / CM, s.y / CM))


def _target_arc(base_end, tangent_dir, side, R, sweep_deg):
    """Arc starting at base_end, tangent to tangent_dir there, centre on `side` (+1 left normal, -1 right), radius R."""
    n = (-tangent_dir[1] * side, tangent_dir[0] * side)
    c = (base_end[0] + R * n[0], base_end[1] + R * n[1])
    a0 = math.atan2(base_end[1] - c[1], base_end[0] - c[0])
    turn = math.radians(sweep_deg) * (1 if side > 0 else -1)
    pt = lambda t: (c[0] + R * math.cos(a0 + t * turn), c[1] + R * math.sin(a0 + t * turn))
    return c, pt(0), pt(0.5), pt(1.0)


def V2():
    """Finding 2 (Tangent solves only a pinned arc) on different bases, sides and perturbation directions/sizes."""
    cases = []
    for base in ('line', 'arc'):
        for side, label in ((+1, 'bulge-left'), (-1, 'bulge-right')):
            for pert in (-0.03, 0.03, 0.08):
                cases.append((base, side, label, pert))
    for base, side, label, pert in cases:
        for fix_far in (False, True):
            sk = sketch_on('V2', 'XY')
            arcs, lines, gc = sk.sketchCurves.sketchArcs, sk.sketchCurves.sketchLines, sk.geometricConstraints
            if base == 'line':
                b = lines.addByTwoPoints(P(0, 0), P(2, 0)); end = (2.0, 0.0); tdir = (1.0, 0.0)
                b.startSketchPoint.isFixed = True; b.endSketchPoint.isFixed = True
            else:
                b = arcs.addByCenterStartSweep(P(0, 0), P(1.2, 0), math.radians(70))
                for q in (b.centerSketchPoint, b.startSketchPoint, b.endSketchPoint): q.isFixed = True
                end = (1.2 * math.cos(math.radians(70)), 1.2 * math.sin(math.radians(70))); tdir = (-math.sin(math.radians(70)), math.cos(math.radians(70)))
            R = 0.9
            c, p0, m, p1 = _target_arc(end, tdir, side, R, 60)
            mv = (m[0] + pert * R * (m[0] - c[0]) / R, m[1] + pert * R * (m[1] - c[1]) / R)  # radial push (+ out, - in)
            t = arcs.addByThreePoints(P(*p0), P(*mv), P(*p1))
            seed_r = arc_info(t)['r']
            near_end = min((t.startSketchPoint, t.endSketchPoint), key=lambda q: math.hypot(xy(q)[0] - end[0], xy(q)[1] - end[1]))
            far_end = t.endSketchPoint if near_end == t.startSketchPoint else t.startSketchPoint
            jp = b.endSketchPoint
            gc.addCoincident(jp, near_end)
            if fix_far: far_end.isFixed = True
            err = None
            try:
                gc.addTangent(b, t)
            except Exception as e:
                err = str(e).splitlines()[0]
            got = arc_info(t)['r']
            tag = '%s %s pert%+.0f%% %s (seed r=%.3f)' % (base, label, pert * 100, 'FAR-FIXED' if fix_far else 'far-free', seed_r)
            if fix_far:
                row('V2', tag + ': solves to R', R, got, tol=1e-3)
            else:
                row('V2', tag + ': keeps seed r (finding predicts)', seed_r, got, tol=2e-3)
            if err: row('V2', tag + ': tangent error', None, err, ok=False)


def _rounded_rect(sk, W, H, r):
    lines, arcs, gc = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints
    hw, hh = W / 2, H / 2
    cs = [(hw - r, hh - r), (-hw + r, hh - r), (-hw + r, -hh + r), (hw - r, -hh + r)]  # TR, TL, BL, BR
    seq = []
    angs = [(0, 90), (90, 180), (180, 270), (270, 360)]
    for k, (c, (a0, a1)) in enumerate(zip(cs, angs)):
        pa = (c[0] + r * math.cos(math.radians(a0)), c[1] + r * math.sin(math.radians(a0)))
        pm = (c[0] + r * math.cos(math.radians((a0 + a1) / 2)), c[1] + r * math.sin(math.radians((a0 + a1) / 2)))
        pb = (c[0] + r * math.cos(math.radians(a1)), c[1] + r * math.sin(math.radians(a1)))
        seq.append(arcs.addByThreePoints(P(*pa), P(*pm), P(*pb)))
        nc = cs[(k + 1) % 4]; na0 = angs[(k + 1) % 4][0]
        qa = (nc[0] + r * math.cos(math.radians(na0)), nc[1] + r * math.sin(math.radians(na0)))
        seq.append(lines.addByTwoPoints(P(*pb), P(*qa)))
    _weld_tangent(gc, seq)
    return seq


def _weld_tangent(gc, seq, tangent=True):
    def ends(e): return [e.startSketchPoint, e.endSketchPoint]
    for a, b in zip(seq, seq[1:] + seq[:1]):
        pa, pb = min(((p, q) for p in ends(a) for q in ends(b)), key=lambda pq: math.hypot(xy(pq[0])[0] - xy(pq[1])[0], xy(pq[0])[1] - xy(pq[1])[1]))
        gc.addCoincident(pa, pb)
    if tangent:
        for a, b in zip(seq, seq[1:] + seq[:1]):
            if isinstance(a, adsk.fusion.SketchArc) or isinstance(b, adsk.fusion.SketchArc):
                gc.addTangent(a, b)


def _bbox_w(cs):
    xs = [xy(p)[0] for c in cs for p in (c.startSketchPoint, c.endSketchPoint)]
    return max(xs) - min(xs)


def _offset(sk, seq, t, inward=True):
    """addOffset2 by t, on the requested side (sign found by trying, as the engine's _ensure_side does)."""
    gc = sk.geometricConstraints
    last = 'both signs landed on the wrong side'
    for sign in ('', '-'):
        try:
            oc = gc.addOffset2(gc.createOffsetInput(list(seq), adsk.core.ValueInput.createByString('%s%g in' % (sign, t))))
        except Exception as e:
            last = str(e).splitlines()[0]
            continue
        kids = [oc.childCurves[i] for i in range(len(oc.childCurves))]
        smaller = _bbox_w(kids) < _bbox_w(seq)
        if smaller == inward:
            return oc, kids, None
        oc.deleteMe()
    return None, [], last


def V3():
    """Finding 3 (addOffset2 refuses the whole loop when an arc would vanish) on DIFFERENT shapes:
    (a) rounded rectangle, inward t=0.75, corner r straddling t; (b) control: the same shapes OUTWARD (convex arcs
    grow, must never fail); (c) a concave bite (radius rb) offset OUTWARD, rb straddling t (concave shrinks outward)."""
    t = 0.75
    for r in (0.60, 0.74, 0.75, 0.76, 0.90):
        sk = sketch_on('V3a_rr_r%.2f' % r, 'XY'); seq = _rounded_rect(sk, 5, 4, r)
        oc, kids, err = _offset(sk, seq, t, inward=True)
        expect_ok = r > t
        row('V3', 'rounded rect r=%.2f inward t=0.75: addOffset2 %s' % (r, 'works' if expect_ok else 'refuses'),
            'ok' if expect_ok else 'refused', 'ok (%d curves)' % len(kids) if oc else 'refused: ' + str(err)[:60],
            ok=(oc is not None) == expect_ok)
        if oc and expect_ok:
            radii = sorted(round(arc_info(k)['r'], 5) for k in kids if isinstance(k, adsk.fusion.SketchArc))
            row('V3', 'rounded rect r=%.2f inward: inner radii r-t' % r, [round(r - t, 5)] * 4, radii)
    for r in (0.30, 0.60):
        sk = sketch_on('V3b_rr_out_r%.2f' % r, 'XY'); seq = _rounded_rect(sk, 5, 4, r)
        oc, kids, err = _offset(sk, seq, t, inward=False)
        row('V3', 'CONTROL rounded rect r=%.2f OUTWARD t=0.75 (convex grows)' % r, 'ok', 'ok' if oc else 'refused: ' + str(err)[:60], ok=oc is not None)
    for rb in (0.60, 0.74, 0.76, 0.90):
        sk = sketch_on('V3c_bite_rb%.2f' % rb, 'XY')
        lines, arcs, gc = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints
        W, H = 5.0, 4.0; hw, hh = W / 2, H / 2
        seq = [lines.addByTwoPoints(P(-hw, hh), P(-rb, hh)),
               arcs.addByThreePoints(P(-rb, hh), P(0, hh - rb), P(rb, hh)),  # concave bite, centre (0, hh)
               lines.addByTwoPoints(P(rb, hh), P(hw, hh)), lines.addByTwoPoints(P(hw, hh), P(hw, -hh)),
               lines.addByTwoPoints(P(hw, -hh), P(-hw, -hh)), lines.addByTwoPoints(P(-hw, -hh), P(-hw, hh))]
        _weld_tangent(gc, seq, tangent=False)
        oc, kids, err = _offset(sk, seq, t, inward=False)
        expect_ok = rb > t
        row('V3', 'concave bite rb=%.2f OUTWARD t=0.75: addOffset2 %s' % (rb, 'works' if expect_ok else 'refuses'),
            'ok' if expect_ok else 'refused', 'ok (%d curves)' % len(kids) if oc else 'refused: ' + str(err)[:60],
            ok=(oc is not None) == expect_ok)
        if oc and expect_ok:
            a = [arc_info(k) for k in kids if isinstance(k, adsk.fusion.SketchArc)]
            row('V3', 'bite rb=%.2f outward: offset arc radius rb-t' % rb, rb - t, a[0]['r'] if a else -1)


def V4():
    """Finding 4 (a parametric offset follows later edits) -- and what happens when the edit crosses the threshold:
    rounded rect r=0.90, inward offset 0.75 (ok), then drive the offset distance to 0.85 (still < r), then 0.95 (> r)."""
    sk = sketch_on('V4_offset_drive', 'XY'); seq = _rounded_rect(sk, 5, 4, 0.90)
    oc, kids, err = _offset(sk, seq, 0.75, inward=True)
    if not oc:
        row('V4', 'setup offset', 'ok', err, ok=False); return
    prm = oc.dimension.parameter
    sign = -1 if prm.value < 0 else 1
    for d in (0.85, 0.95):
        e2 = None
        try:
            prm.value = sign * d * CM
        except Exception as e:
            e2 = str(e).splitlines()[0]
        radii = sorted(round(arc_info(k)['r'], 4) for k in kids if k.isValid and isinstance(k, adsk.fusion.SketchArc))
        hs = sk.sketchCurves.count
        if d < 0.90:
            row('V4', 'drive offset to %.2f (< r=0.90): inner radii follow r-d' % d, [round(0.90 - d, 4)] * 4, radii, tol=1e-3)
        else:
            row('V4', 'drive offset to %.2f (> r): what happens (report)' % d, 'error or clamp', 'error: %s | radii now %s | value=%.4f' % (e2, radii, abs(prm.value) / CM), ok=True)


def V3d():
    """Finding 3 for a CONCAVE arc that is TANGENT to its neighbours (V3c's bite met its lines at sharp corners, a
    topology change of its own): an L-shape whose reflex corner is filleted with radius rb (centre outside the region),
    offset OUTWARD by t=0.75 (a concave arc shrinks outward). Prediction: refuses for rb <= t, works with rb-t for rb > t."""
    t = 0.75
    for rb in (0.60, 0.75, 0.76, 0.90, 1.20):
        sk = sketch_on('V3d_L_rb%.2f' % rb, 'XY')
        lines, arcs, gc = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints
        c = rb / math.sqrt(2)
        seq = [lines.addByTwoPoints(P(-2, -2), P(2, -2)), lines.addByTwoPoints(P(2, -2), P(2, 0)),
               lines.addByTwoPoints(P(2, 0), P(rb, 0)),
               arcs.addByThreePoints(P(rb, 0), P(rb - c, rb - c), P(0, rb)),   # concave fillet, centre (rb, rb)
               lines.addByTwoPoints(P(0, rb), P(0, 2)), lines.addByTwoPoints(P(0, 2), P(-2, 2)),
               lines.addByTwoPoints(P(-2, 2), P(-2, -2))]
        _weld_tangent(gc, seq, tangent=False)
        gc.addTangent(seq[2], seq[3]); gc.addTangent(seq[3], seq[4])
        row('V3', 'L fillet rb=%.2f: built as concave (centre outside)' % rb, (rb, rb), arc_info(seq[3])['c'])
        oc, kids, err = _offset(sk, seq, t, inward=False)
        expect_ok = rb > t
        row('V3', 'L concave fillet rb=%.2f OUTWARD t=0.75: addOffset2 %s' % (rb, 'works' if expect_ok else 'refuses'),
            'ok' if expect_ok else 'refused', 'ok (%d curves)' % len(kids) if oc else 'refused: ' + str(err)[:60],
            ok=(oc is not None) == expect_ok)
        if oc and expect_ok:
            a = [arc_info(k) for k in kids if isinstance(k, adsk.fusion.SketchArc)]
            row('V3', 'L rb=%.2f outward: offset fillet radius rb-t, concentric' % rb, (rb - t, rb, rb), (a[0]['r'], a[0]['c'][0], a[0]['c'][1]) if a else (-1, 0, 0))


def V5():
    """Fred: 'test the dimension tool to understand how the clamping works'. Drive dimensions on the exact T11 right
    chain (eave straight | shoulder | waist | hip | side straight, outer ends fixed, Tangent x4) past their feasible
    range, one value at a time, and record what Fusion does: re-solve, refuse (exception + value kept), or silently
    flip an arc onto its long branch (sweep > 180). Each value starts from a fresh chain so failures don't compound."""
    A = V5_PTS['arcs']
    plans = V5_PLANS
    for arc_name, values in plans:
        for v in values:
            sk = sketch_on('V5_%s_%g' % (arc_name, v), 'XY')
            ent = _t11_right_chain(sk, V5_PTS)
            d = sk.sketchDimensions.addRadialDimension(ent[arc_name], P(2, -2))
            err = None
            try:
                d.parameter.value = v * CM
            except Exception as e:
                err = str(e).splitlines()[0]
            info = {k: arc_info(ent[k]) for k in ('shoulder', 'waist', 'hip')}
            kept = abs(d.parameter.value / CM - v) < 1e-6
            got = info[arc_name]['r']
            sweeps = {k: round(abs(i['sweep']), 1) for k, i in info.items()}
            s, w = info['shoulder'], info['waist']
            tang = abs(math.hypot(s['c'][0] - w['c'][0], s['c'][1] - w['c'][1]) - (s['r'] + w['r']))
            verdict = ('REFUSED (exception), dim=%.4f' % (d.parameter.value / CM)) if err else (
                'solved r=%.4f' % got if abs(got - v) < 1e-4 else 'dim says %.4f but arc r=%.4f' % (d.parameter.value / CM, got))
            row('V5', '%s r -> %g' % (arc_name, v), 'report', '%s | sweeps %s | tangency resid %.1e%s' % (
                verdict, sweeps, tang, ' | FLIPPED >180' if max(sweeps.values()) > 180 else ''), ok=True)
            if err: row('V5', '%s r -> %g: error text' % (arc_name, v), 'report', err[:110], ok=True)
    # the offset distance as a dimension: drive past the smallest convex radius (V4 covers the rounded rect)


def V4b():
    """V4's 'silent squash' confirmed on the REAL T11 loop (9x12): addOffset2 inward 0.75 (ok, convex r=0.935), then drive
    the offset distance to 0.90 (< r) and 1.00 (> r)."""
    sk = sketch_on('V4b_t11_offset_drive', 'XY'); seq = _t11_loop(sk, PTS9)
    oc, kids, err = _offset(sk, seq, 0.75, inward=True)
    if not oc:
        row('V4b', 'setup', 'ok', err, ok=False); return
    prm = oc.dimension.parameter; sign = -1 if prm.value < 0 else 1
    for d in (0.90, 1.00):
        e2 = None
        try:
            prm.value = sign * d * CM
        except Exception as e:
            e2 = str(e).splitlines()[0]
        radii = sorted(round(arc_info(k)['r'], 4) for k in kids if k.isValid and isinstance(k, adsk.fusion.SketchArc))
        row('V4b', 'T11 offset driven to %.2f (convex r=0.935): report' % d, 'r-d=%.3f' % (0.935 - d),
            'error: %s | arc radii %s | dim=%.4f' % (e2, radii, abs(prm.value) / CM), ok=True)


def _pin_all(seq):
    for c in seq:
        for q in (c.startSketchPoint, c.endSketchPoint):
            q.isFixed = True
        if isinstance(c, adsk.fusion.SketchArc):
            c.centerSketchPoint.isFixed = True


def V4c():
    """Is V4b's asymmetry the SOURCE moving? Same T11 loop + offset drive, source (a) free (only base corners fixed)
    vs (b) every point pinned. Read the SOURCE radii too."""
    for pinned in (False, True):
        sk = sketch_on('V4c_pinned_%s' % pinned, 'XY'); seq = _t11_loop(sk, PTS9)
        if pinned: _pin_all(seq)
        oc, kids, err = _offset(sk, seq, 0.75, inward=True)
        if not oc:
            row('V4c', 'setup pinned=%s' % pinned, 'ok', err, ok=False); continue
        prm = oc.dimension.parameter; sign = -1 if prm.value < 0 else 1
        prm.value = sign * 0.90 * CM
        src = sorted(round(arc_info(c)['r'], 4) for c in seq if isinstance(c, adsk.fusion.SketchArc))
        inner = sorted(round(arc_info(k)['r'], 4) for k in kids if isinstance(k, adsk.fusion.SketchArc))
        exp_inner = sorted([round(0.935 - 0.9, 4)] * 4 + [round(1.4025 + 0.9, 4)] * 2)
        row('V4c', 'pinned=%s: SOURCE radii unchanged after driving offset to 0.90' % pinned, [0.935] * 4 + [1.4025] * 2, src, tol=1e-3)
        row('V4c', 'pinned=%s: inner radii = r -/+ 0.90' % pinned, exp_inner, inner, tol=1e-3)


def V6():
    """Offset SIGN rule: which sign of addOffset2's distance goes inward, vs the loop's own direction (built CCW vs CW)
    and shape (rounded rect, T11 loop). The engine guesses by trying; is there a rule?"""
    gcs = []
    for shape in ('rect', 't11'):
        for order in ('as-built', 'reversed'):
            sk = sketch_on('V6_%s_%s' % (shape, order), 'XY')
            seq = _rounded_rect(sk, 5, 4, 0.9) if shape == 'rect' else _t11_loop(sk, PTS9)
            # loop direction from the signed area of the endpoints in CURVE ORDER
            pts = [xy(c.startSketchPoint) for c in seq]
            area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2
            curves = list(seq) if order == 'as-built' else list(reversed(seq))
            gc = sk.geometricConstraints
            oc = gc.addOffset2(gc.createOffsetInput(curves, adsk.core.ValueInput.createByString('0.5 in')))
            kids = [oc.childCurves[i] for i in range(len(oc.childCurves))]
            side = 'inward' if _bbox_w(kids) < _bbox_w(seq) else 'outward'
            row('V6', '%s, curve list %s (curve-order area %s): +0.5 goes' % (shape, order, 'CCW' if area > 0 else 'CW'), 'report', side, ok=True)


def V7():
    """Projections: (a) project the 6 T11 arcs into a second XY sketch: same radii/centres? :S/:E same as the source's?
    (b) drive a source radius -> does the projection follow? (c) project onto a 30-deg tilted sketch: what comes back?
    (d) addOffset2 on PROJECTED curves (how sketch 3 works) and does it follow a source change?"""
    des = get_doc().products.itemByProductType('DesignProductType'); root = des.rootComponent
    skA = sketch_on('V7_source', 'XY'); seq = _t11_loop(skA, PTS9)
    arcsA = [c for c in seq if isinstance(c, adsk.fusion.SketchArc)]
    skB = sketch_on('V7_projected', 'XY')
    proj = [skB.project(c).item(0) for c in seq]
    for c, pc in zip(seq, proj):
        if isinstance(c, adsk.fusion.SketchArc):
            a, b = arc_info(c), arc_info(pc)
            row('V7', 'projected arc: centre+radius same', (a['c'][0], a['c'][1], a['r']), (b['c'][0], b['c'][1], b['r']))
            row('V7', 'projected arc: :S same physical point as source :S', a['s'], b['s'])
    row('V7', 'projected curves are linked (isLinked / isReference)', True, all(getattr(pc, 'isReference', False) for pc in proj))
    # (d) offset the projected loop
    gc = skB.geometricConstraints
    oc, kids, err = _offset(skB, proj, 0.75, inward=True)
    row('V7', 'addOffset2 on projected curves', 'ok', 'ok (%d)' % len(kids) if oc else 'refused: ' + str(err)[:60], ok=oc is not None)
    # (b) drive a source arc radius and see if projection + its offset follow
    d = skA.sketchDimensions.addRadialDimension(seq[3], P(2, -2))
    d.parameter.value = PTS9['arcs']['waist']['r'] * 1.1 * CM
    w = arc_info(seq[3]); pw = arc_info(proj[3])
    row('V7', 'source waist driven +10%: projection follows', w['r'], pw['r'], tol=1e-3)
    if oc:
        inner = [arc_info(k) for k in kids if isinstance(k, adsk.fusion.SketchArc) and near(arc_info(k)['c'], pw['c'], 1e-3)]
        row('V7', 'source waist driven +10%: offset of projection follows (r+t)', w['r'] + 0.75, inner[0]['r'] if inner else -1, tol=1e-3)
    # (c) tilted plane
    skT = sketch_on('V7_tilted', 'TILT30')
    res = skT.project(arcsA[0])
    pc = res.item(0)
    kind = type(pc).__name__
    row('V7', 'arc projected onto a 30-deg tilted sketch: entity type (report)', 'report', kind, ok=True)
    if hasattr(pc, 'geometry'):
        g = pc.geometry
        desc = {k: round(getattr(g, k) / CM, 4) for k in ('radius', 'majorRadius', 'minorRadius') if hasattr(g, k)}
        row('V7', 'tilted projection geometry (report; source r=%.4f, cos30*r=%.4f)' % (arc_info(arcsA[0])['r'], arc_info(arcsA[0])['r'] * math.cos(math.radians(30))),
            'report', str(desc), ok=True)


def V6b():
    """V6's sign result re-tested with each shape BUILT the other way round (rect CW, T11 CCW) and a third shape
    (a plain 4-line rectangle, both directions). Prediction if the rule is 'side relative to the build direction':
    the reported side flips with the build direction."""
    def rect_lines(sk, cw):
        L = sk.sketchCurves.sketchLines
        pts = [(-2, -1.5), (2, -1.5), (2, 1.5), (-2, 1.5)]
        if cw: pts = pts[::-1]
        seq = [L.addByTwoPoints(P(*pts[i]), P(*pts[(i + 1) % 4])) for i in range(4)]
        _weld_tangent(sk.geometricConstraints, seq, tangent=False)
        return seq
    def rr_cw(sk):
        seq = _rounded_rect(sk, 5, 4, 0.9)
        return seq  # rounded rect pieces are created CCW; reversing creation is done below by re-creating lines reversed
    cases = []
    for name, build in (('plain rect built CCW', lambda sk: rect_lines(sk, False)), ('plain rect built CW', lambda sk: rect_lines(sk, True))):
        cases.append((name, build))
    for name, build in cases:
        sk = sketch_on('V6b', 'XY'); seq = build(sk)
        gc = sk.geometricConstraints
        oc = gc.addOffset2(gc.createOffsetInput(list(seq), adsk.core.ValueInput.createByString('0.5 in')))
        kids = [oc.childCurves[i] for i in range(len(oc.childCurves))]
        row('V6b', name + ': +0.5 goes', 'report', 'inward' if _bbox_w(kids) < _bbox_w(seq) else 'outward', ok=True)
    # T11 loop mirrored in Y (built CCW instead of CW): same pieces, y negated
    pts_m = json.loads(json.dumps(PTS9))
    def flip(p): return [p[0], -p[1]]
    for k in ('peak', 'E', 'SH', 'SW', 'WH', 'HHp', 'base'): pts_m[k] = flip(pts_m[k])
    pts_m['HH'] = -pts_m['HH']
    for a in pts_m['arcs'].values():
        for k in ('p0', 'p1', 'centre', 'mid_exact', 'mid_hint'): a[k] = flip(a[k])
    sk = sketch_on('V6b_t11_mirrored', 'XY'); seq = _t11_loop(sk, pts_m)
    gc = sk.geometricConstraints
    oc = gc.addOffset2(gc.createOffsetInput(list(seq), adsk.core.ValueInput.createByString('0.5 in')))
    kids = [oc.childCurves[i] for i in range(len(oc.childCurves))]
    row('V6b', 'T11 loop mirrored (built CCW): +0.5 goes', 'report', 'inward' if _bbox_w(kids) < _bbox_w(seq) else 'outward', ok=True)


def V7b():
    """Projection :S/:E on a sketch facing the OTHER way (XY rotated 180 deg about X): the CCW rule is relative to the
    sketch normal, so a projected arc should come back with :S at the source's :E point (in model space)."""
    skA = sketch_on('V7b_source', 'XY')
    arcs = [skA.sketchCurves.sketchArcs.addByThreePoints(P(0, 0), P(1, 1), P(2, 0)),     # CW as built
            skA.sketchCurves.sketchArcs.addByThreePoints(P(3, 0), P(4, -1), P(5, 0))]    # CCW as built
    skF = sketch_on('V7b_flipped', 'FLIP180')
    for a in arcs:
        pc = skF.project(a).item(0)
        sA = a.startSketchPoint.worldGeometry; sP = pc.startSketchPoint.worldGeometry
        same = math.hypot(sA.x - sP.x, sA.y - sP.y) < 1e-6
        row('V7b', 'flipped sketch: projected :S at the source :S (model space)?', 'report', 'same' if same else 'SWAPPED', ok=True)
    skS = sketch_on('V7b_same', 'XY')
    for a in arcs:
        pc = skS.project(a).item(0)
        sA = a.startSketchPoint.worldGeometry; sP = pc.startSketchPoint.worldGeometry
        row('V7b', 'same-facing sketch: projected :S at the source :S?', 'same', 'same' if math.hypot(sA.x - sP.x, sA.y - sP.y) < 1e-6 else 'SWAPPED')


def _try(fn):
    try:
        fn(); return None
    except Exception as e:
        return str(e).splitlines()[0][:110]


def V8():
    """Constraints AFTER an offset and a projection (what sketch 3 does: miter lines welded to projected outer corners
    and to offset inner corners). Source = T11 loop in sketch A (pinned); sketch B projects it and offsets the projection
    inward 0.75. Then: (a) a miter-like line from a projected corner to the matching offset corner, welded both ends;
    (b) drive the offset 0.75 -> 0.60 and the source waist +10%: does the welded line follow both ends?
    (c) a radius dim on an offset child arc (over-constrains?); (d) a dim on a projected arc; (e) Tangent between an
    offset child and a new free arc; (f) delete one offset child: does the OffsetConstraint survive?"""
    skA = sketch_on('V8_source', 'XY'); seq = _t11_loop(skA, PTS9)
    skB = sketch_on('V8_frame', 'XY')
    proj = [skB.project(c).item(0) for c in seq]
    oc, kids, err = _offset(skB, proj, 0.75, inward=True)
    if not oc:
        row('V8', 'setup', 'ok', err, ok=False); return
    gc, L = skB.geometricConstraints, skB.sketchCurves.sketchLines
    # pair: projected eave-straight end (shoulder horn) with the offset child that starts nearest the inner point
    def endpoints(c): return [c.startSketchPoint, c.endSketchPoint]
    outer_pt = min((q for c in proj for q in endpoints(c)), key=lambda q: math.hypot(xy(q)[0] - PTS9['E'][0], xy(q)[1] - PTS9['E'][1]))
    inner_pt = min((q for c in kids for q in endpoints(c)), key=lambda q: math.hypot(xy(q)[0] - xy(outer_pt)[0], xy(q)[1] - xy(outer_pt)[1]))
    m = L.addByTwoPoints(P(*[v + 0.02 for v in xy(outer_pt)]), P(*[v - 0.02 for v in xy(inner_pt)]))
    e1 = _try(lambda: gc.addCoincident(m.startSketchPoint, outer_pt)); e2 = _try(lambda: gc.addCoincident(m.endSketchPoint, inner_pt))
    row('V8', '(a) weld a miter line to a PROJECTED corner', 'ok', e1 or 'ok', ok=e1 is None)
    row('V8', '(a) weld it to an OFFSET corner', 'ok', e2 or 'ok', ok=e2 is None)
    row('V8', '(a) miter line ends on both corners', xy(outer_pt) + xy(inner_pt), xy(m.startSketchPoint) + xy(m.endSketchPoint))
    prm = oc.dimension.parameter; sign = -1 if prm.value < 0 else 1
    e3 = _try(lambda: setattr(prm, 'value', sign * 0.60 * CM))
    row('V8', '(b) drive offset 0.75->0.60: no error', 'ok', e3 or 'ok', ok=e3 is None)
    row('V8', '(b) miter inner end followed the offset corner', xy(inner_pt), xy(m.endSketchPoint))
    d = skA.sketchDimensions.addRadialDimension(seq[3], P(2, -2))
    for c in seq: 
        for q in (c.startSketchPoint, c.endSketchPoint): q.isFixed = False
    e4 = _try(lambda: setattr(d.parameter, 'value', PTS9['arcs']['waist']['r'] * 1.1 * CM))
    row('V8', '(b) drive SOURCE waist +10% (projection + offset + miter downstream): no error', 'ok', e4 or 'ok', ok=e4 is None)
    row('V8', '(b) miter outer end still on the projected corner', xy(outer_pt), xy(m.startSketchPoint))
    row('V8', '(b) miter inner end still on the offset corner', xy(inner_pt), xy(m.endSketchPoint))
    karcs = [k for k in kids if isinstance(k, adsk.fusion.SketchArc)]
    e5 = _try(lambda: skB.sketchDimensions.addRadialDimension(karcs[0], P(1, 1)))
    row('V8', '(c) radius dim on an OFFSET child arc (report)', 'report', e5 or 'accepted (check isDriven)', ok=True)
    parcs = [c for c in proj if isinstance(c, adsk.fusion.SketchArc)]
    dd = [None]
    e6 = _try(lambda: dd.__setitem__(0, skB.sketchDimensions.addRadialDimension(parcs[0], P(1, 1))))
    row('V8', '(d) radius dim on a PROJECTED arc (report)', 'report', e6 or ('accepted, isDriven=%s' % getattr(dd[0], 'isDriven', '?')), ok=True)
    A = skB.sketchCurves.sketchArcs
    k0 = karcs[1]; ki = arc_info(k0)
    fa = A.addByThreePoints(P(ki['e'][0] + 0.3, ki['e'][1] + 0.3), P(ki['e'][0] + 0.6, ki['e'][1] + 0.8), P(ki['e'][0] + 1.0, ki['e'][1] + 0.9))
    e7 = _try(lambda: (gc.addCoincident(fa.startSketchPoint, k0.endSketchPoint), gc.addTangent(k0, fa)))
    row('V8', '(e) Tangent from an offset child to a new free arc', 'ok', e7 or 'ok', ok=e7 is None)
    lines_k = [k for k in kids if isinstance(k, adsk.fusion.SketchLine)]
    e8 = _try(lambda: lines_k[0].deleteMe())
    row('V8', '(f) delete one offset child: OffsetConstraint still valid? (report)', 'report',
        'delete err: %s | constraint valid=%s' % (e8, oc.isValid), ok=True)


def _tag(e, v):
    e.attributes.add('FrameBuilder', 'ID', v)


def _tagof(e):
    try:
        a = e.attributes.itemByName('FrameBuilder', 'ID')
        return a.value if a else None
    except Exception as ex:
        return 'ERR ' + str(ex).splitlines()[0][:40]


def V9():
    """Naming geometry (the engine's FrameBuilder/ID attributes): which operations keep a name, which drop it, and is
    the entityToken (item 24's document check) stable?"""
    skA = sketch_on('V9_source', 'XY'); seq = _t11_loop(skA, PTS9)
    for i, c in enumerate(seq):
        _tag(c, 'piece_%d' % i); _tag(c.startSketchPoint, 'piece_%d:S' % i)
    waist = seq[3]
    tok0 = waist.entityToken
    # (a) survives a re-solve driven by a dimension
    d = skA.sketchDimensions.addRadialDimension(waist, P(2, -2)); d.parameter.value = PTS9['arcs']['waist']['r'] * 1.05 * CM
    row('V9', '(a) arc name after a dimension-driven re-solve', 'piece_3', _tagof(waist))
    row('V9', '(a) start-point name after re-solve', 'piece_3:S', _tagof(waist.startSketchPoint))
    row('V9', '(a) entityToken stable across the re-solve', tok0, waist.entityToken, ok=(tok0 == waist.entityToken))
    # (b) offset children inherit names?
    skB = sketch_on('V9_offset', 'XY'); seqB = _t11_loop(skB, PTS9)
    for i, c in enumerate(seqB): _tag(c, 'src_%d' % i)
    oc, kids, err = _offset(skB, seqB, 0.75, inward=True)
    row('V9', '(b) offset children carry the source name? (report)', 'report', sorted(set(str(_tagof(k)) for k in kids)), ok=True)
    # (c) projected copies inherit names?
    skC = sketch_on('V9_projected', 'XY')
    pc = [skC.project(c).item(0) for c in seq]
    row('V9', '(c) projected copies carry the source name? (report)', 'report', sorted(set(str(_tagof(c)) for c in pc))[:4], ok=True)
    # (d) findAttributes sees every tagged entity (13 curves + 13 start points in sketch A, + sketch B's 13)
    found = des_find = get_doc().products.itemByProductType('DesignProductType').findAttributes('FrameBuilder', 'ID')
    row('V9', '(d) design.findAttributes count', 13 + 13 + 13, len(found))
    # (e) split a tagged line (breakCurve / trim): what happens to the name?
    skE = sketch_on('V9_split', 'XY')
    ln = skE.sketchCurves.sketchLines.addByTwoPoints(P(0, 0), P(4, 0)); _tag(ln, 'long_line')
    cut = skE.sketchCurves.sketchLines.addByTwoPoints(P(2, -1), P(2, 1))
    res = None
    try:
        res = ln.breakCurve(P(2, 0))
        names = [str(_tagof(res.item(i))) for i in range(res.count)]
        row('V9', '(e) breakCurve: names on the pieces (report)', 'report', '%d pieces: %s | original valid=%s' % (res.count, names, ln.isValid), ok=True)
    except Exception as ex:
        row('V9', '(e) breakCurve', 'report', 'error ' + str(ex).splitlines()[0][:80], ok=True)
    ln2 = skE.sketchCurves.sketchLines.addByTwoPoints(P(0, 3), P(4, 3)); _tag(ln2, 'trim_line')
    skE.sketchCurves.sketchLines.addByTwoPoints(P(2, 2), P(2, 4))
    try:
        r2 = ln2.trim(P(3.5, 3))
        names = [str(_tagof(r2.item(i))) for i in range(r2.count)] if r2 else []
        row('V9', '(e) trim one end: names on what is left (report)', 'report', '%d left: %s | original valid=%s' % (len(names), names, ln2.isValid), ok=True)
    except Exception as ex:
        row('V9', '(e) trim', 'report', 'error ' + str(ex).splitlines()[0][:80], ok=True)
    # (f) duplicate sketch and body names
    s1 = sketch_on('dup_name', 'XY'); s2 = sketch_on('dup_name', 'XY')
    row('V9', '(f) two sketches given the same name (report)', 'report', '%s / %s' % (s1.name, s2.name), ok=True)


TESTS_ALL.update({'V9': V9, 'V8': V8, 'V6b': V6b, 'V7b': V7b, 'V4c': V4c, 'V6': V6, 'V7': V7, 'V4b': V4b, 'V1': V1, 'V2': V2, 'V3': V3, 'V3d': V3d, 'V4': V4, 'V5': V5})
for _name in CONFIRM:
    try:
        TESTS_ALL[_name]()
    except Exception:
        ROWS.append({'test': _name, 'check': 'CRASH', 'expected': None, 'actual': traceback.format_exc().splitlines()[-1], 'ok': False})
with open(RESULTS_FILE, 'a', encoding='utf-8') as fh:
    for r_ in ROWS:
        fh.write(json.dumps(r_) + '\n')
for r_ in ROWS:
    print('%-4s %-4s %-74s exp=%-22s act=%s' % ('ok' if r_['ok'] else 'FAIL', r_['test'], r_['check'][:74], str(r_['expected'])[:22], str(r_['actual'])[:70]))
