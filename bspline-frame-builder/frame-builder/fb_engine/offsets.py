"""
Offset Step — Creates offset curves from closed loops of sketch entities.

Includes the modern addOffset2 API (parametric), fallback to sketch.offset(),
loop integrity auditing, and dynamic corner identification.

FIX: Uses addOffset2 (parametric) as primary method with centroid-based
direction, falling back to sketch.offset() with proper direction point.
"""
import adsk.core, adsk.fusion, traceback


def offset_step(ctx, sketch, s_name, off):
    """
    Offset a collection of sketch curves inward or outward.

    Parameters
    ----------
    ctx     : BuildContext
    sketch  : adsk.fusion.Sketch
    s_name  : str — sketch name key
    off     : dict with keys SourceID (list), DistanceExpr, Direction,
              TargetIDs, CornerIDs
    """
    coll = _collect_source_curves(ctx, sketch, s_name, off)
    if not coll or coll.count == 0:
        ctx.logger.log(f"OFFSET SKIP: No source curves collected for {s_name}", "WARNING")
        return

    try:
        d_expr = off.get("DistanceExpr", "0")

        # --- Audit the loop before attempting offset ---
        _audit_loop_integrity(ctx, coll, s_name)

        # --- Primary: addOffset2 (parametric) ---
        offset_result = _try_parametric_offset(ctx, sketch, coll, d_expr, s_name)

        # --- Fallback: sketch.offset() (non-parametric) ---
        if not offset_result:
            offset_result = _try_sketch_offset(ctx, sketch, coll, d_expr, s_name)

        # --- Tag results ---
        if offset_result and offset_result.count > 0:
            ctx.logger.log(f"OFFSET SUCCESS: Generated {offset_result.count} curves")
            _tag_offset_results(ctx, s_name, off, offset_result)
        else:
            ctx.logger.log(f"OFFSET EMPTY: No curves returned for {s_name}", "WARNING")

    except Exception:
        ctx.logger.log_error(f"OFFSET CRASH in {s_name}")


def step_step(ctx, sketch, s_name, step):
    """
    Generic step dispatcher. Currently supports Type="Offset".
    """
    step_type = step.get("Type")
    if step_type == "Offset":
        source = step.get("SourceID")
        if isinstance(source, str):
            source = [source]
        off = {
            "SourceID": source or [],
            "DistanceExpr": step.get("DistanceExpr", "0"),
            "Direction": step.get("Direction"),
            "TargetIDs": step.get("TargetIDs", []),
            "TargetID": step.get("TargetID"),
            "CornerIDs": step.get("CornerIDs", {})
        }
        offset_step(ctx, sketch, s_name, off)

        # If a single named target is requested, map the first offset curve
        if off.get("TargetID"):
            last_ids = off.get("TargetIDs", [])
            if not last_ids:
                for key in list(ctx.entity_map[s_name].keys()):
                    if key.startswith("offset-"):
                        ctx.set_id(
                            ctx.entity_map[s_name][key], s_name, "offset",
                            override_id=off["TargetID"])
                        break


# ------------------------------------------------------------------
# Source curve collection
# ------------------------------------------------------------------
def _collect_source_curves(ctx, sketch, s_name, off):
    """Build an ObjectCollection of SketchCurves from the source IDs."""
    coll = adsk.core.ObjectCollection.create()
    missing = []
    for sid in off["SourceID"]:
        e = ctx.entity_map[s_name].get(sid)
        if e:
            # Ensure we're adding a SketchCurve (required by offset API)
            curve = adsk.fusion.SketchCurve.cast(e)
            if curve:
                coll.add(curve)
            else:
                coll.add(e)  # let the API sort it out
        else:
            missing.append(sid)
    if missing:
        ctx.logger.log(f"OFFSET MISS: IDs not found in {s_name}: {missing}", "ERROR")
    return coll


# ------------------------------------------------------------------
# Primary: Parametric offset (addOffset2)
# ------------------------------------------------------------------
def _try_parametric_offset(ctx, sketch, coll, d_expr, s_name):
    """
    Attempt the modern parametric offset via createOffsetInput + addOffset2.
    Returns the resulting curve collection or None.
    """
    try:
        val_input = adsk.core.ValueInput.createByString(str(d_expr))
        offset_input = sketch.geometricConstraints.createOffsetInput(coll, val_input)
        offset_constraint = sketch.geometricConstraints.addOffset2(offset_input)

        if offset_constraint and offset_constraint.isValid:
            # addOffset2 returns a constraint, not curves directly.
            # The offset curves are children of the constraint.
            # Collect offset entities from the sketch (newly added curves).
            ctx.logger.log(f"OFFSET PARAMETRIC OK: addOffset2 succeeded for {s_name}")
            # Return the offset constraint's curves if accessible
            if hasattr(offset_constraint, 'offsetCurves'):
                return offset_constraint.offsetCurves
            # Fallback: we can't easily get the curves from the constraint,
            # but the constraint itself succeeded — the geometry is in the sketch.
            ctx.logger.log(
                f"OFFSET NOTE: Constraint created but curve extraction not available. "
                f"Sketch entities were created.", "DEBUG")
            return None
    except Exception as e:
        ctx.logger.log(
            f"OFFSET PARAMETRIC FAIL: addOffset2 not available or failed for {s_name}: {e}",
            "DEBUG")
    return None


