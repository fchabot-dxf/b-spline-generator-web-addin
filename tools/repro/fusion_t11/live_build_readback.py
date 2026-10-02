# Fusion geometry-injection harness (advisor, 2026-10-01). Run INSIDE Fusion through fusion_execute:
#   REPO = r'<this checkout>'; exec(open(REPO + r'\tools\repro\fusion_t11\<file>').read())
# with the inputs named below set first. Scratch docs are fingerprinted by a user parameter and are closed
# only by their own handle (fusion360-quirks skill, scratch-document hygiene).
# Live T11 build through the REAL engine (FrameBuilder.run_sketch_only) from THIS checkout (REPO), inside
# one fusion_execute call: swap sys.path/sys.modules to the worktree, build in a fresh fingerprinted doc,
# read back sketch 2's six arcs against t11_outline, then restore the deployed modules in `finally`.
# Inputs: REPO (checkout path), W, H (board inches), TAG (doc fingerprint suffix).
import sys, os, math, json, time, traceback, types
import adsk.core, adsk.fusion
FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
OUT = os.path.join(REPO, "bspline-frame-builder", "scratch")  # engine log + readback summary (gitignored scratch)
HOLD = sys.modules.get('__adv_t11_live')
if HOLD is None:
    HOLD = types.ModuleType('__adv_t11_live'); HOLD.docs = {}; sys.modules['__adv_t11_live'] = HOLD
# close any EMPTY orphan probe doc from an earlier failed run (fingerprinted, no geometry) before starting
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_t11_live_fp')
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0: _d.close(False)

class Shim:
    def __init__(self): self.lines = []
    def log(self, msg, level='INFO'): self.lines.append('[%s] %s' % (level, msg))
    def log_error(self, msg): self.lines.append('[ERROR] %s' % msg)
    def session_start(self, title): self.lines.append('=== %s' % title)

mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
log = Shim(); out = []
try:
    for m in list(saved_mods): del sys.modules[m]
    sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(os.path.dirname(FB)))  # fb_shared lives beside frame-builder
    import fb_engine.frame_engine as fe
    from fb_engine.t11_geometry import t11_outline
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_t11_live_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-t11-live-' + TAG)
    out.append('doc=%s active=%s product=%s units=%s params=%s' % (doc.name, app.activeDocument.name, app.activeProduct.productType, des.unitsManager.defaultLengthUnits, [des.userParameters.item(i).name for i in range(des.userParameters.count)]))
    for name, val in (('widthIn', W), ('heightIn', H)):
        try:
            p = des.userParameters.add(name, adsk.core.ValueInput.createByString('%s in' % val), 'in', 'board size (probe)')
            out.append('param %s = %s' % (name, p.expression))
        except Exception as e:
            out.append('param %s FAILED: %s (val=%r type=%s)' % (name, str(e).splitlines()[0], val, type(val).__name__))
            raise
    HOLD.docs[TAG] = doc
    fb = fe.FrameBuilder(external_logger=log)
    t0 = time.time()
    fb.run_sketch_only(style_id='template_11', ui_data={'widthIn': W, 'heightIn': H})
    out.append('build %.1fs, fit=%s' % (time.time() - t0, fb.fit))
    root = des.rootComponent
    comps = [root.occurrences.item(i).component for i in range(root.occurrences.count)]
    out.append('occurrences: %s' % [c.name for c in comps])
    sk2 = sk3 = None
    for c in comps + [root]:
        for i in range(c.sketches.count):
            s = c.sketches.item(i)
            if '2_shape_outline' in s.name: sk2 = s
            if '3_frame_enclosure' in s.name: sk3 = s
            out.append('sketch %s: lines=%d arcs=%d profiles=%d' % (s.name, s.sketchCurves.sketchLines.count, s.sketchCurves.sketchArcs.count, s.profiles.count))
    bbo = 0.25
    HW, HHf = W / 2 - bbo, H / 2 - bbo
    o = t11_outline(2 * HW, 2 * HHf, 0.75)
    exp = {'shoulder_R': ((o['C_shoulder'][0] - HW, o['C_shoulder'][1] - HHf), o['r_shoulder']),
           'waist_R': ((o['C_waist'][0] - HW, o['C_waist'][1] - HHf), o['r_waist']),
           'hip_R': ((o['C_hip'][0] - HW, o['C_hip'][1] - HHf), o['r_hip'])}
    for k in list(exp): exp[k.replace('_R', '_L')] = ((-exp[k][0][0], exp[k][0][1]), exp[k][1])
    if sk2 is not None:
        arcs = [sk2.sketchCurves.sketchArcs.item(i) for i in range(sk2.sketchCurves.sketchArcs.count)]
        worst = 0.0
        for name, (c, r) in exp.items():
            best = min(arcs, key=lambda a: math.hypot(a.geometry.center.x / 2.54 - c[0], a.geometry.center.y / 2.54 - c[1]))
            g = best.geometry; dc = math.hypot(g.center.x / 2.54 - c[0], g.center.y / 2.54 - c[1]); dr = g.radius / 2.54 - r
            worst = max(worst, dc, abs(dr))
            out.append('  %-11s r=%.4f (exp %.4f, d=%+.4f) centre d=%.4f sweep=%.1f' % (name, g.radius / 2.54, r, dr, dc, math.degrees(abs(g.endAngle - g.startAngle))))
        out.append('  sketch2 WORST deviation %.4f in over %d arcs' % (worst, len(arcs)))
    if sk3 is not None:
        out.append('sketch3 arcs=%d lines=%d profiles=%d' % (sk3.sketchCurves.sketchArcs.count, sk3.sketchCurves.sketchLines.count, sk3.profiles.count))
    # A parametric-offset FALLBACK logs as a WARNING but is a topology change (fusion360-quirks: addOffset2 fails the
    # whole loop when an arc would vanish) -- count it as a failure, it hid a 7x9 defect on the first run.
    errs = [l for l in log.lines if '[ERROR]' in l or 'PARAMETRIC FAIL' in l or 'FALLING BACK' in l
            or ('MITER' in l.upper() and ('FAIL' in l.upper() or 'MISS' in l.upper()))]
    out.append('engine errors/fallbacks/miter misses: %d' % len(errs)); out.extend('  ' + e[:200] for e in errs[:12])
except Exception:
    out.append(traceback.format_exc())
finally:
    for m in mod_keys():
        if m in sys.modules: del sys.modules[m]
    sys.modules.update(saved_mods)
    sys.path[:] = saved_path
    open(OUT + r"\t11_live_%s.log" % TAG, 'w', encoding='utf-8').write('\n'.join(log.lines))
    open(OUT + r"\t11_live_%s.txt" % TAG, 'w', encoding='utf-8').write('\n'.join(out))
print('\n'.join(out)); print('restored %d deployed modules' % len(saved_mods))
