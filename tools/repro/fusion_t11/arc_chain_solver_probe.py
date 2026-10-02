# Fusion geometry-injection harness (advisor, 2026-10-01). Run INSIDE Fusion through fusion_execute:
#   REPO = r'<this checkout>'; exec(open(REPO + r'\tools\repro\fusion_t11\<file>').read())
# with the inputs named below set first. Scratch docs are fingerprinted by a user parameter and are closed
# only by their own handle (fusion360-quirks skill, scratch-document hygiene).
# Fusion-side T11 3-arc-chain SOLVER PROBE. Inputs: PTS (json.load of t11_probe_points.py's output) and
# STRATEGY (dict: name, via=exact|hint, radius=none|seed|keep, weld=physical|fusion, nudge, order=[steps]).
# Its findings are in the fusion360-quirks skill (a SketchArc runs CCW start->end; Tangent locks, never solves).
# Builds the full 13-piece T11 loop numerically in ONE NEW SKETCH of the probe's own scratch document
# (held in sys.modules['__adv_t11_probe'].doc, fingerprinted by user parameter adv_probe_fp), applies the
# strategy's constraint recipe, then reads back every arc's radius/centre/endpoints vs expected.
import sys, math, json, types, traceback
import adsk.core, adsk.fusion

HOLD = sys.modules.get('__adv_t11_probe')
if HOLD is None:
    HOLD = types.ModuleType('__adv_t11_probe'); HOLD.doc = None; HOLD.fp = 'adv-t11-probe-2026-10-01'
    sys.modules['__adv_t11_probe'] = HOLD

def get_doc():
    if HOLD.doc is not None:
        try:
            HOLD.doc.name  # still alive?
            return HOLD.doc
        except Exception:
            HOLD.doc = None
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = doc.products.itemByProductType('DesignProductType')
    des.userParameters.add('adv_probe_fp', adsk.core.ValueInput.createByReal(1.0), '', HOLD.fp)
    HOLD.doc = doc
    return doc

def P(x, y):
    return adsk.core.Point3D.create(x * 2.54, y * 2.54, 0)   # inches -> cm

