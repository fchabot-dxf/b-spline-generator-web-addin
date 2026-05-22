"""Manufacturing Model builder.

Three MMs, one per body filter rule:

  +------------------+--------------------------+------------------------+
  | Rule name        | Bodies kept              | Bodies removed         |
  +==================+==========================+========================+
  | ``stock``        | (none -- raw blank)      | all                    |
  | ``bspline_set``  | b-spline panel bodies    | frame bodies           |
  | ``frame``        | frame bodies             | b-spline bodies        |
  +------------------+--------------------------+------------------------+

Pass 1 (current code)
---------------------
``cam.manufacturingModels.add()`` auto-snapshots the active Design
state, so for the first verification pass we just create three MMs by
name -- all hold the full geometry. This proves the API plumbing works
in the user's environment before we layer body filtering on top.

Pass 2 (TODO)
-------------
Add a body-filter pass after creation:
  * walk ``mm.occurrence.component.bRepBodies`` (or
    ``allOccurrences[*].component.bRepBodies`` to reach panel bodies
    nested inside the "B-Spline Set" component)
  * call ``BRepBody.deleteMe()`` on bodies that don't match the rule
  * for the frame MM, also apply a reorient transform so the frame
    lays flat for cutting

Note on the Stock MM
--------------------
The Design tree carries a "stock" placeholder component, but it is
NOT a real body. The Stock MM workflow:
  1. Remove every body inherited from the Design snapshot
  2. Read the bounding box of the (formerly present) panel + frame
     bodies, plus a stock margin (configurable later)
  3. Create a sketch on the XY origin plane and draw a rectangle
     sized to the bbox
  4. Extrude it to stock thickness
This extrude happens inside the MM, so the Design is not polluted.

Reference: see ``CAM_API_NOTES.md`` -- "Manufacturing Model creation"
and "Body removal inside an MM".
"""

import math

import adsk.core
import adsk.cam
import adsk.fusion

from cam_utils import get_design


MM_RULES = ('stock', 'bspline_set', 'frame')

# Per-rule occurrence-DELETE policy. Keys are component-name classes
# returned by ``_classify_occurrence`` ('panel', 'frame',
# 'stock_placeholder', 'unknown'). Any occurrence whose class is in
# the delete set for the rule gets removed via ``Occurrence.deleteMe()``.
#
# Why DELETE instead of KEEP semantics:
#   When Fusion creates an MM from a Design, it wraps the entire
#   design under a single 'unknown' occurrence named after the
#   document. If we used a KEEP rule, that wrapper wouldn't match
#   {'panel'} or {'frame'}, so it would get deleted -- nuking all
#   our kept descendants with it. DELETE rules let unknowns ride
#   along (their classified children get pruned, the wrapper stays).
#
#   Stock MM is the exception: we want to nuke EVERYTHING including
#   the wrapper, so 'unknown' is in its delete set.
_DELETE_OCC_CLASSES = {
    'stock':        {'panel', 'frame', 'stock_placeholder', 'unknown'},
    'bspline_set':  {'frame', 'stock_placeholder'},
    'frame':        {'panel', 'stock_placeholder'},
}


def build_all_mms(cam, design, classifier, logger=None):
    """Build the three MMs in one pass and return ``{rule: ManufacturingModel}``.

    User-parameter propagation (called from each ``build_mm``) activates
    the MM to write into its scope. We capture the original active edit
    target up front and restore it at the end so the user lands back in
    their starting context regardless of how many MMs we built.
    """
    app = adsk.core.Application.get()

    # Ensure CAM-Builder-specific user parameters exist in the source
    # design BEFORE we snapshot MMs. Idempotent — won't overwrite a
    # user-edited expression. Adding to source so the existing
    # _propagate_user_parameters_to_mm pass picks them up automatically.
    _ensure_cam_builder_user_parameters(design, logger)

    original_active = None
    try:
        des = get_design(app, logger)
        if des:
            original_active = des.activeEditObject
    except Exception:
        original_active = None

    out = {}
    for rule in MM_RULES:
        mm = build_mm(cam, design, rule, classifier, logger)
        if mm:
            out[rule] = mm

    if original_active is not None:
        _log(logger, f"MM BUILD CKPT 1: about to restore activeEditObject (type={type(original_active).__name__})", "DEBUG")
        try:
            original_active.activate()
            _log(logger, "MM BUILD CKPT 1: restore succeeded", "DEBUG")
        except Exception as e:
            _log(logger, f"MM BUILD: restore activeEditObject failed: {e}", "DEBUG")
    else:
        _log(logger, "MM BUILD CKPT 1: no original_active to restore", "DEBUG")
    _log(logger, f"MM BUILD CKPT 2: returning out (size={len(out)})", "DEBUG")
    return out


def _ensure_cam_builder_user_parameters(source_design, logger):
    """Ensure CAM-Builder-specific user parameters exist in the source
    design. Idempotent: only adds parameters that aren't already there,
    never overwrites a user-edited expression.

    These parameters live in source-design scope (mild pollution) so
    that the existing param-propagation pass picks them up automatically
    when each MM is built. Adding them to source is the only way to
    get them into MM-scope on the current Fusion build, since the MM's
    own derived-design userParameters aren't reliably writable from
    outside the MM context.

    Currently registered:
      - ``lay_flat_clearance`` (default 0.55 in): row-spacing between
        adjacent frame pieces in MM-Frame's lay-flat layout. Used by
        the (forthcoming) ``_populate_frame_geometry`` Move features.
        Should be at least cutter diameter + chip clearance.
    """
    cam_builder_params = [
        # (name, default_expression, unit, comment)
        ('lay_flat_clearance', '0.55 in', 'in',
         'CAM Builder: row-spacing between adjacent frame pieces in '
         'the lay-flat layout. At least cutter diameter + chip clearance.'),
    ]

    if source_design is None:
        _log(logger, "ENSURE PARAMS: source_design is None; skipping", "WARNING")
        return

    try:
        user_params = source_design.userParameters
    except Exception as e:
        _log(logger, f"ENSURE PARAMS: source.userParameters access failed: {e}", "WARNING")
        return

    for name, expr, unit, comment in cam_builder_params:
        try:
            existing = user_params.itemByName(name)
        except Exception:
            existing = None
        if existing:
            _log(logger, f"ENSURE PARAMS: '{name}' already in source design (kept user expression)", "DEBUG")
            continue
        try:
            value = adsk.core.ValueInput.createByString(expr)
            param = user_params.add(name, value, unit, comment)
            if param:
                _log(logger, f"ENSURE PARAMS: added '{name}' = {expr!r} ({unit}) to source design")
            else:
                _log(logger, f"ENSURE PARAMS: add returned None for '{name}'", "WARNING")
        except Exception as e:
            _log(logger, f"ENSURE PARAMS: add '{name}' raised: {e}", "WARNING")


