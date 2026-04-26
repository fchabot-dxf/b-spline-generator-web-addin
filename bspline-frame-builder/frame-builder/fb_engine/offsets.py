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

    # --- NEW: Direction-Agnostic Chain Sorting ---
    # We sort the collection into a continuous S->E chain before auditing or offsetting.
    sorted_coll = _reorder_to_chain(ctx, coll, s_name)
    coll = sorted_coll if sorted_coll else coll

    try:
        d_expr = off.get("DistanceExpr", "0")

        # --- Audit the loop (now supporting flipped connections) ---
        _audit_loop_integrity(ctx, coll, s_name)

        # --- Diagnostic: source-loop endpoint topology ---
        _audit_endpoint_topology(ctx, coll, s_name, label="source")


        # --- Primary: addOffset2 (parametric) ---
        offset_result = _try_parametric_offset(ctx, sketch, coll, d_expr, s_name)

        # --- Fallback: sketch.offset() (non-parametric) ---
        if not offset_result:
            offset_result = _try_sketch_offset(ctx, sketch, coll, d_expr, s_name)

        # --- Tag results ---
        if offset_result and offset_result.count > 0:
            ctx.logger.log(f"OFFSET SUCCESS: Generated {offset_result.count} curves")

            # --- Diagnostic: result-loop endpoint topology ---
            _audit_endpoint_topology(ctx, offset_result, s_name, label="result")

            # Pulse the solver so the new offset entities are fully
            # realized before we try to read .startSketchPoint /
            # .endSketchPoint and assign names.
            #
            # The engine runs offset steps inside an
            # isComputeDeferred=True window (intentionally, for
            # constraint stability). In deferred mode, the curve
            # collection returned by sketch.offset() / addOffset2 hands
            # back proxies that aren't yet finalized - reads like
            # .startSketchPoint may work, but writes like
            # ``entity.name = X`` silently no-op. Result: endpoints
            # never get registered as ID:S / ID:E in entity_map, and
            # downstream miters / constraints can't find them.
            #
            # Toggling False then True forces Fusion to do a single
            # compute pass (finalizing the new entities) and then
            # re-enter deferred mode for the miters that follow.
            try:
                sketch.isComputeDeferred = False
                sketch.isComputeDeferred = True
            except Exception as e:
                ctx.logger.log(
                    f"OFFSET PULSE FAIL in {s_name}: {e}", "WARNING")

            _tag_offset_results(ctx, s_name, off, offset_result)

            # --- Tag corner points if requested ---
            # When the offset step declares a CornerIDs map (e.g. for the
            # BB safe-zone rectangle), label the 4 corner SketchPoints so
            # downstream projection phases can find them.
            _tag_corner_points(ctx, s_name, off, offset_result)

            # --- Global Naming Sweep (Safety Net) ---
            # Even if addOffset2 failed or returned a generic name, we sweep and fix it.
            # We pass d_expr to ensure we name it exactly what the template requested.
            _ensure_parameter_naming(ctx, sketch, d_expr)
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
            # --- RENAMING LOGIC ---
            # addOffset2 creates an OffsetConstraint which OWNS the dimension.
            # We must reach into the dimension's parameter and force the expression.
            try:
                dim = offset_constraint.dimension
                if dim and dim.parameter:
                    # Link the expression to the parameter instead of the name.
                    dim.parameter.expression = d_expr
                    ctx.logger.log(f"OFFSET LINK SUCCESS: Dimension linked to '{d_expr}'")
            except Exception as name_e:
                ctx.logger.log(f"OFFSET LINK FAIL: Could not set expression: {name_e}", "WARNING")

            ctx.logger.log(f"OFFSET PARAMETRIC OK: addOffset2 succeeded for {s_name}")
            if hasattr(offset_constraint, 'offsetCurves'):
                return offset_constraint.offsetCurves
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
            # --- FORCED NAMING FIX ---
            # Standard offsets create generic 'dX' dimensions. We force-rename them 
            # to our parameter name (d_expr) if it's a string identifier.
            _force_rename_offset_dim(sketch, d_expr)
            return result
    except Exception as e:
        ctx.logger.log(f"OFFSET ATTEMPT 1 FAIL: {e}", "WARNING")

    # Attempt 2: flip distance sign
    try:
        ctx.logger.log(f"OFFSET RETRY: flipping distance sign for {s_name}", "WARNING")
        result = sketch.offset(coll, dir_pt, -d_val)
        if result and result.count > 0:
            _force_rename_offset_dim(sketch, d_expr)
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


