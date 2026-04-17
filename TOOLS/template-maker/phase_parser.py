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


def _build_geometry_step(seed_type, args):
    if len(args) < 3:
        return None
    name = args[0].strip()
    if _is_quoted_string(name):
        name = name[1:-1]
    raw_points = [RawCode(arg) for arg in args[1:] if not (arg.startswith('center=') or arg.startswith('radius='))]
    if seed_type == 'Line':
        return {
            'ID': LiteralString(name),
            'Type': LiteralString('Line'),
            'Points': raw_points[:2],
            'StartID': LiteralString(f'{name}:S'),
            'EndID': LiteralString(f'{name}:E')
        }
    if seed_type == 'Arc':
        kw = {}
        pos = []
        for arg in args[1:]:
            if '=' in arg and arg.count('=') == 1:
                key, val = arg.split('=', 1)
                kw[key.strip()] = val.strip()
            else:
                pos.append(arg)
        if len(pos) < 2:
            return None
        center = kw.get('center')
        radius = kw.get('radius')
        return {
            'ID': LiteralString(name),
            'Type': LiteralString('Arc3Point'),
            'Points': [RawCode(pos[0]), RawCode(center or pos[1]), RawCode(pos[1])],
            'StartID': LiteralString(f'{name}:S'),
            'EndID': LiteralString(f'{name}:E'),
            'CenterID': LiteralString(f'{name}:C'),
            **({'Radius': RawCode(radius)} if radius else {})
        }
    return None


def _build_constraint_step(constraint_type, args):
    targets = [RawCode(arg.strip()) for arg in args if arg.strip()]
    return {
        'Type': LiteralString(constraint_type),
        'Targets': targets
    }


def _build_dimension_step(dimension_type, args):
    if len(args) < 2:
        return None
    name = args[0].strip()
    if _is_quoted_string(name):
        name = name[1:-1]

    kw = {}
    targets = []
    for arg in args[1:]:
        if '=' in arg and arg.count('=') == 1:
            key, val = arg.split('=', 1)
            kw[key.strip()] = val.strip()
        else:
            targets.append(arg.strip())

    expression = kw.get('expression')
    orientation = kw.get('orientation')

    step = {
        'Name': LiteralString(name),
        'DimType': LiteralString(dimension_type)
    }
    if expression:
        step['Expression'] = RawCode(expression)
    if orientation:
        step['Orientation'] = LiteralString(orientation)

    if dimension_type in ('Radius', 'Diameter'):
        if targets:
            step['Target'] = RawCode(targets[0])
        return step

    if len(targets) >= 2:
        step['Targets'] = [RawCode(targets[0]), RawCode(targets[1])]
        return step

    return None


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
    if head.startswith('Dimensions.'):
        dimension_type = head.split('.', 1)[1]
        return _build_dimension_step(dimension_type, args)
    return None


def format_phase_step(step):
    return _format_step_dict(step)
