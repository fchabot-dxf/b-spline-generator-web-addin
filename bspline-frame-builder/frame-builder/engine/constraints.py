"""
Constraint Step — Applies geometric constraints to sketch entities.

Supported types: Coincident, Collinear, Horizontal, Vertical,
Tangent, Parallel, Equal.
"""


def constraint_step(ctx, sketch, s_name, rel):
    """
    Resolve target entity IDs and apply the geometric constraint.

    Parameters
    ----------
    ctx     : BuildContext
    sketch  : adsk.fusion.Sketch
    s_name  : str — sketch name key in ctx.entity_map
    rel     : dict with keys "Type" and "Targets" (list of entity ID strings)
    """
    targets = _resolve_targets(ctx, s_name, rel["Targets"])
    if not targets:
        return

    gc = sketch.geometricConstraints
    ctype = rel["Type"]

    try:
        if ctype == "Coincident" and len(targets) == 2:
            gc.addCoincident(targets[0], targets[1])
        elif ctype == "Collinear" and len(targets) == 2:
            gc.addCollinear(targets[0], targets[1])
        elif ctype == "Horizontal" and len(targets) >= 1:
            gc.addHorizontal(targets[0])
        elif ctype == "Vertical" and len(targets) >= 1:
            gc.addVertical(targets[0])
        elif ctype == "Tangent" and len(targets) == 2:
            gc.addTangent(targets[0], targets[1])
        elif ctype == "Parallel" and len(targets) == 2:
            gc.addParallel(targets[0], targets[1])
        elif ctype == "Equal" and len(targets) == 2:
            gc.addEqual(targets[0], targets[1])
        else:
            ctx.logger.log(
                f"CONSTRAINT SKIP: {ctype} needs different target count "
                f"(got {len(targets)})", "WARNING")
            return
        ctx.logger.log(f"CONSTRAINT OK: {ctype} on {rel['Targets']}")

    except Exception as e:
        ctx.logger.log(f"CONSTRAINT FAIL: {ctype} on {rel['Targets']}: {e}", "ERROR")
        _log_related_constraints(ctx, sketch, s_name, targets, rel["Targets"])


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def _resolve_targets(ctx, s_name, target_ids):
    """Resolve a list of entity ID strings into actual sketch entities."""
    resolved = []
    for t_id in target_ids:
        ent = ctx.resolve_entity(s_name, t_id)
        if ent:
            resolved.append(ent)
        else:
            ctx.logger.log(f"CONSTRAINT MISS: {t_id} not found in {s_name}", "WARNING")
    return resolved


def _log_related_constraints(ctx, sketch, s_name, targets, target_ids):
    """Diagnostic: log all constraints that already involve the target entities."""
    try:
        related = []
        for constr in ctx.sketches[s_name].geometricConstraints:
            for tgt in targets:
                for prop in ('entityOne', 'entityTwo', 'entity', 'line', 'point'):
                    if hasattr(constr, prop) and getattr(constr, prop) == tgt:
                        related.append(str(constr))
                        break
        ctx.logger.log(f"RELATED CONSTRAINTS for {target_ids}: {related}", "DEBUG")
    except Exception:
        pass
