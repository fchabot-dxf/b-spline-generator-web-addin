# Extrude-to-the-curved-underside probe (advisor, 2026-10-02; Fred's sketch+solid test list, #1).
# Run inside Fusion via fusion_execute:  PAYLOAD = r'<captured send .json>'; TAG = '<label>'; exec(open(<this>).read())
# Optional: REPO = r'<checkout>' -- loads b-spline-gen.py + fb_engine fresh from THAT repo checkout
# (importlib.util.spec_from_file_location, items 29/32/33/34/35's own pattern) instead of the
# deployed add-in copy (sys.modules['bspline_ui']) -- needed to verify an unlanded fix.
# Replays a REAL captured Send (panel STEP + stamps + frame) through the add-in's own _handle_generate in a fresh
# fingerprinted doc, then measures the two things that can go silently wrong:
#   1. underside pick: every panel face's downward score (send_frame._face_downward_z, H23 item 37: an
#      area-weighted UV-grid average), the chosen face vs the next-best (a small margin = a fragile pick), and
#      whether the pick was ambiguous (another downward face comparably large -- AREA_DOMINANCE_RATIO);
#   2. the extrusion: does every frame bar actually reach the curved underside? min distance bar <-> panel (0 = they
#      touch), and the overlap volume (a bar poking INTO the panel, or a gap, are both silent defects).
# The doc is closed by its own handle afterwards; results are returned as one JSON line.
import sys, os, json, time, traceback
import adsk.core, adsk.fusion

res = {'tag': TAG}
doc = None
_saved_mods = {}
_saved_path = list(sys.path)
try:
    payload = json.load(open(PAYLOAD))
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_underside_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-underside-' + TAG)
    REPO_PATH = globals().get('REPO')
    if REPO_PATH:
        FB = os.path.join(REPO_PATH, "bspline-frame-builder", "frame-builder")
        BSG_DIR = os.path.join(REPO_PATH, "bspline-frame-builder", "b-spline-gen")
        mod_keys = [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.')
                    or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_')
                    or m == 'fb_shared' or m.startswith('fb_shared.')]
        _saved_mods = {m: sys.modules[m] for m in mod_keys}
        for m in mod_keys:
            del sys.modules[m]
        sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(FB)); sys.path.insert(0, BSG_DIR)
        import importlib.util
        spec = importlib.util.spec_from_file_location("bsg_underside_" + TAG, os.path.join(BSG_DIR, "b-spline-gen.py"))
        bsg = importlib.util.module_from_spec(spec)
        sys.modules["bsg_underside_" + TAG] = bsg
        spec.loader.exec_module(bsg)
        from fb_engine import frame_engine as fe
        bsg.frame_engine = fe
        handler_cls = bsg.PaletteHTMLEventHandler
    else:
        handler_cls = sys.modules['bspline_ui'].PaletteHTMLEventHandler
    # Record the face scores AT THE MOMENT the add-in picks the underside (before the frame's trim cut makes the panel's
    # sides vertical) by wrapping send_frame.underside_face for this one call, restored in finally.
    import fb_engine.send_frame as sf_mod
    _orig_uf = sf_mod.underside_face
    picks = []
    def _recording_uf(body):
        sc = sorted((sf_mod._face_downward_z(f), f.area) for f in body.faces)
        picks.append([(round(z, 4), round(a, 1)) for z, a in sc if z is not None])
        return _orig_uf(body)
    sf_mod.underside_face = _recording_uf
    t0 = time.time()
    try:
        handler_cls()._handle_generate(payload)
    finally:
        sf_mod.underside_face = _orig_uf
    res['send_s'] = round(time.time() - t0, 1)
    if picks:
        p0 = picks[0]
        res['at_pick_scores'] = p0[:4] + (['...'] if len(p0) > 4 else [])
        res['at_pick_chosen'] = p0[0][0]
        res['at_pick_next'] = p0[1][0] if len(p0) > 1 else None
        res['at_pick_margin_to_next'] = round(p0[1][0] - p0[0][0], 4) if len(p0) > 1 else None
        res['at_pick_area_dominant'] = not any(
            z < 0 and a >= p0[0][1] * sf_mod.AREA_DOMINANCE_RATIO for z, a in p0[1:])
        res['pick_calls'] = len(picks)
    root = des.rootComponent
    panel, bars = None, []
    for occ in root.allOccurrences:
        for b in occ.bRepBodies:
            if b.name == 'panel':
                panel = b
            elif b.name.startswith('frame_'):
                bars.append(b)
    res['bars'] = sorted(b.name for b in bars)
    if panel is None:
        res['error'] = 'no panel body'
    else:
        scores = sorted(((sf_mod._face_downward_z(f), f.area) for f in panel.faces), key=lambda x: x[0])
        res['face_scores'] = [(round(z, 4), round(a, 1)) for z, a in scores]
        res['chosen_score'] = round(scores[0][0], 4)
        res['margin_to_next'] = round(scores[1][0] - scores[0][0], 4) if len(scores) > 1 else None
        mm = app.measureManager
        per_bar = []
        for b in bars:
            d = mm.measureMinimumDistance(b, panel).value
            # overlap: intersect a temp copy (TemporaryBRepManager) -- volume > 0 means the bar pokes into the panel
            tbm = adsk.fusion.TemporaryBRepManager.get()
            a_ = tbm.copy(b); p_ = tbm.copy(panel)
            try:
                tbm.booleanOperation(a_, p_, adsk.fusion.BooleanTypes.IntersectionBooleanType)
                ov = a_.volume
            except Exception:
                ov = 0.0
            per_bar.append({'bar': b.name, 'min_dist_mm': round(d * 10, 4), 'overlap_cm3': round(ov, 5)})
        res['bars_vs_panel'] = per_bar
    # H23 item 37: recurse into groups (a TimelineGroup's own healthState is ALWAYS Unknown, H23
    # item 32 / tools/repro/timeline_health.py) and capture each genuinely unhealthy item's own
    # warning/error text, not just its name.
    def _unhealthy(items):
        out = []
        for i in range(items.count):
            it = items.item(i)
            if getattr(it, 'isGroup', False):
                out.extend(_unhealthy(it))
            elif it.healthState != adsk.fusion.FeatureHealthStates.HealthyFeatureHealthState:
                out.append((it.name, (getattr(it, 'errorOrWarningMessage', '') or '')[:300]))
        return out
    res['unhealthy'] = _unhealthy(des.timeline)
except Exception:
    res['crash'] = traceback.format_exc()[-500:]
finally:
    try:
        if doc is not None:
            fp = doc.products.itemByProductType('DesignProductType').userParameters.itemByName('adv_underside_fp')
            if fp and fp.comment == 'adv-underside-' + TAG:
                doc.close(False)
    except Exception:
        pass
    for m in list(sys.modules):
        if (m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches')
                or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared'
                or m.startswith('fb_shared.')) and m not in _saved_mods:
            del sys.modules[m]
    sys.modules.update(_saved_mods)
    sys.path[:] = _saved_path
print(json.dumps(res))
import os as _os
try:
    _out = globals().get('RESULTS') or _os.path.join(_os.path.dirname(PAYLOAD), 'underside_results.jsonl')
    with open(_out, 'a') as _fh:
        _fh.write(json.dumps(res) + chr(10))
except Exception:
    pass
