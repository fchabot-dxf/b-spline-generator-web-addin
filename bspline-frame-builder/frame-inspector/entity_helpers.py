"""
Frame Inspector Fusion entity helpers.

This module contains Fusion-specific entity name, metadata, and coordinate
extraction logic that is separate from the palette and payload plumbing.
"""

import math
import adsk.core, adsk.fusion


def _get_native(ent):
    if hasattr(ent, 'nativeObject') and ent.nativeObject:
        return ent.nativeObject
    return ent


def _get_entity_key(ent):
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject
        if hasattr(ent, 'entityToken') and ent.entityToken:
            return ('token', ent.entityToken)
        if hasattr(ent, 'tempId'):
            return ('tempId', ent.tempId)
        return ('id', id(ent))
    except:
        return ('id', id(ent))


def format_point(pt):
    try:
        return f"({round(pt.geometry.x,2)},{round(pt.geometry.y,2)})"
    except:
        return ''


def _get_arc_midpoint_via_evaluator(ent):
    """Reliable arc midpoint via Fusion's geometry evaluator.

    See fusion-inspector.py for full rationale - the angle-bisector
    method below silently picks the wrong half-circle when S and E
    are diametrically opposite (cross product is 0). The evaluator
    traces the actual arc as constructed, so direction is unambiguous.
    """
    try:
        geom = getattr(ent, 'geometry', None)
        if geom is None:
            return None
        evaluator = getattr(geom, 'evaluator', None)
        if evaluator is None:
            return None
        ok, t_min, t_max = evaluator.getParameterExtents()
        if not ok:
            return None
        ok2, mid_pt = evaluator.getPointAtParameter((t_min + t_max) / 2.0)
        if not ok2 or mid_pt is None:
            return None
        return (mid_pt.x, mid_pt.y)
    except Exception:
        return None


def _get_arc_midpoint(ent):
    # Prefer the evaluator-based path (handles the semicircle ambiguity
    # the angle-bisector math fails on). Fall back to the legacy path
    # only if the evaluator is unavailable for some reason.
    via_eval = _get_arc_midpoint_via_evaluator(ent)
    if via_eval is not None:
        return via_eval
    return _get_arc_midpoint_legacy(ent)


def _get_arc_midpoint_legacy(ent):
    try:
        if not hasattr(ent, 'startSketchPoint') or not hasattr(ent, 'endSketchPoint'):
            return None

        sp = ent.startSketchPoint.geometry
        ep = ent.endSketchPoint.geometry
        cp = None
        if hasattr(ent, 'centerSketchPoint') and ent.centerSketchPoint:
            cp = ent.centerSketchPoint.geometry
        elif hasattr(ent, 'geometry') and hasattr(ent.geometry, 'center'):
            cp = ent.geometry.center
        if not cp:
            return None

        dx1 = sp.x - cp.x
        dy1 = sp.y - cp.y
        dx2 = ep.x - cp.x
        dy2 = ep.y - cp.y
        r1 = math.hypot(dx1, dy1)
        if r1 == 0:
            return None

        angle1 = math.atan2(dy1, dx1)
        angle2 = math.atan2(dy2, dx2)
        cross = dx1 * dy2 - dy1 * dx2
        delta = angle2 - angle1
        if cross < 0 and delta > 0:
            delta -= 2 * math.pi
        elif cross > 0 and delta < 0:
            delta += 2 * math.pi

        mid_angle = angle1 + delta / 2.0
        mid_x = cp.x + r1 * math.cos(mid_angle)
        mid_y = cp.y + r1 * math.sin(mid_angle)
        return (mid_x, mid_y)
    except:
        return None


def get_fb_name(ent):
    try:
        if not ent: return "None"
        ent = _get_native(ent)
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', 'name')
            if a: return a.value.split('\n')[0]

        if ent.objectType.endswith('SketchPoint'):
            parents = []
            if hasattr(ent, 'connectedEntities'):
                for ce in ent.connectedEntities:
                    name = get_fb_name(ce)
                    if name and not name.startswith('Sketch'):
                        parents.append(name.split('.')[-1])
            if parents:
                return f"Vertex of {', '.join(parents)}"

        return ent.objectType.split('::')[-1]
    except:
        return "Entity"


