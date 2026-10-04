"""
Geometry Step — Creates sketch entities (Line, Arc3Point, Rectangle, Point).

Each function takes a BuildContext, the active sketch, the sketch name key,
and the geometry spec dict from the template data.
"""
import adsk.core, adsk.fusion
import json
import math
import random


def _fix_rebuild_start_end(ctx, s_name, geom, geo_id, entity, want_sx):
    """H23 item 17: on a `Rebuild`, re-running `addByThreePoints` on a sketch that already has significant
    other content does NOT reliably keep `startSketchPoint`/`endSketchPoint` matching the FIRST/THIRD seed
    point the way the entity's original (first-ever) creation did -- MEASURED live: rebuilding `top_edge`
    with the identical seed Points it was first created with swapped which physical point ended up tagged
    `:S` vs `:E`, silently sending a downstream miter to the wrong corner. Re-tag `:S`/`:E` (and the
    FrameBuilder StartID/EndID attributes `set_id` already wrote) to match the REQUESTED point order, not
    whatever Fusion happened to call "start" this time.

    `want_sx` is the ALREADY-RESOLVED x the caller just used to build `pts[0]` -- H23 item 47: a
    `{'SeedFrom': {...}}` point can only be resolved while its own source entity is still the PRIOR
    one in `entity_map` (before this rebuild overwrote that entry with the new entity); re-resolving
    `geom["Points"][0]` from here, after the rebuild, would read the NEW entity's own just-created
    endpoint instead of the value actually requested.
    """
    try:
        actual_sx = entity.startSketchPoint.geometry.x
        if abs(want_sx - actual_sx) > 0.01:  # cm; a real swap, not float noise
            start_id = geom.get("StartID", f"{geo_id}:S")
            end_id = geom.get("EndID", f"{geo_id}:E")
            ctx.set_id(entity.startSketchPoint, s_name, "point", override_id=end_id)
            ctx.set_id(entity.endSketchPoint, s_name, "point", override_id=start_id)
            ctx.logger.log(f"REBUILD: {geo_id} start/end swapped vs. requested order -- re-tagged")
    except Exception as e:
        ctx.logger.log(f"REBUILD START/END CHECK FAILED: {geo_id}: {e}", "WARNING")


def _delete_existing(ctx, s_name, geo_id):
    """H23 item 17: `Rebuild` support for `Arc3Point` -- delete whatever entity is
    currently registered under `geo_id` (if any) before recreating it. For an arc
    whose branch (short vs. reflex) a constraint-based Fix/Coincident chain cannot
    reliably hold (see template_10/phases/p02_03_loop.py's own docstring), the only
    sure fix is to re-run `addByThreePoints` fresh, with no constraint history at
    all, using the NOW-confirmed-correct endpoints -- the same deterministic
    construction that already gets the branch right on first creation, every time.
    """
    existing = ctx.entity_map.get(s_name, {}).get(geo_id)
    if existing:
        try:
            existing.deleteMe()
            ctx.logger.log(f"REBUILD: deleted existing {geo_id} before recreating")
        except Exception as e:
            ctx.logger.log(f"REBUILD DELETE FAILED: {geo_id}: {e}", "WARNING")


def nudge_point_to_target(ctx, point, target, radius=0.01):
    """
    Displaces a sketch point by a random amount within a specified radius
    around a target coordinate. This 'jitters' the solver out of local minima.
    
    If the point is a derived point (like an Arc Center), it proxies the nudge
    to the parent arc's start point.
    """
    try:
        # 1. Determine the 'Real' point to move (Fusion doesn't allow moving Arc Centers directly)
        p_to_move = point
        is_center = False
        
        # Check if this point is an Arc Center
        try:
            if hasattr(point, 'parentSketchArcs') and point.parentSketchArcs.count > 0:
                p_to_move = point.parentSketchArcs.item(0).startSketchPoint
                is_center = True
        except Exception:
            pass

        # 2. Generate random offset
        dx = radius * (0.5 - random.random()) * 2
        dy = radius * (0.5 - random.random()) * 2
        
        # 3. Apply the nudge
        # If it's a center point, we move the proxy point toward the center's target
        # (This still jitters the solver effectively for the center weld)
        current_geo = p_to_move.geometry
        new_p = adsk.core.Point3D.create(current_geo.x + dx, current_geo.y + dy, 0)
        p_to_move.geometry = new_p
        
        msg = f"  > JITTER NUDGE: Moved {'Arc Start Point' if is_center else 'Point'} to ({new_p.x:.4f}, {new_p.y:.4f})"
        ctx.logger.log(msg)
    except Exception as e:
        ctx.logger.log(f"  > JITTER NUDGE FAILED: {e}", "WARNING")