def build_mm(cam, design, rule, classifier, logger=None):
    """Build a single MM and apply its body-filter rule."""
    if rule not in MM_RULES:
        _log(logger, f"MM BUILD: unknown rule {rule!r}", "WARNING")
        return None

    if cam is None:
        _log(logger, f"MM BUILD ({rule}): cam is None", "ERROR")
        return None

    try:
        mm_input = cam.manufacturingModels.createInput()
        mm_input.name = _mm_display_name(rule)
        mm = cam.manufacturingModels.add(mm_input)
    except Exception as e:
        _log(logger, f"MM BUILD ({rule}): manufacturingModels.add raised: {e}", "ERROR")
        return None

    if mm is None:
        _log(logger, f"MM BUILD ({rule}): manufacturingModels.add returned None", "ERROR")
        return None

    try:
        _log(logger, f"MM BUILD ({rule}): created '{mm.name}'")
    except Exception as e:
        _log(logger, f"MM BUILD ({rule}): created (name read failed: {e})")

    # Apply the occurrence-filter rule. Failures here are logged but
    # not fatal -- the MM still exists, it just holds the full design
    # until we figure out why deleteMe() didn't take.
    try:
        kept, deleted, failed = _apply_occurrence_filter(mm, rule, classifier, logger)
        _log(logger, f"MM BUILD ({rule}): occurrence filter -> kept={kept} deleted={deleted} failed={failed}")
    except Exception as e:
        _log(logger, f"MM BUILD ({rule}): occurrence filter raised: {e}", "WARNING")

    # B-spline-specific second pass: inside the B-Spline Set, mirror
    # the design-tree visibility rules but via deleteMe() since this is
    # the CAM snapshot, not the live design:
    #   - If a Stamped panel exists, delete the Clean occurrence entirely
    #     (Stamped wins, we don't machine the un-stamped variant).
    #   - Strip every 'surface' body from the remaining panel occurrence
    #     (CAM only needs the solid panel — surfaces are reference-only).
    if rule == 'bspline_set':
        try:
            _apply_bspline_panel_filter(mm, logger)
        except Exception as e:
            _log(logger, f"MM BUILD ({rule}): bspline panel filter raised: {e}", "WARNING")

    # Propagate the source design's user parameters into the MM's own
    # parameter scope. Per the Autodesk docs, an MM is "a derive of the
    # Design scene, which can be augmented without any effects of the
    # original Design" -- meaning the MM has its own parameter namespace
    # and the source's userParameters do not auto-inherit. Without this
    # pass, sketches/operations authored inside the MM cannot reference
    # source-design names like 'widthIn' or 'heightIn'.
    try:
        _propagate_user_parameters_to_mm(mm, design, logger)
    except Exception as e:
        _log(logger, f"MM BUILD ({rule}): user-parameter propagation raised: {e}", "WARNING")

    # Stock-MM-only: populate with a parametric placeholder body so the
    # downstream Setup has something to bind. The stock filter has just
    # nuked every body in this MM (by design -- stock should be a raw
    # blank, not a copy of the source geometry); that leaves the Setup
    # with no model unless we put one back.
    if rule == 'stock':
        try:
            _populate_stock_placeholder(mm, design, logger)
        except Exception as e:
            _log(logger, f"MM BUILD ({rule}): stock placeholder build raised: {e}", "WARNING")

    # Frame-MM-only: rotate the two horizontal pieces 90° around Z and
    # pack all four pieces into a row so the user can machine the frame
    # in a single setup with one stock board. Positions aren't critical
    # (user fine-tunes per stock); rotation is.
    if rule == 'frame':
        try:
            _populate_frame_geometry(mm, design, logger)
        except Exception as e:
            _log(logger, f"MM BUILD ({rule}): frame geometry build raised: {e}", "WARNING")

    return mm


def _propagate_user_parameters_to_mm(mm, source_design, logger):
    """Copy every user parameter from ``source_design`` into ``mm``'s
    own parameter scope.

    Fusion API quirk: ``ManufacturingModel`` has no ``userParameters``
    property of its own. The only documented path into MM-scope is to
    activate the MM and then write through ``app.activeProduct``'s
    Design (which, while the MM is active, points to the MM's own
    derived design rather than the source).

    Idempotent: any parameter that already exists in the MM scope (by
    name) is left alone -- we never overwrite a user-edited expression.

    Returns the count of parameters actually added.
    """
    app = adsk.core.Application.get()
    if app is None:
        _log(logger, f"PARAM PROP ({mm.name}): app is None; skipping", "WARNING")
        return 0

    # 1. Snapshot the source design's user params BEFORE switching contexts.
    snapshot = []
    try:
        for p in source_design.userParameters:
            try:
                snapshot.append({
                    'name':       p.name,
                    'expression': p.expression,
                    'unit':       p.unit,
                    'comment':    p.comment or '',
                })
            except Exception as e:
                _log(logger, f"PARAM PROP ({mm.name}): snapshot of one source param failed: {e}", "WARNING")
    except Exception as e:
        _log(logger, f"PARAM PROP ({mm.name}): source userParameters read failed: {e}", "WARNING")
        return 0

    if not snapshot:
        _log(logger, f"PARAM PROP ({mm.name}): source design has no user parameters; nothing to propagate", "DEBUG")
        return 0

    # 2. Activate the MM so the user lands inside it after the build,
    #    then resolve the MM's derived Design via the component handle
    #    rather than via app.activeProduct. The activeProduct path is
    #    unreliable on current Fusion builds (silently returns the
    #    source Design or a CAMProduct depending on workspace state)
    #    and any pollution that lands in source via that path is
    #    invisible until the user opens the source design. Going
    #    through ``mm.occurrence.component.parentDesign`` is a stable
    #    handle into MM scope.
    try:
        mm.activate()
    except Exception as e:
        _log(logger, f"PARAM PROP ({mm.name}): activate failed (non-fatal): {e}", "DEBUG")

    try:
        mm_root = mm.occurrence.component
        mm_design = mm_root.parentDesign if mm_root is not None else None
    except Exception as e:
        _log(logger, f"PARAM PROP ({mm.name}): mm.occurrence.component.parentDesign read failed: {e}", "WARNING")
        return 0
    if mm_design is None:
        _log(logger,
             f"PARAM PROP ({mm.name}): MM-scope Design unreachable via component handle; skipping",
             "WARNING")
        return 0

    try:
        mm_user_params = mm_design.userParameters
    except Exception as e:
        _log(logger, f"PARAM PROP ({mm.name}): userParameters access failed: {e}", "WARNING")
        return 0

    # 4. Write each snapshot entry. Skip names that already exist (the
    #    MM may already carry the param if this is a re-run, or if the
    #    user has hand-authored one in MM scope).
    #
    # Heavy per-iteration logging: this loop has shown a hard crash in
    # the field where the log line for one successful add() is partially
    # written and Fusion dies before the next iteration's add() returns.
    # We log BEFORE and AFTER each add() with the full entry contents so
    # the last line on disk identifies exactly which parameter triggered
    # the crash. _log writes are independent file open/append/close calls
    # in fb_logger, so each one flushes to disk before returning.
    copied = 0
    skipped = 0
    failed = 0
    _log(logger,
         f"PARAM PROP ({mm.name}): entering write loop, {len(snapshot)} entries",
         "DEBUG")
    for idx, entry in enumerate(snapshot):
        name = entry['name']
        _log(logger,
             f"PARAM PROP CKPT 1 [{idx}/{len(snapshot)}] ({mm.name}): about to look up existing param '{name}'",
             "DEBUG")
        try:
            existing = mm_user_params.itemByName(name)
        except Exception:
            existing = None
        if existing:
            skipped += 1
            _log(logger,
                 f"PARAM PROP CKPT 2 [{idx}/{len(snapshot)}] ({mm.name}): '{name}' already exists, skipping",
                 "DEBUG")
            continue
        _log(logger,
             f"PARAM PROP CKPT 3 [{idx}/{len(snapshot)}] ({mm.name}): about to add '{name}' expr={entry['expression']!r} unit={entry['unit']!r}",
             "DEBUG")
        try:
            value = adsk.core.ValueInput.createByString(entry['expression'])
            _log(logger,
                 f"PARAM PROP CKPT 4 [{idx}/{len(snapshot)}] ({mm.name}): ValueInput created for '{name}', calling mm_user_params.add()",
                 "DEBUG")
            param = mm_user_params.add(name, value, entry['unit'], entry['comment'])
            _log(logger,
                 f"PARAM PROP CKPT 5 [{idx}/{len(snapshot)}] ({mm.name}): mm_user_params.add('{name}') returned {'<param>' if param else 'None'}",
                 "DEBUG")
            if param:
                copied += 1
                _log(logger,
                     f"PARAM PROP ({mm.name}): added '{name}' = {entry['expression']!r} ({entry['unit']})",
                     "DEBUG")
            else:
                failed += 1
                _log(logger, f"PARAM PROP ({mm.name}): add returned None for '{name}'", "WARNING")
        except Exception as e:
            failed += 1
            _log(logger, f"PARAM PROP ({mm.name}): add '{name}' raised: {type(e).__name__}: {e}", "WARNING")

    _log(logger,
         f"PARAM PROP CKPT END ({mm.name}): exited write loop, copied={copied} skipped={skipped} failed={failed} of {len(snapshot)} source params",
         "DEBUG")
    _log(logger, f"PARAM PROP ({mm.name}): copied={copied} skipped={skipped} failed={failed} of {len(snapshot)} source params")
    return copied