def _tag_corner_points(ctx, s_name, off, offset_curves):
    """
    Tag the 4 corners of an offset rectangle with user-specified IDs.

    Reads ``off['CornerIDs']`` which maps positional labels to target IDs:
    ``{"TL": "offset_BB_corner_TL", "TR": "offset_BB_corner_TR",
       "BL": "offset_BB_corner_BL", "BR": "offset_BB_corner_BR"}``

    For a closed 4-curve offset rectangle, every corner is shared between
    two adjacent offset curves. We collect all curve endpoints, dedupe
    by entityToken, classify each unique SketchPoint by spatial position
    (left/right X, top/bottom Y relative to the centroid), and tag it
    via ``ctx.set_id``. After this runs, the corner is findable in
    ``entity_map[s_name][corner_ids[label]]`` so projection phases that
    reference the user-friendly ID resolve correctly.

    No-op when CornerIDs is empty or absent.
    """
    corner_ids = off.get("CornerIDs") or {}
    if not corner_ids:
        return

    # Collect endpoints from every offset curve.
    endpoints = []
    for i in range(offset_curves.count):
        curve = offset_curves.item(i)
        try:
            endpoints.append(curve.startSketchPoint)
            endpoints.append(curve.endSketchPoint)
        except Exception:
            continue

    if not endpoints:
        ctx.logger.log(
            f"CORNER TAG SKIP: no endpoints found in {s_name}", "WARNING")
        return

    # Dedupe by entityToken; closed loops share corners between curves.
    unique = {}
    for pt in endpoints:
        try:
            unique[pt.entityToken] = pt
        except Exception:
            continue
    points = list(unique.values())

    if len(points) != 4:
        ctx.logger.log(
            f"CORNER TAG: expected 4 unique corners, got {len(points)} "
            f"in {s_name} - corner tagging may be partial",
            "WARNING")

    def coords(pt):
        try:
            g = pt.geometry
            return float(g.x), float(g.y)
        except Exception:
            return 0.0, 0.0

    pts_with_coords = [(coords(p), p) for p in points]
    if not pts_with_coords:
        return

    # Pick the MOST EXTREME point per corner via explicit ranking.
    #
    # The previous logic ("for each point, assign to its quadrant by
    # x/y signs vs centroid; last assignment wins") works for a
    # 4-corner rectangle but fails for non-rectangular offsets like
    # the 12-segment silhouette - many points land in each quadrant
    # (BB-equivalent corners AND arc endpoints), and which one wins
    # depends on iteration order. Result: 2 corners on actual BB
    # extremes, 2 corners on arbitrary arc endpoints.
    #
    # The ranking-based approach picks the truly extreme point per
    # quadrant by maximising a combined metric:
    #   TL: max(y - x)   most upper-left (y high, x low)
    #   TR: max(x + y)   most upper-right
    #   BL: min(x + y)   most lower-left
    #   BR: max(x - y)   most lower-right
    # Equivalent to "closest to that infinite quadrant corner" by L1
    # distance. Works for any closed loop, not just rectangles.
    classified = {}

    rankings = {
        "TL": lambda c: c[1] - c[0],
        "TR": lambda c: c[0] + c[1],
        "BL": lambda c: -(c[0] + c[1]),
        "BR": lambda c: c[0] - c[1],
    }
    for label, key_fn in rankings.items():
        if label not in corner_ids:
            continue
        best = max(pts_with_coords, key=lambda p: key_fn(p[0]))
        classified[label] = best[1]

    for label, target_id in corner_ids.items():
        pt = classified.get(label)
        if not pt or not target_id:
            ctx.logger.log(
                f"CORNER TAG MISS: {label} -> {target_id!r} not classified "
                f"in {s_name}",
                "WARNING")
            continue
        ctx.set_id(pt, s_name, "corner", override_id=target_id)
        x, y = coords(pt)
        ctx.logger.log(
            f"CORNER TAG: {label} -> {target_id} at ({x:.3f}, {y:.3f}) "
            f"in {s_name}")


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
# Endpoint topology audit
# ------------------------------------------------------------------
def _audit_endpoint_topology(ctx, coll, s_name, label="result"):
    """
    Count unique endpoint SketchPoints across a curve collection.

    For a closed N-curve loop:
      - SHARED topology  -> N unique points (one per junction, both
                            adjacent curves' endpoints resolve to the
                            same SketchPoint object)
      - PAIRED topology  -> 2N unique points (each curve owns its own
                            start/end pair, junctions linked via
                            Coincident constraints between separate
                            entities)

    Manually-drawn geometry (Line/Arc seeds with explicit Points +
    Coincident chains) is PAIRED. Offset-generated geometry (output of
    sketch.offset() / addOffset2) is SHARED, because Fusion's offset
    kernel emits the curves with already-merged junction points.
    """
    if not coll or coll.count == 0:
        return
    try:
        n = coll.count
    except Exception:
        return

    unique_tokens = set()
    total_endpoint_refs = 0
    type_counts = {}

    for i in range(n):
        try:
            curve = coll.item(i)
        except Exception:
            continue
        # Track curve-type composition for context (e.g. is the loop
        # made of pure lines, mixed lines+arcs, etc.).
        try:
            t_name = type(curve).__name__
            type_counts[t_name] = type_counts.get(t_name, 0) + 1
        except Exception:
            pass
        for getter in ("startSketchPoint", "endSketchPoint"):
            try:
                pt = getattr(curve, getter, None)
                if pt is None:
                    continue
                tok = getattr(pt, "entityToken", None)
                if tok:
                    unique_tokens.add(tok)
                    total_endpoint_refs += 1
            except Exception:
                continue

    expected_shared = n
    expected_paired = n * 2
    unique_count = len(unique_tokens)

    if unique_count == expected_shared:
        verdict = "SHARED (one point per junction)"
    elif unique_count == expected_paired:
        verdict = "PAIRED (two points per junction)"
    else:
        verdict = (
            f"MIXED ({unique_count} unique / "
            f"{expected_shared} shared-expected / "
            f"{expected_paired} paired-expected)")

    type_str = ", ".join(f"{k}:{v}" for k, v in sorted(type_counts.items()))

    ctx.logger.log(
        f"ENDPOINT TOPOLOGY ({label}) in {s_name}: {n} curves "
        f"({type_str}), {total_endpoint_refs} endpoint refs, "
        f"{unique_count} unique tokens -> {verdict}")


