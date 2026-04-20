"""Variable-scan layer for the Template Maker payload.

A "variable" in Template Maker means a named Fusion user parameter
(e.g. ``widthIn``, ``cornerRadius``, ``ribSpacing``) that the emitted
phase block should treat as a live expression rather than a frozen
literal. The scanner has two jobs:

1. **Collect design parameters** — ``_collect_design_variables``
   walks the Fusion ``userParameters`` collection and builds one dict
   per parameter (``name``, ``expression``, ``enabled``, ``source``).
   Built-in names (``widthIn``, ``heightIn``) are dropped because the
   FrameBuilder runtime owns those; redeclaring them in the T1 vars
   block would shadow the runtime's values.

2. **Collect selection-derived tokens** — ``_collect_variables``
   tokenises each selected entity's coord expression and hint text,
   then keeps every token that matches the user-parameter whitelist.
   The whitelist is critical: without it, entity IDs ("horn_TL"),
   keyword arguments ("radius", "angleDeg"), and literal numbers
   would all leak into the vars block.

Extracted from ``template_payload`` because scanning is pure Python —
no Fusion API surface beyond the coord / hint callbacks passed in —
and it has its own test surface (``test_template_variable_block``,
``test_template_generator``). Keeping it wedged inside the seed-hint
module meant every change to token handling risked touching the
crash-critical path. Now the scan lives on its own.

Back-compat re-exports
----------------------
``template_payload`` re-imports every public name from here:

    BUILTIN_TEMPLATE_VARIABLES
    _strip_point_prefix
    _call_entity_coord_expr_fn
    _parse_expression_tokens
    _collect_design_variables
    _collect_variables
    _merge_variables

so any caller still doing ``from template_payload import …`` keeps
working. New callers should import from this module directly.
"""

import re

from detection_log import _log_detection
from entity_util import _get_native


# Names the FrameBuilder runtime already owns. They must NOT be
# re-declared in the generated T1 vars block — doing so shadows the
# runtime value and produces a template that runs but silently uses
# the wrong dimensions.
BUILTIN_TEMPLATE_VARIABLES = {'widthIn', 'heightIn'}


def _strip_point_prefix(expr):
    """Drop the ``"Point:"`` prefix that ``get_entity_coord_expr`` tacks
    onto point-typed returns.

    Returning an empty string for a falsy input keeps callers free of
    ``None`` handling — they can pipe the result straight into an
    f-string.
    """
    if not expr:
        return ''
    if expr.startswith('Point:'):
        return expr[len('Point:'):].strip()
    return expr


def _call_entity_coord_expr_fn(get_entity_coord_expr_fn, ent, params=None):
    """Call the injected coord-expr function, tolerant of both the
    1-arg and 2-arg signatures.

    The function lives in ``expression_coords`` and has grown an
    optional ``params`` argument over time. This wrapper makes the
    scanner and hint-builders insensitive to which version they're
    wired up to — handy in tests that inject a minimal fake.
    """
    if not get_entity_coord_expr_fn:
        return ''
    try:
        return get_entity_coord_expr_fn(ent, params)
    except TypeError:
        try:
            return get_entity_coord_expr_fn(ent)
        except Exception:
            return ''
    except Exception:
        return ''


# Tokens that look like identifiers but aren't real user parameters.
# They arise from seed syntax (``Seeds``, ``Arc``, ``Line``), keyword
# arguments (``center``, ``start``, ``radius``), Fusion type names
# (``SketchPoint``, ``SketchArc``), units (``cm``, ``mm``, ``in``),
# Python literals (``True``, ``False``), and module names (``math``).
# Any time the scanner encounters one of these, it drops the token
# rather than proposing it as a variable.
_EXPRESSION_TOKEN_EXCLUSIONS = {
    'Point', 'Seeds', 'Arc', 'Line', 'Constraints', 'Dimensions',
    'center', 'start', 'end', 'SketchPoint', 'SketchLine', 'SketchArc',
    'SketchPoint3D', 'SketchPoint2D', 'centerSketchPoint', 'startSketchPoint',
    'endSketchPoint', 'geometry', 'ctx', 'sketch', 'plan', 'True', 'False',
    'cm', 'mm', 'in', 'math',
}


