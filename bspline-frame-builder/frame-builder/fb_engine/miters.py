"""
Miter Step — Creates solid (or construction) lines connecting inner/outer corners.

Uses jitter seeding: draws the line slightly offset from the target points,
then constrains both endpoints to their final positions. This avoids
zero-length and overlap errors that crash the Fusion solver.
"""
import adsk.core
import math


def miter_step(ctx, sketch, s_name, m):
    """
    Create a miter line between two named points.

    Parameters
    ----------
    ctx     : BuildContext
    sketch  : adsk.fusion.Sketch
    s_name  : str — sketch name key
    m       : dict with keys Source, Target, and optional IsConstruction
    """
    src_id = m.get("Source")
    tgt_id = m.get("Target")
    g_map = ctx.entity_map[s_name]

    try:
        src = g_map.get(src_id)
        tgt = g_map.get(tgt_id)

        if not src or not tgt:
            ctx.logger.log(
                f"MITER MISS: {src_id or '?'}({src is not None}) or "
                f"{tgt_id or '?'}({tgt is not None})", "WARNING")
            return

        # Read source / target coordinates
        sx, sy = _get_coords(src)
        tx, ty = _get_coords(tgt)

        dx, dy = tx - sx, ty - sy
        dist = math.sqrt(dx * dx + dy * dy)

        ctx.logger.log(f"MITER TRACE: {src_id}({sx:.3f}, {sy:.3f}) -> {tgt_id}({tx:.3f}, {ty:.3f}) Dist={dist:.3f} cm", "DEBUG")

        if dist <= 0.001:
            ctx.logger.log(f"MITER SKIP: {src_id} -> {tgt_id} (distance too small: {dist:.5f})", "WARNING")
            return

        # Jitter seed: draw slightly inward from both endpoints
        ux, uy = dx / dist, dy / dist
        jitter = 0.1  # cm
        p1 = adsk.core.Point3D.create(sx + ux * jitter, sy + uy * jitter, 0)
        p2 = adsk.core.Point3D.create(tx - ux * jitter, ty - uy * jitter, 0)

        line = sketch.sketchCurves.sketchLines.addByTwoPoints(p1, p2)
        line.isConstruction = m.get("IsConstruction", False)

        # Assign ID to miter line (e.g., miter-TR, miter-BL)

        miter_id = f"miter-{src_id}_{tgt_id}"
        ctx.set_id(line, s_name, "miter", override_id=miter_id)
        # Assign IDs to miter endpoints (start = :S, end = :E)
        ctx.set_id(line.startSketchPoint, s_name, "miter", override_id=f"miter-{src_id}_{tgt_id}:S")
        ctx.set_id(line.endSketchPoint, s_name, "miter", override_id=f"miter-{src_id}_{tgt_id}:E")

        # Hard-constrain to actual targets
        sketch.geometricConstraints.addCoincident(line.startSketchPoint, src)
        sketch.geometricConstraints.addCoincident(line.endSketchPoint, tgt)

        ctx.logger.log(f"MITER OK: {src_id} -> {tgt_id}")

    except Exception as e:
        ctx.logger.log(f"MITER CRASH: {src_id} -> {tgt_id}: {e}", "ERROR")


def _get_coords(entity):
    """Extract (x, y) from a sketch entity (point or geometry-bearing entity)."""
    if hasattr(entity, 'geometry'):
        return entity.geometry.x, entity.geometry.y
    if hasattr(entity, 'x'):
        return entity.x, entity.y
    return 0.0, 0.0
