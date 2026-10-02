# Extrude-to-the-curved-underside probe (advisor, 2026-10-02; Fred's sketch+solid test list, #1).
# Run inside Fusion via fusion_execute:  PAYLOAD = r'<captured send .json>'; TAG = '<label>'; exec(open(<this>).read())
# Replays a REAL captured Send (panel STEP + stamps + frame) through the add-in's own _handle_generate in a fresh
# fingerprinted doc, then measures the two things that can go silently wrong:
#   1. underside pick: every panel face's downward score (send_frame._face_downward_z), the chosen face's score vs
#      UNDERSIDE_MAX_NORMAL_Z, and the MARGIN to the next-best face (a small margin = a fragile pick);
#   2. the extrusion: does every frame bar actually reach the curved underside? min distance bar <-> panel (0 = they
#      touch), and the overlap volume (a bar poking INTO the panel, or a gap, are both silent defects).
# The doc is closed by its own handle afterwards; results are returned as one JSON line.
import sys, json, time, traceback
import adsk.core, adsk.fusion

res = {'tag': TAG}
doc = None
try:
    payload = json.load(open(PAYLOAD))
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_underside_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-underside-' + TAG)
    # Record the face scores AT THE MOMENT the add-in picks the underside (before the frame's trim cut makes the panel's
    # sides vertical) by wrapping send_frame.underside_face for this one call, restored in finally.
    sf_mod = sys.modules.get('fb_engine.send_frame')
    _orig_uf = sf_mod.underside_face
    picks = []
    def _recording_uf(body):
        sc = sorted((sf_mod._face_downward_z(f), f.area) for f in body.faces)
        picks.append([(round(z, 4), round(a, 1)) for z, a in sc if z is not None])
        return _orig_uf(body)
    sf_mod.underside_face = _recording_uf
    t0 = time.time()
    try:
        sys.modules['bspline_ui'].PaletteHTMLEventHandler()._handle_generate(payload)
    finally:
        sf_mod.underside_face = _orig_uf
    res['send_s'] = round(time.time() - t0, 1)
    if picks:
        p0 = picks[0]
        res['at_pick_scores'] = p0[:4] + (['...'] if len(p0) > 4 else [])
        res['at_pick_chosen'] = p0[0][0]
        res['at_pick_margin_to_bound'] = round(-0.7 - p0[0][0], 4)
        res['at_pick_next'] = p0[1][0] if len(p0) > 1 else None
        res['at_pick_margin_to_next'] = round(p0[1][0] - p0[0][0], 4) if len(p0) > 1 else None
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
        sf = sys.modules.get('fb_engine.send_frame')
        scores = sorted(((sf._face_downward_z(f), f.area) for f in panel.faces), key=lambda x: x[0])
        res['bound'] = sf.UNDERSIDE_MAX_NORMAL_Z
        res['face_scores'] = [(round(z, 4), round(a, 1)) for z, a in scores]
        res['chosen_score'] = round(scores[0][0], 4)
        res['margin_to_bound'] = round(sf.UNDERSIDE_MAX_NORMAL_Z - scores[0][0], 4)
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
    tl = des.timeline
    # H23 item 32: a TimelineGroup's own healthState is ALWAYS UnknownFeatureHealthState,
    # regardless of its children (MEASURED: tools/repro/timeline_health.py's own docstring) --
    # every real Send creates one (the STEP import's own "Group1"), so checking a group's own
    # healthState flagged a permanent false positive on every real Send. Recurse into a group's
    # own children instead; only a genuinely unhealthy child counts.
    def _is_healthy(item):
        if item.isGroup:
            return all(_is_healthy(item.item(i)) for i in range(item.count))
        return item.healthState == adsk.fusion.FeatureHealthStates.HealthyFeatureHealthState
    res['unhealthy'] = [tl.item(i).name for i in range(tl.count) if not _is_healthy(tl.item(i))]
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
print(json.dumps(res))
import os as _os
try:
    _out = globals().get('RESULTS') or _os.path.join(_os.path.dirname(PAYLOAD), 'underside_results.jsonl')
    with open(_out, 'a') as _fh:
        _fh.write(json.dumps(res) + chr(10))
except Exception:
    pass
