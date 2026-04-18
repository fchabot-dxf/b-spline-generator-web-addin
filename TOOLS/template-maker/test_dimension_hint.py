"""Regression tests for the dimension-hint naming convention.

``dimension_hint`` wraps the legacy ``relation_hints._hint_dimension`` with
a validate-and-rename layer so a dim's emitted ``Name`` can never collide
with an existing Fusion user parameter. The rules (see the module
docstring) are:

    (a) raw tag distinct from every user param -> keep as-is
    (b) raw tag collides with a user param     -> prepend ``dim_``
    (c) ``dim_<raw>`` also collides            -> suffix ``_x``

These tests exercise those three branches directly, then walk an end-to-
end build + parse round-trip through ``phase_parser._build_dimension_step``
to confirm the emitted statement remains parser-compatible.
"""

import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# Stub adsk before any template-maker module imports land — matching the
# pattern used by the other regression test files in this folder.
adsk = types.ModuleType('adsk')
adsk_core = types.ModuleType('adsk.core')
adsk_fusion = types.ModuleType('adsk.fusion')
adsk.core = adsk_core
adsk.fusion = adsk_fusion
sys.modules['adsk'] = adsk
sys.modules['adsk.core'] = adsk_core
sys.modules['adsk.fusion'] = adsk_fusion


class _FakeApplication:
    @staticmethod
    def get():
        return None


adsk_core.Application = _FakeApplication


import dimension_hint
import expression_coords
from phase_parser import parse_statement_to_phase_step


# ---------------------------------------------------------------------------
# Pure-function tests for ``derive_dim_identity`` — no Fusion, no I/O.
# ---------------------------------------------------------------------------


def test_derive_dim_identity_passes_through_when_no_collision():
    """Happy path — the raw tag is distinct, leave it alone.

    This is the common case: the user picks (or Rename Selection picks)
    a tag like ``body_width`` that already lives outside parameter
    namespace. No prefix, no warning, no rewrite.
    """
    assert dimension_hint.derive_dim_identity(
        'body_width', {'widthIn', 'heightIn'}
    ) == 'body_width'


def test_derive_dim_identity_prefixes_on_collision():
    """Raw tag matches a user parameter -> prepend ``dim_``.

    The collision case. ``widthIn`` is an existing user parameter, so
    emitting a dim with ``Name='widthIn'`` would collapse the dim's
    identity into the parameter's namespace. The prefix lifts it clear.
    """
    assert dimension_hint.derive_dim_identity(
        'widthIn', {'widthIn', 'heightIn'}
    ) == 'dim_widthIn'


def test_derive_dim_identity_suffixes_on_double_collision():
    """Pathological path — user has a param literally named ``dim_widthIn``.

    We still need a unique name, so the ``_x`` suffix breaks the tie.
    The user sees the ``_x`` and can rename the offending parameter.
    """
    assert dimension_hint.derive_dim_identity(
        'widthIn', {'widthIn', 'dim_widthIn'}
    ) == 'dim_widthIn_x'


# ---------------------------------------------------------------------------
# ``check_and_resolve_name`` — fetches live user params, fires the logger
# when it has to rewrite.
# ---------------------------------------------------------------------------


def test_check_and_resolve_logs_on_rewrite():
    """A rewrite MUST emit exactly one detection-log warning.

    The wrapper couples the rename with an audit trail — without the
    log line the user sees a dim emerge with a name that doesn't match
    what they typed and no explanation. The logger is the breadcrumb.
    """
    saved = expression_coords.get_design_params
    expression_coords.get_design_params = lambda: {
        'widthIn': {'expression': '7 "', 'value': 7.0}
    }
    try:
        captured = []
        def capture(logs_arg, message):
            captured.append((logs_arg, message))

        resolved = dimension_hint.check_and_resolve_name(
            'widthIn', logger=capture
        )
        assert resolved == 'dim_widthIn'
        assert len(captured) == 1, f'expected exactly one warning; got {captured!r}'
        logs_arg, message = captured[0]
        assert logs_arg is None, 'dimension_hint must pass None so _log_detection only hits disk'
        assert 'widthIn' in message, 'warning must name the colliding tag'
        assert 'dim_widthIn' in message, 'warning must name the resolved identity'
    finally:
        expression_coords.get_design_params = saved


