"""
Geometry Step — Creates sketch entities (Line, Arc3Point, Rectangle).

Each function takes a BuildContext, the active sketch, the sketch name key,
and the geometry spec dict from the template data.
"""
import adsk.core, adsk.fusion


def geom_step(ctx, sketch, s_name, geom):
    """
    Dispatch geometry creation based on geom["Type"].

    Supported types: Line, Arc3Point, Rectangle / RectangleCenter.
    """
    geo_type = geom["Type"]
    geo_id = geom["ID"]
    curves = sketch.sketchCurves
    entity = None

    if geo_type == "Line":
        entity = _create_line(ctx, curves, s_name, geom, geo_id)
    elif geo_type == "Arc3Point":
        entity = _create_arc3(ctx, curves, s_name, geom, geo_id)
    elif geo_type in ("Rectangle", "RectangleCenter"):
        entity = _create_rectangle(ctx, sketch, curves, s_name, geom, geo_id)

    if entity:
        if geom.get("IsConstruction"):
            entity.isConstruction = True
        ctx.set_id(entity, s_name, "feature", override_id=geo_id)


# ------------------------------------------------------------------
# Line
# ------------------------------------------------------------------
def _create_line(ctx, curves, s_name, geom, geo_id):
    p1 = adsk.core.Point3D.create(
        ctx.resolve_val(geom["Points"][0][0]),
        ctx.resolve_val(geom["Points"][0][1]), 0)
    p2 = adsk.core.Point3D.create(
        ctx.resolve_val(geom["Points"][1][0]),
        ctx.resolve_val(geom["Points"][1][1]), 0)
    entity = curves.sketchLines.addByTwoPoints(p1, p2)
    ctx.logger.log(f"LINE {geo_id}: ({p1.x:.2f},{p1.y:.2f}) -> ({p2.x:.2f},{p2.y:.2f})")

    # Tag start / end points
    ctx.set_id(entity, s_name, "line", override_id=geo_id)
    ctx.set_id(entity.startSketchPoint, s_name, "point", override_id=f"{geo_id}:S")
    ctx.set_id(entity.endSketchPoint, s_name, "point", override_id=f"{geo_id}:E")

    # Legacy ID support
    start_id = geom.get("StartID")
    end_id = geom.get("EndID")
    if start_id:
        ctx.set_id(entity.startSketchPoint, s_name, "point", override_id=start_id)
    if end_id:
        ctx.set_id(entity.endSketchPoint, s_name, "point", override_id=end_id)

    return entity


# ------------------------------------------------------------------
# Arc (3-point)
# ------------------------------------------------------------------
def _create_arc3(ctx, curves, s_name, geom, geo_id):
    pts = [
        adsk.core.Point3D.create(ctx.resolve_val(p[0]), ctx.resolve_val(p[1]), 0)
        for p in geom["Points"]
    ]
    entity = curves.sketchArcs.addByThreePoints(pts[0], pts[1], pts[2])

    ctx.set_id(entity, s_name, "arc", override_id=geo_id)
    ctx.set_id(entity.startSketchPoint, s_name, "point", override_id=f"{geo_id}:S")
    ctx.set_id(entity.endSketchPoint, s_name, "point", override_id=f"{geo_id}:E")
    ctx.set_id(entity.centerSketchPoint, s_name, "point", override_id=f"{geo_id}:C")
    ctx.logger.log(f"ARC {geo_id}: P1({pts[0].x:.2f},{pts[0].y:.2f}) P2({pts[1].x:.2f},{pts[1].y:.2f})")

    return entity


