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
            ctx.set_id(res.item(i), s_name, "proj", override_id=proj_name)
            _log_projection(ctx, proj, proj_name, res.item(i), s_name)
            proj_names.append(proj_name)

        return ", ".join(proj_names)

    except Exception as e:
        ctx.logger.log_error(
            f"PROJECT FAIL: {proj.get('TargetID', '?')} in {s_name}: {e}")
        return None


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
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
        coords = f"({getattr(g, 'x', '?'):.3f}, {getattr(g, 'y', '?'):.3f})"
    elif (hasattr(ent, 'startSketchPoint') and ent.startSketchPoint
          and hasattr(ent.startSketchPoint, 'geometry')):
        g = ent.startSketchPoint.geometry
        coords = f"({getattr(g, 'x', '?'):.3f}, {getattr(g, 'y', '?'):.3f})"

    ctx.logger.log(
        f"PROJECTION: Source={proj['SourceSketch']}:{proj['SourceID']} "
        f"Target={proj_name} Type={ent_type} "
        f"Coords={coords if coords else '[no geometry]'} in {s_name}")