# ------------------------------------------------------------------
# Loop integrity audit
# ------------------------------------------------------------------
def _audit_loop_integrity(ctx, coll, s_name):
    """Trace endpoints between consecutive curves to find gaps, allowing for flipped directions."""
    if not coll or coll.count < 2:
        return
    ctx.logger.log(f"LOOP AUDIT: Tracing {coll.count} segments for {s_name}", "DEBUG")
    
    for i in range(coll.count):
        c1 = coll.item(i)
        next_idx = (i + 1) % coll.count
        c2 = coll.item(next_idx)

        try:
            # Get all 4 endpoint combinations
            p1s, p1e = c1.startSketchPoint.geometry, c1.endSketchPoint.geometry
            p2s, p2e = c2.startSketchPoint.geometry, c2.endSketchPoint.geometry
            
            # Distances between all possible connection points
            dists = {
                "E-S": p1e.distanceTo(p2s),
                "E-E": p1e.distanceTo(p2e),
                "S-S": p1s.distanceTo(p2s),
                "S-E": p1s.distanceTo(p2e)
            }
            
            # Find minimum distance
            min_type = min(dists, key=dists.get)
            min_dist = dists[min_type]

            ctx.logger.log(f"  SEG {i} -> {next_idx}: MinDist={min_dist:.4f} cm via {min_type}", "DEBUG")
            
            if min_dist > 0.001:
                ctx.logger.log(
                    f"  GAP DETECTED: {min_dist:.4f} cm between segments {i} and {next_idx} "
                    f"({min_type}) in {s_name}!", "WARNING")
            elif min_type != "E-S":
                ctx.logger.log(f"  CONNECTION OK: Flipped junction ({min_type}) at seg {i}", "DEBUG")
        except:
            pass

