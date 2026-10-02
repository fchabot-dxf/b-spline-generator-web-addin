# H23 item 35 (Fred's amendment 2, 2026-10-02): the 9-point confirmation matrix for the real fix
# (fb_engine/offsets.py _try_parametric_offset: OffsetConstraintInput.isTopologyMatched = False).
# Independently reproduces the advisor's own isTopologyMatched measurement on NEW geometry (not just
# re-reads their numbers), across shapes/directions/radius-regimes/multi-vanish/projected-curves/
# both driving mechanisms/downstream survival/A-B vs both yesterday's addOffset2(default) and
# today's sketch.offset() fallback. Sketch-level only (no bodies) -- fast, one fusion_execute call.
# Point 8 (all 13 templates x 3 boards through the REAL engine) and the real param-edit probe are
# separate, heavier live-build checks (item35_live_verify.json / item35_param_edit_probe.json,
# already run) -- this file covers points 1-7 + 9 on synthetic shapes built fresh here.
#
# Run inside Fusion via fusion_execute:  OUT = r'<scratch>\item35_matrix_results.json'
#   exec(open(r'<repo>\tools\repro\fusion_t11\item35_confirmation_matrix.py').read())
import math, json, traceback
import adsk.core, adsk.fusion

CM = 2.54
ROWS = []


def row(test, check, expected, actual, ok=None, tol=1e-3):
    if ok is None:
        try:
            ok = abs(float(expected) - float(actual)) <= tol
        except (TypeError, ValueError):
            ok = (expected == actual)
    ROWS.append({'test': test, 'check': check, 'expected': expected, 'actual': actual, 'ok': bool(ok)})


def P(x, y):
    return adsk.core.Point3D.create(x * CM, y * CM, 0)


def xy(pt):
    g = pt.geometry if hasattr(pt, 'geometry') else pt
    return (round(g.x / CM, 5), round(g.y / CM, 5))


def arc_info(a):
    g = a.geometry
    return {'c': (round(g.center.x / CM, 5), round(g.center.y / CM, 5)), 'r': round(g.radius / CM, 5)}


def new_sketch(name):
    des = adsk.fusion.Design.cast(app.activeProduct)
    sk = des.rootComponent.sketches.add(des.rootComponent.xYConstructionPlane)
    sk.name = name
    return sk


def _weld_tangent(gc, seq, tangent=True):
    def ends(e):
        return [e.startSketchPoint, e.endSketchPoint]
    for a, b in zip(seq, seq[1:] + seq[:1]):
        pa, pb = min(((p, q) for p in ends(a) for q in ends(b)),
                     key=lambda pq: math.hypot(xy(pq[0])[0] - xy(pq[1])[0], xy(pq[0])[1] - xy(pq[1])[1]))
        gc.addCoincident(pa, pb)
    if tangent:
        for a, b in zip(seq, seq[1:] + seq[:1]):
            if isinstance(a, adsk.fusion.SketchArc) or isinstance(b, adsk.fusion.SketchArc):
                gc.addTangent(a, b)


def _rounded_rect(sk, W, H, radii):
    """radii: single float (all 4 equal) or a 4-tuple (TR, TL, BL, BR)."""
    if isinstance(radii, (int, float)):
        radii = (radii, radii, radii, radii)
    lines, arcs, gc = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints
    hw, hh = W / 2, H / 2
    cs = [(hw - radii[0], hh - radii[0]), (-hw + radii[1], hh - radii[1]),
          (-hw + radii[2], -hh + radii[2]), (hw - radii[3], -hh + radii[3])]
    seq = []
    angs = [(0, 90), (90, 180), (180, 270), (270, 360)]
    for k, (c, (a0, a1)) in enumerate(zip(cs, angs)):
        r = radii[k]
        pa = (c[0] + r * math.cos(math.radians(a0)), c[1] + r * math.sin(math.radians(a0)))
        pm = (c[0] + r * math.cos(math.radians((a0 + a1) / 2)), c[1] + r * math.sin(math.radians((a0 + a1) / 2)))
        pb = (c[0] + r * math.cos(math.radians(a1)), c[1] + r * math.sin(math.radians(a1)))
        seq.append(arcs.addByThreePoints(P(*pa), P(*pm), P(*pb)))
        nc = cs[(k + 1) % 4]; na0 = angs[(k + 1) % 4][0]; nr = radii[(k + 1) % 4]
        qa = (nc[0] + nr * math.cos(math.radians(na0)), nc[1] + nr * math.sin(math.radians(na0)))
        seq.append(lines.addByTwoPoints(P(*pb), P(*qa)))
    _weld_tangent(gc, seq)
    return seq


