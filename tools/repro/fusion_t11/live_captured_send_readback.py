# T83 item 2 (T11 live check): run INSIDE Fusion through fusion_execute, exactly like live_build_readback.py.
# Builds Template 11 from a REAL CAPTURED [Send frame] payload (tools/repro/capture_send_payload.mjs's own
# shape-lattice-frame scenario, --template=template_11) -- the app's own randomly-Generated seeds, not
# t11_geometry.py's own defaults -- so the verification is a pure 3-point circumcircle check against each
# arc's own 3 seed points, independent of any template formula.
# Inputs: REPO (checkout path), PAYLOAD_PATH (the captured *.frame.json), W, H (board inches, must match what
# the payload was captured at), TAG (doc fingerprint suffix).
import sys, os, math, json, time, traceback, types
import adsk.core, adsk.fusion
FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
OUT = os.path.join(REPO, "bspline-frame-builder", "scratch")
HOLD = sys.modules.get('__adv_t11_live')
if HOLD is None:
    HOLD = types.ModuleType('__adv_t11_live'); HOLD.docs = {}; sys.modules['__adv_t11_live'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_t11_live_fp')
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0: _d.close(False)

class Shim:
    def __init__(self): self.lines = []
    def log(self, msg, level='INFO'): self.lines.append('[%s] %s' % (level, msg))
    def log_error(self, msg): self.lines.append('[ERROR] %s' % msg)
    def session_start(self, title): self.lines.append('=== %s' % title)

def _circumcircle(p1, p2, p3):
    (ax, ay), (bx, by), (cx, cy) = p1, p2, p3
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    ux = ((ax**2 + ay**2) * (by - cy) + (bx**2 + by**2) * (cy - ay) + (cx**2 + cy**2) * (ay - by)) / d
    uy = ((ax**2 + ay**2) * (cx - bx) + (bx**2 + by**2) * (ax - cx) + (cx**2 + cy**2) * (bx - ax)) / d
    return (ux, uy), math.hypot(ax - ux, ay - uy)

mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
log = Shim(); out = []
try:
    payload = json.load(open(PAYLOAD_PATH, encoding='utf-8'))
    out.append('payload templateId=%s params=%s seeds=%s' % (payload['templateId'], payload['params'], payload['seeds']))
    for m in list(saved_mods): del sys.modules[m]
    sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(os.path.dirname(FB)))
    import fb_engine.frame_engine as fe
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_t11_live_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-t11-live-' + TAG)
    out.append('doc=%s active=%s product=%s units=%s' % (doc.name, app.activeDocument.name, app.activeProduct.productType, des.unitsManager.defaultLengthUnits))
    for name, val in (('widthIn', W), ('heightIn', H)):
        p = des.userParameters.add(name, adsk.core.ValueInput.createByString('%s in' % val), 'in', 'board size (probe)')
        out.append('param %s = %s' % (name, p.expression))
    HOLD.docs[TAG] = doc
    fb = fe.FrameBuilder(external_logger=log)
    ui_data = {'widthIn': W, 'heightIn': H, **payload.get('params', {})}
    t0 = time.time()
    fb.run_sketch_only(style_id='template_11', ui_data=ui_data, seed_geometry=payload['seedGeometry'],
                        panel_lip=payload.get('panelLip') or None)
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
    # Expected circle per arc seed: the circumcircle of its OWN 3 seed points (pure geometry, no template
    # formula -- these are the app's own randomly-Generated seeds, not t11_geometry.py's own defaults).
    arc_ids = ['arc_shoulder_R', 'arc_waist_R', 'arc_hip_R', 'arc_shoulder_L', 'arc_waist_L', 'arc_hip_L']
    exp = {}
    for aid in arc_ids:
        pts = payload['seedGeometry'][aid]['points']
        c, r = _circumcircle(tuple(pts[0]), tuple(pts[1]), tuple(pts[2]))
        exp[aid] = (c, r)
    if sk2 is not None:
        arcs = [sk2.sketchCurves.sketchArcs.item(i) for i in range(sk2.sketchCurves.sketchArcs.count)]
        worst = 0.0
        for name, (c, r) in exp.items():
            best = min(arcs, key=lambda a: math.hypot(a.geometry.center.x / 2.54 - c[0], a.geometry.center.y / 2.54 - c[1]))
            g = best.geometry; dc = math.hypot(g.center.x / 2.54 - c[0], g.center.y / 2.54 - c[1]); dr = g.radius / 2.54 - r
            worst = max(worst, dc, abs(dr))
            out.append('  %-14s r=%.4f (exp %.4f, d=%+.4f) centre d=%.4f sweep=%.1f' % (name, g.radius / 2.54, r, dr, dc, math.degrees(abs(g.endAngle - g.startAngle))))
        out.append('  sketch2 WORST deviation %.4f in over %d arcs (vs the 3-point-seed circumcircle)' % (worst, len(arcs)))
    if sk3 is not None:
        out.append('sketch3 arcs=%d lines=%d profiles=%d' % (sk3.sketchCurves.sketchArcs.count, sk3.sketchCurves.sketchLines.count, sk3.profiles.count))
    # fusion360-quirks: addOffset2 refuses the WHOLE loop (logs INFO, not an error -- H23 item 35
    # correction: sketch.offset() is ALSO parametric, not a lesser fallback) when a convex arc's
    # radius <= the offset distance -- count it explicitly.
    fallback_lines = [l for l in log.lines if 'PARAMETRIC FAIL' in l.upper() or 'OFFSET FALLBACK' in l.upper()]
    errs = [l for l in log.lines if '[ERROR]' in l or ('MITER' in l.upper() and ('FAIL' in l.upper() or 'MISS' in l.upper()))]
    out.append('engine ERRORS: %d' % len(errs)); out.extend('  ' + e[:200] for e in errs[:12])
    out.append('parametric-offset FALLBACKS: %d' % len(fallback_lines)); out.extend('  ' + e[:300] for e in fallback_lines[:5])
except Exception:
    out.append(traceback.format_exc())
finally:
    for m in mod_keys():
        if m in sys.modules: del sys.modules[m]
    sys.modules.update(saved_mods)
    sys.path[:] = saved_path
    open(OUT + r"\t11_captured_%s.log" % TAG, 'w', encoding='utf-8').write('\n'.join(log.lines))
    open(OUT + r"\t11_captured_%s.txt" % TAG, 'w', encoding='utf-8').write('\n'.join(out))
print('\n'.join(out)); print('restored %d deployed modules' % len(saved_mods))
