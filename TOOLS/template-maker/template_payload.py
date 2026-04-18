import datetime
import os
import re
import tempfile
from entity_helpers import get_fb_name, get_entity_coord, get_fb_metadata, _get_arc_midpoint
from expression_coords import _format_point_expr

_DEBUG_LOG_PATH = os.path.join(os.path.dirname(__file__), 'template-maker-detection.log')
_SOURCE_LOG_PATH = os.path.join(os.path.dirname(__file__), 'template-maker-debug.log')
_TEMP_LOG_PATH = os.path.join(tempfile.gettempdir(), 'template-maker-detection.log')


def _write_debug_log(message):
    timestamp = datetime.datetime.now().isoformat(sep=' ', timespec='seconds')
    text = f"[{timestamp}] {message}\n"
    for path in (_DEBUG_LOG_PATH, _SOURCE_LOG_PATH, _TEMP_LOG_PATH):
        try:
            with open(path, 'a', encoding='utf-8') as f:
                f.write(text)
        except Exception:
            pass


def _log_detection(logs, message):
    text = str(message)
    if logs is not None:
        logs.append(text)
    _write_debug_log(text)


def _get_native(ent):
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            return ent.nativeObject
    except Exception:
        pass
    return ent


def _label_for_entity(ent):
    ent = _get_native(ent)
    if not ent:
        return 'Unknown'
    label = get_fb_name(ent)
    if label and not label.startswith('Sketch'):
        return label
    return ent.objectType.split('::')[-1]


def _strip_point_prefix(expr):
    if not expr:
        return ''
    if expr.startswith('Point:'):
        return expr[len('Point:'):].strip()
    return expr


def _call_entity_coord_expr_fn(get_entity_coord_expr_fn, ent, params=None):
    if not get_entity_coord_expr_fn:
        return ''
    try:
        return get_entity_coord_expr_fn(ent, params)
    except TypeError:
        try:
            return get_entity_coord_expr_fn(ent)
        except Exception:
            return ''
    except Exception:
        return ''


BUILTIN_TEMPLATE_VARIABLES = {'widthIn', 'heightIn'}


def _parse_expression_tokens(expr):
    if not expr:
        return []
    # Drop content inside quoted strings before token-scanning so entity IDs
    # like "horn_TL" (which appear inside Seeds.Line("horn_TL", ...)) don't
    # get mistaken for variables.
    stripped = re.sub(r'"[^"]*"|\'[^\']*\'', '', expr)
    tokens = re.findall(r'\b[A-Za-z_][A-Za-z0-9_]*\b', stripped)
    exclude = {
        'Point', 'Seeds', 'Arc', 'Line', 'Constraints', 'Dimensions',
        'center', 'start', 'end', 'SketchPoint', 'SketchLine', 'SketchArc',
        'SketchPoint3D', 'SketchPoint2D', 'centerSketchPoint', 'startSketchPoint',
        'endSketchPoint', 'geometry', 'ctx', 'sketch', 'plan', 'True', 'False',
        'cm', 'mm', 'in', 'math'
    }
    result = []
    for token in tokens:
        if token in exclude or token in BUILTIN_TEMPLATE_VARIABLES:
            continue
        if token.isdigit():
            continue
        if token.startswith('Point') or token.startswith('Sketch'):
            continue
        if token in result:
            continue
        result.append(token)
    return result


def _collect_design_variables(logs=None, get_design_params_fn=None):
    params = (get_design_params_fn() if get_design_params_fn else {}) or {}
    variables = []
    for name, info in params.items():
        if name in BUILTIN_TEMPLATE_VARIABLES:
            continue
        expr = info.get('expression') or ''
        if not expr:
            expr = str(info.get('value', '')).strip()
        if expr:
            variables.append({
                'name': name,
                'expression': expr,
                'enabled': True,
                'source': 'design'
            })
    if logs is not None:
        _log_detection(logs, f"Detected {len(variables)} design parameters")
    return variables


def _merge_variables(primary, secondary):
    seen = set()
    merged = []
    for variable in primary + secondary:
        name = variable.get('name')
        if not name or name in seen:
            continue
        merged.append(variable)
        seen.add(name)
    return merged


def _collect_variables(entities, code_text='', logs=None, params=None, get_entity_coord_expr_fn=None, build_entity_hint_fn=None, valid_names=None):
    """Scan selection-derived expressions/hints for variable-name tokens.

    If ``valid_names`` is provided (e.g. the set of real Fusion user
    parameters minus built-ins), tokens are accepted only if they appear in
    that whitelist. That prevents entity IDs and stray identifiers (e.g.
    the 'radius' in 'radius=2.8255') from leaking into the T1 vars block.
    """
    names = []

    def add_tokens(expr, source):
        expr = expr or ''
        tokens = _parse_expression_tokens(expr)
        if tokens:
            _log_detection(logs, f"Detected tokens from {source}: {tokens}")
        for token in tokens:
            if valid_names is not None and token not in valid_names:
                continue
            if token not in names:
                names.append(token)

    for i, ent in enumerate(entities):
        ent = _get_native(ent)
        expr = _strip_point_prefix(_call_entity_coord_expr_fn(get_entity_coord_expr_fn, ent, params)) if get_entity_coord_expr_fn else ''
        add_tokens(expr, f'selection[{i}] expr')

        hint = build_entity_hint_fn(ent, params) if build_entity_hint_fn else ''
        add_tokens(hint, f'selection[{i}] hint')

    if code_text:
        add_tokens(code_text, 'code_text')

    variables = []
    for name in names:
        variables.append({
            'name': name,
            'expression': name,
            'enabled': True
        })
    _log_detection(logs, f"Collected variable names: {names}")
    return variables