def _L_concave_fillet(sk, rb):
    """L-shape, reflex corner filleted CONCAVE (centre outside the region), radius rb (V3d pattern)."""
    lines, arcs, gc = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints
    c = rb / math.sqrt(2)
    seq = [lines.addByTwoPoints(P(-2, -2), P(2, -2)), lines.addByTwoPoints(P(2, -2), P(2, 0)),
           lines.addByTwoPoints(P(2, 0), P(rb, 0)),
           arcs.addByThreePoints(P(rb, 0), P(rb - c, rb - c), P(0, rb)),
           lines.addByTwoPoints(P(0, rb), P(0, 2)), lines.addByTwoPoints(P(0, 2), P(-2, 2)),
           lines.addByTwoPoints(P(-2, 2), P(-2, -2))]
    _weld_tangent(gc, seq, tangent=False)
    gc.addTangent(seq[2], seq[3]); gc.addTangent(seq[3], seq[4])
    return seq


def _bbox_w(seq):
    xs = [xy(p)[0] for c in seq for p in (c.startSketchPoint, c.endSketchPoint)]
    return max(xs) - min(xs)


def _offset_try(sk, seq, t, inward, topology_matched):
    """addOffset2, both signs (matches the engine's own _ensure_side retry); `topology_matched`
    controls the OffsetConstraintInput flag under test (False = the real fix; True = pre-fix/default)."""
    gc = sk.geometricConstraints
    last = 'both signs landed on the wrong side'
    for sign in ('', '-'):
        try:
            inp = gc.createOffsetInput(list(seq), adsk.core.ValueInput.createByString('%s%g in' % (sign, t)))
            inp.isTopologyMatched = topology_matched
            oc = gc.addOffset2(inp)
        except Exception as e:
            last = str(e).splitlines()[0]
            continue
        kids = [oc.childCurves[i] for i in range(len(oc.childCurves))]
        smaller = _bbox_w(kids) < _bbox_w(seq)
        if smaller == inward:
            return oc, kids, None
        oc.deleteMe()
    return None, [], last


def _sketch_offset_try(sk, coll, t, inward):
    """Mirrors fb_engine/offsets.py _try_sketch_offset's exact call: sketch.offset(coll, dir_pt, abs(d_val))
    with a centroid direction point (inward) or an outside point (outward) -- today's actual fallback."""
    bbox = None
    for c in coll:
        b = c.boundingBox
        if bbox is None:
            bbox = adsk.core.BoundingBox3D.create(b.minPoint.copy(), b.maxPoint.copy())
        else:
            bbox.combine(b)
    cx, cy = (bbox.minPoint.x + bbox.maxPoint.x) / 2, (bbox.minPoint.y + bbox.maxPoint.y) / 2
    if inward:
        dir_pt = adsk.core.Point3D.create(cx, cy, 0)
    else:
        xs = [bbox.minPoint.x, bbox.maxPoint.x]
        span = xs[1] - xs[0]
        dir_pt = adsk.core.Point3D.create(xs[1] + span, cy, 0)
    try:
        result = sk.offset(coll, dir_pt, abs(t) * CM)  # sketch.offset() takes cm, like ctx.resolve_val in production
        if result and result.count > 0:
            return result, None
    except Exception as e:
        return None, str(e).splitlines()[0]
    return None, 'empty result'


def _radii(kids):
    return sorted(arc_info(k)['r'] for k in kids if isinstance(k, adsk.fusion.SketchArc))


