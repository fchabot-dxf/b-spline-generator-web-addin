from entity_helpers import get_fb_name, get_entity_coord, get_fb_metadata, _get_arc_midpoint
from expression_coords import _format_point_expr
# ``_get_native`` and ``_same_entity`` moved to ``entity_util`` so that
# ``relation_hints`` can reuse them without a circular import. Re-imported
# here so existing callers like ``rename_selection`` and
# ``template_naming`` that do ``from template_payload import _get_native``
# keep working — Python adds imported names to the module namespace.
from entity_util import _get_native, _same_entity
# Relation-hint builders (constraints + dimensions) moved out to
# ``relation_hints`` with crash guards baked in. Re-imported so
# ``_build_entity_hint`` below can dispatch to them. ``target_props_for``
# is the single source of truth for the per-subtype property slots,
# shared between the hint emitter and the ownership gate below — both
# must only touch slots Fusion defines for the given subtype, because a
# getattr on an out-of-subtype slot can native-AV mid-recompute and no
# Python ``try/except`` will catch it.
from relation_hints import _hint_constraint, _hint_dimension, target_props_for
# Detection log moved to ``detection_log`` so every module can emit
# diagnostic lines without reaching into the seed-hint module. Re-imported
# here so ``from template_payload import _log_detection`` keeps working
# — new callers should import from ``detection_log`` directly.
from detection_log import _write_debug_log, _log_detection
# Variable-scan layer (design-param collection + selection-token parsing)
# moved to ``variable_scan``. Re-imported here so existing callers that do
# ``from template_payload import _collect_variables`` (or any of the other
# names below) keep working — new callers should import from
# ``variable_scan`` directly. ``_strip_point_prefix`` and
# ``_call_entity_coord_expr_fn`` live there because they're the two
# adapters that feed the token scanner; they're also used by
# ``_format_point_reference`` below, which is why they have to land in
# this module's namespace too.
from variable_scan import (
    BUILTIN_TEMPLATE_VARIABLES,
    _strip_point_prefix,
    _call_entity_coord_expr_fn,
    _parse_expression_tokens,
    _collect_design_variables,
    _collect_variables,
    _merge_variables,
)


def _label_for_entity(ent):
    """Return a display-friendly label for ``ent``.

    ``get_fb_name`` has two non-attribute fallbacks we must NOT treat
    as real labels:
        * ``"Entity"`` — returned from its broad ``except`` branch
          when attribute probing faults on a settling proxy (this is
          the CoincidentConstraint case that used to silently collapse
          every constraint to the label ``"Entity"``)
        * ``"None"`` — returned when the entity itself is falsy
    Treating either as a real label is how constraint picks ended up
    with ``base_label = "Entity"``, which then made
    ``new_label == base_label`` in ``rename_selection``, which then
    made ``set_entity_fb_name`` get skipped entirely. The rename
    appeared to "work" (no crash, renamed=0) while actually doing
    nothing to the constraint's attributes. Falling through to the
    objectType short name (``"CoincidentConstraint"``) gives
    ``make_unique_label`` a real base to disambiguate from.
    """
    ent = _get_native(ent)
    if not ent:
        return 'Unknown'
    label = get_fb_name(ent)
    if (label
            and label not in ('Entity', 'None')
            and not label.startswith('Sketch')
            and not label.startswith('Vertex of')):
        return label
    try:
        obj_type = ent.objectType.split('::')[-1]
        if obj_type:
            return obj_type
    except Exception:
        pass
    return 'Unknown'


_POINT_TYPES = ('SketchPoint', 'SketchPoint3D', 'SketchPoint2D')
# NOTE: ``_POINT_TYPES`` is also referenced inside ``relation_hints``; that
# module re-declares its own copy rather than importing to keep the two
# modules decoupled (this constant rarely changes and each owner uses it
# for a different check — seed vs. target role-ID).


def _format_point_reference(pt, params=None, get_entity_coord_expr_fn=None):
    """Format a reference to a geometry target for use inside a SEED statement.

    For sketch *points*, return a coordinate tuple expression (which is valid
    Python — the arrow-joined multi-tuple format is only used for lines/arcs
    and would be invalid syntax if embedded as a constraint/dim target).

    For non-point entities (lines, arcs, circles), return the entity's name
    as a quoted string literal.

    NOTE: This function is for SEED statement arguments (which need real
    coordinates to place the geometry). For CONSTRAINT / DIMENSION target
    references use ``_format_target_reference`` instead — constraints must
    always use ID strings, never coords, because the points Fusion hands us
    will have already been moved to satisfy the constraint and emitting those
    post-constraint coords into the constraint itself is either a no-op or a
    bug at phase-run time.
    """
    if not pt:
        return 'UnknownPoint'
    pt = _get_native(pt)
    ent_type = getattr(pt, 'objectType', '').split('::')[-1] if hasattr(pt, 'objectType') else ''

    # Points → coord tuple (from expression if available, else literal coord).
    if ent_type in _POINT_TYPES:
        expr = _strip_point_prefix(_call_entity_coord_expr_fn(get_entity_coord_expr_fn, pt, params)) if get_entity_coord_expr_fn else ''
        if expr:
            return expr
        name = get_fb_name(pt)
        if name and not name.startswith('Sketch'):
            return f'"{name}"'
        coord = _strip_point_prefix(get_entity_coord(pt))
        if coord:
            return coord
        return 'Point(...)'

    # Non-points (SketchLine, SketchArc, SketchCircle, ...) → quoted name.
    name = get_fb_name(pt)
    if name and not name.startswith('Sketch'):
        return f'"{name}"'
    # Unnamed: fall back to the entity type as a placeholder — still valid
    # Python (string literal). The user can click Rename Selection to assign
    # a real ID and regenerate.
    return f'"{ent_type}"' if ent_type else 'Point(...)'