_POINT_TYPES = ('SketchPoint', 'SketchPoint3D', 'SketchPoint2D')


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


def _same_entity(a, b):
    """Best-effort identity check that works for both Fusion API proxies and
    the plain Python objects used in tests. Fusion proxies may not be
    ``is``-identical across fetches of the same underlying entity but should
    compare equal via ``==`` (which delegates to the internal entity token).
    """
    if a is b:
        return True
    try:
        return a == b
    except Exception:
        return False


def _iter_connected_entities(pt):
    """Yield the entities connected to a SketchPoint.

    Fusion's ``SketchPoint.connectedEntities`` is a SketchEntityList
    (``count`` + ``item(i)``). For tests we also accept a plain iterable.
    """
    connected = getattr(pt, 'connectedEntities', None)
    if connected is None:
        return
    # SketchEntityList style.
    try:
        count = getattr(connected, 'count', None)
        if count is not None:
            for i in range(count):
                yield connected.item(i)
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
    """Return a Frame Builder point ID (``"curve_name:S|:E|:C"``) for a
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
    real coords), this function NEVER emits coord tuples. Frame Builder's
    constraints and dimensions take IDs like ``"horn_TL"`` or
    ``"horn_TL:E"``. Emitting coords here would either be a no-op (both
    coincident points share the same coords after Fusion settles them) or
    actively wrong at phase-run time.
    """
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
        # No ID derivable — placeholder keeps the emitted statement syntactically
        # valid. User can rename the owning curve and regenerate.
        return f'"{ent_type}"'

    # Non-point entity (line, arc, circle, ellipse, spline) — use its FB name.
    name = get_fb_name(ent)
    if name and not name.startswith('Sketch'):
        return f'"{name}"'
    return f'"{ent_type}"' if ent_type else '"Unknown"'


def _constraint_targets(ent, params=None, get_entity_coord_expr_fn=None):
    """Collect the entity targets Fusion hangs off a Constraint or Dimension,
    formatted as ID-only string literals ready for the emitted hint.

    The ``params`` / ``get_entity_coord_expr_fn`` arguments are kept for
    backwards compatibility with call sites, but they're intentionally
    ignored: constraint targets must never carry coordinate expressions.
    """
    targets = []
    # ``point`` goes before ``entity`` so a SketchCoincidentConstraint emits
    # ``("the_point_id", "the_anchor_id")`` in the natural reading order.
    for prop_name in ('entityOne', 'entityTwo', 'lineOne', 'lineTwo',
                      'circleOne', 'circleTwo', 'pointOne', 'pointTwo',
                      'point', 'entity', 'line', 'curve'):
        try:
            item = getattr(ent, prop_name, None)
            if item:
                targets.append(_format_target_reference(item))
        except Exception:
            pass
    return targets


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


def _hint_constraint(ent, ent_type, name, ctx):
    # Constraints carry their own FrameBuilder name (matching the seed and
    # dimension convention) so the runtime can identify / look them up
    # later. Targets follow the name in positional order.
    targets = _constraint_targets(ent, ctx['params'], ctx['expr_fn'])
    args = [f'"{name}"']
    if targets:
        args.extend(targets)
    else:
        args.append('/* targets */')
    return f'Constraints.{ent_type}({", ".join(args)})'


def _hint_dimension(ent, ent_type, name, ctx):
    expr = ''
    try:
        if hasattr(ent, 'parameter') and ent.parameter:
            expr = str(getattr(ent.parameter, 'expression', '') or '')
    except Exception:
        expr = ''
    # Pull out the geometry being measured — reuses the same prop-name walk
    # as _constraint_targets (entityOne/entityTwo/lineOne/lineTwo/entity/
    # circle for radial/diameter dims, etc.).
    targets = _constraint_targets(ent, ctx['params'], ctx['expr_fn'])
    args = [f'"{name}"']
    args.extend(targets)
    if expr:
        args.append(f'expression="{expr}"')
    return f'Dimensions.{ent_type}({", ".join(args)})'


def _build_entity_hint(ent, params=None, get_entity_coord_expr_fn=None, name_override=None):
    ent = _get_native(ent)
    ent_type = ent.objectType.split('::')[-1] if hasattr(ent, 'objectType') else 'Entity'
    name = name_override if name_override else _label_for_entity(ent)
    ctx = {'params': params, 'expr_fn': get_entity_coord_expr_fn}

    handler = _SHAPE_HINT_HANDLERS.get(ent_type)
    if handler is not None:
        return handler(ent, name, ctx)

    # Constraints and dimensions are matched by substring — Fusion emits a
    # zoo of subtypes (HorizontalConstraint, PerpendicularConstraint,
    # SketchLinearDimension, SketchRadialDimension...) that all route through
    # a single family handler.
    if 'Constraint' in ent_type:
        return _hint_constraint(ent, ent_type, name, ctx)
    if 'Dimension' in ent_type:
        return _hint_dimension(ent, ent_type, name, ctx)

    return f'# {ent_type}("{name}")'
