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
"""

import math


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
