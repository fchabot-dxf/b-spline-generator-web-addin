"""Hint builders for Fusion relation entities — constraints and dimensions.

Split out from ``template_payload`` because:

* Both of these hint types share the same target-walk (``_constraint_targets``,
  ``_format_target_reference``, ``_derive_point_role_id``) and the same
  reentrancy-crash vulnerability when Fusion fires a selection-change event
  while a new constraint / dimension is still settling. Keeping them in one
  module lets the guards live in one place.

* ``template_payload`` was accumulating unrelated concerns — shape hints,
  variable collection, detection logging, entity ownership gates, and
  the relation hints. Separating the relational path shrinks that module
  to its actual job (seed-hint building) and lets relation logic evolve
  independently.

Reentrancy-crash guards (the reason this module exists right now):

* ``_format_target_reference`` is wrapped in a broad ``try/except`` so a
  stale point proxy can't escape as a native segfault.
* ``_iter_connected_entities`` wraps each ``connected.item(i)`` access in
  its own ``try`` so one bad item doesn't abort the whole walk.
* ``_hint_dimension`` wraps ``ent.parameter.expression`` access in its
  own ``try`` — newly-created dimension proxies have been observed to
  take Fusion down when the parameter side hasn't settled yet.

None of these change behaviour on the happy path; they just prevent a
mid-recompute selection-change from escalating into a crash.
"""

from entity_helpers import get_fb_name
from entity_util import _get_native, _same_entity


_POINT_TYPES = ('SketchPoint', 'SketchPoint3D', 'SketchPoint2D')


# ---------------------------------------------------------------------------
# Graph traversal — find the curve that owns a shared point, so we can emit
# a role-based ID ("horn_TL:E") rather than a raw coordinate.
# ---------------------------------------------------------------------------

def _iter_connected_entities(pt):
    """Yield the entities connected to a SketchPoint, guarded per-item.

    Fusion's ``SketchPoint.connectedEntities`` is a SketchEntityList
    (``count`` + ``item(i)``). For tests we also accept a plain iterable.

    The per-item ``try/except`` around ``connected.item(i)`` is intentional:
    during a sketch recompute (e.g. the moment a new constraint is being
    added) individual items can be stale proxies whose getter crashes
    Fusion. Swallowing per-item failures keeps the walk alive so the rest
    of the selection still renders.
    """
    connected = getattr(pt, 'connectedEntities', None)
    if connected is None:
        return
    # SketchEntityList style (native Fusion).
    try:
        count = getattr(connected, 'count', None)
        if count is not None:
            for i in range(count):
                try:
                    item = connected.item(i)
                except Exception:
                    continue
                if item:
                    yield item
            return
    except Exception:
        pass
    # Plain iterable (tests).
    try:
        for ent in connected:
            yield ent
    except Exception:
        return


def _derive_point_role_id(pt):
    """Return a FrameBuilder point ID (``"curve_name:S|:E|:C"``) for a
    SketchPoint that participates in a named curve's start/end/center slot,
    or ``None`` if this point isn't owned by any named curve in Fusion.
    """
    for candidate in _iter_connected_entities(pt):
        try:
            parent = _get_native(candidate)
            parent_name = get_fb_name(parent)
            if not parent_name or parent_name.startswith('Sketch') or parent_name.startswith('Vertex of'):
                continue
            if _same_entity(getattr(parent, 'startSketchPoint', None), pt):
                return f'{parent_name}:S'
            if _same_entity(getattr(parent, 'endSketchPoint', None), pt):
                return f'{parent_name}:E'
            if _same_entity(getattr(parent, 'centerSketchPoint', None), pt):
                return f'{parent_name}:C'
        except Exception:
            continue
    return None


def _format_target_reference(ent):
    """Format an entity as an ID-only string literal for use inside a
    Constraints.* / Dimensions.* argument list.

    Unlike ``_format_point_reference`` (used for seed statements, which need
    real coords), this function NEVER emits coord tuples. FrameBuilder's
    constraints and dimensions take IDs like ``"horn_TL"`` or
    ``"horn_TL:E"``. Emitting coords here would either be a no-op (both
    coincident points share the same coords after Fusion settles them) or
    actively wrong at phase-run time.

    The entire body is wrapped in a broad ``try/except`` as the Layer-2
    guard against reentrancy crashes. A stale target proxy that would have
    segfaulted Fusion now returns ``"UnknownTarget"`` and the build
    continues; the user sees a bad target they can hand-edit, not a crashed
    application.
    """
    try:
        if not ent:
            return '"UnknownTarget"'
        ent = _get_native(ent)
        ent_type = getattr(ent, 'objectType', '').split('::')[-1] if hasattr(ent, 'objectType') else ''

        # Point-typed target: prefer the role-based curve-owned ID (horn_TL:E).
        if ent_type in _POINT_TYPES:
            role_id = _derive_point_role_id(ent)
            if role_id:
                return f'"{role_id}"'
            # Standalone SketchPoint with its own FrameBuilder name.
            name = get_fb_name(ent)
            if name and not name.startswith('Sketch') and not name.startswith('Vertex of'):
                return f'"{name}"'
            # No ID derivable — placeholder keeps the emitted statement
            # syntactically valid. User can rename the owning curve and
            # regenerate.
            return f'"{ent_type}"'

        # Non-point entity (line, arc, circle, ellipse, spline) — use its
        # FrameBuilder name.
        name = get_fb_name(ent)
        if name and not name.startswith('Sketch'):
            return f'"{name}"'
        return f'"{ent_type}"' if ent_type else '"Unknown"'
    except Exception:
        return '"UnknownTarget"'