# ------------------------------------------------------------------
# Center-point Rectangle
# ------------------------------------------------------------------
def _create_rectangle(ctx, sketch, curves, s_name, geom, geo_id):
    cp = adsk.core.Point3D.create(
        ctx.resolve_val(geom["Center"][0]),
        ctx.resolve_val(geom["Center"][1]), 0)
    w = ctx.resolve_val(geom["Size"][0])
    h = ctx.resolve_val(geom["Size"][1])
    corner = adsk.core.Point3D.create(cp.x + w / 2, cp.y + h / 2, 0)
    rect = curves.sketchLines.addCenterPointRectangle(cp, corner)
    ctx.logger.log(
        f"RECT {geo_id}: Center({cp.x:.3f},{cp.y:.3f}) "
        f"W={w:.3f} H={h:.3f} | Total API Items: {rect.count}")

    # 1. Classify boundary lines spatially
    lines = [rect.item(i) for i in range(min(rect.count, 4))]
    classified = ctx.classify_rect_lines(lines)
    
    # Map from semantic keys to LineIDs from geom spec
    # Expected order in template_1: [top, right, bottom, left]
    ids = geom.get("LineIDs", ["BB_top", "BB_right", "BB_bottom", "BB_left"])
    
    mapping = {
        "top": ids[0] if len(ids) > 0 else f"{geo_id}_top",
        "right": ids[1] if len(ids) > 1 else f"{geo_id}_right",
        "bottom": ids[2] if len(ids) > 2 else f"{geo_id}_bottom",
        "left": ids[3] if len(ids) > 3 else f"{geo_id}_left"
    }
    
    for semantic, curve in classified.items():
        ctx.set_id(curve, s_name, "line", override_id=mapping[semantic])
        ctx.logger.log(f"RECT {geo_id} LINE {semantic}: Assigned ID={mapping[semantic]}")

    # 2. Tag Diagonals and Center Point
    if rect.count >= 6:
        _tag_existing_diagonals(ctx, rect, s_name, geo_id)
    else:
        ctx.logger.log(f"RECT {geo_id}: No diagonals from API ({rect.count} items), creating manually")
        _create_manual_diagonals(ctx, sketch, curves, rect, s_name, geo_id)

    # 3. Tag Vertices (The Corner ID hardening)
    # Collect all unique points from the 4 lines
    pts = []
    for line in lines:
        pts.extend([line.startSketchPoint, line.endSketchPoint])
    
    # Deduplicate by entityToken (SketchPoints are often shared)
    unique_pts = {}
    for p in pts:
        unique_pts[p.entityToken] = p
    
    # Classify by quadrant relative to the center point (or origin if not found)
    center_pt = ctx.entity_map[s_name].get(f"{geo_id}:C")
    quadrants = ctx.classify_points_by_quadrant(list(unique_pts.values()), center_pt)
    
    # Assign unique IDs for vertices
    for quad, p in quadrants.items():
        v_id = f"{geo_id}_V_{quad}"
        ctx.set_id(p, s_name, "vertex", override_id=v_id)
        ctx.logger.log(f"RECT {geo_id} VERTEX {quad}: Assigned ID={v_id}")

    return rect.item(0)


def _tag_existing_diagonals(ctx, rect, s_name, geo_id):
    """Tag the diagonals that Fusion created automatically."""
    for i in range(4, 6):
        diag = rect.item(i)
        diag.isConstruction = True
        diag_name = f"{geo_id}_diag{i - 3}"
        ctx.set_id(diag, s_name, "line", override_id=diag_name)
        ctx.logger.log(f"RECT {geo_id} DIAG {i}: Assigned ID={diag_name}")

    # Center point from diagonal intersection
    ctx.set_id(rect.item(4).startSketchPoint, s_name, "point", override_id=f"{geo_id}:C")
    ctx.logger.log(f"RECT {geo_id}: Diagonals successfully tagged")


def _create_manual_diagonals(ctx, sketch, curves, rect, s_name, geo_id):
    """Fallback: manually create diagonals when Fusion doesn't provide them."""
    corners = [rect.item(i).startSketchPoint for i in range(min(rect.count, 4))]
    if len(corners) < 4:
        return

    nudge = 1.0  # cm — outside Fusion's 0.01cm merge tolerance
    diag1 = _draw_diagonal(ctx, sketch, curves, corners[0], corners[2], s_name, geo_id, 1, nudge)
    diag2 = _draw_diagonal(ctx, sketch, curves, corners[1], corners[3], s_name, geo_id, 2, nudge)

    # Center point at diagonal intersection, coincident to origin
    try:
        center_pt = sketch.sketchPoints.add(adsk.core.Point3D.create(nudge, nudge, 0))
        if diag1 and diag1.isValid:
            sketch.geometricConstraints.addCoincident(center_pt, diag1)
        if diag2 and diag2.isValid:
            sketch.geometricConstraints.addCoincident(center_pt, diag2)
        sketch.geometricConstraints.addCoincident(center_pt, sketch.originPoint)
        ctx.set_id(center_pt, s_name, "point", override_id=f"{geo_id}:C")
        ctx.logger.log(f"RECT {geo_id}: Center point on diag intersection + origin OK")
    except Exception as e:
        ctx.set_id(sketch.originPoint, s_name, "point", override_id=f"{geo_id}:C")
        ctx.logger.log_error(f"RECT {geo_id}: Center point FAIL ({e}), using origin")


def _draw_diagonal(ctx, sketch, curves, corner_a, corner_b, s_name, geo_id, index, nudge):
    """Draw a construction diagonal between two rectangle corners."""
    try:
        pa = corner_a.geometry
        pb = corner_b.geometry
        mid_x = (pa.x + pb.x) / 2
        mid_y = (pa.y + pb.y) / 2
        diag = curves.sketchLines.addByTwoPoints(
            adsk.core.Point3D.create(mid_x - nudge, mid_y - nudge, 0),
            adsk.core.Point3D.create(mid_x + nudge, mid_y + nudge, 0))
        diag.isConstruction = True
        ctx.set_id(diag, s_name, "line", override_id=f"{geo_id}_diag{index}")
        sketch.geometricConstraints.addCoincident(diag.startSketchPoint, corner_a)
        sketch.geometricConstraints.addCoincident(diag.endSketchPoint, corner_b)
        ctx.logger.log(f"RECT {geo_id}: Diag{index} OK")
        return diag
    except Exception as e:
        ctx.logger.log_error(f"RECT {geo_id}: Diag{index} FAIL: {e}")
        return None
