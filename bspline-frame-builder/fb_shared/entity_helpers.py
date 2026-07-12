"""
Canonical Fusion entity helpers (fb_shared) — C4/F8 de-dup, slice S1.

Merged from the two drifted copies (frame-inspector/entity_helpers.py +
template-maker/core/entity_helpers.py). Base = frame-inspector; each function's
provenance and any reconciliation decision is noted inline. Reconciliation
decisions are pending advisor review (see WORK-LOG turn 65) — NO callers are
switched to this module yet (S1 is additive), so nothing depends on it until
S3/S4.

Semantic decisions flagged for review:
  - _get_arc_midpoint: uses frame-inspector's evaluator (+ legacy fallback).
    This CHANGES template-maker's arc-midpoint from the angle-bisector to the
    evaluator (correct for semicircles). [GATE]
  - get_fb_name: uses template-maker's ID-first read (bug-fix; ID-stamped
    curves used to come back anonymous). This changes frame-inspector's display
    to the ID attribute when both ID and name are present. [FLAG]
  - get_fb_metadata: uses frame-inspector's real-midpoint `Bulge=`, NOT
    template-maker's `BulgeCenter=`center. Changes template-maker's label+value.
    [FLAG]
"""

import math
import adsk.core, adsk.fusion


# ── identical in both copies ──────────────────────────────────────────────────
def _get_native(ent):
    if hasattr(ent, 'nativeObject') and ent.nativeObject:
        return ent.nativeObject
    return ent


# ── frame-inspector only ──────────────────────────────────────────────────────
def _get_entity_key(ent):
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject
        if hasattr(ent, 'entityToken') and ent.entityToken:
            return ('token', ent.entityToken)
        if hasattr(ent, 'tempId'):
            return ('tempId', ent.tempId)
        return ('id', id(ent))
    except Exception:
        return ('id', id(ent))


# ── identical in both copies ──────────────────────────────────────────────────
def format_point(pt):
    try:
        return f"({round(pt.geometry.x,2)},{round(pt.geometry.y,2)})"
    except Exception:
        return ''


# ── frame-inspector only ──────────────────────────────────────────────────────
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


# ── RECONCILED: frame-inspector's evaluator dispatcher wins (was angle-bisector
#    only in template-maker). [GATE — changes template-maker's arc-midpoint] ────
def _get_arc_midpoint(ent):
    # Prefer the evaluator-based path (handles the semicircle ambiguity
    # the angle-bisector math fails on). Fall back to the legacy path
    # only if the evaluator is unavailable for some reason.
    via_eval = _get_arc_midpoint_via_evaluator(ent)
    if via_eval is not None:
        return via_eval
    return _get_arc_midpoint_legacy(ent)


# ── frame-inspector only (kept as the fallback for the dispatcher above) ───────
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
    except Exception:
        return None


# ── RECONCILED: template-maker's ID-first read wins (bug-fix — a curve stamped
#    with FrameBuilder.ID used to come back anonymous, breaking the ownership
#    gate). Legacy `name` kept as fallback. [FLAG — frame-inspector will now show
#    the ID attribute instead of `name` when a curve carries both] ─────────────
def get_fb_name(ent):
    try:
        if not ent:
            return "None"
        ent = _get_native(ent)
        if hasattr(ent, 'attributes'):
            # Prefer the canonical ``FrameBuilder.ID`` attribute — that's
            # what ``rename_selection`` writes as the primary stamp and
            # what ``_has_framebuilder_attribute`` checks first in the
            # ownership gate. If we only read ``name`` here, a curve
            # stamped with ``ID`` would come back anonymous, which then
            # makes ``_derive_point_role_id`` return ``None`` for every
            # SketchPoint start/end/center on that curve, which in turn
            # makes ``is_framebuilder_owned`` reject every constraint
            # whose targets include those points — the exact symptom of
            # "constraints disappear from the sequence block while the
            # geometry still renders". Legacy ``name`` is kept as the
            # fallback so sketches stamped before the rename-writes-both
            # change still resolve.
            a = ent.attributes.itemByName('FrameBuilder', 'ID')
            if a and a.value:
                return a.value.split('\n')[0]
            a = ent.attributes.itemByName('FrameBuilder', 'name')
            if a and a.value:
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


