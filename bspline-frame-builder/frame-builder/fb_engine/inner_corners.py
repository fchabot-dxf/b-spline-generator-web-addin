"""
Inner Corner Resolve Step.

Locates the 4 inner-enclosure corner SketchPoints by position and
registers them under the names the miter phase expects, bypassing the
offset's curve-tagging behaviour.

The motivation: at high frame_thickness (relative to silhouette feature
radii), Fusion's inward offset merges colliding side arcs into single
phantom curves whose attribute-set is locked. Our normal proximity
tagger then either mis-tags surviving curves or fails to register
endpoints. But the *corners* of the inner enclosure - formed by
intersection of straight-line offsets (top_edge, bottom_edge, horn_TR,
horn_BL) - never merge. The corner SketchPoints exist as valid
geometry regardless of how badly the side arcs degenerated.

So we side-step the curve-tagging problem entirely for miter targets:
compute each expected inner-corner position from the outer projection +
frame_thickness, find the closest existing SketchPoint in the sketch,
register it directly in entity_map under the miter's expected target
ID. No curve sampling, no type matching, just a position lookup.

H23 item 38 adds a second corner shape: a LINE meeting a CIRCLE at a
cusp (T7's own eave, where the roof line is tangent to the concave
neck arc). ``line_circle_corner_step`` below uses the SAME "compute
expected position, find nearest existing SketchPoint" approach, but
reads the circle's own centre/radius LIVE from the already-built arc
instead of baking a Distance/Direction ahead of time from a
template's own default proportions -- those vary per Send (the app's
own randomized seed), so a value baked from defaults almost never
matches the real corner (MEASURED, H23 item 38).
"""

import math

from fb_engine.t7_roof_eave import line_circle_corner


def inner_corner_step(ctx, sketch, s_name, step):
    """
    Resolve inner-enclosure corner SketchPoints and register under the
    user-specified target IDs.

    Parameters
    ----------
    ctx     : BuildContext
    sketch  : adsk.fusion.Sketch
    s_name  : str -- sketch name key (e.g. ``T1_3_frame_enclosure``)
    step    : dict with keys
                'Distance'  -- expression string evaluated to a cm
                               distance (typically ``'frame_thickness'``)
                'Tolerance' -- max distance (cm) between expected
                               position and nearest SketchPoint to
                               accept as a match. Defaults to 0.05.
                'Corners'   -- mapping of label to corner config:
                                 {
                                   'TL': {
                                     'OuterID':  'proj_top_edge:S',
                                     'InnerID':  'inner_proj_top_edge:S',
                                     'Direction': ( 1, -1),  # inward unit signs
                                   },
                                   ...
                                 }

    Direction is the (dx_sign, dy_sign) inward axis-aligned vector
    applied to the outer corner. Each component is +1 or -1; the
    actual offset magnitude per axis is the resolved Distance value.
    For a TL corner: outer is at top-left of envelope, inward means
    +x (rightward) and -y (downward), so Direction = (1, -1).
    """
    corners = step.get('Corners') or {}
    if not corners:
        ctx.logger.log("INNER CORNER: no Corners declared, skipping", "WARNING")
        return

    distance_expr = step.get('Distance', 'frame_thickness')
    tolerance = float(step.get('Tolerance', 0.05))

    # Resolve the distance to centimetres (Fusion's database unit).
    try:
        dist_cm = ctx.design.unitsManager.evaluateExpression(distance_expr, 'cm')
    except Exception as e:
        ctx.logger.log(
            f"INNER CORNER: failed to evaluate distance '{distance_expr}': {e}",
            "ERROR")
        return

    # Snapshot every SketchPoint in this sketch for the position
    # search. We do this once per phase rather than once per corner.
    all_points = _collect_sketch_points(sketch)
    if not all_points:
        ctx.logger.log(
            f"INNER CORNER: no SketchPoints found in {s_name}, cannot resolve",
            "WARNING")
        return

    for label, cfg in corners.items():
        outer_id = cfg.get('OuterID')
        inner_id = cfg.get('InnerID')
        direction = cfg.get('Direction', (0, 0))

        if not outer_id or not inner_id:
            ctx.logger.log(
                f"INNER CORNER {label}: missing OuterID/InnerID, skipping",
                "WARNING")
            continue

        outer_ent = ctx.entity_map.get(s_name, {}).get(outer_id)
        if not outer_ent:
            ctx.logger.log(
                f"INNER CORNER {label}: outer reference '{outer_id}' not in "
                f"entity_map for {s_name}",
                "WARNING")
            continue

        try:
            outer_geom = outer_ent.geometry
            ox, oy = float(outer_geom.x), float(outer_geom.y)
        except Exception as e:
            ctx.logger.log(
                f"INNER CORNER {label}: failed to read outer geometry "
                f"from '{outer_id}': {e}",
                "WARNING")
            continue

        # Expected inner-corner position: outer pulled inward by the
        # resolved distance on each axis.
        expected_x = ox + direction[0] * dist_cm
        expected_y = oy + direction[1] * dist_cm

        nearest_pt, nearest_dist = _find_nearest_point(
            all_points, expected_x, expected_y)

        axis_aligned = all(abs(abs(float(d)) - 1.0) < 1e-9 for d in direction)
        if (nearest_pt is None or nearest_dist > tolerance) and axis_aligned:
            # H23 item 63 (live, T1 cornerRadiusTop max): when a square corner's SHORT side (a horn)
            # is shorter than frame_thickness, the inward offset drops its copy, so the inner corner
            # is where the surviving straight edge's offset meets the next curve -- still ON that
            # edge's axis line, just slid along it (0.074 cm there, past the 0.05 tolerance). Accept
            # the nearest point lying exactly on either axis line through the expected corner,
            # slid by at most the offset distance. Square (+-1, +-1) corners only.
            slid_pt, slid_dist = _find_point_slid_along_axis(
                all_points, expected_x, expected_y, max_slide=dist_cm)
            if slid_pt is not None:
                ctx.logger.log(
                    f"INNER CORNER {label}: short side collapsed in the offset; using the point "
                    f"slid {slid_dist:.4f} cm along the surviving edge")
                nearest_pt, nearest_dist = slid_pt, 0.0

        if nearest_pt is None or nearest_dist > tolerance:
            ctx.logger.log(
                f"INNER CORNER {label}: no SketchPoint within {tolerance:.3f} "
                f"cm of expected ({expected_x:.3f}, {expected_y:.3f}); "
                f"nearest was {nearest_dist:.4f} cm",
                "WARNING")
            continue

        ctx.set_id(nearest_pt, s_name, "corner", override_id=inner_id)
        ctx.logger.log(
            f"INNER CORNER {label}: resolved {inner_id} at "
            f"({expected_x:.3f}, {expected_y:.3f}) "
            f"[match dist={nearest_dist:.4f} cm]")


