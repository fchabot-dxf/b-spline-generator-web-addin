"""
Dimension Step — Creates and drives parametric sketch dimensions.

Handles EnabledParam toggle logic, snap-seed (soft-seed) mode,
Radius/Diameter, Source-to-Target distance, and default entity distance.
"""
import adsk.core, adsk.fusion


def dimension_step(ctx, sketch, s_name, dim, is_snap_only=False):
    """
    Create a sketch dimension from a template spec dict.

    Parameters
    ----------
    ctx          : BuildContext
    sketch       : adsk.fusion.Sketch
    s_name       : str — sketch name key
    dim          : dict with keys Name, Target, Expression, EnabledParam, etc.
    is_snap_only : bool — if True, create the dimension to seed the solver,
                   then immediately delete it (soft-seed pattern).
    """
    dim_name = dim.get("Name", "?")
    dim_target = dim.get("Target", "?")

    # 0. Check UI toggle (EnabledParam) - Bypass if this is a temporary snap-seed
    if not is_snap_only and _is_disabled(ctx, dim):
        ctx.logger.log(f"DIM SKIPPED: {dim_name} ('{dim.get('EnabledParam')}' is OFF)")
        return

    g_map = ctx.entity_map[s_name]

    try:
        tgt = g_map.get(dim_target)
        if not tgt:
            ctx.logger.log(f"DIM MISS: Target '{dim_target}' not found in {s_name}", "WARNING")
            return

        expr = dim.get("Expression") or dim.get("Name") or dim.get("Value")
        
        # Determine source if it exists (for distance dimensions)
        src = None
        if "Source" in dim:
            src = g_map.get(dim["Source"])
        elif "Targets" in dim and len(dim["Targets"]) >= 2:
            src = g_map.get(dim["Targets"][0])
            dim_target = dim["Targets"][1] # Secondary target
            tgt = g_map.get(dim_target)

        text_pt = _compute_text_point(ctx, dim, tgt, src)
        d = _create_dimension(ctx, sketch, s_name, dim, tgt, text_pt)

        if d and expr:
            _apply_expression(ctx, sketch, d, dim_name, dim_target, expr, tgt, is_snap_only)
        elif not d:
            ctx.logger.log(f"DIM NODIM: {dim_name} on '{dim_target}' — no dimension created", "WARNING")

    except Exception as e:
        ctx.logger.log(f"DIM CRASH: {dim_name} on '{dim_target}': {e}", "ERROR")
        _log_constraint_diagnostics(ctx, sketch, s_name, dim_target)


# ------------------------------------------------------------------
# Internals
# ------------------------------------------------------------------
def _is_disabled(ctx, dim):
    """Check whether the dimension's EnabledParam toggle is OFF."""
    en_param = dim.get("EnabledParam")
    if not en_param:
        return False
    try:
        # Check SHADOW STATE (UI active_vars) first
        if en_param in ctx.active_vars:
            val = float(ctx.active_vars[en_param])
            if val <= 1e-5:
                return True
            else:
                ctx.logger.log(f"DIM DRIVING: {dim.get('Name', '?')} ('{en_param}' is ON via Shadow State val={val})")
                return False

        # Fallback to Fusion User Parameters
        p = ctx.design.userParameters.itemByName(en_param)
        if p and p.value <= 1e-5:
            return True
        if p:
            ctx.logger.log(f"DIM DRIVING: {dim.get('Name', '?')} ('{en_param}' is ON via Fusion Param)")
    except Exception:
        pass
    return False


def _create_dimension(ctx, sketch, s_name, dim, tgt, text_pt):
    """
    Create the appropriate SketchDimension based on dim spec.

    Returns the created dimension object or None.
    """
    dim_type = dim.get("DimType") or dim.get("Type")

    # Radial / diameter
    if dim_type == "Radius":
        return sketch.sketchDimensions.addRadialDimension(tgt, text_pt)
    if dim_type == "Diameter":
        return sketch.sketchDimensions.addDiameterDimension(tgt, text_pt)

    # Explicit source-to-target distance
    if "Source" in dim or ("Targets" in dim and len(dim["Targets"]) >= 2):
        src_id = dim.get("Source") or dim["Targets"][0]
        tgt_id = dim.get("Target") or dim["Targets"][1]
        src = ctx.entity_map[s_name].get(src_id)
        tgt = ctx.entity_map[s_name].get(tgt_id)
        
        if src and tgt:
            orient = (
                adsk.fusion.DimensionOrientations.VerticalDimensionOrientation
                if dim.get("Orientation") == "Vertical"
                else adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation
            )
            return sketch.sketchDimensions.addDistanceDimension(src, tgt, orient, text_pt)

    # Default: distance across the entity itself
    if hasattr(tgt, 'startSketchPoint') and hasattr(tgt, 'endSketchPoint'):
        return sketch.sketchDimensions.addDistanceDimension(
            tgt.startSketchPoint, tgt.endSketchPoint,
            adsk.fusion.DimensionOrientations.AlignedDimensionOrientation, text_pt)

    return None