def geom_step(ctx, sketch, s_name, geom):
    """
    Dispatch geometry creation based on geom["Type"].

    Supported types: Line, Arc3Point, Rectangle / RectangleCenter, Point.
    """
    geo_type = geom["Type"]
    geo_id = geom["ID"]
    curves = sketch.sketchCurves
    entity = None

    if geo_type == "Line":
        entity = _create_line(ctx, curves, s_name, geom, geo_id)
    elif geo_type == "Arc3Point":
        entity, want_sx = _create_arc3(ctx, sketch, curves, s_name, geom, geo_id)
        if geom.get("Rebuild") and entity:
            _fix_rebuild_start_end(ctx, s_name, geom, geo_id, entity, want_sx)
    elif geo_type in ("Rectangle", "RectangleCenter"):
        entity = _create_rectangle(ctx, sketch, curves, s_name, geom, geo_id)
    elif geo_type == "Point":
        entity = _create_point(ctx, sketch, s_name, geom, geo_id)

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
# Point (bare construction/reference point, no curve)
# ------------------------------------------------------------------
def _point_seed_from(ctx, s_name, seed_from, geo_id):
    """H23 item 47: a `{'SeedFrom': {'id': <already-built line/arc step ID>, 'side': 'left' or
    'right'}}` point spec -- resolves to whichever of that OTHER entity's two CURRENT endpoints is
    further left (smaller x) or right (larger x), chosen by actual geometry, never by Fusion's own
    `:S`/`:E` label (MEASURED, item 46: `addByThreePoints` assigns `startSketchPoint`/
    `endSketchPoint` by the arc's own geometric direction, not argument order -- `:S` is not
    reliably "the one that was seeded as the left point"). This reads the source's LIVE, CURRENT
    geometry at build time (the source entity must already exist in `entity_map` -- its own step
    must come earlier in this SAME build sequence, and if the source is about to be rebuilt itself,
    this must be called BEFORE that deletion happens) -- a Point anchor needs to track wherever the
    seeded arc's endpoint ACTUALLY landed after `addByThreePoints`, not a declaration-time literal.

    H23 item 78c: `'side': 'short-arc-mid'` -- the SOURCE ARC's own minor-arc midpoint, derived from
    its CURRENT center/radius/endpoints, not a declaration-time literal either. Fixes a real bug
    this item found (affects T10's own archRise handle too, not just T18's): a `Rebuild` arc whose
    two ends track a seed via `SeedFrom` but whose own forcing/apex point was a FIXED literal (e.g.
    `template_10/phases/p02_12_arch_rebuild.py`'s own old `LY`, "the safe zone's own top line")
    assumed the apex always sits on that one fixed line -- true only for the ONE archRise value that
    literal happened to be tuned against. Every OTHER archRise sends a seeded arc whose real apex is
    at a genuinely different height (`hourglassConstruction`'s own sagitta-circle `arch` block:
    apex = chord + archRise, no fixed ceiling at all), so the old literal silently built the WRONG
    circle at the range ends -- not a branch-selection ambiguity like the entries above, a flatly
    incorrect target. The MINOR arc's own midpoint needs no stored apex at all: for a circle of
    radius `r` centred at `C` through two known points `S`/`E`, it is the point `r` out from `C`
    along `unit(S-C) + unit(E-C)` -- the two points' own angular bisector, which always lies on the
    SHORTER of the two arcs they divide the circle into (the sum of two unit vectors across an angle
    < 180 deg always leans into that smaller angle; exactly 180 deg, S and E diametrically opposite,
    has no unique minor arc and is treated as an error rather than guessed at)."""
    src = ctx.entity_map.get(s_name, {}).get(seed_from["id"])
    if src is None:
        raise ValueError(f"SeedFrom {seed_from['id']!r} (point {geo_id!r}): no such built entity yet")
    if seed_from.get("side") == "short-arc-mid":
        c = src.centerSketchPoint.geometry
        r = src.radius
        s, e = src.startSketchPoint.geometry, src.endSketchPoint.geometry
        us, ue = (s.x - c.x, s.y - c.y), (e.x - c.x, e.y - c.y)
        us_n, ue_n = math.hypot(*us), math.hypot(*ue)
        bx, by = us[0] / us_n + ue[0] / ue_n, us[1] / us_n + ue[1] / ue_n
        b_n = math.hypot(bx, by)
        if b_n < 1e-9:
            raise ValueError(f"SeedFrom {seed_from['id']!r} (point {geo_id!r}): short-arc-mid is "
                              f"undefined -- source arc's own two endpoints are diametrically opposite")
        return c.x + r * bx / b_n, c.y + r * by / b_n
    ends = [src.startSketchPoint.geometry, src.endSketchPoint.geometry]
    ends.sort(key=lambda g: g.x)
    chosen = ends[0] if seed_from.get("side") == "left" else ends[-1]
    return chosen.x, chosen.y