def _collect_sketch_points(sketch):
    """Return [(x, y, sketch_point), ...] for every SketchPoint in the sketch."""
    out = []
    try:
        count = sketch.sketchPoints.count
    except Exception:
        return out
    for i in range(count):
        try:
            pt = sketch.sketchPoints.item(i)
            g = pt.geometry
            out.append((float(g.x), float(g.y), pt))
        except Exception:
            continue
    return out


def _find_nearest_point(all_points, ex, ey):
    """Linear-scan nearest point to (ex, ey). Returns (point, distance_cm)."""
    best_pt = None
    best_d = math.inf
    for px, py, pt in all_points:
        dx = px - ex
        dy = py - ey
        d = math.sqrt(dx * dx + dy * dy)
        if d < best_d:
            best_d = d
            best_pt = pt
    return best_pt, best_d


def _find_point_slid_along_axis(all_points, ex, ey, max_slide, on_line_eps=1e-3):
    """Nearest point lying on the horizontal or vertical line through (ex, ey) (within
    `on_line_eps` cm), at most `max_slide` cm from (ex, ey) along that line. Returns
    (point, slide_cm) or (None, inf)."""
    best_pt, best_s = None, math.inf
    for px, py, pt in all_points:
        for off_axis, along in ((abs(py - ey), abs(px - ex)), (abs(px - ex), abs(py - ey))):
            if off_axis <= on_line_eps and along <= max_slide and along < best_s:
                best_pt, best_s = pt, along
    return best_pt, best_s


