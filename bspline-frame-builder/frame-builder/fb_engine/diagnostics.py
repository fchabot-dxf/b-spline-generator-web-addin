"""
Diagnostics — log helpers that are too chatty / domain-specific to live
inside the build loop itself.

Houses :py:func:`log_arc_audit`, which dumps the start / midpoint / end
/ center of every sketch arc after a block has been solved. The audit
helped track down arc-handedness regressions during the block-based
refactor; we keep it on tap so future regressions are easy to
triangulate.

Also houses :py:func:`assert_no_reflex_arcs`, a hard build-time gate
(H23 item 15, Fred's own rule): a sketch arc that sweeps 180 degrees or
more is always a wrong-solver-branch defect, never an intended shape,
across every template. Unlike the audit above it DOES raise — a
reflex arc downstream silently cascades into offset/miter/extrude
failures that are much harder to trace back to the real cause.

Functions here only read from ``BuildContext`` — they never mutate
geometry. Follow the same shape when adding a logging-only diagnostic:
take ctx + sketch + a label, log liberally, swallow exceptions so a
logging bug can never abort the build. ``assert_no_reflex_arcs`` is the
deliberate exception to "never abort" — see its own docstring.
"""
import math


def _point_to_str(pt):
    """Best-effort 'x.xxx, y.yyy' for a SketchPoint, or '?,?' on failure.

    Sketch points returned mid-build can be in odd states (un-solved,
    detached, etc.). The audit treats them as soft data and tolerates
    failure rather than aborting the log line.
    """
    if not pt:
        return "?,?"
    try:
        geom = pt.geometry
        return f"{geom.x:.3f}, {geom.y:.3f}"
    except Exception:
        return "ERR"


def log_arc_audit(ctx, sketch, sketch_name, phase_label, display_name=None):
    """Dump start / mid / end / center of every arc in ``sketch``.

    Parameters
    ----------
    ctx
        BuildContext — used for the logger handle and the entity map
        (so each arc gets its human-readable Frame-Builder ID rather
        than just an opaque BRep handle).
    sketch
        The Fusion ``Sketch`` to audit. Must be live; the caller is
        responsible for de-deferring compute first if they want
        post-solve coordinates.
    sketch_name
        Internal sketch key (matches ``ctx.entity_map`` keys), e.g.
        ``"T1_3_frame-enclosure"``.
    phase_label
        Free-form label printed in the section header — typically
        ``"BLOCK <name> COMPLETE"`` or ``"PRE-OFFSET"``.
    display_name
        Optional pretty name for the header (defaults to
        ``sketch_name``).
    """
    display_name = display_name or sketch_name
    ctx.logger.log(f"--- ARC AUDIT: {phase_label} in {display_name} ---")

    ent_map = ctx.entity_map.get(sketch_name, {})

    try:
        for arc in sketch.sketchCurves.sketchArcs:
            # Find the human-readable ID by searching the entity map
            arc_id = "unknown_arc"
            for eid, eobj in ent_map.items():
                if eobj == arc:
                    arc_id = eid
                    break

            # 1. Basic points (Start, End, Center)
            s_str = _point_to_str(arc.startSketchPoint)
            e_str = _point_to_str(arc.endSketchPoint)
            c_str = _point_to_str(arc.centerSketchPoint)

            # 2. Midpoint (Isolate evaluator for safety)
            m_str = "?,?"
            try:
                res = arc.geometry.evaluator.getPointAtParameter(0.5)
                if res and res[1]:
                    m_str = f"{res[1].x:.3f}, {res[1].y:.3f}"
            except Exception:
                m_str = "eval_fail"

            log_msg = f"  [{arc_id}] S({s_str}) | M({m_str}) | E({e_str}) | C({c_str})"
            ctx.logger.log(log_msg)

    except Exception as e:
        ctx.logger.log(f"ARC AUDIT FATAL FAIL: {e}", "WARNING")


def assert_no_reflex_arcs(ctx, sketch, sketch_name, display_name=None):
    """Raise loudly if any arc in ``sketch`` sweeps >= 180 degrees.

    A reflex sweep means the solver landed on the wrong branch of a
    circle (the long way around instead of the short way) -- this is
    the exact failure class behind H23 item 14/15 (Template 10's arch).
    It never happens by design: every template's arcs are meant to be
    gentle, well under a half-circle. Checked via the arc's own
    ``startAngle``/``endAngle`` (not by re-deriving a sweep from
    sampled points), since those already encode Fusion's own notion of
    which way the arc actually goes.

    Deliberately raises (unlike every other function in this module):
    a reflex arc cascades into offset/miter/extrude failures many
    steps downstream, so failing where the real defect is -- right
    after the sketch solves -- is far cheaper to diagnose than failing
    where the symptom shows up.
    """
    display_name = display_name or sketch_name
    ent_map = ctx.entity_map.get(sketch_name, {})
    try:
        for arc in sketch.sketchCurves.sketchArcs:
            arc_id = "unknown_arc"
            for eid, eobj in ent_map.items():
                if eobj is arc:
                    arc_id = eid
                    break
            sweep_deg = math.degrees(arc.geometry.endAngle - arc.geometry.startAngle) % 360.0
            if sweep_deg >= 180.0:
                msg = (f"REFLEX ARC: [{arc_id}] in {display_name} sweeps {sweep_deg:.1f} deg "
                       f"(>= 180) -- wrong solver branch, not a valid shape")
                ctx.logger.log(msg, "ERROR")
                raise RuntimeError(msg)
    except RuntimeError:
        raise
    except Exception as e:
        ctx.logger.log(f"REFLEX ARC CHECK FAILED TO RUN: {e}", "WARNING")
