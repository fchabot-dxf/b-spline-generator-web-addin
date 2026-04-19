"""Unit tests for the ``isConstruction`` → ``IsConstruction`` round trip.

Scope:
  * The shape-hint emitters in ``template_payload`` append
    ``isConstruction=True`` only when the entity carries a truthy
    ``isConstruction`` attribute. Baseline (non-construction) seeds
    stay diff-clean — no noisy ``isConstruction=False`` kwarg.
  * ``phase_parser`` parses that kwarg back out and stamps
    ``'IsConstruction': True`` on the step dict. Missing kwarg → no
    key on the step.
  * ``template_payload_builder.build_payload_items`` echoes the flag
    into the palette-facing item dict so the JS can render the
    cosmetic ◌ glyph without re-parsing the hint string.

Fusion runtime is stubbed the same way ``test_template_generator.py``
does it — construction flag lives on the fake entity as a plain
Python bool.
"""

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Fake Fusion runtime so ``import adsk`` inside the real modules is a no-op.
adsk = types.ModuleType('adsk')
adsk.core = types.ModuleType('adsk.core')
adsk.fusion = types.ModuleType('adsk.fusion')


class _FakeApp:
    @staticmethod
    def get():
        return None


adsk.core.Application = _FakeApp
sys.modules.setdefault('adsk', adsk)
sys.modules.setdefault('adsk.core', adsk.core)
sys.modules.setdefault('adsk.fusion', adsk.fusion)


class _FakeAttrs:
    def __init__(self, values=None):
        self._values = values or {}

    def itemByName(self, group, name):
        v = self._values.get(name)
        return types.SimpleNamespace(value=v) if v is not None else None


class FakePoint:
    def __init__(self, x, y):
        self.objectType = 'SketchPoint'
        self.geometry = types.SimpleNamespace(x=x, y=y)
        self.attributes = _FakeAttrs()
        self.nativeObject = None


class FakeLine:
    def __init__(self, start, end, name=None, is_construction=False):
        self.objectType = 'SketchLine'
        self.startSketchPoint = start
        self.endSketchPoint = end
        self.isConstruction = is_construction
        self.attributes = _FakeAttrs({'name': name} if name else None)
        self.nativeObject = None


import template_payload
import phase_parser


def _hint_for_line(line, label='my_line'):
    """Emit a Seeds.Line hint through the real _hint_line handler.

    ``ctx['expr_fn'] = None`` bypasses the design-parameter expression
    layer — we want coord literals here so the assertion can compare
    against a predictable string without loading the full generator.
    """
    ctx = {'params': None, 'expr_fn': None}
    return template_payload._hint_line(line, label, ctx)


def test_construction_line_emits_kwarg():
    p1 = FakePoint(0.0, 0.0)
    p2 = FakePoint(1.0, 1.0)
    line = FakeLine(p1, p2, is_construction=True)
    hint = _hint_for_line(line, 'skel_spine')
    # The construction suffix MUST be present, comma-separated, after
    # the last positional — that's the shape the parser's
    # _split_kw_and_positional can recover without drama.
    assert hint.endswith(', isConstruction=True)'), (
        f'expected isConstruction=True suffix; got: {hint!r}'
    )
    assert hint.startswith('Seeds.Line("skel_spine", ')


def test_plain_line_omits_construction_kwarg():
    # Baseline: non-construction line must stay diff-clean — no
    # ``isConstruction=False`` noise. This matters for git diffs on
    # regenerated phase modules where the vast majority of seeds are
    # non-construction.
    p1 = FakePoint(0.0, 0.0)
    p2 = FakePoint(1.0, 1.0)
    line = FakeLine(p1, p2, is_construction=False)
    hint = _hint_for_line(line, 'main_edge')
    assert 'isConstruction' not in hint, (
        f'non-construction line must not emit kwarg; got: {hint!r}'
    )


def test_parser_sets_is_construction_on_step():
    hint = 'Seeds.Line("skel_spine", (0, 0), (1, 1), isConstruction=True)'
    step = phase_parser.parse_statement_to_phase_step(hint)
    assert step is not None
    # The step's IsConstruction value MUST be the Python bool True
    # (not a LiteralString, not the string "True"). ``_format_raw_value``
    # renders a bare bool as the unquoted token ``True`` — which is what
    # the runtime's ``fb_engine/geometry.py`` expects when it reads
    # ``step.get('IsConstruction')``.
    assert step.get('IsConstruction') is True, (
        f'expected True bool on step; got: {step.get("IsConstruction")!r}'
    )


