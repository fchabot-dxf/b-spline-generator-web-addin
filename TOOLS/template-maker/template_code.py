def build_header(file_name='template_phase.py', template_number='T2'):
    return (
        f"# File: {file_name}\n"
        f"# Template: {template_number}\n"
        "\n"
        "from frame_builder.fb_engine import geometry, constraints, dimensions, Seeds\n"
        "\n"
        f"def build_sequence(ctx, sketch, plan='{template_number}'):\n"
        "    # Auto-generated template builder code\n"
        "    seeds = []\n"
        "    constraints = []\n"
        "    dims = []\n"
    )


def build_footer():
    return (
        "\n"
        "    return {\n"
        "        'seeds': seeds,\n"
        "        'constraints': constraints,\n"
        "        'dimensions': dims\n"
        "    }\n"
    )


def build_phase_header(function_name='get_block', template_number='T2'):
    return (
        f"def {function_name}(ui_data=None):\n"
        "    seq = [\n"
    )


def build_phase_footer(phase_name='PhaseName', phase_id='p01'):
    return (
        "    ]\n"
        "    return {\n"
        f"        'Name': '{phase_name}',\n"
        f"        'PhaseID': '{phase_id}',\n"
        "        'BuildSequence': seq\n"
        "    }\n"
    )


def wrap_statement(statement):
    if not statement or not isinstance(statement, str):
        return ''
    if statement.startswith('Seeds.'):
        return f'    seeds.append({statement})'
    if statement.startswith('Constraints.'):
        return f'    constraints.append({statement})'
    if statement.startswith('dimensions.') or statement.startswith('Dimensions.'):
        return f'    dims.append({statement})'
    return f'    {statement}'


def format_code_preview(code_lines, file_name='template_phase.py', template_number='T2'):
    return build_header(file_name=file_name, template_number=template_number) + '\n'.join(code_lines) + build_footer()


def format_phase_block(code_lines, phase_name='PhaseName', phase_id='p01', function_name='get_block', template_number='T2'):
    return build_phase_header(function_name=function_name, template_number=template_number) + '\n'.join(code_lines) + build_phase_footer(phase_name=phase_name, phase_id=phase_id)


# Backwards compatibility for existing imports.
_default_header = build_header
_default_footer = build_footer
_wrap_sequence_hint = wrap_statement
