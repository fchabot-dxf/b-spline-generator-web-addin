"""
Template Maker copy of Frame Inspector coordinate expression helpers.
"""

import math
import re
import adsk.core, adsk.fusion
from entity_helpers import _get_arc_midpoint


def _get_native(ent):
    if hasattr(ent, 'nativeObject') and ent.nativeObject:
        return ent.nativeObject
    return ent


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


def _infer_coord_expr(coord, axis=None, params=None):
    if coord is None:
        return ''
    params = _get_design_param_values(params)
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


def _get_design_param_values(params=None):
    if params is not None:
        return {k: float(v) for k, v in params.items() if v is not None}
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


def _get_point_name(pt):
    try:
        if not pt:
            return None
        if hasattr(pt, 'attributes'):
            a = pt.attributes.itemByName('FrameBuilder', 'name')
            if a and a.value:
                return str(a.value).split('\n')[0]
    except Exception:
        pass
    return None


def _format_point_expr(pt, params=None):
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

    x_expr = _infer_coord_expr(x_value, 'x', params) if x_value is not None else ''
    y_expr = _infer_coord_expr(y_value, 'y', params) if y_value is not None else ''
    if not x_expr and not y_expr:
        return ''

    coord_expr = f"({x_expr}, {y_expr})"
    name = _get_point_name(pt)
    if name:
        return f"({name} : {coord_expr})"
    return coord_expr


def _get_scope():
    try:
        app = adsk.core.Application.get()
        if not app:
            return None
        return adsk.fusion.Design.cast(app.activeProduct)
    except Exception:
        return None


def get_design_params():
    try:
        design = _get_scope()
        if not design:
            return {}
        params = {}
        for p in design.allParameters:
            try:
                if hasattr(p, 'isUserParameter') and not p.isUserParameter:
                    continue
                name = getattr(p, 'name', None)
                if not name:
                    continue
                params[name] = {
                    'expression': str(getattr(p, 'expression', '') or ''),
                    'value': getattr(p, 'value', None)
                }
            except Exception:
                continue
        return params
    except Exception:
        return {}


def _build_entity_coord_expr_string(ent, params=None):
    try:
        if not ent:
            return ''
        ent = _get_native(ent)
        if hasattr(ent, 'objectType') and 'SketchPoint' in ent.objectType:
            expr = _format_point_expr(ent, params)
            return f"Point: {expr}" if expr else ''

        if hasattr(ent, 'startSketchPoint') and hasattr(ent, 'endSketchPoint'):
            start_expr = _format_point_expr(ent.startSketchPoint, params)
            end_expr = _format_point_expr(ent.endSketchPoint, params)
            center = getattr(ent, 'centerSketchPoint', None)
            if not center and hasattr(ent, 'geometry') and hasattr(ent.geometry, 'center'):
                center = ent.geometry.center
            center_expr = _format_point_expr(center, params)
            mid_point = _get_arc_midpoint(ent)
            mid_expr = _format_point_expr(mid_point, params) if mid_point else ''
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
                start_expr = _format_point_expr(geo.startPoint, params)
                end_expr = _format_point_expr(geo.endPoint, params)
                if start_expr or end_expr:
                    return f"{start_expr} -> {end_expr}".strip(' -> ')

        return ''
    except Exception:
        return ''


def get_entity_coord_expr(ent, params=None):
    return _build_entity_coord_expr_string(_get_native(ent), params)