def get_fb_bridge(ent):
    try:
        ent = _get_native(ent)
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', 'name')
            if a:
                lines = a.value.split('\n')
                if len(lines) > 1: return lines[1]
    except:
        pass
    return ""


def get_fb_plan(ent):
    try:
        ent = _get_native(ent)
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', 'plan')
            if a: return a.value
    except:
        pass
    return ""


def get_fb_metadata(ent):
    try:
        ent = _get_native(ent)
        if not hasattr(ent, 'attributes'):
            return ''

        info = []
        for name in ('StartID', 'EndID', 'CenterID'):
            a = ent.attributes.itemByName('FrameBuilder', name)
            if a and a.value:
                info.append(f"{name}={a.value}")

        if hasattr(ent, 'centerSketchPoint') and ent.centerSketchPoint:
            # Emit the real arc mid-point as "Bulge". Was previously set
            # to the center coordinate, which made Bulge == Center - a
            # misleading duplicate. The center sits on the OPPOSITE side
            # of the chord from the actual arc bulge, so duplicating it
            # under a "Bulge" label was wrong both semantically and for
            # downstream consumers passing it to addByThreePoints.
            mid = _get_arc_midpoint(ent)
            if mid is not None:
                info.append(f"Bulge=({round(mid[0], 2)},{round(mid[1], 2)})")

        return ' | '.join(info)
    except:
        return ''


def entity_fingerprint(ent):
    try:
        ent = _get_native(ent)
        if hasattr(ent, 'entityToken') and ent.entityToken:
            return ent.entityToken
        if hasattr(ent, 'tempId'):
            return f"{ent.objectType}_{ent.tempId}"
        return f"{ent.objectType}_{id(ent)}"
    except:
        return str(id(ent))


def get_entity_coord(e):
    try:
        ent = _get_native(e)
        if ent.objectType.endswith('SketchPoint'):
            return f"Point: ({round(ent.geometry.x, 2)}, {round(ent.geometry.y, 2)})"
        if hasattr(ent, 'startSketchPoint') and hasattr(ent, 'endSketchPoint'):
            sp = ent.startSketchPoint.geometry
            ep = ent.endSketchPoint.geometry
            cp = None
            if hasattr(ent, 'centerSketchPoint') and ent.centerSketchPoint:
                cp = ent.centerSketchPoint.geometry
            elif hasattr(ent, 'geometry') and hasattr(ent.geometry, 'center'):
                cp = ent.geometry.center
            if cp:
                mid = _get_arc_midpoint(ent)
                coord_str = f"({round(sp.x,2)}, {round(sp.y,2)}) -> ({round(cp.x,2)}, {round(cp.y,2)}) -> ({round(ep.x,2)}, {round(ep.y,2)})"
                if mid:
                    coord_str += f" -> ({round(mid[0],2)}, {round(mid[1],2)})"
                return coord_str
            return f"({round(sp.x,2)}, {round(sp.y,2)}) -> ({round(ep.x,2)}, {round(ep.y,2)})"
        if hasattr(ent, 'geometry') and hasattr(ent.geometry, 'startPoint'):
            g = ent.geometry
            return f"({round(g.startPoint.x,2)}, {round(g.startPoint.y,2)}) -> ({round(g.endPoint.x,2)}, {round(g.endPoint.y,2)})"
        if hasattr(ent, 'boundingBox'):
            bb = ent.boundingBox
            cx = round((bb.minPoint.x + bb.maxPoint.x) / 2, 2)
            cy = round((bb.minPoint.y + bb.maxPoint.y) / 2, 2)
            return f"Center: ({cx}, {cy})"
    except:
        pass
    return ""