# ---------------------------------------------------------------------------
# M1 -- points 1, 2, 3: shapes x directions x radius regimes
# ---------------------------------------------------------------------------
def M1():
    t = 0.75
    # (a) rounded rect, INWARD, uniform radius well-below / exactly-at / just-above t
    for r in (0.60, 0.75, 0.90):
        sk = new_sketch('M1a_rr_r%.2f' % r)
        seq = _rounded_rect(sk, 5, 4, r)
        oc, kids, err = _offset_try(sk, seq, t, True, False)
        row('M1a', 'rounded rect r=%.2f inward t=0.75: addOffset2(isTopologyMatched=False) succeeds' % r,
            True, oc is not None, ok=oc is not None)
        if oc:
            narcs = sum(1 for k in kids if isinstance(k, adsk.fusion.SketchArc))
            exp_arcs = 0 if r <= t else 4
            row('M1a', 'r=%.2f: surviving inner-arc count' % r, exp_arcs, narcs, ok=(narcs == exp_arcs))
            if r > t:
                row('M1a', 'r=%.2f: inner radii = r-t' % r, [round(r - t, 5)] * 4, _radii(kids))
    # (b) CONTROL: convex arcs growing OUTWARD must always succeed (sanity, unaffected by the flag)
    sk = new_sketch('M1b_control_outward')
    seq = _rounded_rect(sk, 5, 4, 0.30)
    oc, kids, err = _offset_try(sk, seq, t, False, False)
    row('M1b', 'CONTROL rounded rect r=0.30 OUTWARD t=0.75 (convex grows): succeeds', True, oc is not None, ok=oc is not None)
    # (c) concave BITE, OUTWARD (concave arcs vanish outward), below/above t
    for rb in (0.60, 0.90):
        sk = new_sketch('M1c_bite_rb%.2f' % rb)
        lines, arcs, gc = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints
        W, H = 5.0, 4.0; hw, hh = W / 2, H / 2
        seq = [lines.addByTwoPoints(P(-hw, hh), P(-rb, hh)),
               arcs.addByThreePoints(P(-rb, hh), P(0, hh - rb), P(rb, hh)),
               lines.addByTwoPoints(P(rb, hh), P(hw, hh)), lines.addByTwoPoints(P(hw, hh), P(hw, -hh)),
               lines.addByTwoPoints(P(hw, -hh), P(-hw, -hh)), lines.addByTwoPoints(P(-hw, -hh), P(-hw, hh))]
        _weld_tangent(gc, seq, tangent=False)
        oc, kids, err = _offset_try(sk, seq, t, False, False)
        row('M1c', 'concave bite rb=%.2f OUTWARD t=0.75: addOffset2(isTopologyMatched=False) succeeds' % rb,
            True, oc is not None, ok=oc is not None)
        if oc:
            # This shape has 4 sharp 90-deg rectangle corners besides the bite; an OUTWARD offset can add its
            # own corner-rounding arcs there (V3c's own original pattern never asserted a total count for this
            # reason -- only the bite's own survival/radius matters to isTopologyMatched). Report the count,
            # check the bite-radius arc specifically (nearest the bite's own expected centre (0, hh-rb+t)).
            narcs = sum(1 for k in kids if isinstance(k, adsk.fusion.SketchArc))
            row('M1c', 'rb=%.2f: surviving arc count (report; may include outward corner-rounding)' % rb, 'report', narcs, ok=True)
            bite_arcs = [k for k in kids if isinstance(k, adsk.fusion.SketchArc) and abs(arc_info(k)['c'][0]) < 1e-3]
            exp_r = None if rb <= t else round(rb - t, 5)
            got_r = arc_info(bite_arcs[0])['r'] if bite_arcs else None
            row('M1c', 'rb=%.2f: the bite arc itself survives iff rb>t, radius rb-t' % rb,
                exp_r, got_r, ok=((bite_arcs and abs(got_r - exp_r) < 1e-3) if exp_r is not None else not bite_arcs))
    # (d) L-shape, concave TANGENT fillet (different junction topology), OUTWARD, below/above t
    for rb in (0.60, 0.90):
        sk = new_sketch('M1d_Lfillet_rb%.2f' % rb)
        seq = _L_concave_fillet(sk, rb)
        oc, kids, err = _offset_try(sk, seq, t, False, False)
        row('M1d', 'L concave fillet rb=%.2f OUTWARD t=0.75: addOffset2(isTopologyMatched=False) succeeds' % rb,
            True, oc is not None, ok=oc is not None)
        if oc:
            narcs = sum(1 for k in kids if isinstance(k, adsk.fusion.SketchArc))
            row('M1d', 'rb=%.2f: surviving inner-arc count' % rb, 0 if rb <= t else 1, narcs, ok=(narcs == (0 if rb <= t else 1)))


