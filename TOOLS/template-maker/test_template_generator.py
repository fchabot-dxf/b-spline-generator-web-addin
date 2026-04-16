import sys
import types
from pathlib import Path

# Ensure the template-maker package folder is importable.
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Provide a minimal fake Fusion 360 runtime so imports succeed outside Fusion.
adsk = types.ModuleType('adsk')
adsk_core = types.ModuleType('adsk.core')
adsk_fusion = types.ModuleType('adsk.fusion')
adsk.core = adsk_core
adsk.fusion = adsk_fusion
sys.modules['adsk'] = adsk
sys.modules['adsk.core'] = adsk_core
sys.modules['adsk.fusion'] = adsk_fusion

# Minimal Application stub used by expression_coords if accidentally invoked.
class _FakeApplication:
    @staticmethod
    def get():
        return None

adsk_core.Application = _FakeApplication

# Import the generator modules after stubbing adsk.
import expression_coords
import template_generator


def fake_design_params():
    return {
        'widthIn': {'expression': '7 "', 'value': 7.0},
        'heightIn': {'expression': '9 "', 'value': 9.0}
    }

# Patch design param lookup in both modules.
template_generator.get_design_params = fake_design_params
expression_coords.get_design_params = fake_design_params


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
        self.objectType = 'SketchPoint'
        self.geometry = types.SimpleNamespace(x=x, y=y)
        self.x = x
        self.y = y
        self.attributes = FakeAttributes({'name': name} if name else None)
        self.nativeObject = None


class FakeSketchLine:
    def __init__(self, start, end, name=None):
        self.objectType = 'SketchLine'
        self.startSketchPoint = start
        self.endSketchPoint = end
        self.attributes = FakeAttributes({'name': name} if name else None)


class FakeSketchArc:
    def __init__(self, start, end, center, radius, name=None, start_id=None, end_id=None, center_id=None):
        self.objectType = 'SketchArc'
        self.startSketchPoint = start
        self.endSketchPoint = end
        self.centerSketchPoint = center
        self.geometry = types.SimpleNamespace(center=center.geometry if center else None, radius=radius)
        self.attributes = FakeAttributes({
            'name': name,
            'StartID': start_id,
            'EndID': end_id,
            'CenterID': center_id
        })


def build_fake_selection():
    p1 = FakePoint(2.0, 3.0)
    p2 = FakePoint(-1.0, 4.0)
    p3 = FakePoint(1.0, -2.0)
    p4 = FakePoint(4.0, 2.0)
    p_center = FakePoint(0.5, 1.2)

    line = FakeSketchLine(p1, p2, name='horn_TL')
    arc = FakeSketchArc(
        start=p3,
        end=p4,
        center=p_center,
        radius=2.8255,
        name='arc_shoulder_L',
        start_id='arc_shoulder_L:S',
        end_id='arc_shoulder_L:E',
        center_id='arc_shoulder_L:C'
    )
    return [line, arc]


def run_test():
    entities = build_fake_selection()
    payload = template_generator.build_template_payload(entities)
    print('=== Payload Summary ===')
    print(f"count={payload['count']}")
    print(f"items={len(payload['items'])}")
    print()
    print('=== Generated Code Preview ===')
    print(payload['codePreview'])
    print()
    print('=== Item Details ===')
    for item in payload['items']:
        print('---')
        print('name:', item['name'])
        print('coord:', item['coord'])
        print('coordExpr:', item['coordExpr'])
        print('hint:', item['hint'])
        print('meta:', item['meta'])

    assert payload['count'] == 2, 'expected 2 selected entities'
    assert len(payload['items']) == 2, 'expected 2 items in payload'
    assert any('coordExpr' in item and item['coordExpr'] for item in payload['items']), 'expected coordExpr for items'
    assert any('widthIn' in item['coordExpr'] or 'heightIn' in item['coordExpr'] for item in payload['items']), 'expected design parameter expressions in coordExpr'
    assert 'seeds.append(' in payload['codePreview'], 'expected seed code in preview'
    full_code = template_generator._default_header('test_template.py', 'T2') + payload['codePreview'] + template_generator._default_footer()
    compile(full_code, '<string>', 'exec')
    print('\nTest passed.')


if __name__ == '__main__':
    run_test()
