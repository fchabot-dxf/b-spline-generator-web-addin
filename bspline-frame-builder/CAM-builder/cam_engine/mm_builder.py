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

import adsk.core
import adsk.cam
import adsk.fusion

from ..cam_utils import get_design


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
        try:
            original_active.activate()
        except Exception as e:
            _log(logger, f"MM BUILD: restore activeEditObject failed: {e}", "DEBUG")

    return out


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

    # PASS 3 hook -- frame reorient + stock extrude go here.
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

    # 2. Activate the MM to enter its parameter scope.
    try:
        mm.activate()
    except Exception as e:
        _log(logger, f"PARAM PROP ({mm.name}): activate failed: {e}", "WARNING")
        return 0

    # 3. After activation, app.activeProduct *should* be a Design pointing
    #    to the MM's own scope. On current Fusion builds it stays as the
    #    Manufacture workspace's CAMProduct, which means we can't reach
    #    the MM's derived design via this path. Falling back to the source
    #    Design via get_design() lets the propagation proceed -- the
    #    name-collision guard (`existing` check below) makes this a
    #    no-op when the source already has these params, which is the
    #    common case (we're snapshotting FROM the source). The trade-off:
    #    if the user has edited a param's expression in MM scope, this
    #    fallback won't see it; it'll write source values instead.
    mm_design = adsk.fusion.Design.cast(app.activeProduct)
    if mm_design is None:
        mm_design = get_design(app, logger)
        if mm_design is None:
            _log(logger,
                 f"PARAM PROP ({mm.name}): activeProduct is not a Design and "
                 f"no source Design available either; skipping",
                 "WARNING")
            return 0
        _log(logger,
             f"PARAM PROP ({mm.name}): activeProduct after activate is not a Design "
             f"(MM-scope unreachable on this Fusion build); writing into source "
             f"Design (idempotent for source params)",
             "DEBUG")

    try:
        mm_user_params = mm_design.userParameters
    except Exception as e:
        _log(logger, f"PARAM PROP ({mm.name}): userParameters access failed: {e}", "WARNING")
        return 0

    # 4. Write each snapshot entry. Skip names that already exist (the
    #    MM may already carry the param if this is a re-run, or if the
    #    user has hand-authored one in MM scope).
    copied = 0
    skipped = 0
    failed = 0
    for entry in snapshot:
        name = entry['name']
        try:
            existing = mm_user_params.itemByName(name)
        except Exception:
            existing = None
        if existing:
            skipped += 1
            continue
        try:
            value = adsk.core.ValueInput.createByString(entry['expression'])
            param = mm_user_params.add(name, value, entry['unit'], entry['comment'])
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
            _log(logger, f"PARAM PROP ({mm.name}): add '{name}' raised: {e}", "WARNING")

    _log(logger, f"PARAM PROP ({mm.name}): copied={copied} skipped={skipped} failed={failed} of {len(snapshot)} source params")
    return copied


def _populate_stock_placeholder(mm, source_design, logger):
    """Create a parametric rectangular stock body inside MM-Stock.

    Geometry: a centered rectangle on the XY plane, sized
    ``(widthIn + 1in) x (heightIn + 1in)``, extruded ``2 in`` in +Z.
    The two horizontal dimensions reference the source design's user
    parameters (which ``_propagate_user_parameters_to_mm`` has already
    mirrored into MM scope), so the stock auto-resizes if the panel
    parameters change. Z is a literal -- 2in is a sensible default for
    rough stock; bump it later if needed.

    Idempotent: skips if the MM root component already has any body
    (lets the user re-run CAM Builder without nuking edits, and avoids
    duplicates if the function ever fires twice).

    Why this exists: the 'stock' MM rule wipes every body via the
    occurrence filter (so the MM is a clean blank). That leaves the
    Stock Setup with no model to bind, hence the auto-bind via
    ``setup_input.models`` no-ops and the user has to pick MM-Stock
    manually in the dialog. Putting one body here closes the loop.
    """
    app = adsk.core.Application.get()
    if app is None:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): app is None; skipping", "WARNING")
        return False

    try:
        mm.activate()
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): activate failed: {e}", "WARNING")
        return False

    # Unlike PARAM PROP, we cannot fall back to the source Design here:
    # this function CREATES a body, and writing into the source would
    # pollute the user's design. If activeProduct doesn't expose the MM's
    # derived design, we have to skip and surface a clearer message --
    # the cleaner long-term fix is to bind the stock body via the Setup's
    # own stockSolids surface instead of via the MM (TODO).
    mm_design = adsk.fusion.Design.cast(app.activeProduct)
    if mm_design is None:
        _log(logger,
             f"STOCK PLACEHOLDER ({mm.name}): activeProduct after activate is not a Design "
             f"(MM-scope unreachable on this Fusion build); skipping. Stock setup will "
             f"bind 0 bodies until the user picks MM-Stock manually OR until we wire "
             f"stockSolids on the Setup directly.",
             "WARNING")
        return False

    try:
        root_comp = mm_design.rootComponent
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): rootComponent read failed: {e}", "WARNING")
        return False

    # Idempotent: if there's already a body in the root, leave it alone.
    try:
        existing = root_comp.bRepBodies.count
    except Exception:
        existing = 0
    if existing > 0:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): root already has {existing} body/bodies; skipping", "DEBUG")
        return False

    # Verify the parametric expressions will resolve in this scope.
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

    try:
        sketch_lines = sketch.sketchCurves.sketchLines
        # Initial corners are arbitrary in cm (Fusion internal units);
        # the dimensions added below drive the actual size. 5 cm x 5 cm
        # gives the constraint solver a sane non-degenerate seed.
        center = adsk.core.Point3D.create(0, 0, 0)
        corner = adsk.core.Point3D.create(5.0, 5.0, 0)
        rect_lines = sketch_lines.addCenterPointRectangle(center, corner)
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): addCenterPointRectangle failed: {e}", "WARNING")
        return False

    # Find one horizontal line and one vertical line for dimensioning.
    # addCenterPointRectangle adds implicit H/V constraints; we just
    # walk the returned collection and classify by endpoint deltas.
    horizontal_line = None
    vertical_line = None
    try:
        for i in range(rect_lines.count):
            ln = rect_lines.item(i)
            sp = ln.startSketchPoint.geometry
            ep = ln.endSketchPoint.geometry
            dx = abs(sp.x - ep.x)
            dy = abs(sp.y - ep.y)
            if dy < 1e-6 and horizontal_line is None:
                horizontal_line = ln
            elif dx < 1e-6 and vertical_line is None:
                vertical_line = ln
    except Exception as e:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): line classification failed: {e}", "WARNING")
        return False

    if horizontal_line is None or vertical_line is None:
        _log(logger, f"STOCK PLACEHOLDER ({mm.name}): could not find both H and V lines in rectangle", "WARNING")
        return False

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

        if cls in delete:
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
