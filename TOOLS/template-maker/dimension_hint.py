"""Convention-enforcing wrapper for dimension hint emission.

Dimensions have a quirk the constraint path doesn't: the step's ``Name``
field ends up written onto ``dim.parameter.name`` by the runtime (see
``fb_engine/dimensions.py`` — the rename happens as a side-effect of
creating and linking the dim to its expression). That means dim-entity
names share a namespace with Fusion's user parameters — if a dim is
named ``widthIn`` and a user parameter called ``widthIn`` already exists,
Fusion refuses the rename OR silently auto-suffixes, either way making
the dim's identity unpredictable.

This module enforces two rules to keep the two namespaces cleanly
separated:

1. **``Name`` (dim-entity identity)** must not collide with any existing
   user-parameter name. If the raw FrameBuilder tag would collide,
   prepend ``dim_`` so the final Name lives in its own namespace. A
   detection-log warning flags every substitution so the user can see
   what happened.

2. **``Expression`` (value source)** is passed through unchanged — it's
   a reference into user-parameter-land and should read the raw
   parameter name (``widthIn``, ``hornOffset``, ``radius``). No prefix,
   no decoration.

With both rules in place the generated step reads::

    {'Name':       'dim_body_width',        # unique in parameter namespace
     'DimType':    'SketchLinearDimension',
     'Expression': 'widthIn',               # references existing user param
     'Targets':    ['point_A', 'point_B']}

``delete_dimension_by_name('dim_body_width')`` can then find that dim
unambiguously because no other parameter shares the tag.

The mechanical target walk is still owned by ``relation_hints`` —
``_constraint_targets`` is imported here to read each dim subtype's
entityOne/entityTwo/entity/lineOne/lineTwo slots safely through the
per-subtype property map. All this module adds on top is the
validate-and-rename layer.
"""

from detection_log import _log_detection


DIM_NAME_PREFIX = 'dim_'


def _current_user_param_names():
    """Return the set of user-parameter names currently in the design.

    Import is done lazily and the lookup is catch-all wrapped so tests
    that stub ``get_design_params`` on ``expression_coords`` still see
    their patched function (a module-level import would cache the
    original reference before the patch lands).
    """
    try:
        from expression_coords import get_design_params
        params = get_design_params() or {}
        return set(params.keys())
    except Exception:
        return set()


def derive_dim_identity(raw_name, user_param_names):
    """Return a Name that won't collide with any user parameter.

    Rule:
      * If ``raw_name`` is distinct from every user-param name, keep it.
        This is the happy path — the user (or Rename Selection) picked
        a tag that already lives outside parameter-namespace.
      * If it would collide, prepend ``dim_``. Most raw tags like
        ``widthIn`` become ``dim_widthIn``, which is stable because a
        user parameter starting with ``dim_`` is virtually unheard of.
      * If ``dim_<raw>`` *also* collides (pathological case — user has
        a param literally named ``dim_widthIn``), suffix with ``_x`` to
        break the tie. Not clever; the user will spot the ``_x`` and
        rename the offending parameter.

    The function is pure — no I/O, no side effects. The caller is
    responsible for logging the substitution.
    """
    if raw_name not in user_param_names:
        return raw_name
    prefixed = f'{DIM_NAME_PREFIX}{raw_name}'
    if prefixed not in user_param_names:
        return prefixed
    return f'{prefixed}_x'


def check_and_resolve_name(raw_name, logger=None):
    """Resolve a dim's emitted Name, logging any collision it had to fix.

    Wraps ``derive_dim_identity`` with the user-param fetch and the
    detection-log warning. Returns the resolved Name string.

    ``logger`` defaults to ``_log_detection`` but can be overridden in
    tests or when called from a path that collects its own logs list.
    Passing ``None`` suppresses logging entirely.
    """
    user_params = _current_user_param_names()
    resolved = derive_dim_identity(raw_name, user_params)
    if resolved != raw_name and logger is not None:
        logger(
            None,
            f"DIM NAME COLLISION: '{raw_name}' matches an existing user "
            f"parameter — renamed to '{resolved}' to keep the dim's "
            f"identity in its own namespace.",
        )
    return resolved


def _dim_expression(ent):
    """Read ``ent.parameter.expression`` with the reentrancy guard.

    Newly-created dimension proxies have been observed to fault on
    ``.parameter`` access when Fusion hasn't finished settling the
    parameter side — the same trap the existing ``_hint_dimension``
    handler guards against. Repeated here because ``_hint_dimension``
    is no longer the entry point once ``_build_entity_hint`` routes
    dims through this module.
    """
    try:
        if hasattr(ent, 'parameter') and ent.parameter:
            return str(getattr(ent.parameter, 'expression', '') or '')
    except Exception:
        pass
    return ''


def build_dimension_hint(ent, ent_type, name, ctx):
    """Emit ``Dimensions.<Type>("<resolved_name>", targets..., expression="<expr>")``.

    Matches the shape ``relation_hints._hint_dimension`` emits today;
    the only difference is that ``name`` is run through
    ``check_and_resolve_name`` first so a colliding tag gets rewritten
    before it lands in the step's ``Name`` field.

    Target walk is delegated to ``_constraint_targets`` unchanged —
    the per-subtype slot map (``entityOne`` / ``entityTwo`` / ``entity``
    / ``lineOne`` / ``lineTwo`` / ``circleOne`` / ``circleTwo`` /
    ``ellipse``) is the authoritative source of truth and lives next
    to the ownership gate that depends on the same map.
    """
    # Lazy import breaks the otherwise-circular dependency:
    # relation_hints is imported by template_payload, and template_payload
    # imports this module via its dimension dispatch branch.
    from relation_hints import _constraint_targets

    resolved_name = check_and_resolve_name(name, logger=_log_detection)

    expr = _dim_expression(ent)
    targets = _constraint_targets(ent, ctx.get('params'), ctx.get('expr_fn'))

    args = [f'"{resolved_name}"']
    args.extend(targets)
    if expr:
        args.append(f'expression="{expr}"')
    # Linear dims need explicit orientation in the hint so
    # ``phase_parser._normalize_dim_type`` can route them to the engine's
    # distinct ``HorizontalDistance`` / ``VerticalDistance`` whitelist
    # entries. Defaults to omitting the kwarg when the orientation can't
    # be read — the normalizer falls back to Horizontal in that case,
    # matching ``_create_dimension`` runtime behavior.
    if ent_type == 'SketchLinearDimension':
        try:
            import adsk.fusion
            orient = getattr(ent, 'orientation', None)
            if orient == adsk.fusion.DimensionOrientations.VerticalDimensionOrientation:
                args.append('orientation="Vertical"')
            elif orient == adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation:
                args.append('orientation="Horizontal"')
        except Exception:
            pass
    return f'Dimensions.{ent_type}({", ".join(args)})'
