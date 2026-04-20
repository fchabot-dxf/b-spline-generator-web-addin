"""Generate simple variable blocks for the template maker variable generator UI."""


def format_variable_block(variables, include_disabled=False):
    """Format a list of variable records into a simple pasteable block.

    Each variable record is expected to include:
      - name
      - expression
      - enabled

    If include_disabled is False, disabled variables are omitted.
    """
    lines = []
    for variable in variables or []:
        if not variable or not variable.get('name'):
            continue
        if not include_disabled and variable.get('enabled') is False:
            continue
        name = variable.get('name', '').strip()
        expression = str(variable.get('expression', '') or '').strip()
        if not name:
            continue
        if expression and expression != name:
            lines.append(f"{name} = {expression}")
        else:
            lines.append(name)
    return '\n'.join(lines)
