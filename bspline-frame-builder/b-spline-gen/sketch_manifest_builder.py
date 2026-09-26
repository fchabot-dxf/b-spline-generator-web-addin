"""
sketch_manifest_builder.py — T62 (SE15 Slice 2): builds a real, constrained
Fusion sketch from the JS-side "sketch manifest" (SE15-CONSTRAINED-SKETCH-
DESIGN.md §1, produced by editor-sketch-manifest.js / T61). Docs-only turn
constraint carried over from T60/T61 stays in force for THIS module too —
"NO FUSION" for the worker; the advisor runs this in real Fusion after
merge (per T62's own dispatch).

Reuses fb_engine's already-working constraint_step/dimension_step dispatch
(frame-builder's own package, a sibling under this add-in's shared root —
already on sys.path by the time the add-in's own run() has bootstrapped;
_ensure_fb_engine_importable below is a defensive fallback, not the
primary mechanism) rather than re-deriving that machinery. Writes its own
geometry-creation (Line/Circle/ArcCenter/Slot) because fb_engine's own
gaps don't fit this manifest's shape — geometry.py's geom_step has no
Circle/ArcCenterPoint/Slot dispatch branch at all (T60's own research
confirmed the first two are declared in a type list elsewhere, never
implemented; Slot doesn't exist in fb_engine's own vocabulary).

T64 (5 mid-turn amendments, final design): every rail/tie piece is a
Fusion-NATIVE anchored center-to-center SLOT (`addCenterToCenterSlot`),
not the two-classic-sketch.offset()-calls-plus-cap-arcs mechanism T62/T63
originally built and then had to fix twice (one-sided offsets, then an
over-constrained cap scheme) — Fred's own final call, after first asking
only to remove that mechanism from the box-lattice tool, then extending
the removal to Shape Lattice's own lattice fill too ("box lattice needs
to be slots too"). See _create_slot_entity's own doc comment for the
current, still-partially-UNVERIFIED-against-real-Fusion mechanics
(this turn stays NO FUSION; the advisor verifies live after merge).

Importing this module is safe without a live Fusion session (see
test_sketch_manifest_builder.py's own fake-adsk shim) — every adsk.* call
lives inside a function body or behind the module-level stub-tolerant
imports below, matching fb_engine's own existing test convention
(test_deferred_compute.py et al.: install empty adsk/adsk.core/adsk.fusion
stub modules, then import).
"""
import json
import math
import os
import sys
import time

import adsk.core
import adsk.fusion

IN_TO_CM = 2.54


def _ensure_fb_engine_importable():
    """frame-builder/fb_engine is a SIBLING package under this add-in's own
    root (bspline-frame-builder/) — already inserted into sys.path by the
    top-level entry point's own run() (bspline-frame-builder.py) during a
    real Fusion session. This is a DEFENSIVE fallback for the case this
    module gets imported before that's happened (or never, in a test),
    not the primary mechanism — idempotent, same "if d not in sys.path"
    guard style the entry point itself already uses everywhere."""
    here = os.path.dirname(os.path.realpath(__file__))
    addin_root = os.path.dirname(here)  # .../bspline-frame-builder
    fb_root = os.path.join(addin_root, 'frame-builder')
    if fb_root not in sys.path:
        sys.path.insert(0, fb_root)


_ensure_fb_engine_importable()

from fb_engine.build_context import BuildContext  # noqa: E402
from fb_engine.constraints import constraint_step  # noqa: E402
from fb_engine.dimensions import dimension_step  # noqa: E402


class _Logger:
    """Adapts a plain `log_fn(msg)` callable (b-spline-gen.py's own
    module-level `_log`) to the `ctx.logger.log(msg, level)` /
    `.log_error(msg)` interface fb_engine's BuildContext/constraint_step/
    dimension_step already expect — a thin shim, not a re-implementation,
    so this module can hand its own logger straight to fb_engine's own
    functions without them needing to know which add-in called them.

    ALSO accumulates every logged line into `self.records` — fb_engine's
    own step functions are fire-and-forget/log-only (constraint_step never
    returns success/failure, dimensions.py's dimension_step likewise), so
    this is how build_constrained_sketch's own summary dict gets an
    accurate skip/fail COUNT + first-few-reasons (the dispatch's own
    explicit ask) without needing to change fb_engine's own return
    contract at all — just read back what it already logs.
    """

    def __init__(self, log_fn=None):
        self._log_fn = log_fn or (lambda msg: None)
        self.records = []  # [{"level": str, "msg": str}]

    def log(self, msg, level="INFO"):
        self.records.append({"level": level, "msg": msg})
        try:
            self._log_fn(msg if level == "INFO" else f"[{level}] {msg}")
        except Exception:
            pass

    def log_error(self, msg):
        self.log(msg, "ERROR")


def _summarize_issues(records, markers):
    """Every logged record whose message contains ANY of `markers` — the
    count + first 5 reasons, matching the dispatch's own "count + first
    few reasons in the log" ask. `markers` are fb_engine's own established
    tags (CONSTRAINT SKIP/FAIL/MISS, DIM MISS/CRASH/..., OFFSET ...) plus
    this module's own WRAP/CAP tags for the parts fb_engine doesn't cover."""
    issues = [r["msg"] for r in records if any(m in r["msg"] for m in markers)]
    return {"count": len(issues), "first_reasons": issues[:5]}