# Ownership gate (``is_framebuilder_owned`` + ``_has_framebuilder_attribute``)
# moved to ``ownership_gate`` so it lives next to ``relation_hints`` — both
# share ``target_props_for`` and MUST agree on per-subtype slot coverage or
# constraints silently drop out of the palette. Re-imported here so existing
# callers like ``template_payload_builder`` that do
# ``from template_payload import is_framebuilder_owned`` keep working. New
# callers should import from ``ownership_gate`` directly.
from ownership_gate import _has_framebuilder_attribute, is_framebuilder_owned

# ``_derive_point_role_id``, ``_format_target_reference`` and
# ``_constraint_targets`` moved to ``relation_hints`` along with
# ``_hint_constraint`` / ``_hint_dimension``. They're not re-exported here
# because nothing outside the relation-hint path uses them.


# ---------------------------------------------------------------------------
# Shape hint builders — each one takes (ent, name, ctx) and returns the
# Seeds.* line for that sketch shape. ``ctx`` is a small dict carrying the
# shared helpers (params + expr fn) so per-shape signatures stay compact.
#
# Dispatch lives in ``_SHAPE_HINT_HANDLERS`` below. Adding a new seed is a
# matter of writing one handler and registering it — no more edits to a
# monolithic if/elif chain in ``_build_entity_hint``.
# ---------------------------------------------------------------------------


def _hint_point(ent, name, ctx):
    coord = _strip_point_prefix(_call_entity_coord_expr_fn(ctx['expr_fn'], ent, ctx['params'])) if ctx['expr_fn'] else ''
    coord = coord or get_entity_coord(ent)
    return f'Seeds.Point("{name}", {coord})' if coord else f'Seeds.Point("{name}", x, y)'


def _hint_line(ent, name, ctx):
    start_ref = _format_point_reference(getattr(ent, 'startSketchPoint', None), ctx['params'], ctx['expr_fn'])
    end_ref = _format_point_reference(getattr(ent, 'endSketchPoint', None), ctx['params'], ctx['expr_fn'])
    return f'Seeds.Line("{name}", {start_ref}, {end_ref})'


def _hint_arc(ent, name, ctx):
    # Frame Builder's runtime creates arcs via Fusion's
    # ``sketchArcs.addByThreePoints(p1, p2, p3)`` which REQUIRES three points
    # that all sit on the curve: start, a midpoint along the arc, end.
    # Center does NOT belong in this slot — passing it would produce a
    # geometrically wrong arc wherever the center isn't coincidentally on
    # the curve (always, for any real arc).
    #
    # The centerSketchPoint is auto-tagged "{name}:C" by the runtime, so we
    # don't need to emit center metadata in the seed call; it stays
    # reachable for constraints via that stable ID.
    start_ref = _format_point_reference(getattr(ent, 'startSketchPoint', None), ctx['params'], ctx['expr_fn'])
    end_ref = _format_point_reference(getattr(ent, 'endSketchPoint', None), ctx['params'], ctx['expr_fn'])

    mid_pt = _get_arc_midpoint(ent)
    if mid_pt is not None:
        mid_expr = _format_point_expr(mid_pt, ctx['params'])
    else:
        mid_expr = ''
    mid_ref = mid_expr if mid_expr else '(mid_x, mid_y)'

    return f'Seeds.Arc("{name}", {start_ref}, {mid_ref}, {end_ref})'


def _hint_circle(ent, name, ctx):
    center_ref = _format_point_reference(getattr(ent, 'centerSketchPoint', None), ctx['params'], ctx['expr_fn'])
    radius_suffix = ''
    try:
        r = getattr(ent.geometry, 'radius', None)
        if r is not None:
            radius_suffix = f', radius={round(float(r), 4)}'
    except Exception:
        radius_suffix = ''
    return f'Seeds.Circle("{name}", center={center_ref}{radius_suffix})'


