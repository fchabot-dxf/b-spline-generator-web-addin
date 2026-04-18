import sys
import json
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

# Minimal event handler base classes used by the template bridge module.
adsk_core.ActiveSelectionEventHandler = type('ActiveSelectionEventHandler', (object,), {})
adsk_core.DocumentEventHandler = type('DocumentEventHandler', (object,), {})
adsk_core.HTMLEventHandler = type('HTMLEventHandler', (object,), {})
adsk_core.CommandCreatedEventHandler = type('CommandCreatedEventHandler', (object,), {})


class FakeHTMLEventArgs:
    def __init__(self, action, data=None):
        self.action = action
        self.data = data
        self.returnData = None

    @staticmethod
    def cast(args):
        return args


adsk_core.HTMLEventArgs = FakeHTMLEventArgs


class FakeAttributeStore:
    def __init__(self, values=None):
        self._values = values or {}

    def itemByName(self, group, name):
        if name in self._values:
            return types.SimpleNamespace(value=self._values[name])
        return None

    def add(self, group, name, value):
        self._values[name] = value


class FakeSketchPoint:
    def __init__(self, x, y, name=None, parent_sketch=None,
                 is_reference=False, referenced_entity=None,
                 fb_id=None):
        self.objectType = 'SketchPoint'
        self.x = x
        self.y = y
        self.geometry = types.SimpleNamespace(x=x, y=y)
        attrs = {}
        if name:
            attrs['name'] = name
        if fb_id:
            attrs['ID'] = fb_id
        self.attributes = FakeAttributeStore(attrs or None)
        self.nativeObject = None
        self.parentSketch = parent_sketch
        self.isReference = is_reference
        self.referencedEntity = referenced_entity


class FakeSketchLine:
    def __init__(self, start, end, name=None, parent_sketch=None,
                 is_reference=False, referenced_entity=None,
                 fb_id=None):
        self.objectType = 'SketchLine'
        self.startSketchPoint = start
        self.endSketchPoint = end
        attrs = {}
        if name:
            attrs['name'] = name
        if fb_id:
            attrs['ID'] = fb_id
        self.attributes = FakeAttributeStore(attrs or None)
        self.nativeObject = None
        self.parentSketch = parent_sketch
        self.isReference = is_reference
        self.referencedEntity = referenced_entity


class FakeSketchArc:
    def __init__(self, start, end, center, radius, name=None):
        self.objectType = 'SketchArc'
        self.startSketchPoint = start
        self.endSketchPoint = end
        self.centerSketchPoint = center
        self.geometry = types.SimpleNamespace(center=center.geometry if center else None, radius=radius)
        self.attributes = FakeAttributeStore({'name': name} if name else None)
        self.nativeObject = None


class FakeSelection:
    def __init__(self, entity):
        self.entity = entity


class FakeSelectionList:
    def __init__(self, entities):
        self._entities = entities

    @property
    def count(self):
        return len(self._entities)

    def item(self, index):
        return self._entities[index]


class FakePalette:
    def __init__(self):
        self.isValid = True
        self.isVisible = True
        self.sent = []

    def sendInfoToHTML(self, action, payload):
        self.sent.append((action, payload))


class FakePaletteCollection:
    def __init__(self, palette):
        self._palette = palette

    def itemById(self, palette_id):
        return self._palette


class FakeUI:
    def __init__(self, palette, selections, active_document=None):
        self.palettes = FakePaletteCollection(palette)
        self.activeSelections = selections
        self.activeDocument = active_document


class FakeDocument:
    def __init__(self, full_filename=None, name=None):
        self.fullFilename = full_filename
        self.name = name


_fake_app = None


class FakeApplication:
    def __init__(self, ui, active_document=None):
        self.userInterface = ui
        self.activeDocument = active_document

    @staticmethod
    def get():
        return _fake_app


adsk_core.Application = FakeApplication

import template_bridge


def make_fake_app(selection_entities, document=None):
    palette = FakePalette()
    selections = FakeSelectionList([FakeSelection(ent) for ent in selection_entities])
    ui = FakeUI(palette, selections, active_document=document)
    global _fake_app
    _fake_app = FakeApplication(ui, active_document=document)
    return ui, palette


def test_phase_prefix_and_name():
    template_bridge._latest_phase_id = 'p02'
    template_bridge._latest_sketch_name = 'anatomy'

    assert template_bridge._get_phase_prefix() == 'p02_anatomy'
    assert template_bridge._get_phase_name() == 'p02_anatomy'

    template_bridge._latest_sketch_name = ''
    assert template_bridge._get_phase_prefix() == 'p02'
    assert template_bridge._get_phase_name() == 'p02'

    template_bridge._latest_phase_id = ''
    template_bridge._latest_sketch_name = 'anatomy'
    assert template_bridge._get_phase_prefix() == 'anatomy'
    assert template_bridge._get_phase_name() == 'anatomy'