def _resolve_point_spec(ctx, s_name, p, geo_id):
    """One point in a Point/Line/Arc3Point step's own `Points` list: either the usual literal
    `[x_expr, y_expr]` pair (resolved via `ctx.resolve_val`), or a `{'SeedFrom': {...}}` dict
    (resolved via `_point_seed_from`, live geometry). Declared ONCE, shared by every geometry
    creator so a template can mix literal and SeedFrom points within the SAME step (e.g. a
    Rebuild arc whose two ends track a seed (`side: 'left'`/`'right'`) and whose own forcing/apex
    point tracks that SAME arc's own minor-arc midpoint (`side: 'short-arc-mid'`) -- see
    sketches/template_10/phases/p02_12_arch_rebuild.py)."""
    if isinstance(p, dict) and "SeedFrom" in p:
        return _point_seed_from(ctx, s_name, p["SeedFrom"], geo_id)
    return ctx.resolve_val(p[0]), ctx.resolve_val(p[1])


def _create_point(ctx, sketch, s_name, geom, geo_id):
    x, y = _resolve_point_spec(ctx, s_name, geom["Points"][0], geo_id)
    p = adsk.core.Point3D.create(x, y, 0)
    entity = sketch.sketchPoints.add(p)
    ctx.logger.log(f"POINT {geo_id}: ({p.x:.2f},{p.y:.2f})")
    return entity


# ------------------------------------------------------------------
# Arc (3-point)
# ------------------------------------------------------------------
def _create_arc3(ctx, sketch, curves, s_name, geom, geo_id):
    # H23 item 47: resolve every point BEFORE a Rebuild deletes the existing entity under this
    # SAME geo_id -- a {'SeedFrom': {'id': geo_id, ...}} point (the rebuild tracking its OWN prior
    # seeded self, e.g. template_10's own top_edge) needs that prior entity to still exist in
    # entity_map at resolution time; deleting first would resolve against nothing.
    pts = [
        adsk.core.Point3D.create(*_resolve_point_spec(ctx, s_name, p, geo_id), 0)
        for p in geom["Points"]
    ]
    if geom.get("Rebuild"):
        _delete_existing(ctx, s_name, geo_id)

    entity = curves.sketchArcs.addByThreePoints(pts[0], pts[1], pts[2])

    ctx.set_id(entity, s_name, "arc", override_id=geo_id)
    ctx.set_id(entity.startSketchPoint, s_name, "point", override_id=f"{geo_id}:S")
    ctx.set_id(entity.endSketchPoint, s_name, "point", override_id=f"{geo_id}:E")
    center_id = geom.get("CenterID", f"{geo_id}:C")
    ctx.set_id(entity.centerSketchPoint, s_name, "point", override_id=center_id)

    # Persist semantic metadata for inspector and debug tooling.
    try:
        if hasattr(entity, 'attributes'):
            for attr_name in ('StartID', 'EndID', 'CenterID'):
                attr_value = geom.get(attr_name)
                if attr_value is not None:
                    existing = entity.attributes.itemByName('FrameBuilder', attr_name)
                    if existing:
                        existing.value = str(attr_value)
                    else:
                        entity.attributes.add('FrameBuilder', attr_name, str(attr_value))
            bulge_value = geom.get('Bulge')
            if bulge_value is not None:
                bulge_text = json.dumps(bulge_value) if isinstance(bulge_value, (list, tuple)) else str(bulge_value)
                existing = entity.attributes.itemByName('FrameBuilder', 'Bulge')
                if existing:
                    existing.value = bulge_text
                else:
                    entity.attributes.add('FrameBuilder', 'Bulge', bulge_text)
    except Exception:
        pass

    ctx.logger.log(f"ARC {geo_id}: P1({pts[0].x:.2f},{pts[0].y:.2f}) P2({pts[1].x:.2f},{pts[1].y:.2f})")

    return entity, pts[0].x


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
    except Exception:
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
