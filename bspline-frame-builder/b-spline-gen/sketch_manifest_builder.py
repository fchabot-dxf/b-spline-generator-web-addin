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
geometry-creation (Line/Circle/ArcCenter) and width-offset+cap functions,
because fb_engine's own gaps don't fit this manifest's shape:
  - geometry.py's geom_step has no Circle/ArcCenterPoint dispatch branch
    (T60's own research confirmed this — declared in a type list elsewhere,
    never implemented).
  - offsets.py's offset_step/_try_parametric_offset assumes a CLOSED
    multi-curve loop (_tag_offset_results' own classify_rect_lines needs
    >=4 curves; a single open rail/tie would silently get NO endpoint
    tagging at all through that path). The advisor's own live-Fusion
    measurement (SE15-CONSTRAINED-SKETCH-DESIGN.md "Answers" §1+2)
    confirmed the CLASSIC sketch.offset() call (not addOffset2) is what
    actually works for a single open line — that's what this module calls
    directly, per T62's own dispatch text.

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


def _create_geometry(ctx, sketch, s_name, entities):
    """Entities-first pass (§5's own build order). Returns (created_count,
    skipped) — skipped is a list of {"id","type","reason"} dicts. Never
    raises past this function: one bad entity is skipped and reported,
    never aborts the rest of the sketch (the dispatch's own explicit ask,
    applied here since this is NEW code fb_engine doesn't provide — unlike
    constraint_step/dimension_step, which already have this contract
    built in)."""
    curves = sketch.sketchCurves
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
    own research confirmed this: 5 of 5 needed types, no gap). Wrapped in
    a defensive try/except anyway (constraint_step itself never raises
    past its own internals, per its own code — this is belt-and-suspenders
    for a genuinely malformed manifest entry, not the primary safety net)."""
    for c in constraints or []:
        rel = {"Type": c.get("type"), "Targets": c.get("targets", [])}
        try:
            constraint_step(ctx, sketch, s_name, rel)
        except Exception as e:
            ctx.logger.log(f"CONSTRAINT WRAP FAIL: {rel['Type']} on {rel['Targets']}: {e}", "ERROR")


# ---------------------------------------------------------------------------
# Radial dimensions — straight feed into fb_engine's own dimension_step
# ---------------------------------------------------------------------------
def _apply_radial_dimensions(ctx, sketch, s_name, dimensions):
    """The manifest's Radial dimension entries ({target, expression}) map
    onto dimension_step's own {"DimType":"Radius", "Target", "Expression"}
    shape — already implemented there for both Radius/Diameter (T60's own
    research). Offset-type dimension entries are handled separately, by
    _apply_width_offsets below — dimension_step itself
    has NO "Offset" DimType branch (offsets are OffsetConstraints, not
    SketchDimensions, in this codebase's own established split)."""
    for d in dimensions or []:
        if d.get("type") != "Radial":
            continue
        target = d.get("target")
        dim_spec = {"DimType": "Radius", "Target": target, "Expression": d.get("expression"), "Name": f"dim_{target}"}
        try:
            dimension_step(ctx, sketch, s_name, dim_spec)
        except Exception as e:
            ctx.logger.log(f"DIM WRAP FAIL: {target}: {e}", "ERROR")


# ---------------------------------------------------------------------------
# Width offsets + round caps — this module's own (fb_engine's offset_step
# doesn't fit a single open line; see module header)
# ---------------------------------------------------------------------------
def _resolve_offset_seed_distance(expression, ctx):
    """A best-effort NUMERIC seed (cm) for sketch.offset()'s own `dist` arg
    — the dimension this call creates is immediately re-driven by
    `expression` right after (e.g. "rail_width / 2"), so this seed only
    needs to be a small, positive, non-degenerate magnitude; it does not
    need to equal the expression's own resolved value exactly. Tries
    Fusion's own expression evaluator first (correct units, correct
    CURRENT parameter value, since parameters are synced before this
    runs); falls back to a small fixed constant if that fails."""
    try:
        return abs(ctx.design.unitsManager.evaluateExpression(str(expression), "cm"))
    except Exception:
        return 0.05 * IN_TO_CM  # ~0.05in seed, arbitrary but safely nonzero


def _perp_direction_point(line_entity, side_sign, distance_cm):
    """A point offset perpendicular from `line_entity`'s own midpoint, on
    the side `side_sign` (+1/-1) picks — sketch.offset()'s own `dirPt` arg
    is how it's told WHICH SIDE of the curve to offset toward (per the
    advisor's own live-Fusion measurement, SE15-CONSTRAINED-SKETCH-
    DESIGN.md "Answers": a single open line needs ONE sketch.offset() call
    PER SIDE, dirPt-selected). Reads the line's own ALREADY-BUILT Fusion
    geometry (cm), not the manifest's raw inches, so this stays correct
    regardless of how _to_point3d converted the original coordinates."""
    p1, p2 = line_entity.startSketchPoint.geometry, line_entity.endSketchPoint.geometry
    mx, my = (p1.x + p2.x) / 2, (p1.y + p2.y) / 2
    dx, dy = p2.x - p1.x, p2.y - p1.y
    length = math.hypot(dx, dy) or 1.0
    perp_x, perp_y = -dy / length, dx / length
    return adsk.core.Point3D.create(mx + perp_x * distance_cm * side_sign, my + perp_y * distance_cm * side_sign, 0)


def _drive_last_offset_dimension(ctx, sketch, expression, semantic_name):
    """After a sketch.offset() call, the driving SketchOffsetCurvesDimension
    is the LAST dimension Fusion just appended to sketch.sketchDimensions —
    NOT reachable off the returned curve collection directly (confirmed by
    reading fb_engine's own _force_rename_offset_dim, offsets.py, which
    uses this exact same lookup for the identical reason). Sets
    .expression unconditionally (the real driving value) and best-effort
    renames .parameter.name for readability in Fusion's own parameter
    list — same rename-then-set order dimensions.py's own _apply_expression
    already uses."""
    dims = sketch.sketchDimensions
    if dims.count == 0:
        ctx.logger.log(f"OFFSET DIM MISS: no dimension found after offset for {semantic_name}", "WARNING")
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
        ctx.logger.log(f"OFFSET DIM DRIVE FAIL: {semantic_name}: {e}", "WARNING")
        return None


def _do_single_offset(ctx, sketch, s_name, line_entity, side_sign, expression, semantic_name):
    """ONE classic sketch.offset() call (the advisor's own measured,
    proven path — NOT addOffset2, per T62's own dispatch text) on a single
    line, one side. Pulses the sketch (isComputeDeferred False->True)
    right after — offsets.py's own established reason: the returned curve
    is an unfinalized proxy while deferred, so a write like
    `dim.parameter.expression = ...` would silently no-op without this."""
    seed_dist = _resolve_offset_seed_distance(expression, ctx)
    coll = adsk.core.ObjectCollection.create()
    coll.add(line_entity)
    dir_pt = _perp_direction_point(line_entity, side_sign, seed_dist)
    result = sketch.offset(coll, dir_pt, seed_dist)
    if not result or result.count == 0:
        ctx.logger.log(f"OFFSET EMPTY: {semantic_name}", "WARNING")
        return None
    sketch.isComputeDeferred = False
    sketch.isComputeDeferred = True
    _drive_last_offset_dimension(ctx, sketch, expression, semantic_name)
    return result.item(0)


def _apply_width_offsets(ctx, sketch, s_name, offset_dims):
    """§4/§5/§6: TWO classic sketch.offset() calls per centerline (one per
    side). Cap arcs themselves are already created in the geometry pass
    (<id>_capA/<id>_capB, centered on the centerline's own end, radius =
    the SAME width/2 the offsets use) and already get a Radial dimension
    (§1's own manifest, handled by _apply_radial_dimensions) — that alone
    fully determines them (center on the centerline's own end point,
    radius tied to the same parameter driving the offsets).

    T63 fix (advisor's own real-Fusion run, `build_from_manifest_file` on
    a live 75-entity/51-constraint hourglass+lattice fixture): T62's own
    FIRST version of this function also added an explicit Tangent between
    each cap and its nearby offset curve. That produced 30 "CAP TANGENT
    SKIP ... VCS_SKETCH_OVER_CONSTRAINTS" — the cap is ALREADY fully
    pinned by the center+radius above, so an explicit Tangent is a
    redundant, conflicting 5th constraint on a curve that already has 0
    remaining degrees of freedom. Per the advisor's own explicit
    instruction ("drop the explicit cap-tangent step... the result must
    have ZERO skips on this fixture, don't just silence the log"), the
    addTangent call is REMOVED here, not wrapped/silenced — this function
    no longer touches sketch.geometricConstraints at all.

    `offset_dims`: the manifest's own `dimensions[]` entries with
    type=='Offset' — each already {targets:[...ids], expression, id}, one
    pos/neg PAIR per kind-group (rail_offset_pos/rail_offset_neg, etc.).
    One sketch.offset() call PER TARGET id (not one call for the whole
    group's ObjectCollection at once) — the design doc's own open question
    #1/#2 resolved conservatively here, since the advisor's own live
    measurement was specifically against a SINGLE line, not an untested
    multi-line collection.
    """
    pos_by_kind, neg_by_kind = {}, {}
    for od in offset_dims or []:
        oid = od.get("id", "")
        if oid.endswith("_offset_pos"):
            pos_by_kind[oid[:-len("_offset_pos")]] = od
        elif oid.endswith("_offset_neg"):
            neg_by_kind[oid[:-len("_offset_neg")]] = od

    created = 0
    issues = []
    for kind, pos_od in pos_by_kind.items():
        neg_od = neg_by_kind.get(kind)
        if not neg_od:
            msg = f"OFFSET PAIR MISS: no matching _neg entry for '{kind}'"
            issues.append(msg)
            ctx.logger.log(msg, "WARNING")
            continue
        for target_id in pos_od.get("targets", []):
            try:
                line_entity = ctx.resolve_entity(s_name, target_id)
                if not line_entity:
                    msg = f"OFFSET MISS: {target_id} not found in {s_name}"
                    issues.append(msg)
                    ctx.logger.log(msg, "WARNING")
                    continue

                pos_curve = _do_single_offset(ctx, sketch, s_name, line_entity, +1, pos_od.get("expression"), f"{target_id}_offset_pos")
                neg_curve = _do_single_offset(ctx, sketch, s_name, line_entity, -1, neg_od.get("expression"), f"{target_id}_offset_neg")
                if pos_curve:
                    created += 1
                if neg_curve:
                    created += 1
            except Exception as e:
                msg = f"OFFSET FAIL: {target_id}: {e}"
                issues.append(msg)
                ctx.logger.log(msg, "ERROR")
    return created, issues


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
def build_constrained_sketch(sketch_target, design, manifest, placement=None, ui_data=None, log_fn=None):
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
    after use").

    Order (§5, matching fb_engine's own _build_blocks convention): all
    PARAMETERS first (so an expression can reference one by name), then
    ALL geometry, then constraints, inside one deferred-compute window; a
    manual Pulse; then Radial dimensions and width offsets+caps (which do
    their OWN internal Pulse per offset — offsets.py's own established
    reason) in a second window.

    Failure handling: every step is wrapped so ONE bad entity/constraint/
    dimension/offset is skipped and reported, never aborts the rest of the
    sketch — this module's own Logger accumulates every SKIP/FAIL/MISS-
    tagged log line so the returned summary reports an accurate count +
    first-few-reasons without needing fb_engine's own step functions to
    change their existing fire-and-forget/log-only contract.

    Returns a summary dict: {sketchName, entities:{created,skipped},
    constraints:{count,first_reasons}, dimensions:{count,first_reasons},
    offsets:{created,issues:{count,first_reasons}},
    parameters:{created,updated,failed}, latticeConstrained, seconds}.
    """
    t0 = time.time()
    logger = _Logger(log_fn)
    ctx = BuildContext(sketch_target, design, logger, prefix="SE15", ui_data=ui_data)

    plane = placement or sketch_target.xYConstructionPlane
    sketch = sketch_target.sketches.add(plane)
    sketch.name = manifest.get("sketchName") or "SE15 Constrained Sketch"
    s_name = sketch.name
    ctx.entity_map[s_name] = {}
    ctx.sketches[s_name] = sketch

    p_created, p_updated, p_failed = _sync_manifest_parameters(ctx, manifest.get("parameters"))

    entities = manifest.get("entities", [])
    constraints = manifest.get("constraints", [])
    dimensions = manifest.get("dimensions", [])

    sketch.isComputeDeferred = True
    try:
        e_created, e_skipped = _create_geometry(ctx, sketch, s_name, entities)
        _apply_constraints(ctx, sketch, s_name, constraints)
    finally:
        sketch.isComputeDeferred = False

    # Manual Pulse — offsets/dimensions below need to reference endpoints
    # the geometry/constraint pass just created (offsets.py's own
    # documented reason, Ground truth #5).
    sketch.isComputeDeferred = True
    sketch.isComputeDeferred = False

    sketch.isComputeDeferred = True
    try:
        _apply_radial_dimensions(ctx, sketch, s_name, dimensions)
        offset_dims = [d for d in dimensions if d.get("type") == "Offset"]
        o_created, o_issues = _apply_width_offsets(ctx, sketch, s_name, offset_dims)
    finally:
        sketch.isComputeDeferred = False

    constraint_issues = _summarize_issues(
        logger.records, markers=("CONSTRAINT SKIP", "CONSTRAINT FAIL", "CONSTRAINT MISS", "CONSTRAINT WRAP FAIL"))
    dim_issues = _summarize_issues(
        logger.records, markers=("DIM MISS", "DIM CRASH", "DIM NODIM", "DIM EXPR FAIL", "DIM WRAP FAIL", "DIM NAME FAIL"))

    return {
        "sketchName": s_name,
        "entities": {"created": e_created, "skipped": e_skipped},
        "constraints": constraint_issues,
        "dimensions": dim_issues,
        "offsets": {"created": o_created, "issues": {"count": len(o_issues), "first_reasons": o_issues[:5]}},
        "parameters": {"created": p_created, "updated": p_updated, "failed": p_failed},
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