# ---------------------------------------------------------------------------
# Geometry — Line/Circle/ArcCenter (the manifest's own 3 entity types)
# ---------------------------------------------------------------------------
def _to_point3d(xy_in):
    """A manifest coordinate (real MODEL INCHES, §1's own "units": "in")
    -> a Fusion Point3D in CM. Fusion's internal API is ALWAYS centimeters
    regardless of a document's own display units (BuildContext.resolve_val's
    own doc comment: "Resolve a number or string expression... to a float
    in CM") — a stable, well-known Fusion API fact, not something that
    varies by document, so a direct multiply is correct and far cheaper
    than routing every raw coordinate through Fusion's own expression
    evaluator (hundreds of points on a dense lattice). Expression-driven
    VALUES (dimension/offset .expression strings referencing a named user
    parameter, e.g. "rail_width / 2") are NEVER converted this way — those
    go through Fusion's own ValueInput.createByString, which resolves
    itself against the referenced parameter's own declared unit."""
    return adsk.core.Point3D.create(xy_in[0] * IN_TO_CM, xy_in[1] * IN_TO_CM, 0)


def _create_line_entity(ctx, curves, s_name, ent):
    p1 = _to_point3d(ent["p1"])
    p2 = _to_point3d(ent["p2"])
    line = curves.sketchLines.addByTwoPoints(p1, p2)
    ctx.set_id(line, s_name, "line", override_id=ent["id"])
    # T70 AMEND 3: the shape contour's own new mirror-axis Line (declared
    # `isConstruction: true` in the manifest so it never becomes a real,
    # selectable profile edge) is the first Line entity that ever needs
    # this — every OTHER Line entity omits the field, so `.get(...)`
    # defaults False and this is a no-op for them.
    if ent.get("isConstruction"):
        line.isConstruction = True
    ctx.set_id(line.startSketchPoint, s_name, "point", override_id=f"{ent['id']}:S")
    ctx.set_id(line.endSketchPoint, s_name, "point", override_id=f"{ent['id']}:E")
    return line


def _create_circle_entity(ctx, curves, s_name, ent):
    center = _to_point3d(ent["center"])
    radius_cm = ent["radius"] * IN_TO_CM
    circle = curves.sketchCircles.addByCenterRadius(center, radius_cm)
    ctx.set_id(circle, s_name, "circle", override_id=ent["id"])
    # A SketchCircle exposes .centerSketchPoint — resolve_entity's own :C
    # suffix branch (build_context.py) derives it live via hasattr, so no
    # extra tagging call is needed beyond the base id (same as Arc3Point's
    # own :C convention in geometry.py's _create_arc3 — that function
    # doesn't separately tag :C either, for the identical reason).
    return circle


def _create_arc_center_entity(ctx, curves, s_name, ent):
    """ent: {id, center:[x,y], radius, startAngleDeg, sweepDeg} (manifest's
    own inches/degrees) -> a real SketchArc via addByCenterStartSweep,
    which takes a START POINT (not a start ANGLE) as its 2nd arg — this
    function computes that one small trig step itself (center + radius *
    (cos startAngle, sin startAngle)) rather than the manifest carrying a
    redundant third point, matching the design doc's own §5 plan exactly."""
    cx_in, cy_in = ent["center"]
    radius_in = ent["radius"]
    start_rad = math.radians(ent["startAngleDeg"])
    sweep_rad = math.radians(ent["sweepDeg"])
    center = _to_point3d((cx_in, cy_in))
    start_pt = _to_point3d((cx_in + radius_in * math.cos(start_rad), cy_in + radius_in * math.sin(start_rad)))
    arc = curves.sketchArcs.addByCenterStartSweep(center, start_pt, sweep_rad)
    ctx.set_id(arc, s_name, "arc", override_id=ent["id"])
    ctx.set_id(arc.startSketchPoint, s_name, "point", override_id=f"{ent['id']}:S")
    ctx.set_id(arc.endSketchPoint, s_name, "point", override_id=f"{ent['id']}:E")
    ctx.set_id(arc.centerSketchPoint, s_name, "point", override_id=f"{ent['id']}:C")
    return arc


def _create_arc3_entity(ctx, curves, s_name, ent):
    """T65 (advisor's own real Fusion run): a Shape Lattice silhouette arc,
    once it has gone through the JS side's `applyCarvePlacement`, arrives
    here as `{id, type:'Arc3Point', p1, pMid, p2}` — 3 raw points, NOT
    center+radius+angle. The advisor's own measured bug (center+angle
    ArcCenter build, angles negated for the Y-flip): arc centers landed
    outside the board, left/right halves didn't mirror, arc ends didn't
    meet their neighbouring line's own end. The fix moved upstream (JS
    side never re-derives an angle representation after a reflection at
    all) — this function is the OTHER half: build straight off 3 points
    via `addByThreePoints`, matching fb_engine's own pre-existing
    'Arc3Point' naming (geometry.py's own `_create_arc3`, a different
    calling convention — that one resolves template expression strings
    via `ctx.resolve_val`, this one converts already-resolved manifest
    inches directly via `_to_point3d`, the SAME convention every other
    entity in THIS module already uses — so this is a sibling, not a
    delegation, matching the module's own header: 'writes its own
    geometry-creation because fb_engine's own gaps don't fit this
    manifest's shape').

    T67 (advisor's own real Fusion run — "this alone fixed the shape
    bbox"): `addByThreePoints` always normalizes its own result to run
    COUNTER-CLOCKWISE — so `arc.startSketchPoint` is NOT reliably the
    manifest's own `p1`; for a CLOCKWISE-ordered `(p1, pMid, p2)`, Fusion
    hands back `startSketchPoint` == this function's own `p2` instead,
    silently swapping S/E. That swap corrupted every downstream `:S`/`:E`-
    suffixed constraint referencing this arc (tie-on-rail-style
    continuity, node coincidences) without ever raising or logging
    anything — which is exactly why it manifested as a wrong-looking bbox
    (arcs still built, just mislabeled at their own two ends) rather than
    a build failure. Fixed by labeling whichever of Fusion's own two
    returned points is GEOMETRICALLY CLOSER to the manifest's own `p1` as
    `:S` (and the other as `:E`) — correct regardless of which way
    Fusion's own CCW normalization happened to run, since it's derived
    from the ACTUAL resulting geometry, not assumed from call-argument
    order."""
    p1 = _to_point3d(ent["p1"])
    p_mid = _to_point3d(ent["pMid"])
    p2 = _to_point3d(ent["p2"])
    arc = curves.sketchArcs.addByThreePoints(p1, p_mid, p2)
    ctx.set_id(arc, s_name, "arc", override_id=ent["id"])
    sp, ep = arc.startSketchPoint, arc.endSketchPoint
    if sp.geometry.distanceTo(p1) > ep.geometry.distanceTo(p1):
        sp, ep = ep, sp
    ctx.set_id(sp, s_name, "point", override_id=f"{ent['id']}:S")
    ctx.set_id(ep, s_name, "point", override_id=f"{ent['id']}:E")
    ctx.set_id(arc.centerSketchPoint, s_name, "point", override_id=f"{ent['id']}:C")
    return arc