def _reorder_to_chain(ctx, coll, s_name):
    """
    Greedy algorithm to reorder curves into a continuous topological chain.
    Returns a new ObjectCollection or None on failure.
    """
    if not coll or coll.count < 2:
        return coll
        
    try:
        remaining = [coll.item(i) for i in range(coll.count)]
        sorted_items = []
        
        # Start with the first item (e.g. top_edge)
        current = remaining.pop(0)
        sorted_items.append(current)
        
        # We track the 'active' point we're trying to match.
        # We start at the END of segment 0.
        active_pt = current.endSketchPoint.geometry
        
        ctx.logger.log(f"CHAIN SORTER: Starting walk from {sorted_items[0].entityToken[:8]}... endPoint", "DEBUG")
        
        while remaining:
            best_idx = -1
            match_type = None
            min_dist = 999.0
            
            for idx, next_c in enumerate(remaining):
                ns = next_c.startSketchPoint.geometry
                ne = next_c.endSketchPoint.geometry
                d_to_s = active_pt.distanceTo(ns)
                d_to_e = active_pt.distanceTo(ne)
                
                if d_to_s < min_dist:
                    min_dist = d_to_s
                    best_idx = idx
                    match_type = "S"
                if d_to_e < min_dist:
                    min_dist = d_to_e
                    best_idx = idx
                    match_type = "E"
            
            # Use a slightly more generous tolerance for projected geometry (up to 1mm)
            if min_dist < 0.1:
                next_item = remaining.pop(best_idx)
                sorted_items.append(next_item)
                # If we matched the Start, the new active exit point is the End
                active_pt = next_item.endSketchPoint.geometry if match_type == "S" else next_item.startSketchPoint.geometry
                ctx.logger.log(f"  > Linked seg {len(sorted_items)-1} via {match_type} (dist={min_dist:.4f})", "DEBUG")
            else:
                # Loop is fractured or we reached an island
                ctx.logger.log(f"CHAIN SORTER: BREAK - No neighbor within 1mm for active_pt at seg {len(sorted_items)-1}", "WARNING")
                break
        
        # Create new collection
        new_coll = adsk.core.ObjectCollection.create()
        for item in sorted_items:
            new_coll.add(item)
        
        if new_coll.count == coll.count:
            ctx.logger.log(f"CHAIN SORTER: Successfully reordered all {new_coll.count} segments for {s_name}", "DEBUG")
        return new_coll
        
    except Exception as e:
        ctx.logger.log(f"CHAIN SORTER CRASH: {e}", "ERROR")
        return None



def _force_rename_offset_dim(sketch, p_name):
    """
    Aggressively scans for the most recent dimension in the sketch and renames 
    its parameter to p_name. This ensures 'frame_thickness' appears correctly 
    in the Fusion UI even when the parametric solver fallback is used.
    """
    if not isinstance(p_name, str) or p_name.replace('.','',1).isdigit():
        return
        
    try:
        dims = sketch.sketchDimensions
        if dims.count > 0:
            # We target the actual latest dimension created by the offset call
            dim = dims.item(dims.count - 1)
            if hasattr(dim, 'parameter'):
                curr_name = dim.parameter.name
                if curr_name != p_name:
                    try:
                        dim.parameter.name = p_name
                        # Force the expression to link to the variable name (parametric)
                        dim.parameter.expression = str(p_name)
                    except:
                        pass
    except:
        pass


def _ensure_parameter_naming(ctx, sketch, target_name):
    """
    Sweeps through all dimensions in the sketch looking for anything 
    named d### (Fusion generic) and renames it to the intended target_name.
    """
    # If the target name is an expression or doesn't look like a simple ID, skip naming.
    # We only want to rename if we have a clean target parameter string.
    if not isinstance(target_name, str) or any(c in target_name for c in "+-*/() "):
        return

    try:
        for dim in sketch.sketchDimensions:
            param = getattr(dim, "parameter", None)
            if not param:
                continue
                
            old_name = param.name
            # Strict check: 'd' followed only by digits
            if old_name.startswith("d") and old_name[1:].isdigit():
                try:
                    param.name = target_name
                    ctx.logger.log(f"SWEEP RENAME SUCCESS: {old_name} -> {target_name}")
                    # We usually only have one offset per block, so we can stop or continue.
                    # We'll continue in case of complex offsets.
                except Exception as e:
                    ctx.logger.log(f"SWEEP RENAME FAIL on {old_name}: {e}", "DEBUG")
    except:
        pass

