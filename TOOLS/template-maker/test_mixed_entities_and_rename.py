"""Regression tests for the Turn-7 fixes:

1. Constraints on lines emit valid Python (quoted names), not arrow syntax.
2. Dimensions reach the phase block as real steps, not dropped comments.
3. Rename flow: updating the FrameBuilder attribute on an unnamed sketch
   entity makes the regenerated code use the new name.
"""

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Stub adsk before importing the template-maker package.
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

import expression_coords
import template_generator
from rename_selection import rename_selection


def _params_with_radius():
    return {
        'widthIn':  {'expression': '7 "', 'value': 7.0},
        'heightIn': {'expression': '9 "', 'value': 9.0},
        'radius':   {'expression': '2.8255', 'value': 2.8255},
    }


def _use_params(params_fn):
    template_generator.get_design_params = params_fn
    expression_coords.get_design_params = params_fn


class FakeAttrs:
    """Attributes bag with add/itemByName mirroring Fusion's API closely enough
    that the (FrameBuilder, name) / (FrameBuilder, ID) pair round-trips."""

    def __init__(self):
        self._store = {}

    def itemByName(self, group, name):
        key = (group, name)
        if key in self._store:
            return self._store[key]
        return None

    def add(self, group, name, value):
        attr = types.SimpleNamespace(value=value)
        self._store[(group, name)] = attr
        return attr


class FakePoint:
    def __init__(self, x, y, fb_name=None):
        self.objectType = 'adsk::fusion::SketchPoint'
        self.geometry = types.SimpleNamespace(x=x, y=y)
        self.x = x
        self.y = y
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)
            self.attributes.add('FrameBuilder', 'ID', fb_name)
        self.nativeObject = None


class FakeLine:
    def __init__(self, start, end, fb_name=None):
        self.objectType = 'adsk::fusion::SketchLine'
        self.startSketchPoint = start
        self.endSketchPoint = end
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)
            self.attributes.add('FrameBuilder', 'ID', fb_name)


class FakeArc:
    def __init__(self, start, end, center, radius, fb_name=None):
        self.objectType = 'adsk::fusion::SketchArc'
        self.startSketchPoint = start
        self.endSketchPoint = end
        self.centerSketchPoint = center
        self.geometry = types.SimpleNamespace(center=center.geometry, radius=radius)
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)
            self.attributes.add('FrameBuilder', 'ID', fb_name)


class FakePerpendicular:
    def __init__(self, line_a, line_b, fb_name=None):
        self.objectType = 'adsk::fusion::PerpendicularConstraint'
        self.lineOne = line_a
        self.lineTwo = line_b
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)


class FakeLinearDim:
    def __init__(self, point_a, point_b, expr, fb_name=None):
        self.objectType = 'adsk::fusion::SketchLinearDimension'
        self.entityOne = point_a
        self.entityTwo = point_b
        self.parameter = types.SimpleNamespace(expression=expr)
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)


class FakeRadialDim:
    def __init__(self, arc, expr, fb_name=None):
        self.objectType = 'adsk::fusion::SketchRadialDimension'
        self.entity = arc
        self.parameter = types.SimpleNamespace(expression=expr)
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)


def _build_mixed_selection():
    p1 = FakePoint(2.0, 3.0)
    p2 = FakePoint(-1.0, 4.0)
    p3 = FakePoint(1.0, -2.0)
    p4 = FakePoint(4.0, 2.0)
    pc = FakePoint(0.5, 1.2)
    line1 = FakeLine(p1, p2, fb_name='horn_TL')
    line2 = FakeLine(p3, p4, fb_name='brace_BR')
    arc = FakeArc(p3, p4, pc, 2.8255, fb_name='arc_shoulder_L')
    perp = FakePerpendicular(line1, line2, fb_name='perp_1')
    lin_dim = FakeLinearDim(p1, p2, 'widthIn', fb_name='dim_width')
    rad_dim = FakeRadialDim(arc, 'radius', fb_name='dim_shoulder_r')
    return [line1, arc, perp, lin_dim, rad_dim]