def _populate_stock_placeholder(mm, source_design, logger):
    """Create a parametric rectangular stock body INSIDE MM-Stock.

    Geometry: a centered rectangle on the XY plane (centre-point
    rectangle), sized ``(widthIn + 1in) x (heightIn + 1in)``, extruded
    ``2 in`` in +Z. Horizontal dims reference the user parameters that
    ``_propagate_user_parameters_to_mm`` already mirrored into MM scope,
    so the stock auto-resizes when the panel params change. Z is a
    literal — 2in is a sensible rough-stock default.

    Scope guarantee
    ---------------
    Everything is created against ``mm.occurrence.component`` directly,
    NOT against ``app.activeProduct`` after ``mm.activate()``. On the
    user's Fusion build, the post-activate ``activeProduct`` resolves
    to the source Design instead of the MM's derived design, which
    would silently pollute the source. Using ``mm.occurrence.component``
    is a stable handle into the MM's own scope and never falls back.
    User parameters come from ``component.parentDesign.userParameters``
    — the MM's derived Design — for the same reason.

    The ``mm.activate()`` call is still made so the user lands inside
    the MM in the browser after the build, but no API path through
    ``activeProduct`` is taken.

    Idempotent: skips if the MM root component already has any body
    (lets the user re-run CAM Builder without nuking edits, and avoids
    duplicates if the function ever fires twice).
    """
    # 1. Stable handle into the MM's own component. This is the single
    #    most important line in the function — every subsequent geometry
    #    operation (sketches.add, dimensions.add, extrudes.add) goes
    #    through this reference, so the body cannot land in the source
    #    Design.
    try:
        root_comp = mm.occurrence.component
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): mm.occurrence.component read failed: {e}", "WARNING")
        return False
    if root_comp is None:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): mm.occurrence.component is None; skipping", "WARNING")
        return False

    # 2. The MM's derived Design lives behind the component. This is
    #    where MM-scope userParameters live (NOT the source design's
    #    userParameters, which would defeat the purpose of param
    #    propagation).
    try:
        mm_design = root_comp.parentDesign
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): parentDesign read failed: {e}", "WARNING")
        return False
    if mm_design is None:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): parentDesign is None; skipping", "WARNING")
        return False

    # 3. Activate the MM so the user lands inside it in the browser
    #    after the build completes. Failure here is non-fatal — the
    #    geometry calls below don't depend on activation, only on the
    #    component reference grabbed in step 1.
    try:
        mm.activate()
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): activate failed (non-fatal, continuing): {e}", "DEBUG")

    # 4. Idempotent: if MM-Stock already has a body, leave it alone.
    try:
        existing = root_comp.bRepBodies.count
    except Exception:
        existing = 0
    if existing > 0:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): root already has {existing} body/bodies; skipping", "DEBUG")
        return False

    # 5. Verify the parametric expressions will resolve in the MM's scope.
    try:
        mm_user_params = mm_design.userParameters
        missing = [n for n in ('widthIn', 'heightIn') if mm_user_params.itemByName(n) is None]
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): userParameters read failed: {e}", "WARNING")
        return False
    if missing:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): required params {missing} missing in MM scope; skipping (run user-param propagation first)", "WARNING")
        return False

    # ---- Build the sketch ----
    try:
        sketch = root_comp.sketches.add(root_comp.xYConstructionPlane)
        sketch.name = 'Stock Placeholder'
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): sketch.add failed: {e}", "WARNING")
        return False

    # Build the rectangle with addCenterPointRectangle. CRITICAL: seed it
    # OFF origin so every coincident constraint we add later has a
    # non-zero delta to resolve. Per the fusion360-api skill notes,
    # addCoincident on a point that's already at the target location
    # crashes Fusion's constraint solver. Seeding at (3, 3) keeps the
    # rectangle centre well clear of (0, 0) — the final
    # coincident-to-origin is what translates the whole structure so
    # the centre lands on the sketch origin.
    try:
        sketch_lines = sketch.sketchCurves.sketchLines
        center = adsk.core.Point3D.create(3.0, 3.0, 0)
        corner = adsk.core.Point3D.create(8.0, 8.0, 0)
        rect_lines = sketch_lines.addCenterPointRectangle(center, corner)
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): addCenterPointRectangle failed: {e}", "WARNING")
        return False

    # Walk the rectangle's lines: collect 4 corner sketch points, classify
    # each line as horizontal vs vertical by its initial geometry, and
    # remember one of each for the parametric dimensions later.
    #
    # IMPORTANT: in practice, addCenterPointRectangle on this user's
    # Fusion build only welds the corner endpoints — it does NOT add H/V
    # constraints on the edges. The rectangle is free to skew. We add
    # H/V manually below, wrapped in try/except so the call is defensive
    # if a future Fusion build does add them implicitly (redundant H/V
    # constraints can crash the solver — wrap and continue).
    corner_pts = {}        # key: (x_round, y_round) -> SketchPoint
    horizontal_lines = []  # all 2 top/bottom lines
    vertical_lines = []    # all 2 left/right lines
    try:
        for i in range(rect_lines.count):
            ln = rect_lines.item(i)
            sp = ln.startSketchPoint
            ep = ln.endSketchPoint
            for pt in (sp, ep):
                k = (round(pt.geometry.x, 6), round(pt.geometry.y, 6))
                if k not in corner_pts:
                    corner_pts[k] = pt
            dx = abs(sp.geometry.x - ep.geometry.x)
            dy = abs(sp.geometry.y - ep.geometry.y)
            if dy < 1e-6:
                horizontal_lines.append(ln)
            elif dx < 1e-6:
                vertical_lines.append(ln)
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): line classification failed: {e}", "WARNING")
        return False

    if len(horizontal_lines) < 1 or len(vertical_lines) < 1:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): could not classify H/V lines (H={len(horizontal_lines)}, V={len(vertical_lines)})", "WARNING")
        return False
    if len(corner_pts) != 4:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): expected 4 unique corners, found {len(corner_pts)}; skipping anchor", "WARNING")
        return False

    horizontal_line = horizontal_lines[0]
    vertical_line = vertical_lines[0]

    # Sort corners deterministically: BL, TL, BR, TR (sort by x, then y).
    ordered_corners = sorted(
        corner_pts.values(),
        key=lambda p: (round(p.geometry.x, 6), round(p.geometry.y, 6)),
    )
    bl, tl, br, tr = ordered_corners

    geom = sketch.geometricConstraints

    # ---- Apply H/V constraints to each edge of the rectangle ----
    # Without these the rectangle is just 4 lines sharing endpoints — it
    # can skew into a parallelogram. Each call is wrapped: if Fusion
    # already has an implicit one in place, the redundant add raises and
    # we log + continue.
    for ln in horizontal_lines:
        try:
            geom.addHorizontal(ln)
        except Exception as e:
            _log(logger, f"STOCK PLACEHOLDER ({mm.name}): addHorizontal failed (likely already H, continuing): {e}", "DEBUG")
    for ln in vertical_lines:
        try:
            geom.addVertical(ln)
        except Exception as e:
            _log(logger, f"STOCK PLACEHOLDER ({mm.name}): addVertical failed (likely already V, continuing): {e}", "DEBUG")

    # ---- Construction diagonals + intersection sketch point ----
    # Two construction lines from BL→TR and BR→TL. Their intersection is
    # the rectangle's geometric centre. We then add a sketch point and
    # constrain it onto both diagonals → it lands at the centre. Finally
    # we anchor that point to the sketch origin, which translates the
    # whole rectangle so its centre is at (0, 0).

    diag1 = None
    diag2 = None
    try:
        diag1 = sketch_lines.addByTwoPoints(bl, tr)
        diag2 = sketch_lines.addByTwoPoints(br, tl)
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): diagonal addByTwoPoints failed: {e}", "WARNING")
        return False

    try:
        diag1.isConstruction = True
        diag2.isConstruction = True
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): diagonal isConstruction set failed (non-fatal): {e}", "DEBUG")

    # Intersection sketch point — seed slightly off origin so the final
    # addCoincident(origin) has a delta to resolve. Both diagonal coincident
    # constraints will pull this point to the diagonals' crossing first.
    try:
        intersection_pt = sketch.sketchPoints.add(adsk.core.Point3D.create(0.1, 0.1, 0))
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): intersection sketchPoints.add failed: {e}", "WARNING")
        return False

    # Constrain the point to lie on both diagonals. Each addCoincident is
    # wrapped — if Fusion considers one redundant we keep going.
    try:
        geom.addCoincident(intersection_pt, diag1)
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): addCoincident(intersection, diag1) failed: {e}", "WARNING")
    try:
        geom.addCoincident(intersection_pt, diag2)
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): addCoincident(intersection, diag2) failed: {e}", "WARNING")

    # Anchor the intersection (and therefore the rectangle's centre) to
    # the sketch origin. Distance check guards the solver-crash case from
    # the skill: addCoincident on already-coincident points blows up.
    try:
        origin_pt = sketch.originPoint
        dist_to_origin = intersection_pt.geometry.distanceTo(origin_pt.geometry)
        if dist_to_origin > 1e-4:
            geom.addCoincident(intersection_pt, origin_pt)
        else:
            _log(logger,
                 f"STOCK PLACEHOLDER ({mm.name}): intersection already at origin "
                 f"(dist={dist_to_origin:.6f}); skipping origin coincident "
                 f"(rectangle is centred but intersection is unconstrained — "
                 f"consider re-seeding off origin if drift is observed)",
                 "WARNING")
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): origin anchor failed: {e}", "WARNING")

    # Add parametric dimensions. SketchDimensions.addDistanceDimension
    # returns the new dimension; we then write the parametric
    # expression onto its underlying parameter.
    try:
        sketch_dims = sketch.sketchDimensions
        H_DIM_ORIENT = adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation
        V_DIM_ORIENT = adsk.fusion.DimensionOrientations.VerticalDimensionOrientation

        width_dim = sketch_dims.addDistanceDimension(
            horizontal_line.startSketchPoint, horizontal_line.endSketchPoint,
            H_DIM_ORIENT,
            adsk.core.Point3D.create(0, -7, 0),
        )
        width_dim.parameter.expression = 'widthIn + 1 in'

        height_dim = sketch_dims.addDistanceDimension(
            vertical_line.startSketchPoint, vertical_line.endSketchPoint,
            V_DIM_ORIENT,
            adsk.core.Point3D.create(-7, 0, 0),
        )
        height_dim.parameter.expression = 'heightIn + 1 in'
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): dimensioning failed: {e}", "WARNING")
        return False

    # ---- Extrude ----
    try:
        if sketch.profiles.count == 0:
            _log(logger, f"STOCK PLACEHOLDER ({mm.name}): sketch has no profile after rectangle build", "WARNING")
            return False
        profile = sketch.profiles.item(0)
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): profile fetch failed: {e}", "WARNING")
        return False

    try:
        extrudes = root_comp.features.extrudeFeatures
        ext_input = extrudes.createInput(
            profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation,
        )
        # Fixed 2in thickness as specified -- not parametric.
        distance = adsk.core.ValueInput.createByString('2 in')
        ext_input.setDistanceExtent(False, distance)
        extrude = extrudes.add(ext_input)
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): extrude failed: {e}", "WARNING")
        return False

    # Name the body for clarity in the browser and in the Setup dialog.
    try:
        if extrude.bodies.count > 0:
            extrude.bodies.item(0).name = 'Stock'
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): body rename failed: {e}", "DEBUG")

    _log(logger, f"STOCK PLACEHOLDER ({mm.name}): created '(widthIn+1in) x (heightIn+1in) x 2in' body 'Stock'")
    return True