def test_check_and_resolve_silent_on_pass_through():
    """No rewrite -> no log noise.

    The common path must not spam detection.log with warnings — if every
    dim logged a "no collision" line the file would be useless for
    diagnostics. Only emit when something actually changed.
    """
    saved = expression_coords.get_design_params
    expression_coords.get_design_params = lambda: {
        'widthIn': {'expression': '7 "', 'value': 7.0}
    }
    try:
        captured = []
        def capture(logs_arg, message):
            captured.append(message)

        resolved = dimension_hint.check_and_resolve_name(
            'body_width', logger=capture
        )
        assert resolved == 'body_width'
        assert captured == [], 'no warning expected for the pass-through path'
    finally:
        expression_coords.get_design_params = saved


def test_check_and_resolve_handles_missing_design_params():
    """If ``get_design_params`` blows up, fall through to empty set.

    The function is called during payload build — if it raised it would
    abort the whole rebuild. The lazy import + bare ``except`` means a
    missing or faulting adsk stack degrades to "no collision possible"
    which is the safer default than a crash.
    """
    saved = expression_coords.get_design_params
    def bad():
        raise RuntimeError('no design loaded')
    expression_coords.get_design_params = bad
    try:
        # Every tag should pass through unchanged because the user-param
        # set reads as empty.
        assert dimension_hint.check_and_resolve_name(
            'widthIn', logger=None
        ) == 'widthIn'
    finally:
        expression_coords.get_design_params = saved


# ---------------------------------------------------------------------------
# End-to-end ``build_dimension_hint`` — fake sketch dim, real emitter,
# confirm the statement shape + the round-trip through phase_parser.
# ---------------------------------------------------------------------------


class FakeAttributes:
    def __init__(self, values=None):
        self._values = values or {}

    def itemByName(self, group, name):
        value = self._values.get(name)
        if value is None:
            return None
        return types.SimpleNamespace(value=value)


class FakePoint:
    def __init__(self, x, y, name=None):
        self.objectType = 'adsk::fusion::SketchPoint'
        self.geometry = types.SimpleNamespace(x=x, y=y)
        self.x = x
        self.y = y
        self.attributes = FakeAttributes({'name': name} if name else None)
        self.nativeObject = None


class FakeLinearDim:
    """Minimal ``SketchLinearDimension``-shaped fake.

    Carries the two entity slots (``entityOne`` / ``entityTwo``) that
    ``relation_hints.target_props_for`` expects for the subtype, plus a
    ``parameter.expression`` that the hint's expression-passthrough
    reads.
    """
    def __init__(self, e1, e2, expression):
        self.objectType = 'adsk::fusion::SketchLinearDimension'
        self.entityOne = e1
        self.entityTwo = e2
        self.parameter = types.SimpleNamespace(expression=expression)
        self.attributes = FakeAttributes()


def test_build_dimension_hint_emits_prefixed_name_on_collision():
    """Full path: colliding raw tag gets rewritten in the emitted hint.

    The generated statement MUST carry ``"dim_widthIn"`` (not
    ``"widthIn"``) in the Name slot, and the Expression slot MUST still
    carry the raw parameter name ``widthIn`` — the whole point of the
    split is that Name lives in one namespace and Expression references
    the other.
    """
    saved = expression_coords.get_design_params
    expression_coords.get_design_params = lambda: {
        'widthIn': {'expression': '7 "', 'value': 7.0}
    }
    try:
        pt1 = FakePoint(0.0, 0.0, name='body_TL')
        pt2 = FakePoint(7.0, 0.0, name='body_TR')
        dim = FakeLinearDim(pt1, pt2, expression='widthIn')
        hint = dimension_hint.build_dimension_hint(
            dim,
            'SketchLinearDimension',
            'widthIn',            # raw tag collides with the user param
            ctx={'params': None, 'expr_fn': None},
        )
        assert '"dim_widthIn"' in hint, (
            f'Name must be prefix-scoped; got {hint!r}'
        )
        # Check the Name slot specifically — it's the first positional
        # argument, right after ``(``. The expression= kwarg can and must
        # still carry the raw ``widthIn``, so we can't just grep the full
        # statement for ``"widthIn"`` — we have to inspect the Name slot.
        head, _, rest = hint.partition('(')
        first_arg = rest.split(',', 1)[0].strip()
        assert first_arg == '"dim_widthIn"', (
            f'Name slot must be "dim_widthIn"; got {first_arg!r} (full hint: {hint!r})'
        )
        assert 'expression="widthIn"' in hint, (
            f'Expression must reference the raw parameter; got {hint!r}'
        )
    finally:
        expression_coords.get_design_params = saved


