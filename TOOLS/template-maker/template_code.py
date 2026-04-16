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


def _wrap_sequence_hint(statement):
    if statement.startswith('Seeds.'):
        return f'    seeds.append({statement})'
    if statement.startswith('Constraints.'):
        return f'    constraints.append({statement})'
    if statement.startswith('dimensions.') or statement.startswith('Dimensions.'):
        return f'    dims.append({statement})'
    return f'    {statement}'