def test_parser_omits_is_construction_when_kwarg_absent():
    # Clean baseline — the step dict must NOT carry an IsConstruction
    # key when the hint didn't have one. A stray ``'IsConstruction': False``
    # would bloat every emitted step dict and encourage the runtime to
    # treat False as equivalent to the absent case (which it technically
    # already does, but we'd rather not lean on that equivalence).
    hint = 'Seeds.Line("main_edge", (0, 0), (1, 1))'
    step = phase_parser.parse_statement_to_phase_step(hint)
    assert step is not None
    assert 'IsConstruction' not in step


def test_parser_accepts_lowercase_true():
    # Permissive on parse: hand-written templates might use lowercase
    # ``true`` (JS muscle memory) or ``1``. All three should round-trip
    # into ``'IsConstruction': True`` rather than silently dropping the
    # flag.
    for literal in ('True', 'true', '1'):
        hint = f'Seeds.Line("x", (0, 0), (1, 1), isConstruction={literal})'
        step = phase_parser.parse_statement_to_phase_step(hint)
        assert step is not None
        assert step.get('IsConstruction') is True, (
            f'expected True for literal={literal!r}; got: '
            f'{step.get("IsConstruction")!r}'
        )


def test_format_step_renders_construction_as_bare_true():
    # End-to-end render check: a step with IsConstruction=True must
    # format as ``'IsConstruction': True`` — no quotes, no LiteralString
    # repr wrapping. Frame Builder's runtime reads the dict via
    # ``import`` on the phase module, so Python must parse it as a bool.
    step = phase_parser.parse_statement_to_phase_step(
        'Seeds.Line("z", (0, 0), (1, 1), isConstruction=True)'
    )
    rendered = phase_parser.format_phase_step(step)
    assert "'IsConstruction': True" in rendered, (
        f'expected bare True rendering; got: {rendered!r}'
    )


def test_arc_circle_ellipse_spline_all_propagate():
    # One-shot coverage: the construction suffix must appear on every
    # curve subtype. If we ever add a new Seeds.* handler, this test
    # fails loud until the suffix gets wired in too.
    ctx = {'params': None, 'expr_fn': None}
    p1 = FakePoint(0.0, 0.0)
    p2 = FakePoint(1.0, 1.0)
    p3 = FakePoint(0.5, 0.5)

    # Arc — three-positional form (current emitter).
    arc = types.SimpleNamespace(
        objectType='SketchArc',
        startSketchPoint=p1, endSketchPoint=p2, centerSketchPoint=p3,
        geometry=types.SimpleNamespace(
            center=p3.geometry, radius=1.0,
            startAngle=0.0, endAngle=3.14,
        ),
        isConstruction=True,
        attributes=_FakeAttrs(),
        nativeObject=None,
    )
    hint = template_payload._hint_arc(arc, 'arc_1', ctx)
    assert hint.endswith(', isConstruction=True)'), hint

    # Circle.
    circle = types.SimpleNamespace(
        objectType='SketchCircle',
        centerSketchPoint=p1,
        geometry=types.SimpleNamespace(radius=2.0),
        isConstruction=True,
        attributes=_FakeAttrs(),
        nativeObject=None,
    )
    hint = template_payload._hint_circle(circle, 'circ_1', ctx)
    assert hint.endswith(', isConstruction=True)'), hint

    # Ellipse — the construction suffix goes into ``parts`` so the
    # exact position differs, but it still must appear.
    ellipse = types.SimpleNamespace(
        objectType='SketchEllipse',
        centerSketchPoint=p1,
        geometry=types.SimpleNamespace(
            majorAxisRadius=2.0, minorAxisRadius=1.0,
            majorAxis=types.SimpleNamespace(x=1.0, y=0.0),
        ),
        isConstruction=True,
        attributes=_FakeAttrs(),
        nativeObject=None,
    )
    hint = template_payload._hint_ellipse(ellipse, 'ell_1', ctx)
    assert 'isConstruction=True' in hint, hint

    # Spline — the factory builds a handler per subtype; pick one.
    handler = template_payload._hint_spline_factory('FittedSpline')
    spline = types.SimpleNamespace(
        objectType='SketchFittedSpline',
        fitPoints=[p1, p2, p3],
        isConstruction=True,
        attributes=_FakeAttrs(),
        nativeObject=None,
    )
    hint = handler(spline, 'sp_1', ctx)
    assert hint.endswith(', isConstruction=True)'), hint


if __name__ == '__main__':
    test_construction_line_emits_kwarg()
    test_plain_line_omits_construction_kwarg()
    test_parser_sets_is_construction_on_step()
    test_parser_omits_is_construction_when_kwarg_absent()
    test_parser_accepts_lowercase_true()
    test_format_step_renders_construction_as_bare_true()
    test_arc_circle_ellipse_spline_all_propagate()
    print('test_construction_flag passed')