def _find_slot_centerline(curves, p1, p2, line_count_before):
    """T65 (advisor's own real Fusion run, measured): `addCenterToCenterSlot`'s
    own return value is a generic vector, not reliably indexable into named
    curves — the advisor's own recommended technique is to diff the
    sketch's curve collections before/after the call. `addCenterToCenterSlot`
    appends exactly 3 new SketchLines (2 side lines + 1 construction
    centerline; the 2 end arcs land in sketchArcs, irrelevant here) — this
    only searches that NEW slice (`sketchLines[line_count_before:]`, the
    ones this SPECIFIC call just created), not the whole sketch, so an
    earlier piece's own centerline can never be mistaken for this one's
    (T64's first version searched the whole sketch by exact p1/p2 match
    alone, which happened to work for the FIRST slot created purely by
    construction-order coincidence — caught by strengthening a test to
    check a SECOND piece, see WORK-LOG-lane-b.md T64). Within that small
    new slice, the centerline is still the one match on p1/p2 EXACTLY —
    the two side lines sit offset away from it, so this is unambiguous."""
    lines = curves.sketchLines
    try:
        count = lines.count
    except Exception:
        return None
    for i in range(line_count_before, count):
        c = lines.item(i)
        try:
            if c.startSketchPoint.geometry.distanceTo(p1) < 1e-7 and c.endSketchPoint.geometry.distanceTo(p2) < 1e-7:
                return c
        except Exception:
            continue
    return None


def _find_arc_slot_centerline(curves, p1, p_mid, p2, arc_count_before):
    """T69 (SE15b): the arc-shaped sibling of `_find_slot_centerline`, for
    `addThreePointArcSlot` — the advisor's own measured shape ('a
    construction centerline arc through the 3 points, sides +-w/2, end
    caps') gives no more of a trustworthy return value than
    `addCenterToCenterSlot` did (T65's own "generic vector" finding), so
    this diffs `curves.sketchArcs`' own count before/after the call (the
    SAME technique, arcs instead of lines) and, within that new slice,
    requires BOTH a construction-curve flag AND actually passing through
    all 3 given points (within tolerance) to call something the
    centerline. Per the dispatch's own explicit instruction ("if you can't
    identify an arc slot's centerline robustly... log it and skip that
    seg, never guess"): if zero or more than one arc in the new slice
    satisfies both, this returns None rather than picking one — the
    caller raises, which `_create_geometry`'s own per-entity try/except
    turns into a skip+report, never a silent wrong pick."""
    arcs = curves.sketchArcs
    try:
        count = arcs.count
    except Exception:
        return None
    candidates = []
    for i in range(arc_count_before, count):
        a = arcs.item(i)
        try:
            if not getattr(a, "isConstruction", False):
                continue
            center = a.centerSketchPoint.geometry
            radius = center.distanceTo(a.startSketchPoint.geometry)
            on_circle = lambda pt: abs(center.distanceTo(pt) - radius) < 1e-7  # noqa: E731
            if on_circle(p1) and on_circle(p_mid) and on_circle(p2):
                candidates.append(a)
        except Exception:
            continue
    return candidates[0] if len(candidates) == 1 else None


