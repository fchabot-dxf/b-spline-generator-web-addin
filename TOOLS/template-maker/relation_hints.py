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
from role_points import ROLE_POINT_SLOTS
# Detection log is imported here purely for probe-level diagnostic
# logging. The function ``_log_detection(None, ...)`` writes to disk
# WITH an fsync per line — that durability guarantee is the whole
# reason we instrument around the fragile Fusion slot probes. If
# Fusion native-AVs mid-getattr, the line BEFORE the crash is the
# last thing that survives on disk, and that tells us exactly which
# slot access died. Plain ``logging`` would lose the tail in the
# native crash; only the fsynced path carries the evidence across
# a hard process kill.
from detection_log import _log_detection
# Shared CC proxy safety canary. Both this module (probe side) and
# ``ownership_gate`` (gate side) need the same entityToken check before
# touching a CoincidentConstraint's hazardous slots; consolidated into
# ``cc_proxy`` so a future edit can't touch one site and forget the
# other. Different ``log_prefix`` per caller keeps crash-log tails
# distinguishable.
from cc_proxy import is_iterated_cc_proxy


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
    #
    # CoincidentConstraint: ('point', 'entity')
    #
    # These slots ARE native-AV hazards on the DIRECT-PICK proxy — the
    # one you get from ``ui.activeSelections.item(i).entity`` when the
    # user clicks a CC glyph. See the log history for 20:40:57,
    # 20:54:05 (RuntimeError: vector too long + delayed repaint death)
    # and 21:02:06 (outright native AV, no Python exception). Reading
    # ``.point`` or ``.entity`` on that proxy remains unsafe.
    #
    # BUT — by the time ``_constraint_targets`` or the ownership gate
    # sees a CoincidentConstraint, it's ALREADY been swapped out.
    # ``template_payload_builder._expand_offset_picks`` runs the
    # ``coincident_hint.find_matching_coincident_constraint`` pre-pass:
    # it walks ``sketch.geometricConstraints`` and distance-matches the
    # picked proxy against the click hit-point Fusion records on the
    # Selection wrapper. The iterated proxy returned by that function
    # has fully-readable ``.point`` / ``.entity`` (confirmed across 8/8
    # iterated reads in the 09:35:30 probe log, zero crashes).
    #
    # So the tuple is safe here IFF upstream swap is in place. If
    # somebody refactors the swap out, this entry needs to revert to
    # ``()`` OR the hit-point-match code needs to move into every
    # caller of target_props_for. The swap-first, targets-second
    # invariant is documented in coincident_hint.py and this comment;
    # do not change one without the other.
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

    The slot map comes from ``role_points.ROLE_POINT_SLOTS`` so the
    rename-side stamper (``rename_selection._stamp_role_points``) and
    this derivation share a single source of truth. The iteration
    order matches the tuple order — an earlier-listed suffix wins if
    a parent curve somehow exposed the same point in two slots at once
    (shouldn't happen in valid sketches, but the deterministic winner
    keeps the result stable).
    """
    for candidate in _iter_connected_entities(pt):
        try:
            parent = _get_native(candidate)
            parent_name = get_fb_name(parent)
            if not parent_name or parent_name.startswith('Sketch') or parent_name.startswith('Vertex of'):
                continue
            for slot_name, suffix in ROLE_POINT_SLOTS:
                if _same_entity(getattr(parent, slot_name, None), pt):
                    return f'{parent_name}{suffix}'
        except Exception:
            continue
    return None


def _get_origin_entity_map():
    """Return ``{'X_AXIS': ax, 'Y_AXIS': ax, 'ORIGIN': pt}`` for the active
    design, or ``{}`` if the design can't be reached.

    Frame Builder's XZ-plane sketch convention — documented alongside
    ``parametric_engine._project_y_axis`` / ``_project_x_axis`` — maps the
    sketch-space tokens to these root construction entities:

        ``X_AXIS``  -> ``rootComponent.xConstructionAxis`` (world X,
                       sketch-horizontal)
        ``Y_AXIS``  -> ``rootComponent.zConstructionAxis`` (world Z,
                       sketch-vertical — NOT yConstructionAxis; that's
                       perpendicular to an XZ sketch plane)
        ``ORIGIN``  -> ``rootComponent.originConstructionPoint``

    The runtime pre-seeds the first two via sketch.project() and
    ``sketch.originPoint`` for the third so ``ctx.resolve_entity`` can do
    a bare-string lookup on ``"X_AXIS"``/``"Y_AXIS"``/``"ORIGIN"`` without
    any ``Projections`` block needing to exist on the phase.

    Any failure (no active product, API slot retired, settling proxy) is
    swallowed and the caller sees an empty dict — no origin-token mapping
    happens and the normal FB-ID resolution path runs unchanged.
    """
    try:
        import adsk.core
        app = adsk.core.Application.get()
        if not app:
            return {}
        product = getattr(app, 'activeProduct', None)
        if not product:
            return {}
        root = getattr(product, 'rootComponent', None)
        if not root:
            return {}
        return {
            'X_AXIS': getattr(root, 'xConstructionAxis', None),
            'Y_AXIS': getattr(root, 'zConstructionAxis', None),
            'ORIGIN': getattr(root, 'originConstructionPoint', None),
        }
    except Exception:
        return {}


def _origin_axis_token(ent):
    """Return the bare sketch-space token for ``ent`` if it references a
    root construction axis or the design origin point — otherwise ``None``.

    Two match paths, evaluated in this order:

    1. **Direct identity.** ``ent`` IS one of the root construction
       entities (``xConstructionAxis``, ``zConstructionAxis``,
       ``originConstructionPoint``). This covers the edge case where the
       user picks the construction entity straight out of the browser
       tree.

    2. **Reference-through.** ``ent`` is a sketch-space proxy
       (``SketchLine`` for a projected axis, ``SketchPoint`` for a
       projected origin) with ``isReference=True`` and a
       ``referencedEntity`` that matches one of the origin entities.
       This is the normal case: ``_project_y_axis`` produces exactly such
       a SketchLine, and origin appears this way on any sketch whose
       origin has been projected implicitly.

    Returns the token string (``'X_AXIS'`` / ``'Y_AXIS'`` / ``'ORIGIN'``)
    which ``_format_target_reference`` wraps in quotes for emission, or
    ``None`` when neither path matches. The whole function is wrapped
    in try/except so a stale proxy that would fault on ``getattr`` just
    returns ``None`` and the caller falls through to normal resolution.
    """
    try:
        if ent is None:
            return None
        native = _get_native(ent)
        if native is None:
            return None
        origin_map = _get_origin_entity_map()
        if not origin_map:
            return None

        # Path 1 — direct identity against a root construction entity.
        for token, origin_ent in origin_map.items():
            if origin_ent is None:
                continue
            if native is origin_ent or _same_entity(native, origin_ent):
                return token

        # Path 2 — reference-through the sketch-space proxy.
        if getattr(native, 'isReference', False):
            ref = getattr(native, 'referencedEntity', None)
            if ref is not None:
                ref_native = _get_native(ref)
                for token, origin_ent in origin_map.items():
                    if origin_ent is None:
                        continue
                    if ref_native is origin_ent or _same_entity(ref_native, origin_ent):
                        return token
    except Exception:
        return None
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

    Origin-axis / origin-point targets get a short-circuit emission as a
    bare ``"X_AXIS"`` / ``"Y_AXIS"`` / ``"ORIGIN"`` token — the runtime's
    ``ctx.resolve_entity`` does a string-key lookup on ``entity_map`` and
    finds the pre-seeded axis proxy for that token. This bypasses the
    FB-ID resolution path entirely, which matters because origin entities
    CAN'T carry ``FrameBuilder.ID`` attributes (they're design-level, not
    sketch-level) and would otherwise fall through to the ``"Unknown"``
    placeholder.

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

        # Origin-axis / origin-point short-circuit — checked BEFORE the
        # point-type branch because the projected-origin case is a
        # SketchPoint whose role_id lookup would fail (no parent curve
        # owns it) and fall through to ``"SketchPoint"`` placeholder.
        origin_token = _origin_axis_token(ent)
        if origin_token:
            return f'"{origin_token}"'

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
    #
    # DIAGNOSTIC INSTRUMENTATION
    # --------------------------
    # The probe-begin / probe-got / probe-raised lines are here to pin
    # down which exact slot dies when Fusion native-AVs mid-rebuild
    # (the Coincident-selection crash chain). Every line goes through
    # ``_log_detection(None, ...)`` which fsyncs per write, so even a
    # hard Fusion kill leaves the last-attempted probe durable on
    # disk. Reading the tail of ``template-maker-detection.log`` after
    # a crash tells us:
    #
    #   * ``[probe-begin] Foo.bar`` with no matching ``[probe-got]`` or
    #     ``[probe-raised]`` = native AV inside ``getattr`` for that slot.
    #     This is the case where no Python exception path exists and
    #     the empty-tuple dispatch in CONSTRAINT_TARGET_PROPS_BY_TYPE is
    #     the only safe fix.
    #   * ``[probe-raised] Foo.bar → RuntimeError: ...`` = Python-catchable
    #     failure. The swallow already handles it; crash must be elsewhere.
    #   * ``[probe-got] Foo.bar → None`` twice = slots unpopulated. Empty
    #     targets are expected; crash must be elsewhere.
    #
    # This block is intentionally verbose for the diagnostic window; once
    # the Coincident crash site is identified we can prune back to the
    # minimum useful coverage.

    # CoincidentConstraint pre-flight — same guard the ownership gate
    # runs, mirrored here because _constraint_targets is an independent
    # probe path that gets called from the emitter side. If
    # ``_expand_offset_picks`` couldn't swap a picked CC proxy for an
    # iterated one (ambiguous junction pick with 3+ stacked glyphs, or
    # no single best match under the 0.5 ratio rule), the picked proxy
    # reaches us here. Reading ``.point`` / ``.entity`` on it raises
    # "vector too long" at the Python level (caught below) but poisons
    # Fusion's internal pointer graph — the next repaint ~4 s later
    # dereferences the corrupted pointer and native-AVs.
    #
    # ``is_iterated_cc_proxy`` does the entityToken canary read. If it
    # returns False, we refuse the probe WITHOUT touching the hazardous
    # slots. Emitter gets an empty target list and falls through to the
    # ``/* targets */`` placeholder — the user can hand-edit that, which
    # is a better failure mode than a crash. The ``probe-cc`` prefix
    # distinguishes this site from the ownership-gate canary (``gate-cc``)
    # in crash-log tails.
    if ent_type.endswith('CoincidentConstraint'):
        if not is_iterated_cc_proxy(ent, log_prefix='probe-cc'):
            return []

    for prop_name in target_props_for(ent_type):
        _log_detection(None, f"[probe-begin] {ent_type}.{prop_name}")
        try:
            item = getattr(ent, prop_name, None)
            _log_detection(
                None,
                f"[probe-got]   {ent_type}.{prop_name} -> "
                f"{type(item).__name__ if item is not None else 'None'}",
            )
            if item:
                targets.append(_format_target_reference(item))
        except Exception as e:
            _log_detection(
                None,
                f"[probe-raised] {ent_type}.{prop_name} -> "
                f"{type(e).__name__}: {e}",
            )
    _log_detection(
        None,
        f"[probe-end]   {ent_type} targets={len(targets)}",
    )
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
