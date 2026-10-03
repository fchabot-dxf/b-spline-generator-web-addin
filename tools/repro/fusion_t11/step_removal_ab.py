# Step-removal A/B (advisor, 2026-10-02; Fred: "yes test them" -- which building steps are redundant).
# Inside ONE fusion_execute: for template TPL at board W x H, build through the REAL engine (FrameBuilder.run_sketch_only)
# once as BASELINE and once per VARIANT with one kind of step removed from the resolved template, each in its own
# fingerprinted scratch doc; read back every FrameBuilder/ID-tagged curve of sketches 2 and 3 and diff vs baseline.
# Inputs: FB (frame-builder dir of a clean checkout), TPL ('template_1'), W, H, VARIANTS (list of names below).
import sys, os, re, math, json, time, traceback, copy
import adsk.core, adsk.fusion

OUT = os.path.join(os.path.dirname(FB), 'scratch', 'step_removal_results.jsonl')  # gitignored scratch
os.makedirs(os.path.dirname(OUT), exist_ok=True)
CM = 2.54
NUDGE = re.compile(r'\s*[-+]\s*0\.00[12](?![0-9])')


def _strip_nudges(expr):
    if not isinstance(expr, str):
        return expr
    if expr.strip() in ('0.001', '-0.001', '0.002', '-0.002'):
        return '0'
    return NUDGE.sub('', expr)


def _filter(template, variant):
    t = copy.deepcopy(template)
    n_removed = 0
    for sk in t.get('Sketches', []):
        for blk in sk.get('Blocks', []):
            seq = blk.get('BuildSequence')
            if not isinstance(seq, list):
                continue
            keep = []
            for st in seq:
                typ = st.get('Type')
                drop = False
                if variant == 'no_seed_radius':
                    drop = (typ == 'Radius' and str(st.get('Name', '')).startswith('seed_rad')) or \
                           (typ == 'DeleteDimension' and str(st.get('Name', '')).startswith('seed_rad'))
                elif variant == 'no_equal':
                    drop = typ == 'Equal'
                elif variant == 'no_horizontal':
                    drop = typ in ('Horizontal', 'Vertical')
                elif variant == 'no_pulse':
                    drop = typ == 'Pulse'
                elif variant == 'no_nudges' and typ in ('Line', 'Arc3Point') and 'Points' in st:
                    new = [[_strip_nudges(v) for v in p] for p in st['Points']]
                    if new != st['Points']:
                        n_removed += 1
                    st = dict(st, Points=new)
                if drop:
                    n_removed += 1
                else:
                    keep.append(st)
            blk['BuildSequence'] = keep
    return t, n_removed


class Shim:
    def __init__(self): self.lines = []
    def log(self, msg, level='INFO'): self.lines.append('[%s] %s' % (level, msg))
    def log_error(self, msg): self.lines.append('[ERROR] %s' % msg)
    def session_start(self, title): self.lines.append('=== %s' % title)


def _readback(des):
    """{sketch-suffix/ID: signature} for every tagged curve, plus per-sketch profile counts."""
    sig, profiles = {}, {}
    root = des.rootComponent
    comps = [root.occurrences.item(i).component for i in range(root.occurrences.count)]
    for c in comps:
        for i in range(c.sketches.count):
            s = c.sketches.item(i)
            key = s.name.split('_', 1)[-1]  # drop the template prefix
            profiles[key] = s.profiles.count
            for j in range(s.sketchCurves.count):
                cv = s.sketchCurves.item(j)
                a = cv.attributes.itemByName('FrameBuilder', 'ID') if hasattr(cv, 'attributes') else None
                if not a:
                    continue
                g = cv.geometry
                if isinstance(cv, adsk.fusion.SketchArc):
                    v = ('A', g.center.x / CM, g.center.y / CM, g.radius / CM, math.degrees(g.endAngle - g.startAngle))
                elif isinstance(cv, adsk.fusion.SketchLine):
                    p, q = cv.startSketchPoint.geometry, cv.endSketchPoint.geometry
                    pts = sorted([(p.x / CM, p.y / CM), (q.x / CM, q.y / CM)])
                    v = ('L', pts[0][0], pts[0][1], pts[1][0], pts[1][1])
                else:
                    v = (type(cv).__name__,)
                sig['%s/%s' % (key, a.value)] = v
    return sig, profiles


def _build(fe, variant, W, H, TPL):
    log = Shim()
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_ab_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-step-ab')
    for name, val in (('widthIn', W), ('heightIn', H)):
        des.userParameters.add(name, adsk.core.ValueInput.createByString('%s in' % val), 'in', 'board (probe)')
    orig = fe._resolve_template
    removed = [0]
    def patched(style_id, ui_data=None):
        t, prefix = orig(style_id, ui_data)
        if variant != 'baseline':
            t, removed[0] = _filter(t, variant)
        return t, prefix
    fe._resolve_template = patched
    try:
        fb = fe.FrameBuilder(external_logger=log)
        fb.run_sketch_only(style_id=TPL, ui_data={'widthIn': W, 'heightIn': H})
    finally:
        fe._resolve_template = orig
    sig, prof = _readback(des)
    warn = [l for l in log.lines if '[ERROR]' in l or 'PARAMETRIC FAIL' in l or 'FALLING BACK' in l or 'OVER_CONSTRAIN' in l.upper()
            or 'SOLVING_FAILED' in l or ('MITER' in l.upper() and ('FAIL' in l.upper() or 'MISS' in l.upper()))]
    fp = des.userParameters.itemByName('adv_ab_fp')
    if fp and fp.comment == 'adv-step-ab':
        doc.close(False)
    return sig, prof, warn, removed[0]


mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
rows = []
try:
    for m in list(saved_mods): del sys.modules[m]
    sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(os.path.dirname(FB)))
    import fb_engine.frame_engine as fe
    t0 = time.time()
    base_sig, base_prof, base_warn, _ = _build(fe, 'baseline', W, H, TPL)
    rows.append({'tpl': TPL, 'size': '%gx%g' % (W, H), 'variant': 'baseline', 'removed': 0, 'curves': len(base_sig),
                 'profiles': base_prof, 'warnings': len(base_warn), 'warn_sample': [w[:140] for w in base_warn[:3]]})
    for v in VARIANTS:
        sig, prof, warn, n = _build(fe, v, W, H, TPL)
        missing = sorted(set(base_sig) - set(sig)); extra = sorted(set(sig) - set(base_sig))
        dev, worst = 0.0, None
        per = {}
        for k in set(base_sig) & set(sig):
            a, b = base_sig[k], sig[k]
            if a[0] != b[0]:
                d2 = 99.0
            else:
                d2 = max((abs(x - y) for x, y in zip(a[1:], b[1:])), default=0.0)
                if a[0] == 'A': d2 = max(max(abs(x - y) for x, y in zip(a[1:4], b[1:4])), abs(a[4] - b[4]) / 100)
            sk_ = k.split('/')[0]
            if d2 > per.get(sk_, (0, None))[0]: per[sk_] = (round(d2, 5), k.split('/')[1])
        for k in set(base_sig) & set(sig):
            a, b = base_sig[k], sig[k]
            if a[0] != b[0]:
                dev, worst = 99.0, k; continue
            d = max((abs(x - y) for x, y in zip(a[1:], b[1:])), default=0.0)
            if a[0] == 'A':  # sweep in degrees: scale to be comparable (1 deg ~ 0.01 in)
                d = max(max(abs(x - y) for x, y in zip(a[1:4], b[1:4])), abs(a[4] - b[4]) / 100)
            if d > dev:
                dev, worst = d, k
        # name-independent: per sketch, does every curve of the variant match SOME baseline curve (and vice versa)?
        def unmatched(A_, B_):
            worst_ = 0.0
            for sk_ in set(k.split('/')[0] for k in A_):
                a_list = [v_ for k, v_ in A_.items() if k.startswith(sk_ + '/')]
                b_list = [v_ for k, v_ in B_.items() if k.startswith(sk_ + '/')]
                for a_ in a_list:
                    best = min((max(abs(x - y) for x, y in zip(a_[1:5], b_[1:5])) for b_ in b_list if b_[0] == a_[0]), default=99.0)
                    worst_ = max(worst_, best)
            return round(worst_, 5)
        geom_dev = max(unmatched(base_sig, sig), unmatched(sig, base_sig))
        rows.append({'tpl': TPL, 'size': '%gx%g' % (W, H), 'variant': v, 'removed': n, 'geom_dev_ignoring_names': geom_dev, 'curves': len(sig), 'profiles': prof,
                     'warnings': len(warn), 'warn_sample': [w[:140] for w in warn[:3]], 'missing': missing[:5], 'extra': extra[:5],
                     'max_dev_in': round(dev, 6), 'worst': worst, 'per_sketch': per,
                     'same': (not missing and not extra and dev < 1e-4 and prof == base_prof and len(warn) <= len(base_warn))})
    rows.append({'tpl': TPL, 'size': '%gx%g' % (W, H), 'variant': '_time', 'seconds': round(time.time() - t0, 1)})
except Exception:
    rows.append({'tpl': TPL, 'size': '%gx%g' % (W, H), 'variant': 'CRASH', 'error': traceback.format_exc()[-600:]})
finally:
    for m in mod_keys():
        if m in sys.modules: del sys.modules[m]
    sys.modules.update(saved_mods)
    sys.path[:] = saved_path
with open(OUT, 'a', encoding='utf-8') as fh:
    for r in rows: fh.write(json.dumps(r) + '\n')
for r in rows:
    if r['variant'] in ('baseline', '_time', 'CRASH'):
        print(r)
    else:
        print('%-10s %-6s %-15s removed=%-3s same=%-5s GEOM(ignoring names)=%-8s per-sketch=%s warn=%s' % (
            r['tpl'], r['size'], r['variant'], r['removed'], r['same'], r['geom_dev_ignoring_names'], {k: v for k, v in r['per_sketch'].items() if v[0] > 1e-4}, r['warnings']))
