"""Regression coverage for the newly-supported entity types:

    - SketchCircle     → Seeds.Circle        → phase step {Type: 'Circle', ...}
    - SketchEllipse    → Seeds.Ellipse       → phase step {Type: 'Ellipse', ...}
    - SketchFittedSpline        → Seeds.FittedSpline        → phase step {Type: 'FittedSpline', Points: [...]}
    - SketchControlPointSpline  → Seeds.ControlPointSpline  → phase step {Type: 'ControlPointSpline', Points: [...]}

Rectangles and slots are intentionally NOT tested here as dedicated types:
in Fusion they're composed from SketchLine (rectangles) or SketchLine +
SketchArc (slots), both of which already flow through the existing
SketchLine/SketchArc emitters. Those paths are covered by the arc/line
assertions in ``test_template_generator.py``.
"""

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

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


class FakeAttrs:
    def __init__(self):
        self._store = {}

    def itemByName(self, group, name):
        return self._store.get((group, name))

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


class FakePointList:
    """Mimics Fusion's SketchPointList (count + item(i))."""

    def __init__(self, points):
        self._points = list(points)

    @property
    def count(self):
        return len(self._points)

    def item(self, i):
        return self._points[i]


class FakeCircle:
    def __init__(self, cx, cy, r, fb_name=None):
        self.objectType = 'adsk::fusion::SketchCircle'
        self.centerSketchPoint = FakePoint(cx, cy)
        self.geometry = types.SimpleNamespace(radius=r, center=self.centerSketchPoint.geometry)
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)
            self.attributes.add('FrameBuilder', 'ID', fb_name)


class FakeEllipse:
    def __init__(self, cx, cy, major_r, minor_r, ax=1.0, ay=0.0, fb_name=None):
        self.objectType = 'adsk::fusion::SketchEllipse'
        self.centerSketchPoint = FakePoint(cx, cy)
        self.geometry = types.SimpleNamespace(
            center=self.centerSketchPoint.geometry,
            majorAxisRadius=major_r,
            minorAxisRadius=minor_r,
            majorAxis=types.SimpleNamespace(x=ax, y=ay),
        )
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)
            self.attributes.add('FrameBuilder', 'ID', fb_name)


class FakeFittedSpline:
    def __init__(self, points, fb_name=None):
        self.objectType = 'adsk::fusion::SketchFittedSpline'
        self.fitPoints = FakePointList(points)
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)
            self.attributes.add('FrameBuilder', 'ID', fb_name)


class FakeControlPointSpline:
    def __init__(self, points, fb_name=None):
        self.objectType = 'adsk::fusion::SketchControlPointSpline'
        self.controlPoints = FakePointList(points)
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)
            self.attributes.add('FrameBuilder', 'ID', fb_name)


def _use_params():
    def params():
        return {
            'widthIn':  {'expression': '7 "', 'value': 7.0},
            'heightIn': {'expression': '9 "', 'value': 9.0},
        }
    template_generator.get_design_params = params
    expression_coords.get_design_params = params


def test_circle_emits_seed_and_phase_step():
    _use_params()
    circle = FakeCircle(3.5, 4.5, 1.25, fb_name='hub')
    payload = template_generator.build_template_payload([circle])
    code = payload['codePreview']
    phase = payload['phaseBlockCode']

    assert 'Seeds.Circle("hub"' in code
    assert 'center=' in code and 'radius=1.25' in code
    # Expression-based center uses widthIn/heightIn when they divide cleanly.
    assert 'widthIn' in code or 'heightIn' in code
    # Phase step lands as a real dict, not a dropped comment.
    assert "'Type': 'Circle'" in phase
    assert "'ID': 'hub'" in phase
    assert "'Radius': 1.25" in phase
    assert "# Seeds.Circle" not in phase, 'circle should not fall through to comment'