def _constraint_targets(ent, params=None, get_entity_coord_expr_fn=None):
    """Collect the entity targets Fusion hangs off a Constraint or Dimension,
    formatted as ID-only string literals ready for the emitted hint.

    The ``params`` / ``get_entity_coord_expr_fn`` arguments are kept for
    backwards compatibility with call sites, but they're intentionally
    ignored: constraint targets must never carry coordinate expressions.

    Each property access is wrapped in its own ``try`` so one problematic
    property (e.g. ``circleOne`` on a non-circle constraint in a weird
    subclass) can't kill the whole walk.
    """
    targets = []
    # Property-name walk covering every Fusion constraint and dimension
    # subtype. Each Fusion subtype exposes a different set of target slots;
    # we try them all and keep the non-null hits. Order matters because
    # some subtypes expose MORE than one matching name and we want the most
    # specific read first (e.g. ``entityOne`` before the generic ``entity``).
    #
    # CONSTRAINT COVERAGE (Fusion sketch constraint subtypes):
    #   * Coincident             → point, entity           [hybrid pt+any]
    #   * Horizontal / Vertical  → line                    [single]
    #   * HorizontalPoints /
    #     VerticalPoints         → pointOne, pointTwo
    #   * Parallel / Perp /
    #     Collinear              → lineOne, lineTwo
    #   * Equal / Smooth         → curveOne, curveTwo
    #   * Tangent                → curveOne, curveTwo
    #   * MidPoint               → point, line             [hybrid pt+line]
    #   * Concentric             → entityOne, entityTwo
    #   * Symmetry               → entityOne, entityTwo,
    #                              symmetryLine            [3-target]
    #   * Polygon                → centerPoint, cornerPoint
    #
    # DIMENSION COVERAGE (Fusion sketch dimension subtypes):
    #   * Linear / Distance      → entityOne, entityTwo
    #   * Angular                → lineOne, lineTwo
    #   * Radial / Diameter /
    #     Concentric             → entity
    #   * Offset                 → line, entityTwo
    #   * EllipseMajor/MinorRad  → ellipse
    #
    # NOT COVERED (multi-target collections — need dedicated handling if
    # you ever use these): OffsetConstraint (parentCurves, childCurves),
    # CircularPatternConstraint / RectangularPatternConstraint (entities
    # collections). Those will emit with ``/* targets */`` and can be
    # hand-edited in the phase file.
    #
    # ``point`` goes before ``entity`` so a SketchCoincidentConstraint emits
    # ``("the_point_id", "the_anchor_id")`` in the natural reading order.
    for prop_name in ('entityOne', 'entityTwo',
                      'lineOne', 'lineTwo',
                      'curveOne', 'curveTwo',
                      'circleOne', 'circleTwo',
                      'pointOne', 'pointTwo',
                      'centerPoint', 'cornerPoint',
                      'point', 'entity', 'line', 'curve',
                      'symmetryLine', 'ellipse',
                      'midPointCurve'):
        try:
            item = getattr(ent, prop_name, None)
            if item:
                targets.append(_format_target_reference(item))
        except Exception:
            pass
    return targets


# ---------------------------------------------------------------------------
# Public hint builders — one per family.
# ---------------------------------------------------------------------------

def _hint_constraint(ent, ent_type, name, ctx):
    """Emit ``Constraints.<Type>("name", target1, target2, ...)``.

    Constraints carry their own FrameBuilder name (matching the seed and
    dimension convention) so the runtime can identify / look them up
    later. Targets follow the name in positional order.
    """
    targets = _constraint_targets(ent, ctx.get('params'), ctx.get('expr_fn'))
    args = [f'"{name}"']
    if targets:
        args.extend(targets)
    else:
        args.append('/* targets */')
    return f'Constraints.{ent_type}({", ".join(args)})'


def _hint_dimension(ent, ent_type, name, ctx):
    """Emit ``Dimensions.<Type>("name", target1, target2, expression=...)``.

    The ``expression`` read is guarded because newly-created dimension
    proxies have been observed to fault on ``ent.parameter`` access when
    Fusion hasn't finished settling the parameter side of the dimension.
    Swallowing here matches the broader Layer-2 guard philosophy: never
    let a relation-hint build segfault Fusion.
    """
    expr = ''
    try:
        if hasattr(ent, 'parameter') and ent.parameter:
            expr = str(getattr(ent.parameter, 'expression', '') or '')
    except Exception:
        expr = ''
    # Pull out the geometry being measured — reuses the same prop-name walk
    # as _constraint_targets (entityOne/entityTwo/lineOne/lineTwo/entity/
    # circle for radial/diameter dims, etc.).
    targets = _constraint_targets(ent, ctx.get('params'), ctx.get('expr_fn'))
    args = [f'"{name}"']
    args.extend(targets)
    if expr:
        args.append(f'expression="{expr}"')
    return f'Dimensions.{ent_type}({", ".join(args)})'