# ------------------------------------------------------------------
# Fallback: Non-parametric offset (sketch.offset)
# ------------------------------------------------------------------
def _try_sketch_offset(ctx, sketch, coll, d_expr, s_name):
    """
    Fallback using sketch.offset() which takes a numeric distance in cm.
    Uses centroid of source curves as the direction point.
    """
    d_val = ctx.resolve_val(d_expr)
    dir_pt = _compute_centroid_direction(ctx, coll, s_name)

    ctx.logger.log(
        f"OFFSET RUN: {s_name} Distance={d_val:.3f} cm "
        f"DirPt=({dir_pt.x:.3f},{dir_pt.y:.3f})")

    # Attempt 1: centroid is inside the shape, so use abs(d_val) to offset inward
    try:
        result = sketch.offset(coll, dir_pt, abs(d_val))
        if result and result.count > 0:
            return result
    except Exception as e:
        ctx.logger.log(f"OFFSET ATTEMPT 1 FAIL: {e}", "WARNING")

    # Attempt 2: flip distance sign
    try:
        ctx.logger.log(f"OFFSET RETRY: flipping distance sign for {s_name}", "WARNING")
        result = sketch.offset(coll, dir_pt, -d_val)
        if result and result.count > 0:
            return result
    except Exception as e:
        ctx.logger.log(f"OFFSET ATTEMPT 2 FAIL: {e}", "WARNING")

    # Attempt 3: use origin as direction point (most reliable for centered shapes)
    try:
        origin_pt = adsk.core.Point3D.create(0, 0, 0)
        ctx.logger.log(f"OFFSET RETRY: using origin as direction for {s_name}", "WARNING")
        result = sketch.offset(coll, origin_pt, abs(d_val))
        if result and result.count > 0:
            return result
    except Exception as e:
        ctx.logger.log(f"OFFSET ATTEMPT 3 (origin) FAIL: {e}", "ERROR")

    ctx.logger.log(f"OFFSET ALL ATTEMPTS EXHAUSTED for {s_name}", "ERROR")
    return None


def _compute_centroid_direction(ctx, coll, s_name):
    """
    Compute the centroid of the source curves' bounding box.
    Falls back to origin (0,0,0) if bbox computation fails.
    """
    bbox = None
    for i in range(coll.count):
        e = coll.item(i)
        if hasattr(e, 'boundingBox'):
            b = e.boundingBox
            if bbox is None:
                bbox = adsk.core.BoundingBox3D.create(b.minPoint.copy(), b.maxPoint.copy())
            else:
                bbox.combine(b)

    if bbox:
        cx = (bbox.minPoint.x + bbox.maxPoint.x) / 2
        cy = (bbox.minPoint.y + bbox.maxPoint.y) / 2
        ctx.logger.log(
            f"OFFSET CENTROID: ({cx:.3f}, {cy:.3f}) for {s_name}", "DEBUG")
        return adsk.core.Point3D.create(cx, cy, 0)

    ctx.logger.log(
        f"OFFSET CENTROID: BBox failed, using origin for {s_name}", "WARNING")
    return adsk.core.Point3D.create(0, 0, 0)


# ------------------------------------------------------------------
# Result tagging
# ------------------------------------------------------------------
def _tag_offset_results(ctx, s_name, off, offset_curves):
    """
    Assign IDs to the offset result curves and register :S / :E endpoints.

    For loops with more than 4 target IDs (e.g. a 12-segment body outline),
    each offset curve is matched to the source curve whose centroid is nearest
    (proximity mapping). For exactly 4 curves, the legacy spatial
    classify_rect_lines path is used for backward compatibility.
    """
    curves = [offset_curves.item(i) for i in range(offset_curves.count)]
    t_ids  = off.get("TargetIDs", ["offset_top", "offset_right", "offset_bottom", "offset_left"])

    if len(t_ids) > 4:
        # --- Multi-curve path: match each offset curve to nearest source curve ---
        _tag_by_proximity(ctx, s_name, off, curves, t_ids)
    else:
        # --- 4-curve rectangular path: spatial top/right/bottom/left classify ---
        classified = ctx.classify_rect_lines(curves)
        mapping = {
            "top":    t_ids[0] if len(t_ids) > 0 else "offset_top",
            "right":  t_ids[1] if len(t_ids) > 1 else "offset_right",
            "bottom": t_ids[2] if len(t_ids) > 2 else "offset_bottom",
            "left":   t_ids[3] if len(t_ids) > 3 else "offset_left",
        }
        for semantic, curve in classified.items():
            cid = mapping[semantic]
            _register_curve(ctx, s_name, curve, cid)

    # --- Corner tagging: pick outermost vertex per quadrant ---
    corner_ids = off.get("CornerIDs", {})
    if corner_ids:
        all_pts = []
        for c in curves:
            all_pts.extend([c.startSketchPoint, c.endSketchPoint])

        unique_pts = {}
        for p in all_pts:
            unique_pts[p.entityToken] = p

        ctx.logger.log(f"CLASSIFYING OFFSET CORNERS in {s_name}")
        quadrants = ctx.classify_points_by_quadrant(list(unique_pts.values()))

        for quad, p in quadrants.items():
            cid = corner_ids.get(quad)
            if cid:
                ctx.set_id(p, s_name, "corner", override_id=cid)
                g = p.geometry
                ctx.logger.log(f"DYNAMIC CORNER {quad}: Tagged {cid} at ({g.x:.3f}, {g.y:.3f})")