def _apply_expression(ctx, sketch, d, dim_name, dim_target, expr, tgt, is_snap_only):
    """Drive the dimension with the given expression, optionally deleting after seed."""
    try:
        d.parameter.expression = str(expr)
        ctx.logger.log(f"DIM OK: {dim_name} on '{dim_target}' = {expr}")

        if is_snap_only:
            d.deleteMe()
            ctx.logger.log(f"SEED RELEASED: {dim_name}")
    except Exception as e:
        ctx.logger.log(f"DIM EXPR FAIL: {dim_name} on '{dim_target}' expr='{expr}': {e}", "ERROR")
        _log_constraint_diagnostics(ctx, sketch, sketch.name, dim_target)


def _compute_text_point(ctx, dim, tgt, src=None):
    """
    Calculate a text point pushed away from the center (Outer Offset).
    """
    offset_dist = 1.5 # cm
    
    # 1. Start with midpoint of target(s)
    mx, my = 0, 0
    pts = []
    if hasattr(tgt, 'startSketchPoint') and hasattr(tgt, 'endSketchPoint'):
        pts = [tgt.startSketchPoint.geometry, tgt.endSketchPoint.geometry]
    elif hasattr(tgt, 'geometry') and hasattr(tgt.geometry, 'center'):
        pts = [tgt.geometry.center]
    elif hasattr(tgt, 'geometry') and hasattr(tgt.geometry, 'x'):
        pts = [tgt.geometry]
        
    if src:
        if hasattr(src, 'geometry') and hasattr(src.geometry, 'x'):
            pts.append(src.geometry)
            
    if pts:
        mx = sum(p.x for p in pts) / len(pts)
        my = sum(p.y for p in pts) / len(pts)
        
    # 2. Push AWAY from origin based on orientation
    dim_type = dim.get("DimType") or dim.get("Type", "Aligned")
    
    if dim_type == "Horizontal" or dim.get("Orientation") == "Horizontal":
        # Push vertically (Y axis) away from center
        my += offset_dist if my >= 0 else -offset_dist
    elif dim_type == "Vertical" or dim.get("Orientation") == "Vertical":
        # Push horizontally (X axis) away from center
        mx += offset_dist if mx >= 0 else -offset_dist
    elif dim_type in ("Radius", "Diameter"):
        # Push diagonally away from center
        mx += offset_dist if mx >= 0 else -offset_dist
        my += offset_dist if my >= 0 else -offset_dist
    else:
        # Default Aligned: push away from the larger coordinate
        if abs(my) > abs(mx):
            my += offset_dist if my >= 0 else -offset_dist
        else:
            mx += offset_dist if mx >= 0 else -offset_dist
            
    return adsk.core.Point3D.create(mx, my, 0)


def _log_constraint_diagnostics(ctx, sketch, s_name, dim_target):
    """Log all constraints involving the problem target for debugging."""
    try:
        tgt = ctx.entity_map.get(s_name, {}).get(dim_target)
        if not tgt:
            return
        related = []
        for constr in sketch.geometricConstraints:
            if _is_entity_in_constraint(tgt, constr):
                related.append(constr.objectType.split('::')[-1])
        ctx.logger.log(f"DIAGNOSTIC: '{dim_target}' is already locked by: {related}", "DEBUG")
    except Exception:
        pass


def _is_entity_in_constraint(entity, constraint):
    """Check if an entity participates in a geometric constraint."""
    try:
        for prop in ('entity', 'entityOne', 'entityTwo', 'line', 'point'):
            if hasattr(constraint, prop) and getattr(constraint, prop) == entity:
                return True
    except Exception:
        pass
    return False
