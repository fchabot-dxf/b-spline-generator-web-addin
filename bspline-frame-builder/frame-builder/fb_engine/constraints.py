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
    # CK gate — if the constraint declares a ck_ key, check its value before proceeding.
    # 1.0 (or missing) = apply constraint; 0.0 = skip (constraint disabled by template/user).
    ck_name = rel.get("CK")
    if ck_name:
        ck_val = float(ctx.active_vars.get(ck_name, 1.0))
        if ck_val < 0.5:
            ctx.logger.log(f"CONSTRAINT GATED (CK={ck_name}=0): {rel.get('Type')} on {rel.get('Targets')}")
            return

    targets = _resolve_targets(ctx, s_name, rel["Targets"])
    if not targets:
        return

    gc = sketch.geometricConstraints
    ctype = rel["Type"]
    allow_nudge = rel.get("AllowNudge", False)
    rel_name = rel.get("Name")

    created = []  # (constraint_entity, suffix-or-None) — stamped after success

    try:
        if ctype == "Coincident" and len(targets) == 2:
            try:
                c = gc.addCoincident(targets[0], targets[1])
                created.append((c, None))
            except Exception as e:
                if allow_nudge:
                    ctx.logger.log(f"Weld candidate failed ({rel['Targets']}). Attempting Jitter-Retry...", "WARNING")
                    # Force a geometric nudge to 'shake' the solver
                    # We assume targets[0] is the point we want to move toward targets[1]
                    from fb_engine import geometry
                    p_to_move = targets[0] if hasattr(targets[0], 'geometry') else targets[1]
                    target_ent = targets[1] if p_to_move == targets[0] else targets[0]

                    if hasattr(p_to_move, 'geometry') and hasattr(target_ent, 'geometry'):
                        geometry.nudge_point_to_target(ctx, p_to_move, target_ent.geometry, radius=0.01)
                        # Second attempt
                        c = gc.addCoincident(targets[0], targets[1])
                        created.append((c, None))
                        ctx.logger.log(f"CONSTRAINT RECOVERED via Jitter: {ctype} on {rel['Targets']}")
                    else:
                        raise e
                else:
                    raise e
        elif ctype == "Collinear" and len(targets) == 2:

            c = gc.addCollinear(targets[0], targets[1])
            created.append((c, None))
        elif ctype == "Horizontal" and len(targets) >= 1:
            # Multi-target H/V: each target gets its own constraint, so we
            # suffix the name with the target index when more than one is
            # passed. Single-target stays un-suffixed for readability.
            for i, t in enumerate(targets):
                c = gc.addHorizontal(t)
                suffix = None if len(targets) == 1 else str(i)
                created.append((c, suffix))
        elif ctype == "Vertical" and len(targets) >= 1:
            for i, t in enumerate(targets):
                c = gc.addVertical(t)
                suffix = None if len(targets) == 1 else str(i)
                created.append((c, suffix))
        elif ctype == "Tangent" and len(targets) == 2:
            c = gc.addTangent(targets[0], targets[1])
            created.append((c, None))
        elif ctype == "Parallel" and len(targets) == 2:
            c = gc.addParallel(targets[0], targets[1])
            created.append((c, None))
        elif ctype == "Equal" and len(targets) == 2:
            c = gc.addEqual(targets[0], targets[1])
            created.append((c, None))
        else:
            ctx.logger.log(
                f"CONSTRAINT SKIP: {ctype} needs different target count "
                f"(got {len(targets)})", "WARNING")
            return

        # Stamp unique IDs on the just-created constraint(s) so they can be
        # looked up, re-inspected, or deleted by name later. If the template
        # didn't supply a Name, we still register the constraint under an
        # auto-generated ID so the entity_map stays complete.
        for constr, suffix in created:
            if not constr:
                continue
            if rel_name:
                override_id = rel_name if suffix is None else f"{rel_name}_{suffix}"
            else:
                override_id = None  # set_id will auto-generate a constraint-N ID
            ctx.set_id(constr, s_name, "constraint", override_id=override_id)

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