def test_push_selection_to_palette_sends_update():
    start = FakeSketchPoint(0.0, 0.0)
    end = FakeSketchPoint(1.0, 0.0)
    line = FakeSketchLine(start, end)
    doc = FakeDocument(full_filename='test.f3d')
    ui, palette = make_fake_app([line], document=doc)

    template_bridge._last_sel_ids = ''
    template_bridge._latest_payload = ''
    template_bridge._latest_phase_id = 'p01'
    template_bridge._latest_sketch_name = 'anatomy'
    template_bridge._latest_template_number = 'T2'

    template_bridge._push_selection_to_palette()

    assert len(palette.sent) == 1, 'expected one palette update'
    action, payload = palette.sent[0]
    assert action == 'update'
    payload_obj = json.loads(payload)
    assert payload_obj['count'] == 1
    assert payload_obj['phaseBlockCode']
    assert payload_obj['headerText']


def test_html_event_poll_returns_last_payload():
    ui, palette = make_fake_app([], document=FakeDocument(full_filename='test.f3d'))
    template_bridge._latest_payload = '{"count":0}'
    args = FakeHTMLEventArgs('poll')

    handler = template_bridge.HTMLEventHandler()
    handler.notify(args)

    assert args.returnData == template_bridge._latest_payload


def test_html_event_settings_applies_values_and_refreshes():
    start = FakeSketchPoint(0.0, 0.0)
    end = FakeSketchPoint(1.0, 0.0)
    line = FakeSketchLine(start, end)
    doc = FakeDocument(full_filename='sample.f3d')
    ui, palette = make_fake_app([line], document=doc)

    template_bridge._latest_phase_id = 'p01'
    template_bridge._latest_sketch_name = ''
    template_bridge._latest_template_number = 'T2'
    template_bridge._last_sel_ids = ''

    args = FakeHTMLEventArgs('settings', json.dumps({'phaseId': 'p04', 'sketchName': 'anatomy', 'templateNumber': 'T3'}))
    handler = template_bridge.HTMLEventHandler()
    handler.notify(args)

    assert args.returnData == 'ok'
    assert template_bridge._latest_phase_id == 'p04'
    assert template_bridge._latest_sketch_name == 'anatomy'
    assert template_bridge._latest_template_number == 'T3'
    assert len(palette.sent) == 1
    payload_obj = json.loads(palette.sent[0][1])
    assert payload_obj['count'] == 1
    assert payload_obj['mainFeature'] == 'SketchLine'


def test_html_event_rename_applies_framebuilder_metadata():
    start = FakeSketchPoint(0.0, 0.0)
    end = FakeSketchPoint(1.0, 0.0)
    line = FakeSketchLine(start, end)
    doc = FakeDocument(name='Sketch1')
    ui, palette = make_fake_app([line], document=doc)

    template_bridge._latest_phase_id = 'p05'
    template_bridge._latest_sketch_name = 'anatomy'
    template_bridge._latest_template_number = 'T2'
    template_bridge._last_sel_ids = ''

    args = FakeHTMLEventArgs('rename', json.dumps({'phaseId': 'p05', 'sketchName': 'anatomy'}))
    handler = template_bridge.HTMLEventHandler()
    handler.notify(args)

    assert args.returnData == 'ok'
    assert len(palette.sent) == 1
    fb_id = line.attributes.itemByName('FrameBuilder', 'ID')
    fb_name = line.attributes.itemByName('FrameBuilder', 'name')
    assert fb_id and fb_id.value
    assert fb_name and fb_name.value
    assert fb_id.value == fb_name.value
    assert fb_id.value.startswith('p05_anatomy_')


def _fake_sketch(name):
    return types.SimpleNamespace(name=name)


def test_push_selection_projections_success():
    """A clean all-projected selection produces a projection block."""
    src_sketch = _fake_sketch('T2_1_bounding-box')
    src_line = FakeSketchLine(
        FakeSketchPoint(0.0, 0.0),
        FakeSketchPoint(1.0, 0.0),
        fb_id='BB_corner_TL',
        parent_sketch=src_sketch,
    )
    # The projected copy in the current sketch: isReference=True, points back
    # at src_line.
    projected = FakeSketchLine(
        FakeSketchPoint(0.0, 0.0),
        FakeSketchPoint(1.0, 0.0),
        is_reference=True,
        referenced_entity=src_line,
    )
    ui, palette = make_fake_app([projected], document=FakeDocument(full_filename='p.f3d'))

    template_bridge._last_sel_ids = ''
    template_bridge._latest_phase_id = 'p03_projs'
    template_bridge._latest_sketch_name = 'frame-enclosure'
    template_bridge._latest_template_number = 'T2'

    template_bridge._push_selection_to_palette()

    payload_obj = json.loads(palette.sent[-1][1])
    assert payload_obj['selectionKind'] == 'projections'
    assert payload_obj['projectionsOk'] is True
    assert payload_obj['projections'] == [{
        'SourceSketch': '1_bounding-box',
        'SourceID':     'BB_corner_TL',
        'TargetID':     'proj_BB_corner_TL',
    }]
    assert '1_bounding-box' in payload_obj['projectionsNote']
    assert 'get_block' in payload_obj['projectionsBlockCode']
    assert "'SourceID':" in payload_obj['projectionsBlockCode']


