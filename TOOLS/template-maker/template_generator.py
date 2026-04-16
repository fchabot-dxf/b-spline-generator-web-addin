import re
import adsk.core, adsk.fusion
from entity_helpers import get_fb_name, get_entity_coord, get_fb_metadata
from expression_coords import get_entity_coord_expr


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
        'Point', 'Point', 'Seeds', 'Seeds', 'Arc', 'Line', 'Constraints',
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


def _log_detection(logs, message):
    if logs is not None:
        logs.append(str(message))


def _parse_design_values_from_code(code_text):
    values = {}
    if not code_text:
        return values

    patterns = [
        r'"Name"\s*:\s*"widthIn"[^\n]*?"Val"\s*:\s*([-+]?[0-9]*\.?[0-9]+)',
        r'"Name"\s*:\s*"heightIn"[^\n]*?"Val"\s*:\s*([-+]?[0-9]*\.?[0-9]+)',
        r'widthIn\s*[=:]\s*([-+]?[0-9]*\.?[0-9]+)',
        r'heightIn\s*[=:]\s*([-+]?[0-9]*\.?[0-9]+)'
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, code_text):
            value = match.group(1)
            if 'widthIn' in pattern:
                values['widthIn'] = float(value)
            elif 'heightIn' in pattern:
                values['heightIn'] = float(value)

    return values


def _collect_variables(entities, code_text='', logs=None, params=None):
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
        expr = _strip_point_prefix(get_entity_coord_expr(ent, params))
        add_tokens(expr, f'selection[{i}] expr')

        hint = _build_entity_hint(ent, params)
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


def _format_point_reference(pt, params=None):
    if not pt:
        return 'UnknownPoint'
    pt = _get_native(pt)
    name = get_fb_name(pt)
    if name and not name.startswith('Sketch'):
        return f'"{name}"'
    expr = _strip_point_prefix(get_entity_coord_expr(pt, params))
    if expr:
        return expr
    return 'Point(...)'


def _default_header(file_name='template_phase.py', template_number='T2'):
    return (
        f"# File: {file_name}\n"
        f"# Template: {template_number}\n"
        "\n"
        "from frame_builder.fb_engine import geometry, constraints, dimensions\n"
        "\n"
        f"def build_sequence(ctx, sketch, plan='{template_number}'):\n"
        "    # Auto-generated template builder code\n"
        "    seeds = []\n"
        "    constraints = []\n"
        "    dims = []\n"
        ""
    )


def _default_footer():
    return (
        "\n"
        "    return {\n"
        "        'seeds': seeds,\n"
        "        'constraints': constraints,\n"
        "        'dimensions': dims\n"
        "    }\n"
    )


def _constraint_targets(ent, params=None):
    targets = []
    for prop_name in ('entityOne', 'entityTwo', 'lineOne', 'lineTwo', 'circleOne', 'circleTwo', 'pointOne', 'pointTwo', 'entity', 'line', 'curve'):
        try:
            item = getattr(ent, prop_name, None)
            if item:
                targets.append(_format_point_reference(item, params))
        except Exception:
            pass
    return targets


def _build_entity_hint(ent, params=None):
    ent = _get_native(ent)
    ent_type = ent.objectType.split('::')[-1] if hasattr(ent, 'objectType') else 'Entity'
    name = _label_for_entity(ent)
    if ent_type in ('SketchPoint', 'SketchPoint3D', 'SketchPoint2D'):
        coord = _strip_point_prefix(get_entity_coord_expr(ent, params)) or get_entity_coord(ent)
        return f'Seeds.Point("{name}", {coord})' if coord else f'Seeds.Point("{name}", x, y)'

    if ent_type == 'SketchLine':
        start_ref = _format_point_reference(getattr(ent, 'startSketchPoint', None), params)
        end_ref = _format_point_reference(getattr(ent, 'endSketchPoint', None), params)
        return f'Seeds.Line("{name}", {start_ref}, {end_ref})'

    if ent_type == 'SketchArc':
        start_ref = _format_point_reference(getattr(ent, 'startSketchPoint', None), params)
        end_ref = _format_point_reference(getattr(ent, 'endSketchPoint', None), params)
        center_ref = _format_point_reference(getattr(ent, 'centerSketchPoint', None), params)
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
        targets = _constraint_targets(ent, params)
        args = ', '.join(targets) if targets else '/* targets */'
        return f'Constraints.{ent_type}( {args} )'

    return f'# Review selected entity: {ent_type} "{name}"'


def build_template_payload(entities, code_text=''):
    count = len(entities)
    logs = []
    params = _parse_design_values_from_code(code_text)
    payload = {
        'count': count,
        'mainFeature': 'Select sketch geometry...',
        'description': 'Select sketch geometry to preview seed and constraint snippets.',
        'codePreview': '# No selection yet. Select sketch entities to generate code previews.',
        'headerText': _default_header(),
        'footerText': _default_footer(),
        'variables': _collect_variables(entities, code_text, logs, params),
        'logs': logs,
        'fileParams': params,
        'items': [],
        'linked': [],
        'linked_expr': [],
        'listLabel': 'Selection',
        'type': 'TemplateMaker'
    }

    if count == 0:
        return payload

    lines = [f'# Template Maker preview — {count} selected']
    for ent in entities:
        native = _get_native(ent)
        label = _label_for_entity(native)
        coord = get_entity_coord(native) or ''
        expr = _strip_point_prefix(get_entity_coord_expr(native, params)) or coord
        hint = _build_entity_hint(native, params)
        meta = get_fb_metadata(native) if hasattr(native, 'attributes') else ''

        payload['items'].append({
            'name': label,
            'coord': coord,
            'coordExpr': expr,
            'meta': meta,
            'hint': hint
        })
        payload['linked'].append(f"{label} | {coord}")
        payload['linked_expr'].append(f"{label} | {expr}")
        lines.append(f"# {label}")
        lines.append(hint)
        if meta:
            lines.append(f"# {meta}")
        lines.append('')

    payload['mainFeature'] = entities[0].objectType.split('::')[-1] if count == 1 else f'{count} Entities Selected'
    payload['description'] = 'Use the buttons below to wrap preview text into a phase module header/footer.'
    payload['codePreview'] = '\n'.join(lines)
    payload['listLabel'] = 'Selection List'
    return payload