# ── frame-inspector only ──────────────────────────────────────────────────────
def get_fb_bridge(ent):
    try:
        ent = _get_native(ent)
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', 'name')
            if a:
                lines = a.value.split('\n')
                if len(lines) > 1: return lines[1]
    except Exception:
        pass
    return ""


# ── frame-inspector only ──────────────────────────────────────────────────────
def get_fb_plan(ent):
    try:
        ent = _get_native(ent)
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', 'plan')
            if a: return a.value
    except Exception:
        pass
    return ""


# ── RECONCILED: frame-inspector's real-arc-midpoint `Bulge=` wins (template-
#    maker emitted `BulgeCenter=`center, the misleading center-of-curvature).
#    [FLAG — changes template-maker's metadata label + value] ──────────────────
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
    except Exception:
        return ''


# ── frame-inspector only ──────────────────────────────────────────────────────
def entity_fingerprint(ent):
    try:
        ent = _get_native(ent)
        if hasattr(ent, 'entityToken') and ent.entityToken:
            return ent.entityToken
        if hasattr(ent, 'tempId'):
            return f"{ent.objectType}_{ent.tempId}"
        return f"{ent.objectType}_{id(ent)}"
    except Exception:
        return str(id(ent))


# ── RECONCILED: template-maker's superset wins (adds Circle / Ellipse / Spline
#    coordinate rendering; arc/line/bbox identical to frame-inspector). Minor
#    behaviour change for frame-inspector: circles now render center+radius
#    instead of falling through to a bbox "Center". ────────────────────────────
def get_entity_coord(ent):
    try:
        ent = _get_native(ent)
        ot = ent.objectType if hasattr(ent, 'objectType') else ''
        if ot.endswith('SketchPoint'):
            return f"Point: ({round(ent.geometry.x,2)}, {round(ent.geometry.y,2)})"
        # Circle — center + radius; no start/end.
        if ot.endswith('SketchCircle'):
            c = getattr(ent, 'centerSketchPoint', None)
            r = getattr(getattr(ent, 'geometry', None), 'radius', None)
            parts = []
            if c is not None:
                parts.append(f"({round(c.geometry.x, 2)}, {round(c.geometry.y, 2)})")
            if r is not None:
                parts.append(f"r={round(float(r), 2)}")
            return ' '.join(parts)
        # Ellipse — center + majorR + minorR.
        if ot.endswith('SketchEllipse'):
            c = getattr(ent, 'centerSketchPoint', None)
            g = getattr(ent, 'geometry', None)
            major = getattr(g, 'majorAxisRadius', None)
            minor = getattr(g, 'minorAxisRadius', None)
            parts = []
            if c is not None:
                parts.append(f"({round(c.geometry.x, 2)}, {round(c.geometry.y, 2)})")
            if major is not None:
                parts.append(f"rM={round(float(major), 2)}")
            if minor is not None:
                parts.append(f"rm={round(float(minor), 2)}")
            return ' '.join(parts)
        # Splines — list of fit/control points joined with arrows.
        if ot.endswith('SketchFittedSpline') or ot.endswith('SketchControlPointSpline') or ot.endswith('SketchFixedSpline'):
            pieces = []
            for attr in ('fitPoints', 'controlPoints'):
                pts = getattr(ent, attr, None)
                if pts is None:
                    continue
                try:
                    count = getattr(pts, 'count', None)
                    if count is not None:
                        for i in range(count):
                            p = pts.item(i)
                            pieces.append(f"({round(p.geometry.x, 2)}, {round(p.geometry.y, 2)})")
                        break
                except Exception:
                    pass
                try:
                    for p in pts:
                        pieces.append(f"({round(p.geometry.x, 2)}, {round(p.geometry.y, 2)})")
                    break
                except Exception:
                    continue
            return ' -> '.join(pieces)
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
    return ""