def _populate_frame_geometry(mm, source_design, logger):
    """Lay the four frame bodies flat in a row inside MM-Frame.

    Critical behavior
    -----------------
    Rotate ``frame_top`` and ``frame_bottom`` exactly 90° around the
    world Z axis so their long extents flip from X to Y. After rotation
    all four pieces have their long axes along Y (they're "vertical"
    in the WCS frame), matching the existing orientation of
    ``frame_left`` and ``frame_right``. This is what makes the lay-flat
    machinable in a single setup pass.

    Layout (best-effort, not critical)
    ----------------------------------
    Anchor on ``frame_right`` (no move). Pack the other three pieces
    to its right along +X, separated by ``lay_flat_clearance`` (user
    parameter, default 0.55 in). All centers aligned on Y=0. Z left
    untouched (the bodies are already roughly co-planar).

    Positions are computed numerically from the post-rotation bounding
    boxes, NOT from a parametric expression. ``lay_flat_clearance`` is
    READ from the live MM userParameters at build time but baked into
    the Move features as literal cm values — changing the parameter
    later requires re-Generate to update the layout. The user is
    expected to fine-tune piece positions per their actual stock board
    after generation, so layout precision isn't worth a heavier
    parametric implementation.

    Idempotent: skips if MM-Frame already has any moveFeatures (lets
    the user re-run CAM Builder without nuking their hand-tweaks).
    """
    # 1. Stable handle into the MM (same pattern as _populate_stock_placeholder)
    try:
        root_comp = mm.occurrence.component
    except Exception as e:
        _log(logger, f"FRAME LAYOUT ({mm.name}): mm.occurrence.component read failed: {e}", "WARNING")
        return False
    if root_comp is None:
        _log(logger, f"FRAME LAYOUT ({mm.name}): mm.occurrence.component is None; skipping", "WARNING")
        return False

    # MM's derived design — for userParameters lookup and z-axis entity
    try:
        mm_design = root_comp.parentDesign
    except Exception as e:
        _log(logger, f"FRAME LAYOUT ({mm.name}): parentDesign read failed: {e}", "WARNING")
        return False
    if mm_design is None:
        _log(logger, f"FRAME LAYOUT ({mm.name}): parentDesign is None; skipping", "WARNING")
        return False

    # 2. Activate the MM so user lands inside it after build (non-fatal)
    try:
        mm.activate()
    except Exception as e:
        _log(logger, f"FRAME LAYOUT ({mm.name}): activate failed (non-fatal): {e}", "DEBUG")

    # 3. Idempotent: skip if already laid out. Move features for the
    #    frame bodies live on the *body-owning* component (Frame_1),
    #    NOT on the MM wrapper (Fusion rejects cross-context moves with
    #    "object is not in the assembly context of this component").
    #    We check this owner component below after we've found the bodies.
    #    For now defer the idempotent check.

    # 4. Find the four frame_* bodies. They live in child occurrences
    #    (Frame_1 component nested inside the MM wrapper). Walk all
    #    occurrences recursively.
    frame_bodies = {}  # name (lowercased) -> BRepBody
    expected_names = {'frame_bottom', 'frame_top', 'frame_left', 'frame_right'}

    def _yield_all_bodies(comp):
        try:
            for b in comp.bRepBodies:
                yield b
        except Exception:
            pass
        try:
            for occ in comp.allOccurrences:
                try:
                    for b in occ.component.bRepBodies:
                        yield b
                except Exception:
                    continue
        except Exception:
            pass

    try:
        for body in _yield_all_bodies(root_comp):
            try:
                bn = (body.name or '').lower()
            except Exception:
                continue
            if bn in expected_names and bn not in frame_bodies:
                frame_bodies[bn] = body
    except Exception as e:
        _log(logger, f"FRAME LAYOUT ({mm.name}): body walk failed: {e}", "WARNING")
        return False

    if len(frame_bodies) < 4:
        missing = expected_names - set(frame_bodies.keys())
        _log(logger, f"FRAME LAYOUT ({mm.name}): expected 4 frame bodies, found {len(frame_bodies)} (missing: {missing}); skipping", "WARNING")
        return False

    # 5. Read lay_flat_clearance from MM userParameters (cm). Fallback to
    #    0.55 in if missing.
    clearance_cm = 1.397  # 0.55 in default
    try:
        p = mm_design.userParameters.itemByName('lay_flat_clearance')
        if p is not None:
            clearance_cm = float(p.value)
    except Exception as e:
        _log(logger, f"FRAME LAYOUT ({mm.name}): lay_flat_clearance read failed (using {clearance_cm:.4f} cm default): {e}", "DEBUG")

    # 6. Get the move features collection from the BODY-OWNING component,
    #    not the MM wrapper. All four frame_* bodies share the same parent
    #    component (Frame_1 nested inside the MM wrapper). Adding moves to
    #    the wrapper raises "object is not in the assembly context of this
    #    component" because the body objects belong to Frame_1's scope.
    #    Pick any body's parentComponent.
    sample_body = next(iter(frame_bodies.values()))
    try:
        owner_comp = sample_body.parentComponent
    except Exception as e:
        _log(logger, f"FRAME LAYOUT ({mm.name}): body.parentComponent read failed: {e}", "WARNING")
        return False
    if owner_comp is None:
        _log(logger, f"FRAME LAYOUT ({mm.name}): body.parentComponent is None; skipping", "WARNING")
        return False

    # Now apply the deferred idempotent check on the OWNER component.
    try:
        existing_moves = owner_comp.features.moveFeatures.count
    except Exception:
        existing_moves = 0
    if existing_moves > 0:
        _log(logger, f"FRAME LAYOUT ({mm.name}): {existing_moves} moveFeature(s) already on {owner_comp.name}; skipping (idempotent)", "DEBUG")
        return False

    move_features = owner_comp.features.moveFeatures

    # Build a 90°-around-Z rotation matrix (pivot at world origin) and
    # apply it via defineAsFreeMove. This bypasses defineAsRotate's
    # entity-axis requirement, which kept failing here with "Invalid
    # entity" — the construction axis from owner_comp.zConstructionAxis
    # isn't in the right context for the move feature even when the
    # bodies are. Matrix3D + defineAsFreeMove is context-free.
    rot_z_90 = adsk.core.Matrix3D.create()
    rot_z_90.setToRotation(
        math.pi / 2,                                  # 90° in radians
        adsk.core.Vector3D.create(0.0, 0.0, 1.0),     # rotate around +Z
        adsk.core.Point3D.create(0.0, 0.0, 0.0),      # pivot at world origin
    )

    for body_name in ('frame_bottom', 'frame_top'):
        body = frame_bodies[body_name]
        try:
            bodies_collection = adsk.core.ObjectCollection.create()
            bodies_collection.add(body)
            move_input = move_features.createInput2(bodies_collection)
            move_input.defineAsFreeMove(rot_z_90)
            move_features.add(move_input)
            _log(logger, f"FRAME LAYOUT ({mm.name}): rotated {body_name} by 90° around world Z (Matrix3D free-move)")
        except Exception as e:
            _log(logger, f"FRAME LAYOUT ({mm.name}): rotate {body_name} failed: {e}", "WARNING")
            # Don't bail — continue with whatever rotated successfully

    # 7. Read post-rotation bbox sizes and centers for all four bodies.
    sizes = {}    # name -> (sizeX, sizeY, sizeZ) in cm
    centers = {}  # name -> (cx, cy, cz) in cm
    for name, body in frame_bodies.items():
        try:
            bb = body.boundingBox
            if bb is None:
                _log(logger, f"FRAME LAYOUT ({mm.name}): {name} boundingBox is None; skipping", "WARNING")
                return False
            mn, mx = bb.minPoint, bb.maxPoint
            sizes[name] = (mx.x - mn.x, mx.y - mn.y, mx.z - mn.z)
            centers[name] = ((mx.x + mn.x) / 2, (mx.y + mn.y) / 2, (mx.z + mn.z) / 2)
        except Exception as e:
            _log(logger, f"FRAME LAYOUT ({mm.name}): bbox read for {name} failed: {e}", "WARNING")
            return False

    # 8. Lay the row out. Anchor: frame_right keeps its current X position.
    #    Pack the other three to the +X side, each adjacent center spaced
    #    by (left_W/2 + clearance + right_W/2). Y centers all at 0.
    layout_order = ['frame_right', 'frame_left', 'frame_bottom', 'frame_top']

    target_x = {}
    target_x['frame_right'] = centers['frame_right'][0]  # anchor

    prev_right_edge = centers['frame_right'][0] + sizes['frame_right'][0] / 2
    for name in layout_order[1:]:
        body_w = sizes[name][0]
        target_x[name] = prev_right_edge + clearance_cm + body_w / 2
        prev_right_edge = target_x[name] + body_w / 2

    # 9. Apply translations. frame_right is the anchor — no move. The
    #    other three each get one translate Move feature.
    for name in layout_order[1:]:
        body = frame_bodies[name]
        cur_cx, cur_cy, cur_cz = centers[name]
        dx = target_x[name] - cur_cx
        dy = 0.0 - cur_cy           # align row on Y=0
        dz = 0.0                    # leave Z alone
        # Skip vanishingly small moves (avoids degenerate Move features)
        if abs(dx) < 1e-4 and abs(dy) < 1e-4 and abs(dz) < 1e-4:
            _log(logger, f"FRAME LAYOUT ({mm.name}): {name} already at target; skipping translate", "DEBUG")
            continue
        try:
            bodies_collection = adsk.core.ObjectCollection.create()
            bodies_collection.add(body)
            move_input = move_features.createInput2(bodies_collection)
            move_input.defineAsTranslateXYZ(
                adsk.core.ValueInput.createByReal(dx),
                adsk.core.ValueInput.createByReal(dy),
                adsk.core.ValueInput.createByReal(dz),
                True,  # isWorldSpace — interpret deltas in world frame
            )
            move_features.add(move_input)
            _log(logger,
                 f"FRAME LAYOUT ({mm.name}): translated {name} by "
                 f"({dx:+.3f}, {dy:+.3f}, {dz:+.3f}) cm "
                 f"to row position X={target_x[name]:.3f}",
                 "DEBUG")
        except Exception as e:
            _log(logger, f"FRAME LAYOUT ({mm.name}): translate {name} failed: {e}", "WARNING")

    _log(logger,
         f"FRAME LAYOUT ({mm.name}): laid out 4 pieces in row "
         f"(anchor=frame_right, clearance={clearance_cm:.4f} cm, "
         f"row span ≈ {prev_right_edge - centers['frame_right'][0] + sizes['frame_right'][0] / 2:.2f} cm)")
    return True


