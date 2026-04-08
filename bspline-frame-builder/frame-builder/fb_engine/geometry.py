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
# Center-point Rectangle (Harden version: Manual 4-line loop)
# ------------------------------------------------------------------
def _create_rectangle(ctx, sketch, curves, s_name, geom, geo_id):
    """
    Creates a rectangle as 4 discrete lines in a guaranteed clockwise loop.
    This resolves the endpoint-order issues that cause 28cm gaps in Offset.
    """
    cp_x = ctx.resolve_val(geom["Center"][0])
    cp_y = ctx.resolve_val(geom["Center"][1])
    w = ctx.resolve_val(geom["Size"][0])
    h = ctx.resolve_val(geom["Size"][1])

    # 1. Define 4 corners (TR, TL, BL, BR)
    half_w = w / 2
    half_h = h / 2
    pTR = adsk.core.Point3D.create(cp_x + half_w, cp_y + half_h, 0)
    pTL = adsk.core.Point3D.create(cp_x - half_w, cp_y + half_h, 0)
    pBL = adsk.core.Point3D.create(cp_x - half_w, cp_y - half_h, 0)
    pBR = adsk.core.Point3D.create(cp_x + half_w, cp_y - half_h, 0)

    # 2. Draw 4 lines in a clockwise loop
    # Note: Using addByTwoPoints and manually connecting start/end ensures shared points
    l_top    = curves.sketchLines.addByTwoPoints(pTL, pTR)
    l_right  = curves.sketchLines.addByTwoPoints(l_top.endSketchPoint, pBR)
    l_bottom = curves.sketchLines.addByTwoPoints(l_right.endSketchPoint, pBL)
    l_left   = curves.sketchLines.addByTwoPoints(l_bottom.endSketchPoint, l_top.startSketchPoint)

    ctx.logger.log(f"RECT {geo_id}: Manual 4-line loop created Center({cp_x:.3f},{cp_y:.3f}) W={w:.3f} H={h:.3f}")

    # 3. Apply IDs and Spatially Classify (using the helper to be safe)
    # ids expected order: [top, right, bottom, left]
    ids = geom.get("LineIDs", [f"{geo_id}_top", f"{geo_id}_right", f"{geo_id}_bottom", f"{geo_id}_left"])
    
    # We assign IDs based on our known loop order
    ctx.set_id(l_top,    s_name, "line", override_id=ids[0])
    ctx.set_id(l_right,  s_name, "line", override_id=ids[1])
    ctx.set_id(l_bottom, s_name, "line", override_id=ids[2])
    ctx.set_id(l_left,   s_name, "line", override_id=ids[3])

    # 4. Standard Rectangle Constraints (Perpendicular + H/V)
    try:
        constrs = sketch.geometricConstraints
        constrs.addHorizontal(l_top)
        constrs.addHorizontal(l_bottom)
        constrs.addVertical(l_left)
        constrs.addVertical(l_right)
        constrs.addPerpendicular(l_top, l_right)
        constrs.addPerpendicular(l_right, l_bottom)
        # Equality constraints help the solver stay square
        constrs.addEqual(l_top, l_bottom)
        constrs.addEqual(l_left, l_right)
    except:
        pass

    # 5. Tag Vertices (TR, TL, BL, BR)
    ctx.set_id(l_top.endSketchPoint,    s_name, "vertex", override_id=f"{geo_id}_V_TR")
    ctx.set_id(l_top.startSketchPoint,  s_name, "vertex", override_id=f"{geo_id}_V_TL")
    ctx.set_id(l_bottom.endSketchPoint, s_name, "vertex", override_id=f"{geo_id}_V_BL")
    ctx.set_id(l_bottom.startSketchPoint, s_name, "vertex", override_id=f"{geo_id}_V_BR")

    # 6. Manual Diagonals and Center Point
    _create_manual_diagonals_lite(ctx, sketch, curves, l_top.startSketchPoint, l_bottom.startSketchPoint, l_top.endSketchPoint, l_bottom.endSketchPoint, s_name, geo_id)

    return l_top

def _create_manual_diagonals_lite(ctx, sketch, curves, pTL, pBR, pTR, pBL, s_name, geo_id):
    """Refined diagonal creation for the manual loop."""
    try:
        diag1 = curves.sketchLines.addByTwoPoints(pTL, pBR)
        diag2 = curves.sketchLines.addByTwoPoints(pTR, pBL)
        diag1.isConstruction = True
        diag2.isConstruction = True
        ctx.set_id(diag1, s_name, "line", override_id=f"{geo_id}_diag1")
        ctx.set_id(diag2, s_name, "line", override_id=f"{geo_id}_diag2")
        
        # Center point intersection
        center_pt = sketch.sketchPoints.add(adsk.core.Point3D.create(pTL.geometry.x + 0.1, pTL.geometry.y + 0.1, 0))
        sketch.geometricConstraints.addCoincident(center_pt, diag1)
        sketch.geometricConstraints.addCoincident(center_pt, diag2)
        # We only ground to origin here if CP is (0,0)
        # But for now let's just tag it. The template handles ORIGIN constraint if needed.
        ctx.set_id(center_pt, s_name, "point", override_id=f"{geo_id}:C")
    except Exception as e:
        ctx.logger.log_error(f"RECT {geo_id} Diag Lite FAIL: {e}")



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