def run_strategy(S, pts):
    doc = get_doc()
    des = doc.products.itemByProductType('DesignProductType')
    root = des.rootComponent
    sk = root.sketches.add(root.xYConstructionPlane)
    sk.name = S['name']
    sk.isComputeDeferred = True
    lines, arcs, gc, dims = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs, sk.geometricConstraints, sk.sketchDimensions
    A = pts['arcs']
    HW, HH = pts['HW'], pts['HH']
    via_key = 'mid_exact' if S.get('via') == 'exact' else 'mid_hint'
    def mx(p): return [-p[0], p[1]]
    ent = {}; decl = {}
    def line(id_, p0, p1):
        ent[id_] = lines.addByTwoPoints(P(*p0), P(*p1)); decl[id_] = (p0, p1)
    def arc(id_, a, mirror=False):
        p0, m, p1 = a['p0'], a[via_key], a['p1']
        if mirror: p0, m, p1 = mx(p1), mx(m), mx(p0)   # left side runs the other way (loop stays clockwise)
        e = arcs.addByThreePoints(P(*p0), P(*m), P(*p1))
        # cross-check start/end identity (quirk: not guaranteed)
        s = e.startSketchPoint.geometry;
        if abs(s.x - p0[0]*2.54) > 1e-6 or abs(s.y - p0[1]*2.54) > 1e-6:
            print('  NOTE: %s start/end swapped by Fusion' % id_)
        ent[id_] = e; decl[id_] = (p0, p1)
    nud = S.get('nudge', 0.001)
    peak, E, SH, SW, WH, HHp, base = pts['peak'], pts['E'], pts['SH'], pts['SW'], pts['WH'], pts['HHp'], pts['base']
    # right side, clockwise from the peak (p02_02_loop.py's own order + nudges)
    line('roof_R', peak, E)
    line('eave_straight_R', E, SH)
    arc('arc_shoulder_R', A['shoulder'])
    arc('arc_waist_R', dict(A['waist'], p0=[SW[0], SW[1] - nud]))
    arc('arc_hip_R', dict(A['hip'], p0=[WH[0], WH[1] - nud]))
    line('side_straight_R', [HHp[0], HHp[1] - nud], [HW, -HH])
    line('bottom_edge', [HW - nud, -HH], [-HW + nud, -HH])
    line('side_straight_L', [-HW + nud, -HH], [-HHp[0], HHp[1] - 2 * nud])
    arc('arc_hip_L', dict(A['hip'], p0=[WH[0], WH[1] - 2 * nud]), mirror=True)       # mirror: p1(HHp) -> start
    arc('arc_waist_L', dict(A['waist'], p0=[SW[0], SW[1] - 2 * nud]), mirror=True)
    arc('arc_shoulder_L', A['shoulder'], mirror=True)
    line('eave_straight_L', mx(SH), mx(E))
    line('roof_L', [-E[0], E[1] + nud], [nud, HH - nud])
    # seed radius dims
    if S.get('radius') in ('seed', 'keep'):
        for k, r in (('arc_shoulder_R', A['shoulder']['r']), ('arc_waist_R', A['waist']['r']), ('arc_hip_R', A['hip']['r']),
                     ('arc_hip_L', A['hip']['r']), ('arc_waist_L', A['waist']['r']), ('arc_shoulder_L', A['shoulder']['r'])):
            d = dims.addRadialDimension(ent[k], P(0, 0))
            d.parameter.value = r * 2.54
            ent['rad_' + k] = d
    # welds (p02_03)
    def SP(k, end):
        s, e = ent[k].startSketchPoint, ent[k].endSketchPoint
        if S.get('weld') != 'physical':
            return s if end == 'S' else e            # the engine's own convention: Fusion's start/end
        want = decl[k][0] if end == 'S' else decl[k][1]   # the DECLARED loop-direction end, matched by position
        d = lambda p: math.hypot(p.geometry.x - want[0] * 2.54, p.geometry.y - want[1] * 2.54)
        return s if d(s) <= d(e) else e
    welds = [('roof_R','S','roof_L','E'), ('roof_R','E','eave_straight_R','S'), ('eave_straight_R','E','arc_shoulder_R','S'),
             ('arc_shoulder_R','E','arc_waist_R','S'), ('arc_waist_R','E','arc_hip_R','S'), ('arc_hip_R','E','side_straight_R','S'),
             ('side_straight_R','E','bottom_edge','S'), ('bottom_edge','E','side_straight_L','S'),
             ('side_straight_L','E','arc_hip_L','S'), ('arc_hip_L','E','arc_waist_L','S'), ('arc_waist_L','E','arc_shoulder_L','S'),
             ('arc_shoulder_L','E','eave_straight_L','S'), ('eave_straight_L','E','roof_L','S')]
    # base corners stand in for the projected bounding-box corners (projected geometry is immovable)
    ent['bottom_edge'].startSketchPoint.isFixed = True
    ent['side_straight_L'].startSketchPoint.isFixed = True
    def do_welds():
        for a, ae, b, be in welds: gc.addCoincident(SP(a, ae), SP(b, be))
    def do_fix(which):
        tgt = {'joints': [('arc_shoulder_R','E'), ('arc_waist_R','S'), ('arc_waist_R','E'), ('arc_hip_R','S'),
                          ('arc_hip_L','E'), ('arc_waist_L','S'), ('arc_waist_L','E'), ('arc_shoulder_L','S')],
               'chain_ends': [('arc_shoulder_R','S'), ('arc_shoulder_R','E'), ('arc_waist_R','S'), ('arc_waist_R','E'), ('arc_hip_R','S'), ('arc_hip_R','E'),
                              ('arc_hip_L','S'), ('arc_hip_L','E'), ('arc_waist_L','S'), ('arc_waist_L','E'), ('arc_shoulder_L','S'), ('arc_shoulder_L','E')],
               'all_lines': [('roof_R','S'), ('roof_R','E'), ('eave_straight_R','E'), ('side_straight_R','S'),
                             ('side_straight_L','E'), ('eave_straight_L','S'), ('eave_straight_L','E')]}
        for k, e in sum((tgt[w] for w in which), []): SP(k, e).isFixed = True
    def do_tangent():
        for a, b in [('eave_straight_R','arc_shoulder_R'), ('arc_shoulder_R','arc_waist_R'), ('arc_waist_R','arc_hip_R'), ('arc_hip_R','side_straight_R'),
                     ('side_straight_L','arc_hip_L'), ('arc_hip_L','arc_waist_L'), ('arc_waist_L','arc_shoulder_L'), ('arc_shoulder_L','eave_straight_L')]:
            gc.addTangent(ent[a], ent[b])
    def do_del_radius():
        for k in list(ent):
            if k.startswith('rad_'): ent[k].deleteMe(); del ent[k]
    def do_centres():
        cps = sk.sketchPoints
        for k, a, mir in (('arc_shoulder_R', A['shoulder'], False), ('arc_waist_R', A['waist'], False), ('arc_hip_R', A['hip'], False),
                          ('arc_hip_L', A['hip'], True), ('arc_waist_L', A['waist'], True), ('arc_shoulder_L', A['shoulder'], True)):
            c = mx(a['centre']) if mir else a['centre']
            cp = cps.add(P(*c)); cp.isFixed = True
            gc.addCoincident(ent[k].centerSketchPoint, cp)
    steps = {'welds': do_welds, 'tangent': do_tangent, 'del_radius': do_del_radius, 'centres': do_centres,
             'fix_joints': lambda: do_fix(['joints']), 'fix_chain_ends': lambda: do_fix(['chain_ends']),
             'fix_all': lambda: do_fix(['chain_ends', 'all_lines'])}
    err = None
    for st in S['order']:
        try:
            steps[st]()
        except Exception as e:
            err = '%s: %s' % (st, str(e).splitlines()[0]); print('  STEP FAIL', err); break
    sk.isComputeDeferred = False
    # read back
    exp = {'arc_shoulder_R': A['shoulder'], 'arc_waist_R': A['waist'], 'arc_hip_R': A['hip'],
           'arc_hip_L': A['hip'], 'arc_waist_L': A['waist'], 'arc_shoulder_L': A['shoulder']}
    rows = []; worst_r = 0; worst_c = 0
    for k, a in exp.items():
        e = ent[k]; g = e.geometry; c = g.center; r = g.radius / 2.54
        cx, cy = c.x / 2.54, c.y / 2.54
        ex = a['centre'] if k.endswith('_R') else mx(a['centre'])
        dr = r - a['r']; dc = math.hypot(cx - ex[0], cy - ex[1])
        sweep = math.degrees(abs(g.endAngle - g.startAngle))
        worst_r = max(worst_r, abs(dr)); worst_c = max(worst_c, dc)
        rows.append('  %-15s r=%.4f (exp %.4f, d=%+.4f) centre d=%.4f sweep=%.1f (exp %.1f)' % (k, r, a['r'], dr, dc, sweep, a['sweep_deg']))
    print('STRATEGY %s  order=%s via=%s radius=%s weld=%s nudge=%s' % (S['name'], '>'.join(S['order']), S.get('via', 'hint'), S.get('radius', 'none'), S.get('weld', 'fusion'), S.get('nudge', 0.001)))
    print('\n'.join(rows))
    print('  RESULT: worst |dr|=%.4f  worst centre drift=%.4f  err=%s  profiles=%d' % (worst_r, worst_c, err, sk.profiles.count))
    return worst_r, worst_c, err

try:
    run_strategy(STRATEGY, PTS)
except Exception:
    print(traceback.format_exc())
