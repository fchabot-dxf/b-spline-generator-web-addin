"""
Projection Step — Projects entities from one sketch into another.

Handles SourceSketch + SourceID lookup (with :S/:E/:C suffixes),
attribute-based fallback search, and semantic ID assignment to projected entities.
"""


def project_step(ctx, sketch, s_name, proj):
    """
    Project an entity from a source sketch into the current sketch.

    Parameters
    ----------
    ctx     : BuildContext
    sketch  : adsk.fusion.Sketch
    s_name  : str — current sketch name key
    proj    : dict with keys SourceSketch, SourceID, and optional TargetID

    Returns
    -------
    str or None — comma-separated list of assigned projection IDs, or None on failure
    """
    try:
        src_name = f"{ctx.prefix}_{proj['SourceSketch']}"
        full_source_id = proj["SourceID"]
        base_id = full_source_id.split(':')[0]

        # Verify source sketch exists
        if src_name not in ctx.entity_map:
            ctx.logger.log(
                f"PROJECTION ERROR: Source Sketch {src_name} not in Entity Map!", "ERROR")
            return None

        src_ent = ctx.entity_map.get(src_name, {}).get(base_id)

        # Fallback: search design attributes
        if not src_ent:
            src_ent = _attribute_fallback(ctx, base_id)

        if not src_ent:
            ctx.logger.log(
                f"PROJECTION WARNING: Source entity {full_source_id} not found in {src_name}",
                "WARNING")
            return None

        # Resolve :S / :E / :C suffix on the source entity
        if ":" in full_source_id and src_ent:
            suffix = full_source_id.split(':')[1]
            if suffix == "S":
                src_ent = src_ent.startSketchPoint
            elif suffix == "E":
                src_ent = src_ent.endSketchPoint
            elif suffix == "C":
                src_ent = src_ent.centerSketchPoint

        if not src_ent:
            ctx.logger.log(
                f"PROJECTION WARNING: Suffix entity {full_source_id} not found in {src_name}",
                "WARNING")
            return None

        # Perform the projection
        res = sketch.project(src_ent)

        # Assign semantic IDs to projected entities
        base_name = proj.get('SourceID', proj.get('TargetID', 'proj'))
        target_id = proj.get('TargetID')
        proj_names = []

        for i in range(res.count):
            proj_name = (
                target_id if target_id and res.count == 1
                else f"proj_{base_name}_{i}"
            )
            ent = res.item(i)
            ctx.set_id(ent, s_name, "proj", override_id=proj_name)
            _register_endpoints(ctx, s_name, ent, proj_name)
            _log_projection(ctx, proj, proj_name, ent, s_name)
            proj_names.append(proj_name)

        return ", ".join(proj_names)

    except Exception as e:
        ctx.logger.log_error(
            f"PROJECT FAIL: {proj.get('TargetID', '?')} in {s_name}: {e}")
        return None


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def _register_endpoints(ctx, s_name, ent, base_id):
    """
    Register :S / :E (and :C for arcs) sub-IDs for a projected curve.

    Mirrors what offsets._register_curve does for offset results: when a
    line or arc lands in a sketch via Project, it owns its own start /
    end SketchPoints (independent from any source entity's coincidences),
    and downstream phases (miters, constraints) reference them as
    ``base_id:S`` / ``base_id:E``.

    Without this registration, miters that source from
    ``proj_top_edge:S`` etc. fail with MITER MISS even though the curve
    itself is correctly tagged. SketchPoint projections (single points)
    have no endpoints; this function silently no-ops on them.
    """
    if not ent:
        return
    try:
        sp = getattr(ent, 'startSketchPoint', None)
        ep = getattr(ent, 'endSketchPoint', None)
        cp = getattr(ent, 'centerSketchPoint', None)
        if sp:
            ctx.set_id(sp, s_name, "point", override_id=f"{base_id}:S")
        if ep:
            ctx.set_id(ep, s_name, "point", override_id=f"{base_id}:E")
        if cp:
            ctx.set_id(cp, s_name, "point", override_id=f"{base_id}:C")
    except Exception as e:
        ctx.logger.log(
            f"PROJ ENDPOINT REGISTER FAIL: {base_id} in {s_name}: {e}",
            "DEBUG")


def _attribute_fallback(ctx, base_id):
    """Search design attributes for an entity tagged with the given ID."""
    try:
        attrs = ctx.design.findAttributes('FrameBuilder', 'ID')
        for attr in attrs:
            if attr.value == base_id:
                return attr.parent
    except Exception:
        pass
    return None


def _log_projection(ctx, proj, proj_name, ent, s_name):
    """Log coordinates and type information for a projected entity."""
    ent_type = type(ent).__name__
    coords = None
    if hasattr(ent, 'geometry') and ent.geometry:
        g = ent.geometry
        x, y = getattr(g, 'x', None), getattr(g, 'y', None)
        is_num = isinstance(x, (int, float)) and isinstance(y, (int, float))
        coords = f"({x:.3f}, {y:.3f})" if is_num else f"({x}, {y})"
    elif (hasattr(ent, 'startSketchPoint') and ent.startSketchPoint
          and hasattr(ent.startSketchPoint, 'geometry')):
        g = ent.startSketchPoint.geometry
        x, y = getattr(g, 'x', None), getattr(g, 'y', None)
        is_num = isinstance(x, (int, float)) and isinstance(y, (int, float))
        coords = f"({x:.3f}, {y:.3f})" if is_num else f"({x}, {y})"

    ctx.logger.log(
        f"PROJECTION: Source={proj['SourceSketch']}:{proj['SourceID']} "
        f"Target={proj_name} Type={ent_type} "
        f"Coords={coords if coords else '[no geometry]'} in {s_name}")