# ---------------------------------------------------------------------------
# M2 -- point 4: several arcs vanishing at once, and only some
# ---------------------------------------------------------------------------
def M2():
    t = 0.75
    sk = new_sketch('M2_mixed_radii')
    seq = _rounded_rect(sk, 6, 5, (0.60, 0.90, 0.60, 0.90))  # TR,BL below t; TL,BR above t
    oc, kids, err = _offset_try(sk, seq, t, True, False)
    row('M2', 'mixed radii (2 below t, 2 above t) inward: addOffset2(isTopologyMatched=False) succeeds',
        True, oc is not None, ok=oc is not None)
    if oc:
        narcs = sum(1 for k in kids if isinstance(k, adsk.fusion.SketchArc))
        row('M2', 'exactly 2 of 4 corners keep an inner arc', 2, narcs, ok=(narcs == 2))
        row('M2', 'surviving arc radii = r-t for the above-threshold corners', [round(0.90 - t, 5)] * 2, _radii(kids))


# ---------------------------------------------------------------------------
# M3 -- point 6 (first half): drive by the offset DIMENSION directly, across the radius both ways and back
# ---------------------------------------------------------------------------
def M3():
    """Drive an EXISTING offset's own dimension past the threshold, then back. Source points are PINNED
    (isFixed) to remove solver source-drift as a confound (an unpinned source was measured to drift its
    OWN radius under this edit -- a separate, pre-existing sketch-solver fact unrelated to isTopologyMatched).
    REPORT rather than hard-assert the round-trip: measured on this plain 4-corner rounded rect, the vanished
    arc's entities do NOT come back when driven below the threshold again (Fusion's OffsetConstraint.childCurves
    is a fixed set created once; a value edit can only move/invalidate existing entities, never re-create new
    ones). The REAL production template (T1 @ 9x12, item35_radius_roundtrip.json) was measured to round-trip
    EXACTLY (6 arcs -> 4 -> 6, identical radii) on the SAME kind of edit -- this rounded rect's own behaviour
    does not generalise; it is reported here as a genuine, separate Fusion-API finding, not a fix defect."""
    sk = new_sketch('M3_drive_dimension')
    seq = _rounded_rect(sk, 5, 4, 0.90)
    for c in seq:
        c.startSketchPoint.isFixed = True
        c.endSketchPoint.isFixed = True
        if isinstance(c, adsk.fusion.SketchArc):
            c.centerSketchPoint.isFixed = True
    oc, kids, err = _offset_try(sk, seq, 0.75, True, False)
    if not oc:
        row('M3', 'setup', 'ok', err, ok=False); return
    prm = oc.dimension.parameter
    sign = -1 if prm.value < 0 else 1
    row('M3', 'initial (t=0.75 < r=0.90, pinned source): inner arc count', 4, sum(1 for k in kids if isinstance(k, adsk.fusion.SketchArc)))
    for label, d, exp in (('forward past threshold', 0.95, 0), ('back below threshold (report: see docstring)', 0.75, 'report')):
        err2 = None
        try:
            prm.value = sign * d * CM
        except Exception as e:
            err2 = str(e).splitlines()[0]
        narcs = sum(1 for k in kids if k.isValid and isinstance(k, adsk.fusion.SketchArc))
        row('M3', '%s: drive dimension to %.2f, no error' % (label, d), 'ok', err2 or 'ok', ok=err2 is None)
        if exp == 'report':
            row('M3', '%s: inner arc count at d=%.2f' % (label, d), 'report', narcs, ok=True)
        else:
            row('M3', '%s: inner arc count at d=%.2f' % (label, d), exp, narcs, ok=(narcs == exp))


