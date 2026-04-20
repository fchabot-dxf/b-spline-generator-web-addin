import sys
import types
from pathlib import Path

# Ensure the template-maker package folder is importable.
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Minimal Fusion stub for import compatibility.
adsk = types.ModuleType('adsk')
adsk_core = types.ModuleType('adsk.core')
adsk_fusion = types.ModuleType('adsk.fusion')
adsk.core = adsk_core
adsk.fusion = adsk_fusion
sys.modules['adsk'] = adsk
sys.modules['adsk.core'] = adsk_core
sys.modules['adsk.fusion'] = adsk_fusion

# Minimal event-handler classes are not needed here, but keep the module present.
adsk_core.ActiveSelectionEventHandler = type('ActiveSelectionEventHandler', (), {})
adsk_core.DocumentEventHandler = type('DocumentEventHandler', (), {})
adsk_core.HTMLEventHandler = type('HTMLEventHandler', (), {})
adsk_core.CommandCreatedEventHandler = type('CommandCreatedEventHandler', (), {})

import template_naming


def test_safe_name_handles_spaces_and_symbols():
    assert template_naming.safe_name('Phase 01') == 'Phase_01'
    assert template_naming.safe_name(' anatomy  line ') == 'anatomy_line'
    assert template_naming.safe_name('A&B/C') == 'ABC'
    assert template_naming.safe_name(None) == ''


def test_get_parent_sketch_prefix_returns_safe_name():
    sketch = types.SimpleNamespace(name='Sketch Phase')
    entity = types.SimpleNamespace(parentSketch=sketch)
    assert template_naming.get_parent_sketch_prefix(entity) == 'Sketch_Phase'

    entity_no_parent = types.SimpleNamespace()
    assert template_naming.get_parent_sketch_prefix(entity_no_parent) is None


def test_make_unique_label_uses_phase_prefix_for_sketch_entities():
    sketch = types.SimpleNamespace(name='Sketch Phase')
    entity = types.SimpleNamespace(objectType='SketchLine', parentSketch=sketch)
    counters = {}

    first = template_naming.make_unique_label(entity, 'SketchLine', counters, phase_prefix='anatomy_p02')
    second = template_naming.make_unique_label(entity, 'SketchLine', counters, phase_prefix='anatomy_p02')

    assert first == 'anatomy_p02_SketchLine'
    assert second == 'anatomy_p02_SketchLine_02'


def test_make_unique_label_uses_sketch_prefix_when_no_phase_prefix():
    sketch = types.SimpleNamespace(name='Sketch Phase')
    entity = types.SimpleNamespace(objectType='SketchLine', parentSketch=sketch)
    counters = {}

    label = template_naming.make_unique_label(entity, 'SketchLine', counters)
    assert label == 'Sketch_Phase_SketchLine'


def test_make_unique_label_does_not_prefix_non_sketch_entities():
    entity = types.SimpleNamespace(objectType='Point')
    counters = {}

    label = template_naming.make_unique_label(entity, 'Point', counters, phase_prefix='p01')
    assert label == 'Point'


def run_test():
    test_safe_name_handles_spaces_and_symbols()
    test_get_parent_sketch_prefix_returns_safe_name()
    test_make_unique_label_uses_phase_prefix_for_sketch_entities()
    test_make_unique_label_uses_sketch_prefix_when_no_phase_prefix()
    test_make_unique_label_does_not_prefix_non_sketch_entities()
    print('test_template_naming passed')


if __name__ == '__main__':
    run_test()