def _create_arc3_slot_entity(ctx, sketch, curves, s_name, ent, width_expression):
    """T69 (SE15b, Fred: "want the shape contour to be made of slots") — a
    contour ARC segment becomes a Fusion-native three-point arc slot
    (`addThreePointArcSlot`), the arc-shaped sibling of `_create_slot_
    entity`'s own center-to-center Line slot: a construction CENTERLINE
    arc through the manifest's own p1/pMid/p2, two side arcs at +-width/2,
    two end caps, and its own width dimension.

    T70 AMEND 2 (advisor's own real Fusion run on T69's own 02b9100, a
    genuine measured bug, not a re-guess): the method's own argument order
    is `(START, END, POINT-ON-ARC)`, NOT `(start, mid, end)` — T69's own
    first attempt called `addThreePointArcSlot(p1, p_mid, p2, ...)`,
    telling Fusion its arc's own END was THIS module's own MIDPOINT, so
    every contour arc built only half its intended sweep (start to
    midpoint, not start to end) — measured as 2 Tangent constraints
    SOLVING_FAILED and a parity maxErr of 2.35in across all 12 contour
    segments. Fixed by passing `p2` (this function's own real end point)
    as Fusion's own END argument, and `p_mid` as Fusion's own POINT-ON-ARC
    (a hint used only to fix the circle, not guaranteed to land on the
    drawn sweep in general — true for every point THIS module ever passes
    it, since `p_mid` is always the real geometric mid-sweep point of the
    SAME arc `p1`/`p2` bound, so it always lands on the intended minor
    arc). `:S`/`:E` are STILL tagged by PROXIMITY to `p1` afterward (kept,
    not removed by this fix) — the advisor's own measurement found
    Fusion's returned centerline arc CCW-normalized regardless of the
    fixed argument order, exactly like `addByThreePoints` already is (T67).

    Registers the CENTERLINE (never the visible slot body) under this
    segment's own manifest id, :C for the centre. Every EXISTING contour
    constraint (Coincident chain, Tangent, H/V, Equal, Symmetry, the
    hourglass's own Radial dims) already targets this SAME id/suffix
    scheme, so they re-target onto the centerline with NO changes of their
    own — a real re-target, not an additive mechanism, exactly like the
    Line-slot case.

    If the centerline can't be identified UNIQUELY, this raises rather
    than guessing — `_find_arc_slot_centerline`'s own doc comment has the
    "never guess" reasoning; the caller (`_create_geometry`)'s existing
    per-entity try/except turns that into a skip+report, the same
    contract every other entity type in this module already has."""
    p1 = _to_point3d(ent["p1"])
    p_mid = _to_point3d(ent["pMid"])
    p2 = _to_point3d(ent["p2"])
    width_in = ent.get("width", 0.07)
    value_input = adsk.core.ValueInput.createByReal(width_in * IN_TO_CM)
    arc_count_before = curves.sketchArcs.count
    sketch.addThreePointArcSlot(p1, p2, p_mid, value_input, True)
    centerline = _find_arc_slot_centerline(curves, p1, p_mid, p2, arc_count_before)
    if not centerline:
        raise RuntimeError(f"could not identify the arc slot's own centerline for {ent['id']}")
    ctx.set_id(centerline, s_name, "arc", override_id=ent["id"])
    sp, ep = centerline.startSketchPoint, centerline.endSketchPoint
    if sp.geometry.distanceTo(p1) > ep.geometry.distanceTo(p1):
        sp, ep = ep, sp
    ctx.set_id(sp, s_name, "point", override_id=f"{ent['id']}:S")
    ctx.set_id(ep, s_name, "point", override_id=f"{ent['id']}:E")
    ctx.set_id(centerline.centerSketchPoint, s_name, "point", override_id=f"{ent['id']}:C")
    if width_expression:
        _drive_last_dimension(ctx, sketch, width_expression, f"{ent['id']}_width")
    return centerline


def _drive_last_dimension(ctx, sketch, expression, semantic_name):
    """After a geometry call that creates its OWN dimension as a side
    effect (addCenterToCenterSlot's own width dimension; previously also
    used for sketch.offset()'s own dimension, T63/T64's now-removed
    offset mechanism) — the driving dimension is the LAST one Fusion just
    appended to sketch.sketchDimensions, not reachable off the geometry
    call's own return value (confirmed via fb_engine's own
    _force_rename_offset_dim, offsets.py, using the identical lookup for
    the identical reason). Sets .expression unconditionally and best-
    effort renames .parameter.name for readability."""
    dims = sketch.sketchDimensions
    if dims.count == 0:
        ctx.logger.log(f"DIM MISS: no dimension found after geometry creation for {semantic_name}", "WARNING")
        return None
    d = dims.item(dims.count - 1)
    try:
        if hasattr(d, 'parameter') and d.parameter:
            try:
                d.parameter.name = semantic_name
            except Exception:
                pass
            d.parameter.expression = str(expression)
        return d
    except Exception as e:
        ctx.logger.log(f"DIM DRIVE FAIL: {semantic_name}: {e}", "WARNING")
        return None


def _create_slot_entity(ctx, sketch, curves, s_name, ent, width_expression):
    """T64 (5 mid-turn amendments, final design): a rail/tie piece becomes
    a Fusion-native center-to-center slot — ONE `addCenterToCenterSlot`
    call produces the whole rounded-rect body (2 side lines + 2 end arcs)
    PLUS an internal construction centerline and its own width dimension,
    all at once. This function:
    1. Creates the slot with a SEED width (`ent['width']`, the manifest's
       own resolved value in inches) — a real, usable starting number,
       later re-driven by `width_expression` (e.g. "stroke_width"), same
       "seed then re-drive" pattern every other dimensioned quantity in
       this module already uses.
    2. Registers the CENTERLINE (not the visible slot body) under this
       piece's own manifest id — relationship constraints (H/V, tie-on-
       rail, node coincidences) all target rails/ties by bare id, and per
       the advisor's own instruction, those constraints act on the slot's
       own centerline.
    3. Re-drives the width dimension via `width_expression`.
    NO symmetry constraint is added (measured: the slot is already
    symmetric by construction; an explicit one over-constrains).

    T65 (advisor's own real Fusion run): `addCenterToCenterSlot` lives on
    `Sketch` itself, NOT on `SketchLines` (verified live via `dir()`) —
    the T64 call site had it backwards, which made EVERY slot call raise
    AttributeError, caught one level up in `_create_geometry`'s own per-
    entity try/except and logged as a skip (80-94 "CONSTRAINT MISS" on the
    advisor's own real fixtures, since no rail/tie ever got registered).
    `Sketch` also exposes `addThreePointArcSlot`/`addCenterPointArcSlot`/
    `addCenterPointSlot`/`addOverallSlot` alongside it — none used here,
    named only because they confirm the METHOD FAMILY lives on Sketch, not
    a coincidence specific to this one method.

    T66 (Fred's own rule, "never use Fix"; advisor's own real Fusion run:
    ALL 63 relationship constraints on a real box fixture failed
    VCS_SKETCH_OVER_CONSTRAINTS): T64's OWN post-hoc `isFixed = True` on
    both centerline endpoints — the ACTUAL source of the Fix bug — is
    REMOVED entirely, and never comes back regardless of what else this
    function does. Pinning every piece in place is now ENTIRELY the
    relationship constraints' own job (`_apply_constraints`, fed by the
    manifest's own H/V/Coincident declarations) — the advisor's own
    measured minimal example (2 rails + 1 tie, all slots, NO Fix) produced
    ZERO failures.

    T67 (advisor's own real Fusion run, corrects a T66 misdiagnosis): the
    API call's own 4th argument is NOT an anchor/Fix flag at all — it's
    CREATE-WIDTH-DIMENSION. T66 set it `False` on the (wrong) theory that
    it was the SAME Fix mechanism as the post-hoc `isFixed` above; measured
    live, `False` means the slot gets NO `SketchDiameterDimension` at all,
    so `_drive_last_dimension` (below) finds nothing to re-drive — every
    slot's own width dimension came back "DIM MISS" and `stroke_width`
    drove nothing (34/35 constraint fails too, likely downstream: a
    dimensionless slot's own geometry may not fully resolve). Reverted to
    `True` — this is genuinely a DIFFERENT knob from Fix, not a re-
    introduction of it; the two mechanisms happened to share one call
    site's own boolean position, which is exactly what made T66's own
    diagnosis plausible-but-wrong without a live measurement to check it
    against."""
    p1 = _to_point3d(ent["p1"])
    p2 = _to_point3d(ent["p2"])
    width_in = ent.get("width", 0.07)
    value_input = adsk.core.ValueInput.createByReal(width_in * IN_TO_CM)
    line_count_before = curves.sketchLines.count
    sketch.addCenterToCenterSlot(p1, p2, value_input, True)
    centerline = _find_slot_centerline(curves, p1, p2, line_count_before)
    if not centerline:
        raise RuntimeError(f"could not identify the slot's own centerline for {ent['id']}")
    ctx.set_id(centerline, s_name, "line", override_id=ent["id"])
    ctx.set_id(centerline.startSketchPoint, s_name, "point", override_id=f"{ent['id']}:S")
    ctx.set_id(centerline.endSketchPoint, s_name, "point", override_id=f"{ent['id']}:E")
    if width_expression:
        _drive_last_dimension(ctx, sketch, width_expression, f"{ent['id']}_width")
    return centerline


