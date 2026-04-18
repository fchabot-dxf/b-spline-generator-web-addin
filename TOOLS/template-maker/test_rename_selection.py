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

import rename_selection
import template_generator
import template_payload


def fake_attrs(values=None):
    class FakeAttributes:
        def __init__(self, values=None):
            self._values = values or {}

        def itemByName(self, group, name):
            value = self._values.get(name)
            if value is None:
                return None
            return types.SimpleNamespace(value=value)

        def add(self, group, name, value):
            self._values[name] = value

    return FakeAttributes(values)


class FakeSketchEntity:
    def __init__(self, object_type, name=None):
        self.objectType = object_type
        self.attributes = fake_attrs({'name': name} if name else None)
        self.nativeObject = None
        self.name = name


class FakeSketchLine(FakeSketchEntity):
    def __init__(self, name=None):
        super().__init__('SketchLine', name=name)
        self.startSketchPoint = types.SimpleNamespace(objectType='SketchPoint', geometry=types.SimpleNamespace(x=0, y=0), attributes=fake_attrs())
        self.endSketchPoint = types.SimpleNamespace(objectType='SketchPoint', geometry=types.SimpleNamespace(x=1, y=0), attributes=fake_attrs())


class FakeSketchArc(FakeSketchEntity):
    def __init__(self, name=None):
        super().__init__('SketchArc', name=name)
        self.startSketchPoint = types.SimpleNamespace(objectType='SketchPoint', geometry=types.SimpleNamespace(x=0, y=0), attributes=fake_attrs())
        self.endSketchPoint = types.SimpleNamespace(objectType='SketchPoint', geometry=types.SimpleNamespace(x=1, y=0), attributes=fake_attrs())
        self.centerSketchPoint = types.SimpleNamespace(objectType='SketchPoint', geometry=types.SimpleNamespace(x=0.5, y=0.5), attributes=fake_attrs())
        self.geometry = types.SimpleNamespace(center=self.centerSketchPoint.geometry, radius=1.0)


def run_test():
    # Phase prefix generation
    phase_prefix = rename_selection.build_phase_prefix('p03', 'anatomy')
    assert phase_prefix == 'p03_anatomy', f'expected phase prefix, got {phase_prefix}'

    # Entity name assignment
    line = FakeSketchLine()
    rename_selection.set_entity_fb_name(line, 'p03_anatomy_SketchLine_01')
    assert line.attributes.itemByName('FrameBuilder', 'ID').value == 'p03_anatomy_SketchLine_01'
    assert line.attributes.itemByName('FrameBuilder', 'name').value == 'p03_anatomy_SketchLine_01'

    # Rename selection with generic entities
    unnamed1 = FakeSketchLine()
    unnamed2 = FakeSketchLine()
    renamed = rename_selection.rename_selection([unnamed1, unnamed2], phase_prefix='p03_anatomy')
    assert renamed == 2, f'expected two renamed entities, got {renamed}'
    id1 = unnamed1.attributes.itemByName('FrameBuilder', 'name').value
    id2 = unnamed2.attributes.itemByName('FrameBuilder', 'name').value
    assert id1 != id2, 'expected unique names for renamed selection'
    assert id1.startswith('p03_anatomy_SketchLine'), f'unexpected id1 {id1}'
    assert id2.startswith('p03_anatomy_SketchLine'), f'unexpected id2 {id2}'

    # Ensure renamed labels appear in generated template payload hints
    payload = template_generator.build_template_payload([unnamed1, unnamed2], phase_prefix='p03_anatomy')
    assert payload['items'][0]['name'] == id1
    assert payload['items'][1]['name'] == id2
    assert id1 in payload['items'][0]['hint']
    assert id2 in payload['items'][1]['hint']

    # Existing FrameBuilder:ID must be preserved on rename, even when the
    # user runs Rename Selection again. Fresh entities in the same pass
    # must still get unique names (not collide with the preserved ID).
    preserved = FakeSketchLine()
    preserved.attributes = fake_attrs({'ID': 'horn_TL', 'name': 'horn_TL'})
    preserved.name = 'horn_TL'
    fresh = FakeSketchLine()
    renamed = rename_selection.rename_selection([preserved, fresh], phase_prefix='p03_anatomy')
    assert renamed == 1, f'expected exactly one renamed entity (fresh only), got {renamed}'
    assert preserved.attributes.itemByName('FrameBuilder', 'ID').value == 'horn_TL', \
        'preserved FrameBuilder:ID was clobbered by rename_selection'
    assert preserved.attributes.itemByName('FrameBuilder', 'name').value == 'horn_TL', \
        'preserved FrameBuilder:name was clobbered by rename_selection'
    fresh_name = fresh.attributes.itemByName('FrameBuilder', 'name').value
    assert fresh_name != 'horn_TL', f'fresh entity collided with preserved ID: {fresh_name}'
    assert fresh_name.startswith('p03_anatomy_SketchLine'), f'unexpected fresh name {fresh_name}'

    print('test_rename_selection passed')


if __name__ == '__main__':
    run_test()
