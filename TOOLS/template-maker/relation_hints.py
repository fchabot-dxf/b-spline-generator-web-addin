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


# Per-subtype property slots for every Fusion sketch constraint + dimension.
# Both ``_constraint_targets`` (hint emission) and
# ``template_payload.is_framebuilder_owned`` (ownership gate) use this map;
# keeping it in one place prevents them drifting apart — the symptom when
# they drift is "selecting X constraint does nothing in the palette" because
# the gate can't see any targets to inherit ownership from.
#
# Why a per-subtype dispatch instead of a flat walk across every prop name:
# Fusion's C++ layer will native-AV on ``getattr(ent, prop_name)`` for a
# slot that isn't part of the subtype's public surface when the proxy is
# still settling after a rename or new-constraint event. A native AV does
# NOT raise a Python exception — ``try/except`` around the getattr is
# powerless. The only safe approach is to never ask for a slot the subtype
# doesn't own in the first place.
#
# Order within each tuple matters — it's the order targets appear in the
# emitted ``Constraints.<Type>(...)`` call, so the natural reading order
# (point before line, entityOne before entityTwo, etc.) must be preserved.
#
# Subtypes are keyed on the short object-type name
# (``objectType.split('::')[-1]``). ``target_props_for`` below does the
# split so callers can pass the fully-qualified name if they have it.
CONSTRAINT_TARGET_PROPS_BY_TYPE = {
    # --- Constraints --- (Fusion does NOT prefix constraint subtypes
    # with ``Sketch`` — the class name is just ``CoincidentConstraint``
    # etc. under ``adsk::fusion::``. Dimensions DO carry the prefix.)
    'CoincidentConstraint':              ('point', 'entity'),
    'HorizontalConstraint':              ('line',),
    'VerticalConstraint':                ('line',),
    'HorizontalPointsConstraint':        ('pointOne', 'pointTwo'),
    'VerticalPointsConstraint':          ('pointOne', 'pointTwo'),
    'ParallelConstraint':                ('lineOne', 'lineTwo'),
    'PerpendicularConstraint':           ('lineOne', 'lineTwo'),
    'CollinearConstraint':               ('lineOne', 'lineTwo'),
    'EqualConstraint':                   ('curveOne', 'curveTwo'),
    'SmoothConstraint':                  ('curveOne', 'curveTwo'),
    'TangentConstraint':                 ('curveOne', 'curveTwo'),
    'MidPointConstraint':                ('point', 'midPointCurve'),
    'ConcentricConstraint':              ('entityOne', 'entityTwo'),
    'SymmetryConstraint':                ('entityOne', 'entityTwo', 'symmetryLine'),
    'PolygonConstraint':                 ('centerPoint', 'cornerPoint'),

    # --- Dimensions ---
    'SketchLinearDimension':             ('entityOne', 'entityTwo'),
    'SketchAngularDimension':            ('lineOne', 'lineTwo'),
    'SketchRadialDimension':             ('entity',),
    'SketchDiameterDimension':           ('entity',),
    'SketchConcentricCircleDimension':   ('circleOne', 'circleTwo'),
    'SketchOffsetDimension':             ('line', 'entityTwo'),
    'SketchEllipseMajorRadiusDimension': ('ellipse',),
    'SketchEllipseMinorRadiusDimension': ('ellipse',),
}


def target_props_for(ent_type):
    """Return the prop slots Fusion exposes for ``ent_type``.

    ``ent_type`` can be the fully-qualified ``adsk::fusion::XConstraint`` or
    just ``XConstraint`` — either way we key on the short name. Unknown
    subtypes return ``()``; the emitter falls back to ``/* targets */`` and
    the gate counts the entity as un-owned. That's intentional: asking
    Fusion for a slot we don't know the subtype defines is exactly the
    native-AV failure mode this dispatch exists to prevent.
    """
    short = (ent_type or '').split('::')[-1]
    return CONSTRAINT_TARGET_PROPS_BY_TYPE.get(short, ())


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

    We dispatch on ``ent.objectType`` and probe ONLY the slots Fusion
    defines for that subtype — see ``CONSTRAINT_TARGET_PROPS_BY_TYPE``.
    Probing out-of-subtype slots on a settling proxy is a native-AV hazard
    that no Python ``try/except`` can catch.
    """
    targets = []
    ent_type = getattr(ent, 'objectType', '') or ''
    # Subtypes not in the dispatch table (e.g. OffsetConstraint,
    # CircularPatternConstraint — which expose multi-target collections
    # rather than single-slot properties) return an empty tuple from
    # ``target_props_for`` and fall through to the emitter's
    # ``/* targets */`` placeholder. Users can hand-edit those in the phase
    # file; crashing Fusion to "cover" them isn't an acceptable trade.
    for prop_name in target_props_for(ent_type):
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
    """Emit ``Constraints.<Type>(target1, target2, ...)``.

    We intentionally DO NOT prefix a constraint name. Constraints in
    Fusion (at least ``CoincidentConstraint`` in this codebase's
    observed environment) do not support custom attributes at all —
    accessing ``.attributes`` raises ``"3 : object does not support
    attributes"`` — so we can't stamp a ``FrameBuilder.ID`` on them
    to begin with. And because the FrameBuilder runtime only uses
    constraint names for debug display (never for lookup), the name
    adds nothing but complexity here. Emitting target-only keeps the
    sequence block honest: every constraint is identified purely by
    the (already-named) geometry it targets, which is how the runtime
    actually creates it at phase-run time.

    The legacy ``_build_constraint_step`` in ``phase_parser`` already
    handles the no-name shape (see its "every arg is a target" branch)
    so dropping the name here needs no parser-side change.

    ``name`` is kept in the signature so the shared dispatch in
    ``_build_entity_hint`` doesn't need a special-case. Unused here.
    """
    _ = name  # intentionally unused — see docstring
    targets = _constraint_targets(ent, ctx.get('params'), ctx.get('expr_fn'))
    if targets:
        args = list(targets)
    else:
        args = ['/* targets */']
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