def _classify_occurrence(occ):
    """Classify a top-level occurrence by its component name.

    Returns one of:
        'panel'              -- B-Spline Set component (b-spline panel)
        'frame'              -- frame component (frame_* bodies inside)
        'stock_placeholder'  -- the user's "stock" placeholder component
        'unknown'            -- anything else; kept by every MM defensively

    Component-name based rather than body-classifier based because once
    bodies are inside an MM snapshot, the assemblyContext chain doesn't
    reliably resolve back to the original parent component name. The
    component name itself is preserved on the occurrence and is the
    only stable handle.
    """
    try:
        name = (occ.component.name or '').lower()
    except Exception:
        return 'unknown'

    # Frame: matches "Frame_1", "Frame 2", etc -- the extrusion engine
    # creates a component prefixed "Frame_<N>" and stamps body names
    # frame_<label> inside it.
    if name.startswith('frame') or 'frame' in name:
        return 'frame'

    if 'b-spline set' in name or 'bspline set' in name:
        return 'panel'

    if name == 'stock' or name.startswith('stock'):
        return 'stock_placeholder'

    return 'unknown'


def _apply_occurrence_filter(mm, rule, classifier, logger):
    """Walk every occurrence inside the MM (recursively, via
    ``component.allOccurrences``) and delete those whose class is in
    ``_DELETE_OCC_CLASSES[rule]``.

    Returns ``(kept, deleted, failed)`` counts.

    Walking recursively (not just top-level) is critical: when Fusion
    creates an MM from the Design, it wraps everything under a single
    'unknown' occurrence named after the document. The named groups
    we want to filter (B-Spline Set, Frame_1, stock) live one level
    inside that wrapper. Top-level-only walks see only the wrapper.

    Deletes deepest-first -- if a parent gets deleted before its
    children, the children are gone too, and the second deleteMe()
    call would fail with 'invalid object'. ``isValid`` skip handles
    that edge case anyway.

    The ``classifier`` argument is unused here -- the occurrence-name
    rule is sufficient and avoids the body-ancestry-lookup fragility
    that breaks inside an MM snapshot. We accept the parameter for
    signature compatibility.
    """
    delete = _DELETE_OCC_CLASSES[rule]

    try:
        comp = mm.occurrence.component
    except Exception as e:
        _log(logger, f"MM FILTER ({rule}): could not read mm.occurrence.component: {e}", "ERROR")
        return (0, 0, 0)

    # Snapshot the recursive occurrence list BEFORE deleting -- the
    # collection invalidates as we mutate.
    try:
        all_occs = [comp.allOccurrences.item(i) for i in range(comp.allOccurrences.count)]
    except Exception as e:
        _log(logger, f"MM FILTER ({rule}): could not enumerate allOccurrences: {e}", "ERROR")
        return (0, 0, 0)

    kept = 0
    to_delete = []
    for occ in all_occs:
        try:
            occ_name = occ.component.name
        except Exception:
            occ_name = '<unnamed>'
        cls = _classify_occurrence(occ)

        # Surface-only occurrences are filtered out of CAM MMs. Per user
        # requirement: MMs should contain only solid bodies. If b-spline
        # ops need surface geometry, the template/operation needs to
        # source it from somewhere else (e.g., extract solid from surface
        # in the source design before MM build).
        surface_only = False
        try:
            comp_for_bodies = occ.component
            bodies = comp_for_bodies.bRepBodies
            if bodies.count > 0:
                has_solid = False
                for bi in range(bodies.count):
                    b = bodies.item(bi)
                    try:
                        if b.isSolid:
                            has_solid = True
                            break
                    except Exception:
                        has_solid = True
                        break
                surface_only = not has_solid
        except Exception:
            surface_only = False

        if surface_only:
            to_delete.append((occ, occ_name, f"{cls}+surface_only"))
            _log(logger, f"MM FILTER ({rule}): DEL surface-only occ '{occ_name}' (class={cls})", "DEBUG")
        elif cls in delete:
            to_delete.append((occ, occ_name, cls))
        else:
            kept += 1
            _log(logger, f"MM FILTER ({rule}): KEEP occ '{occ_name}' (class={cls})", "DEBUG")

    # Deepest-first delete order -- use fullPathName length as a depth
    # proxy. Fusion's path strings are slash-separated, so longer == deeper.
    def _depth(t):
        try:
            return -len(t[0].fullPathName or '')
        except Exception:
            return 0
    to_delete.sort(key=_depth)

    # Wrap deletes inside a BaseFeature edit so the MM's timeline gets
    # ONE collapsed entry ("Base Feature" with our deletions inside)
    # instead of N "Remove" entries -- one per deleteMe() call. That's
    # the difference between "Remove" semantics (parametric, every
    # action becomes a timeline feature) and "Delete" semantics
    # (direct-edit, batched into a single base feature).
    base_feat = None
    try:
        base_features = comp.features.baseFeatures
        base_feat = base_features.add()
        base_feat.startEdit()
    except Exception as e:
        _log(logger, f"MM FILTER ({rule}): BaseFeature wrap unavailable, deletions will land directly on timeline: {e}", "DEBUG")
        base_feat = None

    deleted = 0
    failed = 0
    try:
        for occ, occ_name, cls in to_delete:
            try:
                if not occ.isValid:
                    deleted += 1
                    continue
                ok = occ.deleteMe()
                if ok:
                    deleted += 1
                    _log(logger, f"MM FILTER ({rule}): DEL  occ '{occ_name}' (class={cls})", "DEBUG")
                else:
                    failed += 1
                    _log(logger, f"MM FILTER ({rule}): deleteMe() returned False for occ '{occ_name}' (class={cls})", "WARNING")
            except Exception as e:
                failed += 1
                _log(logger, f"MM FILTER ({rule}): deleteMe() raised on occ '{occ_name}' (class={cls}): {e}", "WARNING")
    finally:
        if base_feat is not None:
            try:
                base_feat.finishEdit()
                _log(logger, f"MM FILTER ({rule}): collapsed {deleted} deletions into 1 BaseFeature timeline entry", "DEBUG")
            except Exception as e:
                _log(logger, f"MM FILTER ({rule}): BaseFeature.finishEdit failed: {e}", "WARNING")

    return (kept, deleted, failed)