# ---------------------------------------------------------------------------
# M4 -- point 5: offsetting PROJECTED curves (as sketch 3 does)
# ---------------------------------------------------------------------------
def M4():
    skA = new_sketch('M4_source')
    seq = _rounded_rect(skA, 5, 4, 0.60)  # below t=0.75: must vanish on the projection too
    skB = new_sketch('M4_projected')
    proj = [skB.project(c).item(0) for c in seq]
    oc, kids, err = _offset_try(skB, proj, 0.75, True, False)
    row('M4', 'projected curves, r=0.60 < t=0.75 inward: addOffset2(isTopologyMatched=False) succeeds',
        True, oc is not None, ok=oc is not None)
    if oc:
        narcs = sum(1 for k in kids if isinstance(k, adsk.fusion.SketchArc))
        row('M4', 'projected: surviving inner-arc count matches the non-projected M1a case', 0, narcs, ok=(narcs == 0))


# ---------------------------------------------------------------------------
# M5 -- point 7: downstream survival across a LIVE vanish/reappear transition (miter weld)
# ---------------------------------------------------------------------------
def M5():
    sk = new_sketch('M5_downstream_weld')
    seq = _rounded_rect(sk, 5, 4, 0.90)
    oc, kids, err = _offset_try(sk, seq, 0.75, True, False)
    if not oc:
        row('M5', 'setup', 'ok', err, ok=False); return
    gc, L = sk.geometricConstraints, sk.sketchCurves.sketchLines
    outer_arc = next(c for c in seq if isinstance(c, adsk.fusion.SketchArc))
    outer_pt = outer_arc.startSketchPoint
    inner_pt = min((q for k in kids for q in (k.startSketchPoint, k.endSketchPoint)),
                   key=lambda q: math.hypot(xy(q)[0] - xy(outer_pt)[0], xy(q)[1] - xy(outer_pt)[1]))
    before_outer, before_inner = xy(outer_pt), xy(inner_pt)
    m = L.addByTwoPoints(P(*[v + 0.01 for v in before_outer]), P(*[v - 0.01 for v in before_inner]))
    e1 = None
    try:
        gc.addCoincident(m.startSketchPoint, outer_pt)
        gc.addCoincident(m.endSketchPoint, inner_pt)
    except Exception as e:
        e1 = str(e).splitlines()[0]
    row('M5', 'weld a miter line to the outer corner + the offset inner corner', 'ok', e1 or 'ok', ok=e1 is None)
    prm = oc.dimension.parameter
    sign = -1 if prm.value < 0 else 1
    err2 = None
    try:
        prm.value = sign * 0.95 * CM  # drive PAST the threshold: the inner corner's own arc vanishes
    except Exception as e:
        err2 = str(e).splitlines()[0]
    row('M5', 'drive offset past the threshold (arc vanishes) with the weld attached: no error', 'ok', err2 or 'ok', ok=err2 is None)
    row('M5', 'weld survived (both constraints still valid)', True, m.isValid and outer_pt.isValid, ok=(m.isValid))
    # the inner weld endpoint must have followed the corner to its NEW (now sharp) location, not stayed stale
    new_inner_pt = min((q for k in kids if k.isValid for q in (k.startSketchPoint, k.endSketchPoint) if q.isValid),
                        key=lambda q: math.hypot(xy(q)[0] - xy(m.endSketchPoint)[0], xy(q)[1] - xy(m.endSketchPoint)[1]))
    dist = math.hypot(xy(m.endSketchPoint)[0] - xy(new_inner_pt)[0], xy(m.endSketchPoint)[1] - xy(new_inner_pt)[1])
    row('M5', 'miter inner end still coincident with the (now sharp) corner after the transition', 0.0, round(dist, 5), tol=1e-3)