def _hint_ellipse(ent, name, ctx):
    center_ref = _format_point_reference(getattr(ent, 'centerSketchPoint', None), ctx['params'], ctx['expr_fn'])
    parts = [f'"{name}"', f'center={center_ref}']
    try:
        geo = getattr(ent, 'geometry', None)
        major = getattr(geo, 'majorAxisRadius', None)
        if major is not None:
            parts.append(f'majorRadius={round(float(major), 4)}')
        minor = getattr(geo, 'minorAxisRadius', None)
        if minor is not None:
            parts.append(f'minorRadius={round(float(minor), 4)}')
        axis = getattr(geo, 'majorAxis', None)
        if axis is not None:
            import math as _math
            ax = getattr(axis, 'x', None)
            ay = getattr(axis, 'y', None)
            if ax is not None and ay is not None:
                theta = _math.degrees(_math.atan2(float(ay), float(ax)))
                parts.append(f'angleDeg={round(theta, 4)}')
    except Exception:
        pass
    return f'Seeds.Ellipse({", ".join(parts)})'


def _iter_spline_points(ent):
    """Yield the control/fit points of a spline in native order.

    Fusion SketchPointList exposes ``count`` + ``item(i)``; we fall back to
    plain iteration for fakes/tests.
    """
    for attr in ('fitPoints', 'controlPoints'):
        pts = getattr(ent, attr, None)
        if pts is None:
            continue
        try:
            count = getattr(pts, 'count', None)
            if count is not None:
                for i in range(count):
                    yield pts.item(i)
                return
        except Exception:
            pass
        try:
            for pt in pts:
                yield pt
            return
        except Exception:
            continue


def _hint_spline_factory(seed_name):
    """Return a hint handler that emits ``Seeds.<seed_name>("id", [pts])``."""

    def handler(ent, name, ctx):
        point_refs = [
            _format_point_reference(pt, ctx['params'], ctx['expr_fn'])
            for pt in _iter_spline_points(ent)
        ]
        pts_literal = '[' + ', '.join(point_refs) + ']'
        return f'Seeds.{seed_name}("{name}", {pts_literal})'

    return handler


_SHAPE_HINT_HANDLERS = {
    'SketchPoint':               _hint_point,
    'SketchPoint2D':             _hint_point,
    'SketchPoint3D':             _hint_point,
    'SketchLine':                _hint_line,
    'SketchArc':                 _hint_arc,
    'SketchCircle':              _hint_circle,
    'SketchEllipse':             _hint_ellipse,
    'SketchFittedSpline':        _hint_spline_factory('FittedSpline'),
    'SketchControlPointSpline':  _hint_spline_factory('ControlPointSpline'),
    'SketchFixedSpline':         _hint_spline_factory('FixedSpline'),
}


# ``_hint_constraint`` and ``_hint_dimension`` moved to ``relation_hints``.
# They're imported at the top of this module so ``_build_entity_hint``
# below can still dispatch to them by name — same call site, just a
# different home.


def _build_entity_hint(ent, params=None, get_entity_coord_expr_fn=None, name_override=None):
    ent = _get_native(ent)
    ent_type = ent.objectType.split('::')[-1] if hasattr(ent, 'objectType') else 'Entity'
    name = name_override if name_override else _label_for_entity(ent)
    ctx = {'params': params, 'expr_fn': get_entity_coord_expr_fn}

    handler = _SHAPE_HINT_HANDLERS.get(ent_type)
    if handler is not None:
        return handler(ent, name, ctx)

    # OffsetConstraint is the single constraint subtype that routes to a
    # dedicated step builder instead of the generic ``Constraints.<Type>``
    # emitter. The runtime treats offsets as ``{'Type': 'Offset', ...}``
    # steps with ``SourceID`` / ``DistanceExpr`` / ``TargetIDs`` slots —
    # none of which fit the generic ``{'Type', 'Targets'}`` constraint
    # shape. Routed here BEFORE the generic ``'Constraint' in ent_type``
    # branch because OffsetConstraint's name contains 'Constraint' and
    # would otherwise be caught by the generic handler.
    if ent_type == 'OffsetConstraint':
        from offset_hint import build_offset_step
        return build_offset_step(ent, label_override=name_override)

    # Constraints and dimensions are matched by substring — Fusion emits a
    # zoo of subtypes (HorizontalConstraint, PerpendicularConstraint,
    # SketchLinearDimension, SketchRadialDimension...) that all route through
    # a single family handler.
    if 'Constraint' in ent_type:
        return _hint_constraint(ent, ent_type, name, ctx)
    if 'Dimension' in ent_type:
        # Dimensions route through ``dimension_hint.build_dimension_hint``
        # rather than ``_hint_dimension`` directly. The wrapper enforces a
        # naming convention the constraint path doesn't need: the step's
        # ``Name`` field ends up written onto ``dim.parameter.name`` by the
        # runtime, so it shares a namespace with Fusion user parameters.
        # ``build_dimension_hint`` prepends ``dim_`` when a raw tag would
        # collide with an existing user parameter (logging a detection-log
        # warning), keeping dim identity unambiguous for the
        # ``delete_dimension_by_name`` lookup. Target walk is still owned by
        # ``relation_hints._constraint_targets`` (imported lazily inside
        # ``build_dimension_hint`` to avoid the relation_hints ↔
        # dimension_hint import cycle).
        from dimension_hint import build_dimension_hint
        return build_dimension_hint(ent, ent_type, name, ctx)

    return f'# {ent_type}("{name}")'