def _create_geometry(ctx, sketch, s_name, entities, dimensions=None):
    """Entities-first pass (§5's own build order). Returns (created_count,
    skipped) — skipped is a list of {"id","type","reason"} dicts. Never
    raises past this function: one bad entity is skipped and reported,
    never aborts the rest of the sketch (the dispatch's own explicit ask,
    applied here since this is NEW code fb_engine doesn't provide — unlike
    constraint_step/dimension_step, which already have this contract
    built in). `dimensions` (T64) is looked up for each `Slot` entity's
    own matching SlotWidth expression — created and dimensioned in the
    SAME step, unlike every other entity type here (see _create_slot_
    entity's own doc comment for why)."""
    curves = sketch.sketchCurves
    slot_width_expr_by_id = {d["target"]: d.get("expression") for d in (dimensions or []) if d.get("type") == "SlotWidth"}
    created = 0
    skipped = []
    for ent in entities or []:
        etype = ent.get("type")
        eid = ent.get("id")
        try:
            if etype == "Line":
                _create_line_entity(ctx, curves, s_name, ent)
            elif etype == "Circle":
                _create_circle_entity(ctx, curves, s_name, ent)
            elif etype == "ArcCenter":
                _create_arc_center_entity(ctx, curves, s_name, ent)
            elif etype == "Arc3Point":
                _create_arc3_entity(ctx, curves, s_name, ent)
            elif etype == "Slot":
                _create_slot_entity(ctx, sketch, curves, s_name, ent, slot_width_expr_by_id.get(eid))
            elif etype == "Arc3PointSlot":
                _create_arc3_slot_entity(ctx, sketch, curves, s_name, ent, slot_width_expr_by_id.get(eid))
            else:
                skipped.append({"id": eid, "type": etype, "reason": "unknown entity type"})
                ctx.logger.log(f"GEOM SKIP: unknown type '{etype}' for {eid}", "WARNING")
                continue
            created += 1
        except Exception as e:
            skipped.append({"id": eid, "type": etype, "reason": str(e)})
            ctx.logger.log(f"GEOM FAIL: {eid} ({etype}): {e}", "ERROR")
    return created, skipped


# ---------------------------------------------------------------------------
# Constraints — straight feed into fb_engine's own constraint_step
# ---------------------------------------------------------------------------
def _apply_constraints(ctx, sketch, s_name, constraints):
    """The manifest's {type, targets} constraint dicts map 1:1 onto
    constraint_step's own {"Type", "Targets"} shape — Coincident, Tangent,
    Horizontal, Vertical, Equal are ALL already implemented there (T60's
    own research confirmed this: 5 of 5 needed types, no gap); Symmetry
    (3 targets: point, point, symmetryLine) added in T70 for the shape
    contour's own L/R mirror pass. Wrapped in a defensive try/except anyway
    (constraint_step itself never raises past its own internals, per its
    own code — this is belt-and-suspenders for a genuinely malformed
    manifest entry, not the primary safety net)."""
    for c in constraints or []:
        rel = {"Type": c.get("type"), "Targets": c.get("targets", [])}
        try:
            constraint_step(ctx, sketch, s_name, rel)
        except Exception as e:
            ctx.logger.log(f"CONSTRAINT WRAP FAIL: {rel['Type']} on {rel['Targets']}: {e}", "ERROR")


