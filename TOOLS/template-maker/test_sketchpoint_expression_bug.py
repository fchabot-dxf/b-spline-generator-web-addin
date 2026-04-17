"""
Reproduces BUG_FIX_CONTEXT_SHEET.md: Seeds.Line/Seeds.Arc hints fall back to
named IDs / placeholders instead of expression coords on real SketchPoints.

The existing test_template_generator.py hides the bug because its FakePoint
exposes `.x`/`.y` directly. Real Fusion SketchPoints only expose coordinates
via `.geometry.x` / `.geometry.y` — which is what this test simulates.
"""
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Stub adsk before importing template modules.
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


def fake_design_params():
    return {
        'widthIn': {'expression': '7 "', 'value': 7.0},
        'heightIn': {'expression': '9 "', 'value': 9.0},
    }


template_generator.get_design_params = fake_design_params
expression_coords.get_design_params = fake_design_params


class _Attrs:
    def __init__(self, values=None):
        self._v = values or {}

    def itemByName(self, group, name):
        val = self._v.get(name)
        if val is None:
            return None
        return types.SimpleNamespace(value=val)


class RealLikeSketchPoint:
    """Mimics Fusion SketchPoint: coords live on .geometry only, NOT directly."""
    def __init__(self, x, y, name=None):
        self.objectType = 'adsk::fusion::SketchPoint'
        self.geometry = types.SimpleNamespace(x=x, y=y)
        self.attributes = _Attrs({'name': name} if name else None)
        self.nativeObject = None
        # NOTE: deliberately NO self.x / self.y here.


class RealLikeSketchLine:
    def __init__(self, start, end, name=None):
        self.objectType = 'adsk::fusion::SketchLine'
        self.startSketchPoint = start
        self.endSketchPoint = end
        self.attributes = _Attrs({'name': name} if name else None)
        self.nativeObject = None
        self.geometry = types.SimpleNamespace(
            startPoint=start.geometry,
            endPoint=end.geometry,
        )


def test_sketchline_hint_contains_parameter_expressions_for_real_sketchpoint():
    p1 = RealLikeSketchPoint(7.0, 0.0, name='p1')   # == widthIn, 0
    p2 = RealLikeSketchPoint(0.0, 9.0, name='p2')   # == 0, heightIn
    line = RealLikeSketchLine(p1, p2, name='horn_TL')

    payload = template_generator.build_template_payload([line])
    item = payload['items'][0]

    print('hint      :', item['hint'])
    print('coordExpr :', item['coordExpr'])

    assert 'widthIn' in item['hint'] or 'heightIn' in item['hint'], (
        f"BUG: Seeds.Line hint did not use parameter expressions. "
        f"Got: {item['hint']!r}"
    )


if __name__ == '__main__':
    test_sketchline_hint_contains_parameter_expressions_for_real_sketchpoint()
    print('OK')
