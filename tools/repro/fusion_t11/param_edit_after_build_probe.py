# Parameter edits AFTER a build (advisor, 2026-10-02; Fred's sketch+solid list, #2).
# Run inside Fusion via fusion_execute:  PAYLOAD = r'<captured send .json>'; TAG = '<label>'; EDITS = [('frame_thickness', '0.6 in'), ...]
#   exec(open(<this>).read())
# Replays a real captured Send, then changes user parameters the way a person would in Fusion's Parameters dialog,
# one edit at a time, and after each one reads back: timeline health (groups judged by their children -- a group's own
# healthState is always Unknown), the frame bars present, every bar still touching the panel (min distance, overlap),
# and the frame-enclosure sketch's inner arcs (a radius collapsing toward 0 = the silent offset squash).
# Results append to RESULTS (default: <payload dir>/param_edit_results.jsonl); the doc is closed by its own handle.
import sys, os, json, time, traceback
import adsk.core, adsk.fusion


def _health(des):
    bad = []
    def walk(items):
        for i in range(items.count):
            it = items.item(i)
            if it.isGroup:
                walk(adsk.fusion.TimelineGroup.cast(it.entity) if False else it.group if hasattr(it, 'group') else [])
                continue
            try:
                if it.healthState != adsk.fusion.FeatureHealthStates.HealthyFeatureHealthState:
                    bad.append('%s: %s' % (it.name, (it.errorOrWarningMessage or '')[:80]))
            except Exception:
                pass
    tl = des.timeline
    for i in range(tl.count):
        it = tl.item(i)
        if it.isGroup:
            continue  # its children are top-level timeline items too; the group's own state is always Unknown
        try:
            if it.healthState != adsk.fusion.FeatureHealthStates.HealthyFeatureHealthState:
                bad.append('%s: %s' % (it.name, (it.errorOrWarningMessage or '')[:80]))
        except Exception:
            pass
    return bad


def _state(des):
    root = des.rootComponent
    panel, bars, inner_r = None, [], []
    for occ in root.allOccurrences:
        for b in occ.bRepBodies:
            if b.name == 'panel':
                panel = b
            elif b.name.startswith('frame_'):
                bars.append(b)
        for sk in occ.component.sketches:
            if sk.name.endswith('3_frame_enclosure'):
                for j in range(sk.sketchCurves.sketchArcs.count):
                    a = sk.sketchCurves.sketchArcs.item(j)
                    if not a.isReference and not a.isConstruction:
                        inner_r.append(round(a.geometry.radius / 2.54, 4))
    mm = app.measureManager
    touch = [round(mm.measureMinimumDistance(b, panel).value * 10, 4) for b in bars] if panel else []
    return {'bars': sorted(b.name for b in bars), 'bar_volumes_cm3': sorted(round(b.volume, 2) for b in bars),
            'max_gap_mm': max(touch) if touch else None, 'enclosure_arc_radii_in': sorted(inner_r)[:8],
            'unhealthy': _health(des)}


res = {'tag': TAG, 'edits': []}
doc = None
try:
    payload = json.load(open(PAYLOAD))
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_paramedit_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-paramedit-' + TAG)
    sys.modules['bspline_ui'].PaletteHTMLEventHandler()._handle_generate(payload)
    res['baseline'] = _state(des)
    res['params'] = {p.name: p.expression for p in des.userParameters if p.name in ('frame_thickness', 'boundingboxoffset', 'panel_lip', 'widthIn', 'heightIn')}
    for name, expr in EDITS:
        p = des.userParameters.itemByName(name)
        rec = {'param': name, 'to': expr}
        if p is None:
            rec['error'] = 'no such parameter'
        else:
            rec['from'] = p.expression
            try:
                p.expression = expr
            except Exception as e:
                rec['error'] = str(e).splitlines()[0][:120]
            rec['after'] = _state(des)
            try:
                p.expression = rec['from']  # restore before the next edit, so each edit is judged on its own
            except Exception as e:
                rec['restore_error'] = str(e).splitlines()[0][:120]
            rec['restored'] = _state(des)
        res['edits'].append(rec)
except Exception:
    res['crash'] = traceback.format_exc()[-500:]
finally:
    try:
        if doc is not None:
            fp = doc.products.itemByProductType('DesignProductType').userParameters.itemByName('adv_paramedit_fp')
            if fp and fp.comment == 'adv-paramedit-' + TAG:
                doc.close(False)
    except Exception:
        pass
print(json.dumps(res)[:3000])
try:
    _out = globals().get('RESULTS') or os.path.join(os.path.dirname(PAYLOAD), 'param_edit_results.jsonl')
    with open(_out, 'a') as _fh:
        _fh.write(json.dumps(res) + chr(10))
except Exception:
    pass
