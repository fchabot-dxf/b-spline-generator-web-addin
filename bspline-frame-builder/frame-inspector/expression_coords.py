"""
Fusion Frame Inspector expression coordinate helpers.

This module is intentionally separate from the main inspector workflow so that
expression extraction logic can be extended independently of the palette and
selection payload plumbing.
"""

import math
import re
import adsk.core, adsk.fusion


def _get_native(ent):
    if hasattr(ent, 'nativeObject') and ent.nativeObject:
        return ent.nativeObject
    return ent


def _get_entity_key(ent):
    try:
        ent = _get_native(ent)
        if hasattr(ent, 'entityToken') and ent.entityToken:
            return ('token', ent.entityToken)
        if hasattr(ent, 'tempId'):
            return ('tempId', ent.tempId)
        return ('id', id(ent))
    except Exception:
        return ('id', id(ent))


def _get_arc_midpoint(ent):
    try:
        if not hasattr(ent, 'startSketchPoint') or not hasattr(ent, 'endSketchPoint'):
            return None

        sp = ent.startSketchPoint.geometry
        ep = ent.endSketchPoint.geometry
        cp = None
        if hasattr(ent, 'centerSketchPoint') and ent.centerSketchPoint:
            cp = ent.centerSketchPoint.geometry
        elif hasattr(ent, 'geometry') and hasattr(ent.geometry, 'center'):
            cp = ent.geometry.center
        if not cp:
            return None

        dx1 = sp.x - cp.x
        dy1 = sp.y - cp.y
        dx2 = ep.x - cp.x
        dy2 = ep.y - cp.y
        r1 = math.hypot(dx1, dy1)
        if r1 == 0:
            return None

        angle1 = math.atan2(dy1, dx1)
        angle2 = math.atan2(dy2, dx2)
        cross = dx1 * dy2 - dy1 * dx2
        delta = angle2 - angle1
        if cross < 0 and delta > 0:
            delta -= 2 * math.pi
        elif cross > 0 and delta < 0:
            delta += 2 * math.pi

        mid_angle = angle1 + delta / 2.0
        mid_x = cp.x + r1 * math.cos(mid_angle)
        mid_y = cp.y + r1 * math.sin(mid_angle)
        return (mid_x, mid_y)
    except Exception:
        return None


def _parse_numeric_value(value):
    try:
        return float(value)
    except Exception:
        try:
            text = str(value)
            m = re.search(r'[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?', text)
            if m:
                return float(m.group(0))
        except Exception:
            pass
    return None


def _get_design_param_values():
    params = get_design_params()
    values = {}
    for name in ('widthIn', 'heightIn'):
        info = params.get(name)
        if not info:
            continue
        raw = info.get('value')
        numeric = _parse_numeric_value(raw)
        if numeric is None:
            numeric = _parse_numeric_value(info.get('expression'))
        if numeric is not None:
            values[name] = numeric
    return values


def _round_if_close(value, tol=1e-6):
    rounded = round(value)
    return rounded if abs(value - rounded) <= tol else None


def _nice_fraction(value, max_denom=12, tol=1e-6):
    for denom in range(1, max_denom + 1):
        numer = round(value * denom)
        if abs(value - (numer / denom)) <= tol:
            return numer, denom
    return None


def _format_factor(factor, name):
    if factor is None or math.isnan(factor) or math.isinf(factor):
        return None
    if abs(factor) < 1e-6:
        return '0'
    if abs(factor - 1.0) < 1e-6:
        return name
    if abs(factor + 1.0) < 1e-6:
        return f"-{name}"

    integer = _round_if_close(factor)
    if integer is not None:
        if integer == 0:
            return '0'
        return f"{name} * {integer}"

    return f"{name} * {round(factor, 4)}"


def _infer_coord_expr(coord, axis=None):
    if coord is None:
        return ''
    params = _get_design_param_values()
    if not params:
        return str(round(coord, 4))

    axis_key = str(axis).lower() if axis is not None else None
    axis_to_param = {
        'x': 'widthIn',
        'y': 'heightIn'
    }
    if axis_key in axis_to_param:
        param_name = axis_to_param[axis_key]
        if param_name in params:
            expr = _format_factor(coord / params[param_name], param_name)
            return expr if expr is not None else str(round(coord, 4))

    best_expr = None
    best_score = None
    for name, value in params.items():
        if value == 0:
            continue
        factor = coord / value
        expr = _format_factor(factor, name)
        if not expr:
            continue
        score = len(expr)
        if best_score is None or score < best_score:
            best_score = score
            best_expr = expr

    return best_expr if best_expr is not None else str(round(coord, 4))


