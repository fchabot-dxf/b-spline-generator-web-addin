import datetime
import os
import re
import tempfile
from entity_helpers import get_fb_name, get_entity_coord, get_fb_metadata

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


def _parse_expression_tokens(expr):
    if not expr:
        return []
    tokens = re.findall(r'\b[A-Za-z_][A-Za-z0-9_]*\b', expr)
    exclude = {
        'Point', 'Seeds', 'Arc', 'Line', 'Constraints',
        'center', 'start', 'end', 'SketchPoint', 'SketchLine', 'SketchArc',
        'SketchPoint3D', 'SketchPoint2D', 'centerSketchPoint', 'startSketchPoint',
        'endSketchPoint', 'geometry', 'ctx', 'sketch', 'plan', 'True', 'False',
        'cm', 'mm', 'in', 'math'
    }
    result = []
    for token in tokens:
        if token in exclude:
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


def _collect_variables(entities, code_text='', logs=None, params=None, get_entity_coord_expr_fn=None, build_entity_hint_fn=None):
    names = []

    def add_tokens(expr, source):
        expr = expr or ''
        tokens = _parse_expression_tokens(expr)
        if tokens:
            _log_detection(logs, f"Detected tokens from {source}: {tokens}")
        for token in tokens:
            if token not in names:
                names.append(token)

    for i, ent in enumerate(entities):
        ent = _get_native(ent)
        expr = _strip_point_prefix(get_entity_coord_expr_fn(ent, params)) if get_entity_coord_expr_fn else ''
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


def _format_point_reference(pt, params=None, get_entity_coord_expr_fn=None):
    if not pt:
        return 'UnknownPoint'
    pt = _get_native(pt)
    name = get_fb_name(pt)
    if name and not name.startswith('Sketch'):
        return f'"{name}"'
    expr = _strip_point_prefix(get_entity_coord_expr_fn(pt, params)) if get_entity_coord_expr_fn else ''
    if expr:
        return expr
    coord = _strip_point_prefix(get_entity_coord(pt))
    if coord:
        return coord
    return 'Point(...)'


def _constraint_targets(ent, params=None, get_entity_coord_expr_fn=None):
    targets = []
    for prop_name in ('entityOne', 'entityTwo', 'lineOne', 'lineTwo', 'circleOne', 'circleTwo', 'pointOne', 'pointTwo', 'entity', 'line', 'curve'):
        try:
            item = getattr(ent, prop_name, None)
            if item:
                targets.append(_format_point_reference(item, params, get_entity_coord_expr_fn))
        except Exception:
            pass
    return targets


def _build_entity_hint(ent, params=None, get_entity_coord_expr_fn=None):
    ent = _get_native(ent)
    ent_type = ent.objectType.split('::')[-1] if hasattr(ent, 'objectType') else 'Entity'
    name = _label_for_entity(ent)
    if ent_type in ('SketchPoint', 'SketchPoint3D', 'SketchPoint2D'):
        coord = _strip_point_prefix(get_entity_coord_expr_fn(ent, params)) if get_entity_coord_expr_fn else ''
        coord = coord or get_entity_coord(ent)
        return f'Seeds.Point("{name}", {coord})' if coord else f'Seeds.Point("{name}", x, y)'

    if ent_type == 'SketchLine':
        start_ref = _format_point_reference(getattr(ent, 'startSketchPoint', None), params, get_entity_coord_expr_fn)
        end_ref = _format_point_reference(getattr(ent, 'endSketchPoint', None), params, get_entity_coord_expr_fn)
        return f'Seeds.Line("{name}", {start_ref}, {end_ref})'

    if ent_type == 'SketchArc':
        start_ref = _format_point_reference(getattr(ent, 'startSketchPoint', None), params, get_entity_coord_expr_fn)
        end_ref = _format_point_reference(getattr(ent, 'endSketchPoint', None), params, get_entity_coord_expr_fn)
        center_ref = _format_point_reference(getattr(ent, 'centerSketchPoint', None), params, get_entity_coord_expr_fn)
        radius = ''
        try:
            radius = getattr(ent.geometry, 'radius', None)
            if radius is not None:
                radius = f', radius={round(radius, 4)}'
            else:
                radius = ''
        except Exception:
            radius = ''
        return f'Seeds.Arc("{name}", {start_ref}, {end_ref}, center={center_ref}{radius})'

    if 'SketchConstraint' in ent_type or ent_type.endswith('Constraint') or 'Constraint' in ent_type:
        targets = _constraint_targets(ent, params, get_entity_coord_expr_fn)
        args = ', '.join(targets) if targets else '/* targets */'
        return f'Constraints.{ent_type}( {args} )'

    return f'# Review selected entity: {ent_type} "{name}"'
