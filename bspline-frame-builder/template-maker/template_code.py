"""Template Maker code-fragment emitters.

All Template Maker output paths emit the SAME format — the only one
FrameBuilder's parametric engine actually executes:

    def get_block(ui_data=None):
        seq = [
            {'ID': '...', 'Type': '...', ...},
            {'Type': 'Coincident', 'Targets': [...]},
        ]
        return {
            'Name': '...',
            'PhaseID': '...',
            'BuildSequence': seq,
        }

``parametric_engine.py`` reads ``block.get("BuildSequence", [])`` and
processes each dict as a geometry / constraint / dimension step. There
is no code path that calls ``build_sequence()`` or reads ``seeds`` /
``constraints`` / ``dims`` — that older wrapper was an earlier draft
that never had a runtime. Emitting it produced phase files that loaded
cleanly (valid Python) but ran as no-ops (engine saw no BuildSequence).

Both ``format_code_preview`` (Wrapper + Sequence + Footer assembly) and
``format_phase_block`` (one-shot) now route through the same wrapper,
so pasting either produces a working phase file.
"""


def build_header(file_name='template_phase.py', template_number='T2'):
    """Header for the Wrapper + Sequence + Footer assembly path.

    Emits imports and the ``get_block`` opener so the assembled paste
    drops into FrameBuilder unmodified.

    ``file_name`` and ``template_number`` are kept as parameters for
    call-site compatibility — the palette still tracks them in the
    settings pill and they flow through to entity naming / phase IDs
    elsewhere — but they no longer appear in the emitted output. The
    old ``# File: ... # Template: ... # Phase: ...`` banner carried no
    runtime meaning and only added visual noise to the phase file.
    """
    return (
        "def get_block(ui_data=None):\n"
        "    \"\"\"Auto-generated phase block.\"\"\"\n"
        "    seq = [\n"
    )


def build_footer(phase_name='PhaseName', phase_id='p01'):
    """Footer for the Wrapper + Sequence + Footer assembly path.

    Closes the ``seq`` list and returns the block dict with ``Name``,
    ``PhaseID``, and ``BuildSequence`` — the exact keys the parametric
    engine reads (see ``parametric_engine.py`` line 208).
    """
    return (
        "\n    ]\n"
        "    return {\n"
        f"        'Name': '{phase_name}',\n"
        f"        'PhaseID': '{phase_id}',\n"
        "        'BuildSequence': seq,\n"
        "    }\n"
    )


def build_phase_header(function_name='get_block', template_number='T2'):
    """Header for the one-shot Phase Block path (no file banner / imports).

    Used when only the ``get_block`` function is being regenerated in
    place; callers are responsible for any surrounding imports. Shape
    matches ``build_header`` from the opener onward so both paths
    produce the same internal structure.
    """
    return (
        f"def {function_name}(ui_data=None):\n"
        "    seq = [\n"
    )


def build_phase_footer(phase_name='PhaseName', phase_id='p01'):
    """Footer for the one-shot Phase Block path.

    Kept as a thin alias of ``build_footer`` so the two emission paths
    stay in lockstep — if the block dict shape ever changes, one edit
    covers both.
    """
    return build_footer(phase_name=phase_name, phase_id=phase_id)


def wrap_statement(statement):
    """Indent a pre-formatted phase-step dict string for inclusion in ``seq``.

    Input is expected to already be a dict literal like
    ``{'ID': 'x', 'Type': 'Line', ...},`` — emitted by
    ``phase_parser.format_phase_step``. We add the list-interior indent
    (8 spaces matches the hand-written phase files) and nothing else.

    Two legacy shapes are tolerated so mid-paste edits don't silently
    break: a bare ``Seeds.*`` / ``Constraints.*`` / ``Dimensions.*``
    call is passed through commented so the user can see it landed
    somewhere instead of vanishing. These comments never execute at
    runtime — they're a visible breadcrumb, not a real step.
    """
    if not statement or not isinstance(statement, str):
        return ''
    stripped = statement.strip()
    if stripped.startswith('{') and stripped.endswith((',', '}', '},')):
        return f'        {stripped}'
    if stripped.startswith(('Seeds.', 'Constraints.', 'Dimensions.', 'dimensions.')):
        # Un-parseable builder-call — shouldn't reach here anymore, but
        # if it does, show it commented so the user can debug.
        return f'        # UNPARSED: {stripped}'
    return f'        {stripped}'


def format_code_preview(code_lines, file_name='template_phase.py', template_number='T2',
                        phase_name='PhaseName', phase_id='p01'):
    """Assemble Wrapper + Sequence + Footer into a valid phase file.

    ``code_lines`` must already be formatted as phase-step dict literals
    (see ``phase_parser.format_phase_step``). Blank lines are preserved
    so user-edited whitespace doesn't collapse on re-preview.
    """
    return (
        build_header(file_name=file_name, template_number=template_number)
        + '\n'.join(code_lines)
        + build_footer(phase_name=phase_name, phase_id=phase_id)
    )


def format_phase_block(code_lines, phase_name='PhaseName', phase_id='p01',
                       function_name='get_block', template_number='T2'):
    """Assemble just the ``get_block`` function (no file banner)."""
    return (
        build_phase_header(function_name=function_name, template_number=template_number)
        + '\n'.join(code_lines)
        + build_phase_footer(phase_name=phase_name, phase_id=phase_id)
    )


# Backwards compatibility for existing imports.
_default_header = build_header
_default_footer = build_footer
_wrap_sequence_hint = wrap_statement