def _format_point_expr(pt):
    if not pt:
        return ''

    x_value = None
    y_value = None
    if isinstance(pt, (list, tuple)) and len(pt) >= 2:
        x_value, y_value = pt[0], pt[1]
    else:
        if hasattr(pt, 'x'):
            try:
                x_value = float(pt.x)
            except Exception:
                x_value = None
        if hasattr(pt, 'y'):
            try:
                y_value = float(pt.y)
            except Exception:
                y_value = None

    x_expr = _infer_coord_expr(x_value, 'x') if x_value is not None else ''
    y_expr = _infer_coord_expr(y_value, 'y') if y_value is not None else ''
    if not x_expr and not y_expr:
        return ''
    return f"({x_expr}, {y_expr})"


def _build_entity_coord_expr_string(ent):
    try:
        if not ent:
            return ''
        if hasattr(ent, 'objectType') and 'SketchPoint' in ent.objectType:
            expr = _format_point_expr(ent)
            return f"Point: {expr}" if expr else ''

        if hasattr(ent, 'startSketchPoint') and hasattr(ent, 'endSketchPoint'):
            start_expr = _format_point_expr(ent.startSketchPoint)
            end_expr = _format_point_expr(ent.endSketchPoint)
            center = getattr(ent, 'centerSketchPoint', None)
            if not center and hasattr(ent, 'geometry') and hasattr(ent.geometry, 'center'):
                center = ent.geometry.center
            center_expr = _format_point_expr(center)
            mid_point = _get_arc_midpoint(ent)
            mid_expr = _format_point_expr(mid_point) if mid_point else ''
            if start_expr or end_expr or center_expr or mid_expr:
                if center_expr:
                    expr = f"{start_expr} -> {center_expr} -> {end_expr}"
                    if mid_expr:
                        expr += f" -> {mid_expr}"
                    return expr.strip(' -> ')
                expr = f"{start_expr} -> {end_expr}"
                if mid_expr:
                    expr += f" -> {mid_expr}"
                return expr.strip(' -> ')

        if hasattr(ent, 'geometry'):
            geo = ent.geometry
            if hasattr(geo, 'startPoint') and hasattr(geo, 'endPoint'):
                start_expr = _format_point_expr(geo.startPoint)
                end_expr = _format_point_expr(geo.endPoint)
                if start_expr or end_expr:
                    return f"{start_expr} -> {end_expr}".strip(' -> ')

        return ''
    except Exception:
        return ''


def get_entity_coord_expr(ent):
    return _build_entity_coord_expr_string(_get_native(ent))


def get_entity_name(ent):
    try:
        ent = _get_native(ent)
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', 'name')
            if a and a.value:
                return a.value.split('\n')[0]
    except Exception:
        pass
    try:
        return ent.objectType.split('::')[-1]
    except Exception:
        return 'Entity'


def _get_design():
    try:
        app = adsk.core.Application.get()
        if not app: return None
        return adsk.fusion.Design.cast(app.activeProduct)
    except Exception:
        return None


def _get_design_parameter(design, name):
    try:
        if not design: return None
        p = design.allParameters.itemByName(name)
        if p: return p
        return design.allParameters.itemByName(f'BSG_{name}')
    except Exception:
        return None


def get_design_params():
    params = {}
    design = _get_design()
    if not design:
        return params

    for name in ('widthIn', 'heightIn'):
        try:
            p = _get_design_parameter(design, name)
            if p:
                params[name] = {
                    'expression': str(getattr(p, 'expression', '')),
                    'value': getattr(p, 'value', None),
                    'unit': str(getattr(p, 'unit', ''))
                }
        except Exception:
            continue
    return params


def format_design_params():
    params = get_design_params()
    entries = []
    for name in ('widthIn', 'heightIn'):
        if name in params:
            info = params[name]
            expr = info.get('expression')
            val = info.get('value')
            if expr:
                entries.append(f"{name}={expr}")
            elif val is not None:
                entries.append(f"{name}={round(val, 4)}")
    return ', '.join(entries)