def test_build_dimension_hint_passes_through_when_no_collision():
    """Non-colliding tag keeps its original spelling.

    ``body_width`` is distinct from the user param namespace so the
    emitter just passes it through. This is the default case and must
    not incur any prefix rewriting.
    """
    saved = expression_coords.get_design_params
    expression_coords.get_design_params = lambda: {
        'widthIn': {'expression': '7 "', 'value': 7.0}
    }
    try:
        pt1 = FakePoint(0.0, 0.0, name='body_TL')
        pt2 = FakePoint(7.0, 0.0, name='body_TR')
        dim = FakeLinearDim(pt1, pt2, expression='widthIn')
        hint = dimension_hint.build_dimension_hint(
            dim,
            'SketchLinearDimension',
            'body_width',
            ctx={'params': None, 'expr_fn': None},
        )
        assert '"body_width"' in hint, hint
        assert 'dim_body_width' not in hint, (
            'no-collision path must not add the dim_ prefix'
        )
    finally:
        expression_coords.get_design_params = saved


def test_build_dimension_hint_roundtrips_through_phase_parser():
    """The emitted statement must parse back into a well-formed step dict.

    This is the guarantee the template_payload -> phase_parser pipeline
    relies on: whatever ``build_dimension_hint`` emits has to survive
    ``parse_statement_to_phase_step`` and end up as a dict with the
    Name / DimType / Expression / Targets slots the runtime reads.

    The round-trip pins the shape so the generator and the parser can't
    drift independently.
    """
    saved = expression_coords.get_design_params
    expression_coords.get_design_params = lambda: {
        'widthIn': {'expression': '7 "', 'value': 7.0}
    }
    try:
        pt1 = FakePoint(0.0, 0.0, name='body_TL')
        pt2 = FakePoint(7.0, 0.0, name='body_TR')
        dim = FakeLinearDim(pt1, pt2, expression='widthIn')
        hint = dimension_hint.build_dimension_hint(
            dim,
            'SketchLinearDimension',
            'widthIn',
            ctx={'params': None, 'expr_fn': None},
        )

        step = parse_statement_to_phase_step(hint)
        assert step is not None, f'parser returned None for {hint!r}'
        # ``Name`` and ``DimType`` are stored as ``LiteralString`` which
        # wraps the underlying string in ``.value``. Use that rather than
        # ``str()`` because ``LiteralString`` only defines ``__repr__``.
        assert step['Name'].value == 'dim_widthIn', step
        assert step['DimType'].value == 'SketchLinearDimension', step
        # Expression is emitted as a double-quoted string (``expression="widthIn"``)
        # so the parser strips the quotes and wraps the identifier in
        # ``LiteralString``. Pull the payload off ``.value`` regardless of
        # wrapper class — both RawCode and LiteralString expose the raw
        # source via a single attribute.
        expr_val = getattr(step['Expression'], 'value', None) \
                   or getattr(step['Expression'], 'code', None)
        assert expr_val == 'widthIn', step
        assert 'Targets' in step, step
        assert len(step['Targets']) == 2, step
    finally:
        expression_coords.get_design_params = saved


def test_build_dimension_hint_tolerates_missing_parameter():
    """No parameter (fresh / in-flight dim) -> no expression argument.

    Newly-created dims can reach the hint emitter before their
    ``.parameter`` side has settled. The guard in ``_dim_expression``
    swallows that and the emitted statement simply omits
    ``expression=`` instead of crashing the build.
    """
    pt1 = FakePoint(0.0, 0.0, name='body_TL')
    pt2 = FakePoint(7.0, 0.0, name='body_TR')
    dim = FakeLinearDim(pt1, pt2, expression='')
    # Simulate a parameter access that explodes.
    class Boom:
        def __getattr__(self, k):
            raise RuntimeError('dim not settled')
    dim.parameter = Boom()

    saved = expression_coords.get_design_params
    expression_coords.get_design_params = lambda: {}
    try:
        hint = dimension_hint.build_dimension_hint(
            dim,
            'SketchLinearDimension',
            'body_width',
            ctx={'params': None, 'expr_fn': None},
        )
        assert 'expression=' not in hint, (
            f'missing parameter must not surface as expression=; got {hint!r}'
        )
        assert '"body_width"' in hint, hint
    finally:
        expression_coords.get_design_params = saved


# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------


if __name__ == '__main__':
    test_derive_dim_identity_passes_through_when_no_collision()
    test_derive_dim_identity_prefixes_on_collision()
    test_derive_dim_identity_suffixes_on_double_collision()
    test_check_and_resolve_logs_on_rewrite()
    test_check_and_resolve_silent_on_pass_through()
    test_check_and_resolve_handles_missing_design_params()
    test_build_dimension_hint_emits_prefixed_name_on_collision()
    test_build_dimension_hint_passes_through_when_no_collision()
    test_build_dimension_hint_roundtrips_through_phase_parser()
    test_build_dimension_hint_tolerates_missing_parameter()
    print('OK')