def line_circle_corner_step(ctx, sketch, s_name, step):
    """
    Resolve a cusp-like inner corner where a LINE is tangent to a CIRCLE (H23 item 38: T7's own
    eave, where the roof line meets the concave neck arc) -- computed LIVE from the real,
    already-built geometry (the line's own two endpoints, the circle's own centre/radius read
    straight off the real arc), via fb_engine.t7_roof_eave.line_circle_corner.

    Parameters
    ----------
    ctx, sketch, s_name : as inner_corner_step
    step : dict with keys
             'Tolerance'      -- max distance (cm) between expected position and nearest
                                  SketchPoint to accept as a match. Defaults to 0.05.
             'FrameThickness' -- expression string evaluated to a cm distance (defaults to
                                  'frame_thickness').
             'Corners'        -- mapping of label to corner config:
                                    {
                                      'eave_R': {
                                        'LineFarID':  'proj_roof_R:S',   # far end (not tangent)
                                        'LineNearID': 'proj_roof_R:E',   # near end (tangent pt)
                                        'ArcID':      'proj_arc_neck_R', # the circle itself
                                        'InnerID':    'inner_proj_arc_neck_R:S',
                                        'Concave':    True,  # see line_circle_corner's own docstring
                                      },
                                      ...
                                    }
    The "interior" reference point used to pick the correct offset side is the board's own
    centre, (0, 0) in Fusion's sketch coordinates -- true for any board-centred symmetric
    template, not just T7; no per-corner config needed.
    """
    corners = step.get('Corners') or {}
    if not corners:
        ctx.logger.log("LINE-CIRCLE CORNER: no Corners declared, skipping", "WARNING")
        return

    tolerance = float(step.get('Tolerance', 0.05))
    try:
        ft_cm = ctx.design.unitsManager.evaluateExpression(step.get('FrameThickness', 'frame_thickness'), 'cm')
    except Exception as e:
        ctx.logger.log(f"LINE-CIRCLE CORNER: failed to evaluate frame thickness: {e}", "ERROR")
        return

    all_points = _collect_sketch_points(sketch)
    if not all_points:
        ctx.logger.log(f"LINE-CIRCLE CORNER: no SketchPoints found in {s_name}, cannot resolve", "WARNING")
        return

    for label, cfg in corners.items():
        far_id, near_id, arc_id, inner_id = (cfg.get('LineFarID'), cfg.get('LineNearID'),
                                              cfg.get('ArcID'), cfg.get('InnerID'))
        if not (far_id and near_id and arc_id and inner_id):
            ctx.logger.log(f"LINE-CIRCLE CORNER {label}: missing LineFarID/LineNearID/ArcID/InnerID, skipping", "WARNING")
            continue

        emap = ctx.entity_map.get(s_name, {})
        far_ent, near_ent, arc_ent = emap.get(far_id), emap.get(near_id), emap.get(arc_id)
        missing = [n for n, e in (('LineFarID', far_ent), ('LineNearID', near_ent), ('ArcID', arc_ent)) if e is None]
        if missing:
            ctx.logger.log(f"LINE-CIRCLE CORNER {label}: {', '.join(missing)} not in entity_map for {s_name}", "WARNING")
            continue

        try:
            far_pt = (float(far_ent.geometry.x), float(far_ent.geometry.y))
            near_pt = (float(near_ent.geometry.x), float(near_ent.geometry.y))
            arc_geom = arc_ent.geometry
            circle_center = (float(arc_geom.center.x), float(arc_geom.center.y))
            circle_radius = float(arc_geom.radius)
        except Exception as e:
            ctx.logger.log(f"LINE-CIRCLE CORNER {label}: failed to read live geometry: {e}", "WARNING")
            continue

        e_in = line_circle_corner(far_pt, near_pt, (0.0, 0.0), ft_cm, circle_center, circle_radius,
                                   concave=cfg.get('Concave', True))

        nearest_pt, nearest_dist = _find_nearest_point(all_points, e_in[0], e_in[1])
        if nearest_pt is None or nearest_dist > tolerance:
            ctx.logger.log(
                f"LINE-CIRCLE CORNER {label}: no SketchPoint within {tolerance:.3f} "
                f"cm of expected ({e_in[0]:.3f}, {e_in[1]:.3f}); nearest was {nearest_dist:.4f} cm",
                "WARNING")
            continue

        ctx.set_id(nearest_pt, s_name, "corner", override_id=inner_id)
        ctx.logger.log(
            f"LINE-CIRCLE CORNER {label}: resolved {inner_id} at "
            f"({e_in[0]:.3f}, {e_in[1]:.3f}) [match dist={nearest_dist:.4f} cm]")