def _curve_centroid(curve):
    """Return (cx, cy) for a sketch curve via its bounding box."""
    try:
        b = curve.boundingBox
        return (
            (b.minPoint.x + b.maxPoint.x) / 2,
            (b.minPoint.y + b.maxPoint.y) / 2,
        )
    except Exception:
        return (0.0, 0.0)


def _register_curve(ctx, s_name, curve, cid):
    """Tag a curve and its endpoints under the given ID."""
    ctx.set_id(curve, s_name, "offset", override_id=cid)
    ctx.logger.log(f"OFFSET {s_name}: Assigned ID={cid}")
    try:
        ctx.set_id(curve.startSketchPoint, s_name, "point", override_id=f"{cid}:S")
        ctx.set_id(curve.endSketchPoint,   s_name, "point", override_id=f"{cid}:E")
    except Exception:
        pass


def _tag_by_proximity(ctx, s_name, off, offset_curves, t_ids):
    """
    Match each offset curve to the nearest source curve by centroid distance,
    then assign the corresponding TargetID.  Any unmatched offset curves get
    a generic fallback ID so they still appear in the entity_map.
    """
    # Build source centroids list: (cx, cy, t_id)
    src_centroids = []
    for sid, tid in zip(off["SourceID"], t_ids):
        src_entity = ctx.entity_map[s_name].get(sid)
        if src_entity and hasattr(src_entity, 'boundingBox'):
            cx, cy = _curve_centroid(src_entity)
            src_centroids.append((cx, cy, tid))

    used = set()
    for curve in offset_curves:
        ocx, ocy = _curve_centroid(curve)
        best_tid  = None
        best_dist = float('inf')
        best_idx  = -1

        for i, (scx, scy, tid) in enumerate(src_centroids):
            if i in used:
                continue
            d = (ocx - scx) ** 2 + (ocy - scy) ** 2
            if d < best_dist:
                best_dist = d
                best_tid  = tid
                best_idx  = i

        if best_tid is not None:
            used.add(best_idx)
            _register_curve(ctx, s_name, curve, best_tid)
        else:
            # fallback: generic sequential ID
            fallback = f"offset_{len(used)}"
            _register_curve(ctx, s_name, curve, fallback)
            ctx.logger.log(
                f"OFFSET PROXIMITY: No source match for curve at ({ocx:.3f},{ocy:.3f}) "
                f"in {s_name}, using {fallback}", "WARNING")


# ------------------------------------------------------------------
# Loop integrity audit
# ------------------------------------------------------------------
def _audit_loop_integrity(ctx, coll, s_name):
    """Trace endpoints between consecutive curves to find gaps."""
    if not coll or coll.count < 2:
        return
    ctx.logger.log(f"LOOP AUDIT: Tracing {coll.count} segments for {s_name}", "DEBUG")
    for i in range(coll.count):
        c1 = coll.item(i)
        next_idx = (i + 1) % coll.count
        c2 = coll.item(next_idx)

        # Handle different curve types if necessary, but SketchCurve usually has points
        try:
            p1e = c1.endSketchPoint.geometry
            p2s = c2.startSketchPoint.geometry
            dist = p1e.distanceTo(p2s)

            ctx.logger.log(
                f"  SEG {i}: E({p1e.x:.4f}, {p1e.y:.4f}) -> "
                f"SEG {next_idx}: S({p2s.x:.4f}, {p2s.y:.4f}) Dist={dist:.4f} cm",
                "DEBUG")
            if dist > 0.001:
                ctx.logger.log(
                    f"  GAP DETECTED: {dist:.4f} cm between segments {i} and {next_idx} "
                    f"in {s_name}!", "WARNING")
        except:
            pass