def test_constraint_on_lines_uses_quoted_names():
    _use_params(_params_with_radius)
    payload = template_generator.build_template_payload(_build_mixed_selection())
    code = payload['codePreview']
    phase = payload['phaseBlockCode']

    # codePreview and phaseBlockCode both render the phase-step dict literal
    # ({'Type': 'PerpendicularConstraint', 'Name': 'perp_1',
    #   'Targets': ["horn_TL", "brace_BR"]}). The constraint's own
    # FrameBuilder name lands in the ``Name`` key; its two line targets land
    # quoted inside the ``Targets`` list. Arrow syntax (``start->end``)
    # must never appear — constraints take IDs, not coord tuples.
    for line in code.splitlines():
        if 'PerpendicularConstraint' in line:
            assert "'Name': 'perp_1'" in line, (
                f'expected Name key carrying constraint ID, got: {line}'
            )
            assert '"horn_TL"' in line and '"brace_BR"' in line, (
                f'expected quoted line names in Targets list, got: {line}'
            )
            assert '->' not in line, (
                f'arrow syntax leaked into constraint: {line}'
            )
    # Same constraint should land in the phase block as a real step, with
    # both the constraint's own Name and its Targets populated.
    assert "'Type': 'PerpendicularConstraint'" in phase
    assert "'Name': 'perp_1'" in phase
    assert "'Targets': [\"horn_TL\", \"brace_BR\"]" in phase


def test_dimensions_reach_phase_block():
    _use_params(_params_with_radius)
    payload = template_generator.build_template_payload(_build_mixed_selection())
    phase = payload['phaseBlockCode']

    # Previously, both dims dropped to `# Dimensions.X(...)` comments. They
    # must now appear as real build-sequence dict entries with the fields
    # Frame Builder needs.
    assert "'DimType': 'SketchLinearDimension'" in phase, phase
    assert "'DimType': 'SketchRadialDimension'" in phase, phase
    assert 'dim_width' in phase and 'dim_shoulder_r' in phase
    # Radial dim uses a single Target, linear uses Targets (plural).
    assert "'Target': \"arc_shoulder_L\"" in phase
    # And no dimension should have fallen through to a comment.
    for line in phase.splitlines():
        assert not line.lstrip().startswith('# Dimensions.'), (
            f'dimension fell through as comment: {line}'
        )


def test_rename_flow_updates_generated_code():
    """Rename an initially-unnamed line and confirm the regenerated code
    carries the new ID through every place it appears — Seeds.Line, the
    phase-block dict, and any constraint that references it."""

    _use_params(_params_with_radius)

    # Start with an unnamed line and a perpendicular constraint that uses it.
    p_a = FakePoint(0.0, 0.0)
    p_b = FakePoint(1.0, 1.0)
    p_c = FakePoint(2.0, 0.0)
    p_d = FakePoint(3.0, 1.0)
    unnamed = FakeLine(p_a, p_b)  # no FrameBuilder name yet
    helper = FakeLine(p_c, p_d, fb_name='helper_line')
    perp = FakePerpendicular(unnamed, helper, fb_name='perp_unnamed')

    before = template_generator.build_template_payload([unnamed, helper, perp])
    before_code = before['codePreview']

    # Before rename: the unnamed line should render with the placeholder type
    # (or at minimum NOT carry a project-specific name yet).
    assert 'horn_upper_arm' not in before_code

    # Simulate a Rename Selection click. The helper already has a real name
    # so it should be skipped; the unnamed one gets a prefix-based ID.
    count = rename_selection([unnamed, helper, perp], phase_prefix='p04_torso')
    assert count >= 1, 'expected at least one rename'

    # Manually replace the auto-prefix name with a user-style name to mimic
    # the user typing one in afterwards — exercises the same attribute path.
    unnamed.attributes.add('FrameBuilder', 'name', 'horn_upper_arm')
    unnamed.attributes.add('FrameBuilder', 'ID', 'horn_upper_arm')

    after = template_generator.build_template_payload([unnamed, helper, perp])
    after_code = after['codePreview']
    after_phase = after['phaseBlockCode']

    assert 'horn_upper_arm' in after_code, (
        f'expected new name to appear in regenerated preview; got:\n{after_code}'
    )
    assert 'horn_upper_arm' in after_phase, (
        f'expected new name to appear in phase block; got:\n{after_phase}'
    )
    # The constraint should now reference the renamed line by its new name.
    for line in after_code.splitlines():
        if 'PerpendicularConstraint' in line:
            assert '"horn_upper_arm"' in line, (
                f'constraint still references old name: {line}'
            )


if __name__ == '__main__':
    test_constraint_on_lines_uses_quoted_names()
    test_dimensions_reach_phase_block()
    test_rename_flow_updates_generated_code()
    print('OK')
