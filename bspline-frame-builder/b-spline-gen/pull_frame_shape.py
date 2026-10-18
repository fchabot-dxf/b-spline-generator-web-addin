"""Pull from Fusion part 2 (seat B 2026-10-18; advisor 66, Fred): the wood-frame SKETCH SHAPE comes back.

Send seeds the frame's shape as the template's own seed Line / Arc3Point steps, each tagged FrameBuilder/ID = its seed
id (fb_engine/seed_geometry.py, ctx.set_id). This reads those same curves back, found by that tag and by the frame
component's own tag (fb_engine.send_frame.find_frames, scoped to the project's board) -- never by sketch name or by
position. The reply is the SAME shape the app's frameSeedGeometry sends, {id: {'points': [[x, y], ...]}} in inches,
sketch coordinates (centred, y up), so core/pull-frame-shape.js can fit it onto the template's handles. A line is
[start, end]; an arc is [start, mid, end]. The app names the ids it wants (`seed_ids`: the template's line/arc
seedMap entries), so this stays template-agnostic. No dimension, constraint or parameter is read or written.
"""
from fb_engine.send_frame import find_frames

CM_PER_IN = 2.54
FRAME_ID_ATTR = ("FrameBuilder", "ID")


def _id_of(entity):
    try:
        a = entity.attributes.itemByName(*FRAME_ID_ATTR)
        return a.value if a else None
    except Exception:
        return None


def _in(pt):
    return [round(pt.x / CM_PER_IN, 5), round(pt.y / CM_PER_IN, 5)]


def _arc_points(arc):
    sp, ep = arc.startSketchPoint.geometry, arc.endSketchPoint.geometry
    ev = arc.geometry.evaluator
    _, s = ev.getParameterAtPoint(sp)
    _, e = ev.getParameterAtPoint(ep)
    _, mid = ev.getPointAtParameter((s + e) / 2.0)
    return [_in(sp), _in(mid), _in(ep)]


def read_frame_shape(design, scope, seed_ids):
    """{seed id: {'points': [...]}} for every wanted id found on the project's own frame; {'ids', 'missing', 'failed'}
    are reported in the second return so a curve that was not found / not readable is counted, never dropped
    silently. Returns (shape, report). No frame / no ids asked -> ({}, report)."""
    wanted = {str(i) for i in (seed_ids or []) if i}
    shape, failed = {}, []
    frames = find_frames(design, scope) if wanted else []
    for comp in frames:
        for sk in getattr(comp, 'sketches', None) or []:
            curves = sk.sketchCurves
            for kind, coll in (('line', curves.sketchLines), ('arc', curves.sketchArcs)):
                for ent in coll:
                    sid = _id_of(ent)
                    if sid not in wanted or sid in shape:
                        continue
                    try:
                        if kind == 'line':
                            shape[sid] = {'points': [_in(ent.startSketchPoint.geometry), _in(ent.endSketchPoint.geometry)]}
                        else:
                            shape[sid] = {'points': _arc_points(ent)}
                    except Exception:
                        failed.append(sid)
    return shape, {'frames': len(frames), 'asked': len(wanted), 'found': len(shape),
                   'missing': sorted(wanted - set(shape) - set(failed)), 'failed': sorted(set(failed))}