def _apply_bspline_panel_filter(mm, logger):
    """Inside the bspline_set MM, enforce primary-panel rules:

      1. If a Stamped occurrence with a panel body exists, delete the
         Clean occurrence -- Stamped is what we machine; Clean is the
         alternative the user already decided not to use.
      2. On the surviving panel-bearing occurrence, delete the surface
         body. CAM only needs the solid panel; the surface body is
         reference geometry from the export pipeline.

    After the architectural rewrite, the source design has exactly two
    children of B-Spline Set (Clean and Stamped) each with two bodies
    (panel and surface). No orphan handling, no consolidation cleanup --
    the JS-side STEP writer produces the correct shape from the start.

    Two-phase deletion:
      Phase A: occurrence delete inside a wrapper-component BaseFeature
        edit. Cross-component occurrence deletion is special-cased by
        Fusion to work inside BaseFeature scope.
      Phase B: body delete OUTSIDE any BaseFeature edit. Bodies live in
        CHILD components (Stamped); deleting them inside a wrapper
        BaseFeature raises InternalValidationError. Each body produces
        one ordinary 'Remove' timeline entry -- with one body per
        survivor that's tolerable.
    """
    try:
        comp = mm.occurrence.component
    except Exception as e:
        _log(logger, f"BSPLINE FILTER: read mm comp failed: {e}", "ERROR")
        return

    # Find the B-Spline Set occurrence(s) inside the MM snapshot.
    try:
        all_occs = [comp.allOccurrences.item(i) for i in range(comp.allOccurrences.count)]
    except Exception as e:
        _log(logger, f"BSPLINE FILTER: enumerate allOccurrences failed: {e}", "ERROR")
        return

    bspline_set_occs = []
    for o in all_occs:
        try:
            nm = (o.component.name or '').lower()
        except Exception:
            continue
        if 'b-spline set' in nm or 'bspline set' in nm:
            bspline_set_occs.append(o)

    if not bspline_set_occs:
        _log(logger, "BSPLINE FILTER: no B-Spline Set occurrence in MM snapshot", "DEBUG")
        return

    # Walk children of each B-Spline Set, classify Clean vs Stamped.
    occs_to_delete = []
    surface_bodies_to_delete = []

    for parent_occ in bspline_set_occs:
        clean_occ   = None
        stamped_occ = None
        try:
            for i in range(parent_occ.childOccurrences.count):
                try:
                    child = parent_occ.childOccurrences.item(i)
                    cn = (child.component.name or '').lower()
                except Exception:
                    continue
                if 'stamped' in cn and _component_has_panel_body(child.component):
                    stamped_occ = child
                elif 'clean' in cn:
                    clean_occ = child
        except Exception as e:
            _log(logger, f"BSPLINE FILTER: child walk failed: {e}", "WARNING")
            continue

        # Stamped wins: queue Clean for deletion.
        survivor = stamped_occ if stamped_occ is not None else clean_occ
        if stamped_occ is not None and clean_occ is not None:
            try:
                nm = clean_occ.component.name
            except Exception:
                nm = '<unnamed>'
            occs_to_delete.append((clean_occ, nm))

        # On the survivor, queue surface body for deletion.
        if survivor is not None:
            try:
                for i in range(survivor.component.bRepBodies.count):
                    try:
                        b  = survivor.component.bRepBodies.item(i)
                        bn = (b.name or '').lower()
                    except Exception:
                        continue
                    if _is_surface_body_name(bn):
                        surface_bodies_to_delete.append(
                            (b, survivor.component.name, b.name)
                        )
            except Exception as e:
                _log(logger, f"BSPLINE FILTER: body walk failed: {e}", "WARNING")

    if not occs_to_delete and not surface_bodies_to_delete:
        _log(logger, "BSPLINE FILTER: nothing to prune", "DEBUG")
        return

    # ---- Phase A: occurrence deletes inside wrapper BaseFeature ----
    occ_deleted = 0
    if occs_to_delete:
        base_feat = None
        try:
            base_feat = comp.features.baseFeatures.add()
            base_feat.startEdit()
        except Exception as e:
            _log(logger, f"BSPLINE FILTER: BaseFeature open failed: {e}", "DEBUG")
            base_feat = None

        try:
            for occ, nm in occs_to_delete:
                try:
                    if not occ.isValid:
                        occ_deleted += 1
                        continue
                    if occ.deleteMe():
                        occ_deleted += 1
                        _log(logger, f"BSPLINE FILTER: deleted Clean occ '{nm}' (Stamped wins)", "INFO")
                    else:
                        _log(logger, f"BSPLINE FILTER: occ deleteMe returned False for '{nm}'", "WARNING")
                except Exception as e:
                    _log(logger, f"BSPLINE FILTER: occ deleteMe '{nm}' raised: {e}", "WARNING")
        finally:
            if base_feat is not None:
                try:
                    base_feat.finishEdit()
                except Exception as e:
                    _log(logger, f"BSPLINE FILTER: BaseFeature.finishEdit failed: {e}", "WARNING")

    # ---- Phase B: body deletes (must run OUTSIDE BaseFeature) ----
    body_deleted = 0
    for body, comp_name, body_name in surface_bodies_to_delete:
        try:
            if not body.isValid:
                continue
            if body.deleteMe():
                body_deleted += 1
                _log(logger, f"BSPLINE FILTER: deleted surface body '{body_name}' from '{comp_name}'", "DEBUG")
            else:
                _log(logger, f"BSPLINE FILTER: body deleteMe returned False for '{body_name}' in '{comp_name}'", "WARNING")
        except Exception as e:
            _log(logger, f"BSPLINE FILTER: body deleteMe '{body_name}' raised: {e}", "WARNING")

    _log(logger, f"BSPLINE FILTER: pruned {occ_deleted} Clean occ(s) and {body_deleted} surface body/bodies", "INFO")