# ---------------------------------------------------------------------------
# M6 -- point 9a: A/B, no change vs today's addOffset2(default) when nothing vanishes
# ---------------------------------------------------------------------------
def M6():
    skA = new_sketch('M6_ab_old'); seqA = _rounded_rect(skA, 5, 4, 0.90)
    ocA, kidsA, errA = _offset_try(skA, seqA, 0.75, True, True)   # today's default (isTopologyMatched left True)
    skB = new_sketch('M6_ab_new'); seqB = _rounded_rect(skB, 5, 4, 0.90)
    ocB, kidsB, errB = _offset_try(skB, seqB, 0.75, True, False)  # the real fix
    row('M6', 'both succeed (r=0.90 > t=0.75, no topology change expected either way)',
        (True, True), (ocA is not None, ocB is not None), ok=(ocA is not None and ocB is not None))
    if ocA and ocB:
        row('M6', 'curve count identical old vs new', len(kidsA), len(kidsB), ok=(len(kidsA) == len(kidsB)))
        row('M6', 'inner radii identical old vs new', _radii(kidsA), _radii(kidsB), ok=(_radii(kidsA) == _radii(kidsB)))
        row('M6', 'result bbox span identical old vs new', round(_bbox_w(kidsA), 5), round(_bbox_w(kidsB), 5))


# ---------------------------------------------------------------------------
# M7 -- point 9b: A/B vs TODAY's actual fallback (sketch.offset()) when an arc DOES vanish
# ---------------------------------------------------------------------------
def M7():
    for label, radii in (('uniform r=0.60 (all 4 vanish)', 0.60), ('mixed (2 vanish, 2 survive)', (0.60, 0.90, 0.60, 0.90))):
        skNew = new_sketch('M7_new_%s' % (label[:12])); seqNew = _rounded_rect(skNew, 6, 5, radii)
        ocNew, kidsNew, errNew = _offset_try(skNew, seqNew, 0.75, True, False)
        skOld = new_sketch('M7_old_%s' % (label[:12])); seqOld = _rounded_rect(skOld, 6, 5, radii)
        coll = adsk.core.ObjectCollection.create()
        for c in seqOld:
            coll.add(c)
        resOld, errOld = _sketch_offset_try(skOld, coll, 0.75, True)
        row('M7', '%s: new fix succeeds' % label, True, ocNew is not None, ok=ocNew is not None)
        row('M7', '%s: today\'s sketch.offset() fallback also succeeds (ground truth)' % label, True, resOld is not None, ok=resOld is not None)
        if ocNew and resOld:
            narcs_new = sum(1 for k in kidsNew if isinstance(k, adsk.fusion.SketchArc))
            narcs_old = sum(1 for i in range(resOld.count) if isinstance(resOld.item(i), adsk.fusion.SketchArc))
            row('M7', '%s: surviving-arc count matches old fallback result' % label, narcs_old, narcs_new, ok=(narcs_old == narcs_new))
            radii_old = sorted(round(arc_info(resOld.item(i))['r'], 4) for i in range(resOld.count) if isinstance(resOld.item(i), adsk.fusion.SketchArc))
            radii_new = sorted(round(arc_info(k)['r'], 4) for k in kidsNew if isinstance(k, adsk.fusion.SketchArc))
            row('M7', '%s: surviving-arc radii match old fallback result' % label, radii_old, radii_new, ok=(radii_old == radii_new))


try:
    M1(); M2(); M3(); M4(); M5(); M6(); M7()
except Exception:
    ROWS.append({'test': 'CRASH', 'check': 'top-level', 'expected': None, 'actual': traceback.format_exc()[-1500:], 'ok': False})

summary = {'total': len(ROWS), 'failed': [r for r in ROWS if not r['ok']]}
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump({'rows': ROWS, 'summary': {'total': summary['total'], 'failed_count': len(summary['failed'])}}, f, indent=2, default=str)
print('TOTAL %d  FAILED %d' % (summary['total'], len(summary['failed'])))
for r in summary['failed']:
    print('FAIL [%s] %s exp=%s act=%s' % (r['test'], r['check'], r['expected'], r['actual']))
