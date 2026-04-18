"""Parse generated statements (``Seeds.*``, ``Constraints.*``, ``Dimensions.*``)
into Frame Builder phase-step dicts.

The parser is dispatch-based: each shape, constraint family, and dimension
family has its own small builder registered in ``_SEED_HANDLERS`` /
``_DIM_HANDLERS``. Adding a new seed (say ``Seeds.Polygon``) is a matter of
writing one small function and registering it — no edits to a monolithic
``_build_geometry_step`` required.
"""

import re


class RawCode:
    def __init__(self, code):
        self.code = code

    def __repr__(self):
        return self.code


class LiteralString:
    def __init__(self, value):
        self.value = value

    def __repr__(self):
        return repr(self.value)


# ---------------------------------------------------------------------------
# Argument-string tokenisation
# ---------------------------------------------------------------------------

def _split_top_level_arguments(arg_string):
    args = []
    depth = 0
    current = ''
    for char in arg_string:
        if char == ',' and depth == 0:
            args.append(current.strip())
            current = ''
            continue
        current += char
        if char in '([{':
            depth += 1
        elif char in ')]}':
            depth -= 1
    if current.strip():
        args.append(current.strip())
    return args


def _is_quoted_string(value):
    return isinstance(value, str) and ((value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")))


def _unquote(value):
    if _is_quoted_string(value):
        return value[1:-1]
    return value


def _parse_point_tuple(raw_expr):
    """Split a ``(x, y)`` or ``[x, y]`` coordinate into a list of
    ``LiteralString`` components.

    The canonical phase-file Points format is a list-of-list-of-strings
    (e.g. ``[['widthIn * 0.1', 'heightIn * 0.2']]``); the runtime reads each
    string and evaluates it with ``widthIn`` / ``heightIn`` in scope. Earlier
    drafts wrapped each coordinate as a single ``RawCode`` tuple, which
    rendered as raw Python tuples ``(widthIn * 0.1, heightIn * 0.2)`` and
    broke import because ``widthIn`` isn't a module-level symbol.

    ``LiteralString`` wrapping ensures ``_format_raw_value`` emits the
    expression *inside* quotes so the eval happens later, at phase-run time.
    """
    if not isinstance(raw_expr, str):
        return []
    s = raw_expr.strip()
    if (s.startswith('(') and s.endswith(')')) or (s.startswith('[') and s.endswith(']')):
        s = s[1:-1]
    parts = _split_top_level_arguments(s)
    return [LiteralString(p.strip()) for p in parts if p.strip()]


def _split_kw_and_positional(args):
    """Split a list of raw argument strings into (positional, kw_dict).

    A fragment is treated as a keyword if it contains exactly one ``=``
    *outside of any nested parens/brackets*. This matters for arguments like
    ``center=(x, y)`` (one kw), ``[(1,2), (3,4)]`` (positional list), and
    bare tuple targets ``(widthIn, 0)`` (positional).
    """
    positional = []
    kw = {}
    for arg in args:
        key = _extract_kw_key(arg)
        if key is not None:
            _, _, val = arg.partition('=')
            kw[key] = val.strip()
        else:
            positional.append(arg)
    return positional, kw


def _extract_kw_key(arg):
    """Return the keyword name if ``arg`` is a top-level ``key=value``, else None."""
    depth = 0
    for i, ch in enumerate(arg):
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth = max(0, depth - 1)
        elif ch == '=' and depth == 0:
            head = arg[:i].strip()
            if head and re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', head):
                return head
            return None
    return None


# ---------------------------------------------------------------------------
# Step rendering
# ---------------------------------------------------------------------------

def _format_raw_value(value):
    if isinstance(value, RawCode):
        return value.code
    if isinstance(value, LiteralString):
        return repr(value.value)
    if isinstance(value, dict):
        items = [f"'{k}': {_format_raw_value(v)}" for k, v in value.items()]
        return '{' + ', '.join(items) + '}'
    if isinstance(value, list):
        return '[' + ', '.join(_format_raw_value(v) for v in value) + ']'
    if isinstance(value, str):
        if _is_quoted_string(value):
            return value
        return repr(value)
    return repr(value)


def _format_step_dict(step):
    if not step:
        return '    # Unsupported step'
    fields = [f"'{k}': {_format_raw_value(v)}" for k, v in step.items()]
    return '    {' + ', '.join(fields) + '},'


def format_phase_step(step):
    return _format_step_dict(step)


# ---------------------------------------------------------------------------
# Shared helper — every seed builder starts with name + (positional, kw).
# ---------------------------------------------------------------------------

def _parse_seed_common(args):
    if not args:
        return None, [], {}
    name = _unquote(args[0].strip())
    positional, kw = _split_kw_and_positional(args[1:])
    return name, positional, kw


# ---------------------------------------------------------------------------
# Individual seed builders (one per shape)
# ---------------------------------------------------------------------------

def _build_line_step(args):
    name, positional, _ = _parse_seed_common(args)
    if not name or len(positional) < 2:
        return None
    return {
        'ID': LiteralString(name),
        'Type': LiteralString('Line'),
        'Points': [_parse_point_tuple(positional[0]), _parse_point_tuple(positional[1])],
        'StartID': LiteralString(f'{name}:S'),
        'EndID': LiteralString(f'{name}:E'),
    }


def _build_arc_step(args):
    """Build a phase step for ``Seeds.Arc``.

    Two shapes are accepted:

    * **Current (correct)** — three positional points ON the curve:
      ``Seeds.Arc("name", start, mid, end)``. This matches the runtime's
      ``sketchArcs.addByThreePoints`` exactly; all three points must lie on
      the arc. The center is auto-tagged ``"{name}:C"`` at runtime.

    * **Legacy** — two positional points plus ``center=`` kwarg:
      ``Seeds.Arc("name", start, end, center=c)``. The template-maker no
      longer emits this form because it produces geometrically wrong arcs
      (center isn't a curve point). It's accepted here only so existing
      hand-written templates still parse.
    """
    name, positional, kw = _parse_seed_common(args)
    if not name:
        return None

    base_step = {
        'ID': LiteralString(name),
        'Type': LiteralString('Arc3Point'),
        'StartID': LiteralString(f'{name}:S'),
        'EndID': LiteralString(f'{name}:E'),
        'CenterID': LiteralString(f'{name}:C'),
    }

    if len(positional) >= 3:
        base_step['Points'] = [
            _parse_point_tuple(positional[0]),
            _parse_point_tuple(positional[1]),
            _parse_point_tuple(positional[2]),
        ]
        return base_step

    if len(positional) >= 2:
        center = kw.get('center')
        base_step['Points'] = [
            _parse_point_tuple(positional[0]),
            _parse_point_tuple(center or positional[1]),
            _parse_point_tuple(positional[1]),
        ]
        radius = kw.get('radius')
        if radius:
            base_step['Radius'] = RawCode(radius)
        return base_step

    return None


def _build_circle_step(args):
    name, _positional, kw = _parse_seed_common(args)
    if not name:
        return None
    step = {
        'ID': LiteralString(name),
        'Type': LiteralString('Circle'),
        'CenterID': LiteralString(f'{name}:C'),
    }
    if 'center' in kw:
        step['Center'] = RawCode(kw['center'])
    if 'radius' in kw:
        step['Radius'] = RawCode(kw['radius'])
    return step


def _build_ellipse_step(args):
    name, _positional, kw = _parse_seed_common(args)
    if not name:
        return None
    step = {
        'ID': LiteralString(name),
        'Type': LiteralString('Ellipse'),
        'CenterID': LiteralString(f'{name}:C'),
    }
    for src, dst in (('center', 'Center'),
                     ('majorRadius', 'MajorRadius'),
                     ('minorRadius', 'MinorRadius'),
                     ('angleDeg', 'AngleDeg')):
        if src in kw:
            step[dst] = RawCode(kw[src])
    return step


def _build_spline_step_factory(seed_type):
    """Return a handler that emits a spline step for the given Fusion subtype."""

    def handler(args):
        name, positional, kw = _parse_seed_common(args)
        if not name:
            return None
        # First positional that starts with '[' is the point list.
        pts_arg = next((a for a in positional if a.startswith('[')), None)
        points = []
        if pts_arg:
            inner = pts_arg.strip()
            if inner.startswith('[') and inner.endswith(']'):
                inner = inner[1:-1]
            for piece in _split_top_level_arguments(inner):
                if piece:
                    points.append(_parse_point_tuple(piece))
        step = {
            'ID': LiteralString(name),
            'Type': LiteralString(seed_type),
            'Points': points,
        }
        if 'degree' in kw:
            step['Degree'] = RawCode(kw['degree'])
        return step

    return handler


_SEED_HANDLERS = {
    'Line':                 _build_line_step,
    'Arc':                  _build_arc_step,
    'Circle':               _build_circle_step,
    'Ellipse':              _build_ellipse_step,
    'FittedSpline':         _build_spline_step_factory('FittedSpline'),
    'ControlPointSpline':   _build_spline_step_factory('ControlPointSpline'),
    'FixedSpline':          _build_spline_step_factory('FixedSpline'),
}


def _build_geometry_step(seed_type, args):
    handler = _SEED_HANDLERS.get(seed_type)
    if handler is None:
        return None
    return handler(args)


# ---------------------------------------------------------------------------
# Constraints
# ---------------------------------------------------------------------------

def _build_constraint_step(constraint_type, args):
    """Parse ``Constraints.<Type>(target1, target2, ...)`` into a phase step.

    Constraints carry no name — every positional argument is a target ID.
    This is a deliberate architectural choice, not a parser shortcut:

    * Fusion's C++ layer refuses ``.attributes`` access on several
      constraint subtypes (``CoincidentConstraint`` is the observed
      offender), so we can't stamp a FrameBuilder ID on them even if we
      wanted to.
    * The FrameBuilder runtime only ever used constraint names for debug
      output — it never looks a constraint up by name. Creation is
      target-driven (``addPerpendicular(lineA, lineB)``) and the target
      tuple uniquely identifies the relationship.
    * The old "first quoted arg = name, rest = targets" heuristic
      collapses the moment any real constraint hint is emitted, because
      *every* target is itself a quoted ID string (``"horn_TL"``). Trying
      to dual-shape this parser produced phase steps where the first
      target was swallowed into a ``Name`` field and only the remainder
      survived as targets — exactly the bug this removal fixes.

    Hand-written phase files that still carry a legacy name as the first
    arg (``Constraints.X("name", lineA, lineB)``) will now surface that
    quoted name as a target, which the runtime will correctly flag as an
    unknown entity. The fix is to delete the name from the hand-written
    statement; the parser does not try to cover for that mistake.
    """
    cleaned = [arg.strip() for arg in args if arg.strip()]
    targets = [RawCode(arg) for arg in cleaned]
    return {
        'Type': LiteralString(constraint_type),
        'Targets': targets,
    }


# ---------------------------------------------------------------------------
# Offsets — dedicated step builder, distinct from generic constraints.
# ---------------------------------------------------------------------------

def _parse_string_list(raw):
    """Parse ``["a", "b", "c"]`` into a list of unquoted Python strings.

    Used for the source and target lists in an ``Offset.From(...)`` hint.
    Items that aren't quoted are kept as-is (they'll round-trip through
    ``_format_raw_value`` as repr-wrapped strings, which still produces
    valid Python at phase-run time).
    """
    if not isinstance(raw, str):
        return []
    s = raw.strip()
    if s.startswith('[') and s.endswith(']'):
        s = s[1:-1]
    out = []
    for piece in _split_top_level_arguments(s):
        piece = piece.strip()
        if not piece:
            continue
        out.append(_unquote(piece))
    return out


def _build_offset_step(args):
    """Parse ``Offset.From([sources], distance="expr", targets=[...])`` into a
    ``{'Type': 'Offset', 'SourceID': [...], 'DistanceExpr': ..., 'TargetIDs': [...]}``
    step dict.

    The runtime's ``fb_engine/offsets.py:offset_step`` reads exactly these
    three slots (plus optional ``Direction`` and ``CornerIDs`` that the
    Template Maker doesn't emit — ``addOffset2`` takes direction from the
    sign of ``DistanceExpr`` and corner naming is a downstream hand-edit).

    Missing sources or targets yields ``None`` rather than a partial step
    so the code-preview skip-on-None path drops the broken hint silently
    rather than writing a syntactically-valid but semantically-empty
    offset entry.
    """
    if not args:
        return None
    positional, kw = _split_kw_and_positional(args)
    sources_raw = positional[0] if positional else kw.get('sources')
    if sources_raw is None:
        return None
    sources = _parse_string_list(sources_raw)
    if not sources:
        return None
    distance = kw.get('distance')
    if distance is None:
        return None
    targets_raw = kw.get('targets')
    if targets_raw is None:
        return None
    targets = _parse_string_list(targets_raw)

    step = {
        'Type': LiteralString('Offset'),
        'SourceID': [LiteralString(s) for s in sources],
        'DistanceExpr': LiteralString(_unquote(distance)) if _is_quoted_string(distance) else RawCode(distance),
        'TargetIDs': [LiteralString(t) for t in targets],
    }
    return step


# ---------------------------------------------------------------------------
# Dimensions
# ---------------------------------------------------------------------------

# Short names kept for backwards-compatibility with hand-written statements.
# Fusion emits long-form types (e.g. SketchRadialDimension) so we normalize.
_RADIAL_DIM_TYPES = {
    'Radius', 'Diameter',
    'SketchRadialDimension', 'SketchDiameterDimension',
}


def _build_dimension_step(dimension_type, args):
    if not args:
        return None
    name = _unquote(args[0].strip())
    positional, kw = _split_kw_and_positional(args[1:])
    targets = positional

    # Accept ``value=`` as an alias for ``expression=`` — the generator used
    # to emit ``value=`` before the dimension handler was fleshed out.
    expression = kw.get('expression') or kw.get('value')
    orientation = kw.get('orientation')

    step = {
        'Name': LiteralString(name),
        'DimType': LiteralString(dimension_type),
    }
    if expression:
        if _is_quoted_string(expression):
            step['Expression'] = LiteralString(expression[1:-1])
        else:
            step['Expression'] = RawCode(expression)
    if orientation:
        step['Orientation'] = LiteralString(orientation)

    if dimension_type in _RADIAL_DIM_TYPES:
        if targets:
            step['Target'] = RawCode(targets[0])
        return step

    if len(targets) >= 2:
        step['Targets'] = [RawCode(targets[0]), RawCode(targets[1])]
        return step

    # Targets may be absent — emit the step anyway so the dimension doesn't
    # disappear into a dropped comment. The user can fill targets downstream.
    return step


# ---------------------------------------------------------------------------
# Top-level dispatch: statement-in, step-out
# ---------------------------------------------------------------------------

def parse_statement_to_phase_step(statement):
    if not statement or '(' not in statement:
        return None
    head, rest = statement.split('(', 1)
    rest = rest.rsplit(')', 1)[0]
    args = _split_top_level_arguments(rest)
    if head.startswith('Seeds.'):
        seed_type = head.split('.', 1)[1]
        return _build_geometry_step(seed_type, args)
    if head.startswith('Constraints.'):
        constraint_type = head.split('.', 1)[1]
        return _build_constraint_step(constraint_type, args)
    if head.startswith('Offset.'):
        # Only ``Offset.From`` exists today — the subtype tail is unused and
        # kept as an extension hook for future forms like ``Offset.By``.
        return _build_offset_step(args)
    if head.startswith('Dimensions.'):
        dimension_type = head.split('.', 1)[1]
        return _build_dimension_step(dimension_type, args)
    return None