def _component_has_panel_body(comp):
    """``True`` if ``comp`` owns a body classified as a panel.

    Accepts ``panel``, ``panel_N`` (bspline-gen's own suffix), and
    ``panel (N)`` (Fusion's auto-uniquifier). Mirrors the surface
    matcher so the two are symmetric."""
    try:
        n = comp.bRepBodies.count
    except Exception:
        return False
    for i in range(n):
        try:
            bn = (comp.bRepBodies.item(i).name or '').lower()
        except Exception:
            continue
        if _is_panel_body_name(bn):
            return True
    return False


def _is_panel_body_name(bn):
    """True for: 'panel', 'panel_N', 'panel (N)'."""
    if bn == 'panel':
        return True
    if bn.startswith('panel_'):
        return True
    if bn.startswith('panel (') and bn.endswith(')'):
        # 'panel (1)' / 'panel (12)' — Fusion uniquifier
        return True
    return False


def _is_surface_body_name(bn):
    """True for: 'surface', 'surface_N', 'surface (N)'."""
    if bn == 'surface':
        return True
    if bn.startswith('surface_'):
        return True
    if bn.startswith('surface (') and bn.endswith(')'):
        return True
    return False


# ---------------------------------------------------------------------------
# Generic mode -- one MM per component
# ---------------------------------------------------------------------------

