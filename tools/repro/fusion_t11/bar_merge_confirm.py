# Confirm the "bars merge" finding: for one payload, (A) Send at 0.75 then EDIT frame_thickness to T_EDIT, and
# (B) a FRESH Send with frame_thickness = T_EDIT. For each: bar volumes, total frame volume (union), pairwise overlap
# volume between bars (TemporaryBRepManager intersection), bar bounding boxes. Results append to RESULTS.
import sys, os, json, copy, traceback
import adsk.core, adsk.fusion


def bars_report(des):
    root = des.rootComponent
    bars = [b for occ in root.allOccurrences for b in occ.bRepBodies if b.name.startswith('frame_')]
    tbm = adsk.fusion.TemporaryBRepManager.get()
    vols = {b.name: round(b.volume, 2) for b in bars}
    overlaps = {}
    for i in range(len(bars)):
        for j in range(i + 1, len(bars)):
            a = tbm.copy(bars[i]); c = tbm.copy(bars[j])
            try:
                tbm.booleanOperation(a, c, adsk.fusion.BooleanTypes.IntersectionBooleanType)
                v = round(a.volume, 2)
            except Exception:
                v = 0.0
            if v > 0.01:
                overlaps['%s&%s' % (bars[i].name, bars[j].name)] = v
    union = None
    if bars:
        u = tbm.copy(bars[0])
        for b in bars[1:]:
            tbm.booleanOperation(u, tbm.copy(b), adsk.fusion.BooleanTypes.UnionBooleanType)
        union = round(u.volume, 2)
    bb = {b.name: [round(b.boundingBox.maxPoint.x - b.boundingBox.minPoint.x, 2), round(b.boundingBox.maxPoint.y - b.boundingBox.minPoint.y, 2)] for b in bars}
    return {'vols': vols, 'sum': round(sum(vols.values()), 2), 'union': union, 'overlaps': overlaps, 'bbox_cm': bb}


def run(payload, tag, edit_to=None):
    out = {'tag': tag}
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_barmerge_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-barmerge-' + tag)
    try:
        sys.modules['bspline_ui'].PaletteHTMLEventHandler()._handle_generate(payload)
        out['as_built'] = bars_report(des)
        if edit_to:
            des.userParameters.itemByName('frame_thickness').expression = edit_to
            out['after_edit'] = bars_report(des)
    except Exception:
        out['crash'] = traceback.format_exc()[-400:]
    finally:
        fp = des.userParameters.itemByName('adv_barmerge_fp')
        if fp and fp.comment == 'adv-barmerge-' + tag:
            doc.close(False)
    return out


base = json.load(open(PAYLOAD))
results = [run(base, TAG + '_edit_to_%s' % T_EDIT.replace(' ', ''), edit_to=T_EDIT)]
fresh = copy.deepcopy(base)
fresh['frame']['params']['frame_thickness'] = float(T_EDIT.split()[0])
results.append(run(fresh, TAG + '_fresh_send_%s' % T_EDIT.replace(' ', '')))
with open(RESULTS, 'a') as fh:
    for r in results:
        fh.write(json.dumps(r) + chr(10))
print(json.dumps(results)[:2500])
