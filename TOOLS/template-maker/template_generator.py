import adsk.core, adsk.fusion
from expression_coords import get_design_params, get_entity_coord_expr
from phase_parser import parse_statement_to_phase_step, format_phase_step, RawCode, LiteralString

_parse_statement_to_phase_step = parse_statement_to_phase_step
RawCode = RawCode
LiteralString = LiteralString
from template_payload import (
    _build_entity_hint,
    _collect_design_variables,
    _collect_variables,
    _merge_variables,
    _strip_point_prefix,
    _get_native,
    _log_detection,
    BUILTIN_TEMPLATE_VARIABLES,
)
from template_payload_builder import build_payload_items, build_code_preview
from template_code import build_header, build_footer, wrap_statement, format_phase_block
from template_variable_block import format_variable_block


# Legacy aliases preserved for compatibility with the existing test harness.
_default_header = build_header
_default_footer = build_footer
_wrap_sequence_hint = wrap_statement


def _build_phase_block_code(items, phase_name='Generated Phase', phase_id='p01_generated', function_name='get_block', template_number='T2'):
    lines = []
    for item in items:
        step = parse_statement_to_phase_step(item['hint'])
        if step:
            lines.append(format_phase_step(step))
        else:
            lines.append(f"    # {item['hint']}")
    return format_phase_block(lines, phase_name=phase_name, phase_id=phase_id, function_name=function_name, template_number=template_number)


def build_template_payload(entities, phase_prefix=None, phase_id=None, phase_name=None, template_number='T2'):
    count = len(entities)
    logs = []
    design_vars = _collect_design_variables(logs, get_design_params)
    # Only accept selection-derived tokens that are real Fusion user
    # parameters (minus built-ins like widthIn/heightIn which are always
    # pre-existing in the Frame Builder runtime and read-only — they should
    # not be declared again in the T1 vars block).
    all_param_names = set((get_design_params() or {}).keys())
    valid_names = all_param_names - BUILTIN_TEMPLATE_VARIABLES
    selection_vars = _collect_variables(
        entities,
        '',
        logs,
        None,
        get_entity_coord_expr,
        lambda ent, params: _build_entity_hint(ent, params, get_entity_coord_expr),
        valid_names=valid_names,
    )
    _log_detection(logs, f"build_template_payload: selection={count} design_vars={len(design_vars)} selection_vars={len(selection_vars)}")
    merged_variables = _merge_variables(design_vars, selection_vars)
    payload = {
        'count': count,
        'mainFeature': 'Select sketch geometry...',
        'description': 'Select sketch geometry to preview seed and constraint snippets.',
        'codePreview': '# No selection yet. Select sketch entities to generate code previews.',
        'phaseBlockCode': '# No phase block generated yet.',
        'headerText': build_header(template_number=template_number),
        'footerText': build_footer(),
        'variables': merged_variables,
        'variableBlock': format_variable_block(merged_variables),
        'logs': logs,
        'items': [],
        'linked': [],
        'linked_expr': [],
        'listLabel': 'Selection',
        'type': 'TemplateMaker'
    }

    if count == 0:
        return payload

    items = build_payload_items(entities, phase_prefix=phase_prefix)
    payload['items'] = items
    for item in items:
        payload['linked'].append(f"{item['name']} | {item['coord']}")
        payload['linked_expr'].append(f"{item['name']} | {item['coordExpr']}")

    payload['mainFeature'] = entities[0].objectType.split('::')[-1] if count == 1 else f'{count} Entities Selected'
    payload['description'] = 'Use the buttons below to wrap preview text into a phase module header/footer.'
    payload['codePreview'] = build_code_preview(items)
    payload['phaseBlockCode'] = _build_phase_block_code(
        items,
        phase_name=phase_name or 'Generated Phase',
        phase_id=phase_id or 'p01_generated',
        template_number=template_number,
    )
    return payload