def build_mms_from_components(cam, design, component_names, logger=None):
    """Generic mode: build one MM per component name.

    Each MM is a full snapshot of the Design with every component EXCEPT
    the target deleted. The document wrapper occurrence is preserved
    (it's not in ``component_names`` so the filter keeps it automatically).

    Parameters
    ----------
    cam : adsk.cam.CAM
    design : adsk.fusion.Design
        Source design (used for user-parameter propagation).
    component_names : list[str]
        Top-level component names to build MMs for, as returned by the
        palette's SCAN action (``root.occurrences[i].component.name``).

    Returns
    -------
    dict[str, ManufacturingModel]
        ``{component_name: ManufacturingModel}`` for each successfully
        built MM.
    """
    _ensure_cam_builder_user_parameters(design, logger)

    app = adsk.core.Application.get()
    original_active = None
    try:
        des = get_design(app, logger)
        if des:
            original_active = des.activeEditObject
    except Exception:
        pass

    out = {}
    for comp_name in component_names:
        mm = _build_mm_for_component(cam, design, comp_name, component_names, logger)
        if mm:
            out[comp_name] = mm

    if original_active is not None:
        _log(logger, f"MM BUILD GENERIC CKPT 1: about to restore activeEditObject (type={type(original_active).__name__})", "DEBUG")
        try:
            original_active.activate()
            _log(logger, "MM BUILD GENERIC CKPT 1: restore succeeded", "DEBUG")
        except Exception as e:
            _log(logger, f"MM BUILD GENERIC: restore activeEditObject failed: {e}", "DEBUG")
    else:
        _log(logger, "MM BUILD GENERIC CKPT 1: no original_active to restore", "DEBUG")
    _log(logger, f"MM BUILD GENERIC CKPT 2: returning out (size={len(out)})", "DEBUG")
    return out


def _build_mm_for_component(cam, design, comp_name, all_comp_names, logger=None):
    """Build one MM that contains only the occurrence for ``comp_name``."""
    if cam is None:
        _log(logger, f"MM BUILD GENERIC ({comp_name}): cam is None", "ERROR")
        return None

    try:
        mm_input = cam.manufacturingModels.createInput()
        mm_input.name = f'MM - {comp_name}'
        mm = cam.manufacturingModels.add(mm_input)
    except Exception as e:
        _log(logger, f"MM BUILD GENERIC ({comp_name}): manufacturingModels.add raised: {e}", "ERROR")
        return None

    if mm is None:
        _log(logger, f"MM BUILD GENERIC ({comp_name}): manufacturingModels.add returned None", "ERROR")
        return None

    _log(logger, f"MM BUILD GENERIC ({comp_name}): created '{mm.name}'")

    try:
        kept, deleted, failed = _apply_generic_filter(mm, comp_name, all_comp_names, logger)
        _log(logger, f"MM BUILD GENERIC ({comp_name}): filter -> kept={kept} deleted={deleted} failed={failed}")
    except Exception as e:
        _log(logger, f"MM BUILD GENERIC ({comp_name}): filter raised: {e}", "WARNING")

    try:
        _propagate_user_parameters_to_mm(mm, design, logger)
    except Exception as e:
        _log(logger, f"MM BUILD GENERIC ({comp_name}): param propagation raised: {e}", "WARNING")

    return mm


def _apply_generic_filter(mm, target_comp_name, all_comp_names, logger):
    """Keep only the target component; delete every other known component.

    Uses ``all_comp_names`` to distinguish "sibling component to delete"
    from "document wrapper to keep": any occurrence whose component name
    is in ``all_comp_names`` but is NOT the target → delete. Occurrences
    whose name is NOT in ``all_comp_names`` are the document wrapper
    (named after the document, not after any component) → keep.

    Empirically verified on ``canoe_plus_paddle v3``:
      allOccurrences inside an MM built from that design contains:
        - 'Canoe_grab'                (component → keep if target, else delete)
        - 'Part4^canoe_plus_paddle'   (component → keep if target, else delete)
        - 'canoe_plus_paddle v2 (1)'  (document wrapper → NOT in all_comp_names → keep)
    """
    target_lower = target_comp_name.lower()
    all_lower = {n.lower() for n in all_comp_names}

    try:
        comp = mm.occurrence.component
    except Exception as e:
        _log(logger, f"GENERIC FILTER ({target_comp_name}): mm.occurrence.component failed: {e}", "ERROR")
        return (0, 0, 0)

    try:
        all_occs = [comp.allOccurrences.item(i) for i in range(comp.allOccurrences.count)]
    except Exception as e:
        _log(logger, f"GENERIC FILTER ({target_comp_name}): enumerate allOccurrences failed: {e}", "ERROR")
        return (0, 0, 0)

    kept = 0
    to_delete = []
    for occ in all_occs:
        try:
            occ_comp_name = (occ.component.name or '').lower()
        except Exception:
            occ_comp_name = ''

        if occ_comp_name == target_lower:
            kept += 1
            _log(logger, f"GENERIC FILTER ({target_comp_name}): KEEP '{occ.component.name}' (target)", "DEBUG")
        elif occ_comp_name in all_lower:
            # Known sibling component → delete
            to_delete.append((occ, occ.component.name))
            _log(logger, f"GENERIC FILTER ({target_comp_name}): queue DEL '{occ.component.name}' (sibling)", "DEBUG")
        else:
            # Not a known component name → document wrapper → keep
            kept += 1
            _log(logger, f"GENERIC FILTER ({target_comp_name}): KEEP '{occ.component.name}' (wrapper)", "DEBUG")

    # Deepest-first so parent deletions don't orphan child deleteMe() calls
    def _depth(t):
        try:
            return -len(t[0].fullPathName or '')
        except Exception:
            return 0
    to_delete.sort(key=_depth)

    # Wrap in a BaseFeature so the deletions collapse to one timeline entry
    base_feat = None
    try:
        base_feat = comp.features.baseFeatures.add()
        base_feat.startEdit()
    except Exception as e:
        _log(logger, f"GENERIC FILTER ({target_comp_name}): BaseFeature wrap unavailable: {e}", "DEBUG")
        base_feat = None

    deleted = 0
    failed = 0
    try:
        for occ, occ_name in to_delete:
            try:
                if not occ.isValid:
                    deleted += 1
                    continue
                ok = occ.deleteMe()
                if ok:
                    deleted += 1
                    _log(logger, f"GENERIC FILTER ({target_comp_name}): DEL '{occ_name}'", "DEBUG")
                else:
                    failed += 1
                    _log(logger, f"GENERIC FILTER ({target_comp_name}): deleteMe returned False for '{occ_name}'", "WARNING")
            except Exception as e:
                failed += 1
                _log(logger, f"GENERIC FILTER ({target_comp_name}): deleteMe raised for '{occ_name}': {e}", "WARNING")
    finally:
        if base_feat is not None:
            try:
                base_feat.finishEdit()
                _log(logger, f"GENERIC FILTER ({target_comp_name}): collapsed {deleted} deletions into 1 BaseFeature entry", "DEBUG")
            except Exception as e:
                _log(logger, f"GENERIC FILTER ({target_comp_name}): BaseFeature.finishEdit failed: {e}", "WARNING")

    return (kept, deleted, failed)


def _mm_display_name(rule):
    return {
        'stock':        'MM - Stock (raw blank)',
        'bspline_set':  'MM - B-spline set',
        'frame':        'MM - Frame (lay-flat)',
    }[rule]


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
