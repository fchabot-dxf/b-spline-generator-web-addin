import adsk.core, adsk.fusion
from entity_helpers import get_entity_coord, get_fb_metadata
from expression_coords import get_design_params, get_entity_coord_expr
from template_payload import (
    _build_entity_hint,
    _collect_design_variables,
    _collect_variables,
    _merge_variables,
    _strip_point_prefix,
    _get_native,
    _label_for_entity,
    _log_detection,
)
from template_code import _default_header, _default_footer, _wrap_sequence_hint


def build_template_payload(entities):
    count = len(entities)
    logs = []
    design_vars = _collect_design_variables(logs, get_design_params)
    selection_vars = _collect_variables(
        entities,
        '',
        logs,
        None,
        get_entity_coord_expr,
        lambda ent, params: _build_entity_hint(ent, params, get_entity_coord_expr),
    )
    _log_detection(logs, f"build_template_payload: selection={count} design_vars={len(design_vars)} selection_vars={len(selection_vars)}")
    payload = {
        'count': count,
        'mainFeature': 'Select sketch geometry...',
        'description': 'Select sketch geometry to preview seed and constraint snippets.',
        'codePreview': '# No selection yet. Select sketch entities to generate code previews.',
        'headerText': _default_header(),
        'footerText': _default_footer(),
        'variables': _merge_variables(design_vars, selection_vars),
        'logs': logs,
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
        expr = _strip_point_prefix(get_entity_coord_expr(native)) or coord
        hint = _build_entity_hint(native, None, get_entity_coord_expr)
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
        lines.append(f"    # {label}")
        if expr:
            lines.append(f"    # coordExpr: {expr}")
        lines.append(_wrap_sequence_hint(hint))
        if meta:
            lines.append(f"    # {meta}")
        lines.append('')

    payload['mainFeature'] = entities[0].objectType.split('::')[-1] if count == 1 else f'{count} Entities Selected'
    payload['description'] = 'Use the buttons below to wrap preview text into a phase module header/footer.'
    payload['codePreview'] = '\n'.join(lines)
    payload['listLabel'] = 'Selection List'
    return payload