def test_push_selection_projections_untagged_refusal():
    """Projected pick with an untagged source refuses cleanly."""
    src_sketch = _fake_sketch('T2_1_bounding-box')
    # Source has no fb_id — this is the "upstream phase compromised" case.
    src_line = FakeSketchLine(
        FakeSketchPoint(0.0, 0.0),
        FakeSketchPoint(1.0, 0.0),
        parent_sketch=src_sketch,
    )
    projected = FakeSketchLine(
        FakeSketchPoint(0.0, 0.0),
        FakeSketchPoint(1.0, 0.0),
        is_reference=True,
        referenced_entity=src_line,
    )
    ui, palette = make_fake_app([projected], document=FakeDocument(full_filename='u.f3d'))

    template_bridge._last_sel_ids = ''
    template_bridge._latest_phase_id = 'p03_projs'
    template_bridge._latest_sketch_name = 'frame-enclosure'

    template_bridge._push_selection_to_palette()

    payload_obj = json.loads(palette.sent[-1][1])
    assert payload_obj['selectionKind'] == 'projections'
    assert payload_obj['projectionsOk'] is False
    assert payload_obj['projectionsReason'] == 'untagged_source'
    assert 'untagged' in payload_obj['projectionsError']
    assert payload_obj['projections'] == []
    assert payload_obj['projectionsBlockCode'] == ''


def test_push_selection_mixed_refusal():
    """Seeds + projections in one pick → mixed warning, no projection block."""
    src_sketch = _fake_sketch('T2_1_bounding-box')
    src_line = FakeSketchLine(
        FakeSketchPoint(0.0, 0.0),
        FakeSketchPoint(1.0, 0.0),
        fb_id='BB_corner_TL',
        parent_sketch=src_sketch,
    )
    projected = FakeSketchLine(
        FakeSketchPoint(0.0, 0.0),
        FakeSketchPoint(1.0, 0.0),
        is_reference=True,
        referenced_entity=src_line,
    )
    native = FakeSketchLine(
        FakeSketchPoint(2.0, 0.0),
        FakeSketchPoint(3.0, 0.0),
    )
    ui, palette = make_fake_app([projected, native], document=FakeDocument(full_filename='m.f3d'))

    template_bridge._last_sel_ids = ''
    template_bridge._latest_phase_id = 'p03_projs'
    template_bridge._latest_sketch_name = 'frame-enclosure'

    template_bridge._push_selection_to_palette()

    payload_obj = json.loads(palette.sent[-1][1])
    assert payload_obj['selectionKind'] == 'mixed'
    assert payload_obj['mixedPickWarning']
    assert payload_obj['projections'] == []
    assert payload_obj['projectionsOk'] is None


def test_push_selection_seeds_unchanged():
    """Plain seed selection leaves the new projection fields empty/defaults."""
    line = FakeSketchLine(
        FakeSketchPoint(0.0, 0.0),
        FakeSketchPoint(1.0, 0.0),
    )
    ui, palette = make_fake_app([line], document=FakeDocument(full_filename='s.f3d'))

    template_bridge._last_sel_ids = ''
    template_bridge._latest_phase_id = 'p01'
    template_bridge._latest_sketch_name = 'anatomy'

    template_bridge._push_selection_to_palette()

    payload_obj = json.loads(palette.sent[-1][1])
    assert payload_obj['selectionKind'] == 'seeds'
    assert payload_obj['projectionsOk'] is None
    assert payload_obj['projections'] == []
    # Seed path still emits its usual block code — unchanged behavior.
    assert payload_obj['phaseBlockCode']


def run_test():
    test_phase_prefix_and_name()
    test_push_selection_to_palette_sends_update()
    test_html_event_poll_returns_last_payload()
    test_html_event_settings_applies_values_and_refreshes()
    test_html_event_rename_applies_framebuilder_metadata()
    test_push_selection_projections_success()
    test_push_selection_projections_untagged_refusal()
    test_push_selection_mixed_refusal()
    test_push_selection_seeds_unchanged()
    print('test_template_bridge passed')


if __name__ == '__main__':
    run_test()