# ---------------------------------------------------------------------------
# Radial/Distance dimensions — straight feed into fb_engine's own dimension_step
# ---------------------------------------------------------------------------
def _apply_declared_dimensions(ctx, sketch, s_name, dimensions):
    """The manifest's Radial dimension entries ({target, expression}) map
    onto dimension_step's own {"DimType":"Radius", "Target", "Expression"}
    shape — already implemented there for both Radius/Diameter (T60's own
    research). T70 AMEND 5: Distance entries ({targets:[a,b], orientation,
    expression}) map onto dimension_step's own {"DimType":"Distance",
    "Targets":[a,b], "Orientation", "Expression"} shape — ALSO already
    implemented there (`_create_dimension`'s own "Targets... len>=2" branch
    -> `addDistanceDimension`), not new fb_engine surface, just a
    previously-unused existing one. SlotWidth entries are handled
    separately, during geometry creation itself (_create_slot_entity) —
    dimension_step itself has NO "SlotWidth" DimType branch, and a slot's
    own width dimension is a side effect of `addCenterToCenterSlot`, not a
    standalone dimension_step call the way Radial/Distance are."""
    for d in dimensions or []:
        dtype = d.get("type")
        if dtype == "Radial":
            target = d.get("target")
            dim_spec = {"DimType": "Radius", "Target": target, "Expression": d.get("expression"), "Name": f"dim_{target}"}
        elif dtype == "Distance":
            targets = d.get("targets") or []
            target = "_".join(targets)
            dim_spec = {
                "DimType": "Distance", "Targets": targets, "Orientation": d.get("orientation"),
                "Expression": d.get("expression"), "Name": f"dim_{target}",
            }
        else:
            continue
        try:
            dimension_step(ctx, sketch, s_name, dim_spec)
        except Exception as e:
            ctx.logger.log(f"DIM WRAP FAIL: {target}: {e}", "ERROR")


# ---------------------------------------------------------------------------
# Parity — T68 item 2b (Fred: "make sure the drawing in the addin matches
# the one we insert in fusion"). Reads back what build_constrained_sketch
# ACTUALLY built (via ctx.entity_map, keyed by the SAME manifest ids
# _create_*_entity already registers them under) and compares against the
# manifest's own DECLARED geometry — a mismatch beyond `tol` means the
# constraint/dimension solve pulled geometry away from where the manifest
# said it should be, not a build failure (the entity was still created).
# ---------------------------------------------------------------------------
def _point_in(pt_cm):
    """A Fusion Point3D (CM) -> [x, y] in INCHES, the manifest's own
    convention (§1: "units": "in") — the inverse of _to_point3d."""
    return [pt_cm.x / IN_TO_CM, pt_cm.y / IN_TO_CM]


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _circumcircle(p1, p_mid, p2):
    """Center+radius (inches) of the circle through 3 points — the
    manifest's own Arc3Point entity never stores center/radius directly
    (T65's own fix: the JS side stopped re-deriving an angle representation
    after a reflection), so this derives the manifest's own IMPLIED circle
    from its declared p1/pMid/p2, to compare against the actual built arc's
    real center/radius. Standard circumcenter formula; returns None for 3
    (near-)collinear points (an infinite/undefined radius — never expected
    for a real silhouette arc, so callers skip the radius check in that
    case rather than raising)."""
    ax, ay = p1
    bx, by = p_mid
    cx, cy = p2
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return None
    ux = ((ax ** 2 + ay ** 2) * (by - cy) + (bx ** 2 + by ** 2) * (cy - ay) + (cx ** 2 + cy ** 2) * (ay - by)) / d
    uy = ((ax ** 2 + ay ** 2) * (cx - bx) + (bx ** 2 + by ** 2) * (ax - cx) + (cx ** 2 + cy ** 2) * (bx - ax)) / d
    radius = math.hypot(ax - ux, ay - uy)
    return [ux, uy], radius


def verify_sketch_against_manifest(ctx, sketch, manifest, tol=0.002):
    """Compares every manifest entity's DECLARED geometry (inches) against
    what `ctx.entity_map[sketch.name]` actually holds after the full
    build — Slot/Line by centerline ends (order-preserving: for a Slot,
    `_find_slot_centerline`/`_find_arc_slot_centerline` only ever register
    the centerline whose own start/end ALREADY matched p1/p2 (or p1/pMid/p2)
    exactly at creation time, so this is really checking whether the LATER
    constraint/dimension pass moved it away again); Circle by center+radius;
    Arc3Point/Arc3PointSlot (T69: the SAME check either way — a contour arc
    slot's own construction centerline is geometrically identical to a
    plain Arc3Point for this purpose) by ends compared ORDER-FREE (Fusion's
    own `addByThreePoints`/`addThreePointArcSlot` both always normalize to
    CCW, so which manifest point becomes `.startSketchPoint` vs
    `.endSketchPoint` isn't guaranteed — this checks the actual geometry,
    not `_create_arc3_entity`/`_create_arc3_slot_entity`'s own proximity-
    tagged :S/:E, so it stays correct regardless of either function's own
    labeling) plus radius/center derived from the manifest's own
    p1/pMid/p2 via `_circumcircle`. ArcCenter is not checked — T65's own
    `applyCarvePlacement` always converts it to Arc3Point before a manifest
    reaches this module; a raw pre-placement manifest fed straight to
    `build_from_manifest_file` is a dev-only path outside this check's
    scope.

    Never raises: an entity missing from entity_map (already reported
    under entities.skipped) or a lookup that throws counts as a mismatch
    with no contribution to maxErr, rather than aborting the whole check —
    matching every other phase in this module (`_create_geometry`,
    `_apply_constraints`, ...), where one bad entity never takes down the
    rest.

    Returns {"maxErr": float inches (0.0 if nothing to check), "mismatches":
    [id, ...]}. Logs one WARNING (count + first 5 ids) when non-empty."""
    g_map = ctx.entity_map.get(sketch.name, {})
    max_err = 0.0
    mismatches = []
    for ent in manifest.get("entities", []):
        etype = ent.get("type")
        eid = ent.get("id")
        entity = g_map.get(eid)
        if not entity:
            if etype in ("Slot", "Line", "Circle", "Arc3Point", "Arc3PointSlot"):
                mismatches.append(eid)
            continue
        try:
            if etype in ("Slot", "Line"):
                p1a = _point_in(entity.startSketchPoint.geometry)
                p2a = _point_in(entity.endSketchPoint.geometry)
                err = max(_dist(p1a, ent["p1"]), _dist(p2a, ent["p2"]))
            elif etype == "Circle":
                ca = _point_in(entity.centerSketchPoint.geometry)
                ra_in = entity.radius / IN_TO_CM
                err = max(_dist(ca, ent["center"]), abs(ra_in - ent["radius"]))
            elif etype in ("Arc3Point", "Arc3PointSlot"):
                sa = _point_in(entity.startSketchPoint.geometry)
                ea = _point_in(entity.endSketchPoint.geometry)
                end_err = min(
                    max(_dist(sa, ent["p1"]), _dist(ea, ent["p2"])),
                    max(_dist(sa, ent["p2"]), _dist(ea, ent["p1"])),
                )
                circum = _circumcircle(ent["p1"], ent["pMid"], ent["p2"])
                if circum:
                    exp_center, exp_radius = circum
                    ca = _point_in(entity.centerSketchPoint.geometry)
                    ra_in = entity.radius / IN_TO_CM
                    err = max(end_err, _dist(ca, exp_center), abs(ra_in - exp_radius))
                else:
                    err = end_err
            else:
                continue
        except Exception as e:
            ctx.logger.log(f"PARITY CHECK FAIL: {eid}: {e}", "WARNING")
            mismatches.append(eid)
            continue
        max_err = max(max_err, err)
        if err > tol:
            mismatches.append(eid)
    if mismatches:
        ctx.logger.log(
            f"PARITY WARNING: {len(mismatches)} entity(ies) drifted beyond {tol}in from the manifest: {mismatches[:5]}",
            "WARNING")
    return {"maxErr": round(max_err, 6), "mismatches": mismatches}