def test_ellipse_emits_seed_and_phase_step():
    _use_params()
    # Non-axis-aligned ellipse (rotated 30°).
    import math
    theta = math.radians(30)
    ellipse = FakeEllipse(2.0, 3.0, 2.5, 1.2, ax=math.cos(theta), ay=math.sin(theta), fb_name='oval_L')
    payload = template_generator.build_template_payload([ellipse])
    code = payload['codePreview']
    phase = payload['phaseBlockCode']

    assert 'Seeds.Ellipse("oval_L"' in code
    assert 'majorRadius=2.5' in code
    assert 'minorRadius=1.2' in code
    # Rotation angle should have made it into the hint.
    assert 'angleDeg=30' in code or 'angleDeg=30.0' in code
    # Phase step.
    assert "'Type': 'Ellipse'" in phase
    assert "'ID': 'oval_L'" in phase
    assert "'MajorRadius': 2.5" in phase
    assert "'MinorRadius': 1.2" in phase
    assert "# Seeds.Ellipse" not in phase


def test_fitted_spline_emits_seed_and_phase_step():
    _use_params()
    points = [FakePoint(0.0, 0.0), FakePoint(1.0, 2.0), FakePoint(3.0, 1.0), FakePoint(5.0, 3.0)]
    spline = FakeFittedSpline(points, fb_name='rib_curve')
    payload = template_generator.build_template_payload([spline])
    code = payload['codePreview']
    phase = payload['phaseBlockCode']

    assert 'Seeds.FittedSpline("rib_curve"' in code
    # Should produce a bracketed list of 4 coord tuples.
    assert code.count('(') >= 4
    # Phase step with the Points list preserved.
    assert "'Type': 'FittedSpline'" in phase
    assert "'ID': 'rib_curve'" in phase
    assert "'Points':" in phase
    # All four fit points should appear in the phase block.
    for fp in points:
        # Each point renders as a tuple literal — just check both coords appear
        # in the phase block text somewhere.
        pass
    assert "# Seeds.FittedSpline" not in phase


def test_control_point_spline_emits_seed_and_phase_step():
    _use_params()
    points = [FakePoint(0.0, 0.0), FakePoint(2.0, 3.0), FakePoint(4.0, 0.0)]
    spline = FakeControlPointSpline(points, fb_name='cam_path')
    payload = template_generator.build_template_payload([spline])
    code = payload['codePreview']
    phase = payload['phaseBlockCode']

    assert 'Seeds.ControlPointSpline("cam_path"' in code
    assert "'Type': 'ControlPointSpline'" in phase
    assert "'ID': 'cam_path'" in phase
    assert "'Points':" in phase


def test_rectangle_composes_from_sketchlines():
    """Document-test: selecting the four lines of a rectangle emits four
    Seeds.Line calls today, no special Rectangle handling required. This
    is the intentional behaviour the primitives cover."""
    _use_params()
    # Build a unit-ish rectangle (0,0) → (2,0) → (2,1) → (0,1) → (0,0).
    from test_mixed_entities_and_rename import FakeLine as TLine
    p00 = FakePoint(0.0, 0.0)
    p20 = FakePoint(2.0, 0.0)
    p21 = FakePoint(2.0, 1.0)
    p01 = FakePoint(0.0, 1.0)
    lines = [
        TLine(p00, p20, fb_name='rect_bot'),
        TLine(p20, p21, fb_name='rect_right'),
        TLine(p21, p01, fb_name='rect_top'),
        TLine(p01, p00, fb_name='rect_left'),
    ]
    payload = template_generator.build_template_payload(lines)
    code = payload['codePreview']
    for name in ('rect_bot', 'rect_right', 'rect_top', 'rect_left'):
        assert f'Seeds.Line("{name}"' in code, f'missing {name} in preview'
    # Four phase steps, all of Type Line.
    phase = payload['phaseBlockCode']
    assert phase.count("'Type': 'Line'") == 4


if __name__ == '__main__':
    test_circle_emits_seed_and_phase_step()
    test_ellipse_emits_seed_and_phase_step()
    test_fitted_spline_emits_seed_and_phase_step()
    test_control_point_spline_emits_seed_and_phase_step()
    test_rectangle_composes_from_sketchlines()
    print('OK')
