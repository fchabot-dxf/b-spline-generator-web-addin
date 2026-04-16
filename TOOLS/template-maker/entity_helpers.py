"""
Template Maker copy of Frame Inspector entity helpers.
"""

import math
import adsk.core, adsk.fusion


def _get_native(ent):
    if hasattr(ent, 'nativeObject') and ent.nativeObject:
        return ent.nativeObject
    return ent


def get_fb_name(ent):
    try:
        if not ent:
            return "None"
        ent = _get_native(ent)
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', 'name')
            if a:
                return a.value.split('\n')[0]

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
    except Exception:
        return "Entity"


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
            center_coord = format_point(ent.centerSketchPoint)
            if center_coord:
                info.append(f"BulgeCenter={center_coord}")

        return ' | '.join(info)
    except Exception:
        return ''


def format_point(pt):
    try:
        return f"({round(pt.geometry.x,2)},{round(pt.geometry.y,2)})"
    except Exception:
        return ''


def get_entity_coord(ent):
    try:
        ent = _get_native(ent)
        if ent.objectType.endswith('SketchPoint'):
            return f"Point: ({round(ent.geometry.x,2)}, {round(ent.geometry.y,2)})"
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
    except Exception:
        pass
    return ''


def _get_arc_midpoint(ent):
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
    except Exception:
        return None