# ---------------------------------------------------------------------------
# User parameters — create-or-update, arbitrary manifest-declared names
# ---------------------------------------------------------------------------
def _sync_manifest_parameters(ctx, parameters):
    """Create-or-update EVERY named parameter the manifest declares (§1's
    own `parameters[]` — rail_width, corner_radius, half_width, etc.),
    BEFORE any geometry/dimension/offset step that might reference one by
    name in an expression — same ordering ParametricSketchBuilder's own
    _sync_user_parameters (frame-builder/fb_engine/parametric_engine.py)
    already establishes for the identical structural reason (a dimension's
    own .expression string can't resolve a parameter that doesn't exist
    yet). b-spline-gen.py's OWN _sync_user_parameters is NOT reused here —
    it's hardcoded to a 2-entry widthIn/heightIn param_map (T60's own
    research), not a generic arbitrary-name loop; this function is closer
    to ParametricSketchBuilder's own generic version, adapted for this
    manifest's own {name, value, unit} shape rather than a bare UI dict."""
    user_params = ctx.design.userParameters
    created, updated = 0, 0
    failed = []
    for p in parameters or []:
        name = p.get("name")
        value = p.get("value")
        unit = p.get("unit") or ""
        if not name:
            continue
        try:
            existing = user_params.itemByName(name)
            if existing:
                existing.expression = str(value)
                updated += 1
            else:
                # T63 fix (advisor's own real-Fusion measurement): createByReal
                # takes a value in Fusion's CANONICAL internal unit (cm for a
                # length), ignoring the `unit` string passed to .add() — that
                # arg only labels/displays the parameter, it does NOT convert
                # the raw number. Passing 0.07 (meant as INCHES) via createByReal
                # silently created a 0.07 CM parameter (confirmed: it measured
                # back as 0.0276in = 0.07/2.54). A real length unit needs
                # createByString(f"{value} {unit}") so Fusion's own expression
                # parser does the conversion; a genuinely unitless ratio
                # (waist_reach, corner_radius, ...) keeps createByReal exactly
                # as before (no unit string to misinterpret).
                if unit:
                    value_input = adsk.core.ValueInput.createByString(f"{value} {unit}")
                else:
                    value_input = adsk.core.ValueInput.createByReal(float(value))
                user_params.add(name, value_input, unit, "SE15 constrained sketch parameter")
                created += 1
        except Exception as e:
            failed.append(f"{name}: {e}")
            ctx.logger.log(f"PARAM SYNC FAIL: {name}: {e}", "WARNING")
    return created, updated, failed