def _parse_expression_tokens(expr):
    """Extract candidate variable-name tokens from a single expression.

    Quoted string literals are scrubbed before tokenising so entity IDs
    embedded in emitted code (e.g. ``"horn_TL"`` inside
    ``Seeds.Line("horn_TL", …)``) can't masquerade as variables. The
    remaining tokens are filtered against the exclusion set, the
    built-in names, and any ``"Point"`` / ``"Sketch"`` prefix that
    slipped past the exclusion list. Digits are rejected outright.
    Order is preserved; duplicates are folded.
    """
    if not expr:
        return []
    # Drop content inside quoted strings before token-scanning so entity IDs
    # like "horn_TL" (which appear inside Seeds.Line("horn_TL", ...)) don't
    # get mistaken for variables.
    stripped = re.sub(r'"[^"]*"|\'[^\']*\'', '', expr)
    tokens = re.findall(r'\b[A-Za-z_][A-Za-z0-9_]*\b', stripped)
    result = []
    for token in tokens:
        if token in _EXPRESSION_TOKEN_EXCLUSIONS or token in BUILTIN_TEMPLATE_VARIABLES:
            continue
        if token.isdigit():
            continue
        if token.startswith('Point') or token.startswith('Sketch'):
            continue
        if token in result:
            continue
        result.append(token)
    return result


def _collect_design_variables(logs=None, get_design_params_fn=None):
    """Walk Fusion's user parameters and emit one dict per real variable.

    The ``get_design_params_fn`` callback is injected from
    ``expression_coords.get_design_params`` in production and from the
    test harness in the unit tests — the scanner itself has no Fusion
    surface. Built-ins (``widthIn``, ``heightIn``) are skipped.
    Parameters without an expression fall back to ``str(value)`` so the
    vars block always gets something evaluable.
    """
    params = (get_design_params_fn() if get_design_params_fn else {}) or {}
    variables = []
    for name, info in params.items():
        if name in BUILTIN_TEMPLATE_VARIABLES:
            continue
        expr = info.get('expression') or ''
        if not expr:
            expr = str(info.get('value', '')).strip()
        if expr:
            variables.append({
                'name': name,
                'expression': expr,
                'enabled': True,
                'source': 'design'
            })
    if logs is not None:
        _log_detection(logs, f"Detected {len(variables)} design parameters")
    return variables


def _merge_variables(primary, secondary):
    """Combine two variable lists, preserving order and deduplicating by
    name. ``primary`` wins on name collisions — that's how
    ``_collect_design_variables`` ends up as the source of truth when a
    selection-derived token happens to share a name with a user
    parameter.
    """
    seen = set()
    merged = []
    for variable in primary + secondary:
        name = variable.get('name')
        if not name or name in seen:
            continue
        merged.append(variable)
        seen.add(name)
    return merged


def _collect_variables(entities, code_text='', logs=None, params=None,
                       get_entity_coord_expr_fn=None,
                       build_entity_hint_fn=None, valid_names=None):
    """Scan selection-derived expressions/hints for variable-name tokens.

    For each selected entity, the scanner pulls two strings:

      * the coord expression (``get_entity_coord_expr_fn(ent, params)``),
        which may reference user parameters as in
        ``(widthIn * 0.5, heightIn * 0.5)``,
      * the hint (``build_entity_hint_fn(ent, params)``), which for
        dimensions contains the ``expression=`` kwarg the user wrote.

    Both are tokenised via ``_parse_expression_tokens``. If
    ``valid_names`` is provided (e.g. the set of real Fusion user
    parameters minus built-ins), tokens are accepted only if they
    appear in that whitelist. That's what prevents entity IDs and
    stray identifiers (``radius``, ``angleDeg``) from leaking into
    the T1 vars block.
    """
    names = []

    def add_tokens(expr, source):
        expr = expr or ''
        tokens = _parse_expression_tokens(expr)
        if tokens:
            _log_detection(logs, f"Detected tokens from {source}: {tokens}")
        for token in tokens:
            if valid_names is not None and token not in valid_names:
                continue
            if token not in names:
                names.append(token)

    for i, ent in enumerate(entities):
        ent = _get_native(ent)
        expr = (
            _strip_point_prefix(_call_entity_coord_expr_fn(get_entity_coord_expr_fn, ent, params))
            if get_entity_coord_expr_fn else ''
        )
        add_tokens(expr, f'selection[{i}] expr')

        hint = build_entity_hint_fn(ent, params) if build_entity_hint_fn else ''
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