# ---------------------------------------------------------------------------
# Orchestration — §5's own build sequence
# ---------------------------------------------------------------------------
def build_constrained_sketch(sketch_target, design, manifest, placement=None, ui_data=None, log_fn=None, sketch_name_override=None):
    """§5's own build sequence — the add-in side of SE15 (design doc §5,
    T61's own JS-side manifest producer). `sketch_target` is a Component
    (matching _import_single_layer_svg's own contract —
    sketch_target.sketches.add(plane)); `design` is the active
    adsk.fusion.Design (b-spline-gen.py's own `des`, already resolved in
    _handle_generate's own scope by the time this would be called — not
    re-derived here, since guessing at a Component's own parent design
    attribute is more fragile than just asking the caller for it);
    `manifest` is the §1 JSON dict (already parsed, not a JSON string);
    `placement` optionally overrides plane selection (defaults to the SAME
    xYConstructionPlane _import_single_layer_svg already uses for
    orientation=='z-up' — open question #4 in the design doc, kept as
    today's default per the advisor's own "Answers" ruling: "keep
    _import_single_layer_svg's construction-plane placement... revisit
    after use"). `sketch_name_override` (T64): the manifest's own
    `sketchName` field is set by export-flow.js's own `_fusionLayerManifest`
    to a generic `f"Layer {id}"` — fine as a diagnostic default for
    `build_from_manifest_file`'s own dev usage, but WRONG for a real
    per-layer send, where the sketch should match the plain-SVG path's own
    naming scheme (`_import_all_svg_layers`'s own `sketch_name`, "L<n> -
    <profile> (<depth>\")"). The caller (`_build_constrained_sketch_for_
    layer`, b-spline-gen.py) passes the matching name here; when omitted
    (the dev-entry-point path), the manifest's own field is used exactly
    as before.

    Order (§5, matching fb_engine's own _build_blocks convention): all
    PARAMETERS first (so an expression can reference one by name), then
    ALL geometry, then constraints, inside one deferred-compute window; a
    manual Pulse; then Radial/Distance dimensions (T70 AMEND 5 added
    Distance) in a second window.

    Failure handling: every step is wrapped so ONE bad entity/constraint/
    dimension/offset is skipped and reported, never aborts the rest of the
    sketch — this module's own Logger accumulates every SKIP/FAIL/MISS-
    tagged log line so the returned summary reports an accurate count +
    first-few-reasons without needing fb_engine's own step functions to
    change their existing fire-and-forget/log-only contract.

    Returns a summary dict: {sketchName, entities:{created,skipped},
    constraints:{count,first_reasons}, dimensions:{count,first_reasons},
    parameters:{created,updated,failed}, parity:{maxErr,mismatches} (T68
    item 2b — see verify_sketch_against_manifest's own doc comment),
    latticeConstrained, seconds}.
    """
    t0 = time.time()
    logger = _Logger(log_fn)
    ctx = BuildContext(sketch_target, design, logger, prefix="SE15", ui_data=ui_data)

    plane = placement or sketch_target.xYConstructionPlane
    sketch = sketch_target.sketches.add(plane)
    sketch.name = sketch_name_override or manifest.get("sketchName") or "SE15 Constrained Sketch"
    s_name = sketch.name
    ctx.entity_map[s_name] = {}
    ctx.sketches[s_name] = sketch
    # T70 AMEND 4: the manifest's own mirror-axis Coincident constraints
    # target a special 'origin' id -- registered here (not a real manifest
    # ENTITY, so it never goes through _create_geometry) so the EXISTING
    # generic resolve_entity lookup (a plain entity_map dict get) finds it
    # for free, with zero changes to fb_engine's own shared resolver.
    ctx.entity_map[s_name]["origin"] = sketch.originPoint

    p_created, p_updated, p_failed = _sync_manifest_parameters(ctx, manifest.get("parameters"))

    entities = manifest.get("entities", [])
    constraints = manifest.get("constraints", [])
    dimensions = manifest.get("dimensions", [])

    # T64 (final design, 5 mid-turn amendments): a Slot entity creates its
    # OWN width dimension as a side effect of geometry creation itself
    # (_create_slot_entity, inside _create_geometry) — no separate
    # offset/cap phase exists any more (Fred: "box lattice needs to be
    # slots too", removing the old offset+cap mechanism entirely, not
    # just gating it off for one layer type). Geometry + constraints stay
    # in ONE deferred-compute window, same as before.
    sketch.isComputeDeferred = True
    try:
        e_created, e_skipped = _create_geometry(ctx, sketch, s_name, entities, dimensions)
        _apply_constraints(ctx, sketch, s_name, constraints)
    finally:
        sketch.isComputeDeferred = False

    # Manual Pulse — Radial/Distance dimensions below may reference
    # points/curves the geometry/constraint pass just created (offsets.py's
    # own documented reason, Ground truth #5, reused here for the same
    # structural reason even though the offset mechanism itself is gone).
    sketch.isComputeDeferred = True
    sketch.isComputeDeferred = False

    sketch.isComputeDeferred = True
    try:
        _apply_declared_dimensions(ctx, sketch, s_name, dimensions)
    finally:
        sketch.isComputeDeferred = False

    constraint_issues = _summarize_issues(
        logger.records, markers=("CONSTRAINT SKIP", "CONSTRAINT FAIL", "CONSTRAINT MISS", "CONSTRAINT WRAP FAIL"))
    dim_issues = _summarize_issues(
        logger.records, markers=("DIM MISS", "DIM CRASH", "DIM NODIM", "DIM EXPR FAIL", "DIM WRAP FAIL", "DIM NAME FAIL"))
    parity = verify_sketch_against_manifest(ctx, sketch, manifest)

    return {
        "sketchName": s_name,
        "entities": {"created": e_created, "skipped": e_skipped},
        "constraints": constraint_issues,
        "dimensions": dim_issues,
        "parameters": {"created": p_created, "updated": p_updated, "failed": p_failed},
        "parity": parity,
        "latticeConstrained": manifest.get("latticeConstrained"),
        "seconds": round(time.time() - t0, 2),
    }


def build_from_manifest_file(path, placement=None):
    """Dev entry point for `fusion_execute`-style invocation, per T62's own
    dispatch ask — no HTML-bridge round-trip needed. Reads a manifest JSON
    file from disk, builds it into a NEW sketch on the ROOT component's XY
    plane, returns build_constrained_sketch's own summary dict.

    NOT wired into any UI — call directly, e.g. from a fusion_execute
    script:
        import sys
        sys.path.insert(0, r'<addin-root>/b-spline-gen')
        from sketch_manifest_builder import build_from_manifest_file
        print(build_from_manifest_file(r'C:/path/to/manifest.json'))

    The manifest JSON file itself is exactly what `window.__se15Manifest()`
    (T61, main/app-init.js, gated behind `window.__editorDebug = 'SE15'`)
    returns from the live palette page — copy that object's own JSON out
    of devtools (`JSON.stringify(window.__se15Manifest(), null, 2)`) into
    a file, then point this function at it.
    """
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    if not design:
        raise RuntimeError("build_from_manifest_file: no active Fusion Design")
    with open(path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    root_comp = design.rootComponent
    return build_constrained_sketch(root_comp, design, manifest, placement=placement)
