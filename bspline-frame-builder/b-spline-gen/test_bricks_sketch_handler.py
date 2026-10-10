"""
F35 item 11: b-spline-gen.py's "Bricks" sketch (PaletteHTMLEventHandler._apply_bricks_sketch and
its own helper _remove_named_sketch) -- the Python side of "send bricks with the B-spline".
Reuses test_colour_decal_handler.py's own Fusion-API fakes (_FakeBody/_FakeFace/_FakeOcc/
_import_group/_stamped_occ/_fake_geometry_types) for body/face/occurrence resolution -- the SAME
_find_stamped_component / _find_stamped_panel_body / _largest_area_face chain the decal already
exercises -- and adds the sketch/construction-plane/import-manager fakes _apply_bricks_sketch
additionally needs that the decal's own tests never touched.

MUST NEVER RAISE is the one property every test here checks for, same as the decal's own suite:
a bricks-sketch failure must never fail the rest of a Send.
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_colour_decal_handler import (  # noqa: E402  (shared Fusion-API fakes)
    bsg, _FakeBody, _FakeFace, _FakeOcc, _import_group, _stamped_occ, _fake_geometry_types,  # noqa: F401
)

import pytest  # noqa: E402


class _FakeSketch:
    def __init__(self, plane, owner=None):
        self.plane = plane
        self.name = ''
        self.deleted = False
        self._owner = owner

    def deleteMe(self):
        self.deleted = True
        if self._owner is not None and self in self._owner._items:
            self._owner._items.remove(self)


class _FakeSketches:
    def __init__(self):
        self._items = []

    def add(self, plane):
        s = _FakeSketch(plane, owner=self)
        self._items.append(s)
        return s

    def __iter__(self):
        return iter(self._items)

    def __len__(self):
        return len(self._items)


class _FakePlane:
    def __init__(self, name=''):
        self.name = name


class _FakePlaneInput:
    def __init__(self):
        self.offset_args = None

    def setByOffset(self, target_plane, offset_val):
        self.offset_args = (target_plane, offset_val)


class _FakeConstructionPlanes:
    def __init__(self):
        self.added = []

    def createInput(self):
        return _FakePlaneInput()

    def add(self, plane_input):
        p = _FakePlane()
        p._input = plane_input
        self.added.append(p)
        return p


def _face_with_bounding_box(area, peak=5.0):
    """_FakeFace (test_colour_decal_handler.py) only carries .area/.pointOnFace -- enough for
    _largest_area_face, but _compute_artwork_plane ALSO reads top_face.boundingBox.maxPoint.z (or
    .y for y-up), which the decal's own tests never touch (it only ever needs the largest face,
    never its bounding box)."""
    face = _FakeFace(area)
    face.boundingBox = types.SimpleNamespace(maxPoint=types.SimpleNamespace(x=peak, y=peak, z=peak))
    return face


def _bricks_component(body):
    """A Stamped occurrence's own component, extended with the sketch/construction-plane surface
    _apply_bricks_sketch additionally needs -- _FakeComponent itself (test_colour_decal_handler.py)
    stays untouched; these are plain extra attributes on one instance, not a shared-class change."""
    occ = _stamped_occ(body)
    comp = occ.component
    comp.sketches = _FakeSketches()
    comp.constructionPlanes = _FakeConstructionPlanes()
    comp.xYConstructionPlane = _FakePlane('XY')
    comp.xZConstructionPlane = _FakePlane('XZ')
    return occ, comp


class _FakeSvgImportOptions:
    def __init__(self, path):
        self.path = path
        self.scale = None


class _FakeImportManager:
    def __init__(self):
        self.import_calls = []

    def createSVGImportOptions(self, path):
        return _FakeSvgImportOptions(path)

    def importToTarget(self, options, sketch):
        self.import_calls.append((options, sketch))


@pytest.fixture(autouse=True)
def _fake_import_manager(monkeypatch):
    """_import_single_layer_svg reads adsk.core.Application.get().importManager directly --
    test_svg_layer_import_plan's own stub Application.get() returns None (a real "outside Fusion"
    state), which _apply_colour_decal's own tests never needed since decals don't import SVG."""
    fake_mgr = _FakeImportManager()

    class _FakeApp:
        importManager = fake_mgr

    monkeypatch.setattr(bsg.adsk.core.Application, 'get', staticmethod(lambda: _FakeApp()))
    return fake_mgr


@pytest.fixture(autouse=True)
def _fake_value_input(monkeypatch):
    """_compute_artwork_plane calls adsk.core.ValueInput.createByReal(...) -- the base stub
    (test_svg_layer_import_plan.py) declares ValueInput as a bare SimpleNamespace with no such
    method (never needed by the decal's own tests, which use Matrix3D instead)."""
    class _VI:
        def __init__(self, v):
            self.realValue = v

        @classmethod
        def createByReal(cls, v):
            return cls(v)

    monkeypatch.setattr(bsg.adsk.core, 'ValueInput', _VI, raising=False)


@pytest.fixture(autouse=True)
def _fake_board_size(monkeypatch):
    """_import_single_layer_svg falls back to _get_current_board_size() when `params` lacks
    widthIn/heightIn -- that function queries a real Fusion Design (adsk.fusion.Design.cast(...)),
    which this stub environment has none of. Bypassing it entirely: _PARAMS already supplies real
    widthIn/heightIn directly, so this fallback is never meant to be exercised by these tests."""
    monkeypatch.setattr(bsg, '_get_current_board_size', lambda: {'widthIn': 7, 'heightIn': 9})


_PARAMS = {'widthIn': 7, 'heightIn': 9}
_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><polygon points="0,0 1,0 1,1 0,1"/></svg>'


def _handler():
    return bsg.PaletteHTMLEventHandler()


class TestRemoveNamedSketch:
    def test_removes_only_the_named_sketch(self):
        comp = types.SimpleNamespace(sketches=_FakeSketches())
        keep = comp.sketches.add(None); keep.name = 'Other'
        target = comp.sketches.add(None); target.name = bsg.BRICKS_SKETCH_NAME
        n = bsg._remove_named_sketch(comp, bsg.BRICKS_SKETCH_NAME)
        assert n == 1
        assert target.deleted is True
        assert keep.deleted is False
        assert list(comp.sketches) == [keep]

    def test_zero_when_absent_is_a_safe_no_op(self):
        comp = types.SimpleNamespace(sketches=_FakeSketches())
        assert bsg._remove_named_sketch(comp, bsg.BRICKS_SKETCH_NAME) == 0

    def test_a_crash_never_propagates(self):
        class _Boom:
            def __iter__(self):
                raise RuntimeError('sketches exploded')
        comp = types.SimpleNamespace(sketches=_Boom())
        assert bsg._remove_named_sketch(comp, bsg.BRICKS_SKETCH_NAME) == 0


class TestApplyBricksSketch:
    def test_no_bricks_key_at_all_leaves_an_existing_sketch_untouched(self):
        """append sends `bricks: null` -- no instruction, same contract as the decal's own None."""
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])
        existing = comp.sketches.add(None); existing.name = bsg.BRICKS_SKETCH_NAME

        _handler()._apply_bricks_sketch(group, {}, _PARAMS)  # no 'bricks' key at all
        assert existing.deleted is False

        _handler()._apply_bricks_sketch(group, {'bricks': None}, _PARAMS)  # explicit None, same meaning
        assert existing.deleted is False
        assert len(comp.sketches) == 1

    def test_disabled_removes_an_existing_sketch(self):
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])
        existing = comp.sketches.add(None); existing.name = bsg.BRICKS_SKETCH_NAME

        _handler()._apply_bricks_sketch(group, {'bricks': {'enabled': False}}, _PARAMS)

        assert existing.deleted is True
        assert len(comp.sketches) == 0

    def test_disabled_with_none_present_is_a_safe_no_op(self):
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])
        _handler()._apply_bricks_sketch(group, {'bricks': {'enabled': False}}, _PARAMS)  # must not raise
        assert len(comp.sketches) == 0

    def test_no_stamped_component_enabled_is_skipped_not_raised(self):
        group = _import_group([])  # nothing sent at all
        _handler()._apply_bricks_sketch(group, {'bricks': {'enabled': True, 'svg': _SVG}}, _PARAMS)  # must not raise

    def test_enabled_with_no_existing_sketch_adds_exactly_one_named_bricks(self, _fake_import_manager):
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])

        _handler()._apply_bricks_sketch(group, {'bricks': {'enabled': True, 'svg': _SVG}}, _PARAMS)

        items = list(comp.sketches)
        assert len(items) == 1
        assert items[0].name == 'Bricks'  # exactly 'Bricks', NOT 'Source - Bricks'
        assert len(_fake_import_manager.import_calls) == 1

    def test_re_send_replaces_rather_than_duplicates(self, _fake_import_manager):
        """The exact scenario the brief itself names: enabled, re-Send, still exactly 1."""
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])
        payload = {'bricks': {'enabled': True, 'svg': _SVG}}

        _handler()._apply_bricks_sketch(group, payload, _PARAMS)
        first = list(comp.sketches)[0]
        _handler()._apply_bricks_sketch(group, payload, _PARAMS)

        items = list(comp.sketches)
        assert len(items) == 1  # never 2
        assert first.deleted is True  # the OLD one was actually removed, not just outnumbered
        assert items[0] is not first

    def test_missing_svg_data_is_skipped_not_raised(self):
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])
        _handler()._apply_bricks_sketch(group, {'bricks': {'enabled': True, 'svg': ''}}, _PARAMS)
        assert len(comp.sketches) == 0

    def test_a_fusion_api_crash_never_propagates(self, _fake_import_manager, monkeypatch):
        """The property the brief states outright: 'never fails a Send'."""
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])

        def boom(*a, **kw):
            raise RuntimeError('sketches.add exploded')
        monkeypatch.setattr(comp.sketches, 'add', boom)

        _handler()._apply_bricks_sketch(group, {'bricks': {'enabled': True, 'svg': _SVG}}, _PARAMS)  # must not raise

    def test_lands_in_the_stamped_component_not_clean_or_root(self, _fake_import_manager):
        """F35 item 12's own convention: never falls back to root/Clean when only Clean was sent."""
        clean_body = _FakeBody(faces=[_face_with_bounding_box(10)])
        clean_occ = _FakeOcc('Clean', bodies=[clean_body])
        group = _import_group([clean_occ])

        _handler()._apply_bricks_sketch(group, {'bricks': {'enabled': True, 'svg': _SVG}}, _PARAMS)  # must not raise, must not touch Clean

        assert not hasattr(clean_body.parentComponent, 'sketches') or len(getattr(clean_body.parentComponent, 'sketches', [])) == 0


class TestApplyBrickOutlineSketches:
    """2026-10-10 (Fred, via the advisor): the 'Wall outline' / 'Frame outline' sketches beside 'Bricks' -- one row each
    (export-flow.js BRICK_OUTLINE_SKETCHES), the same tri-state and home rule; the Bricks sketch untouched."""

    def _rows(self, wall=True, frame=True):
        row = lambda name, on: {'name': name, 'enabled': True, 'carve': True, 'svg': _SVG} if on else {'name': name, 'enabled': False}
        return {'brickOutlines': [row('Wall outline', wall), row('Frame outline', frame)]}

    def test_the_names_match_the_js_declaration(self):
        import pathlib
        import re
        js = (pathlib.Path(__file__).parent / 'html' / 'main' / 'export-flow.js').read_text(encoding='utf-8')
        block = js[js.index('export const BRICK_OUTLINE_SKETCHES'):]
        block = block[:block.index(']);')]
        assert tuple(re.findall(r"name: '([^']+)'", block)) == bsg.BRICK_OUTLINE_SKETCH_NAMES

    def test_each_row_its_own_sketch_beside_bricks(self, _fake_import_manager):
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])
        payload = {'bricks': {'enabled': True, 'svg': _SVG}, **self._rows()}
        h = _handler()
        h._apply_bricks_sketch(group, payload, _PARAMS)
        h._apply_brick_outline_sketches(group, payload, _PARAMS)
        assert sorted(s.name for s in comp.sketches) == ['Bricks', 'Frame outline', 'Wall outline']
        h._apply_brick_outline_sketches(group, payload, _PARAMS)  # re-Send: replaced, never duplicated
        assert sorted(s.name for s in comp.sketches) == ['Bricks', 'Frame outline', 'Wall outline']

    def test_a_disabled_row_removes_only_its_own_sketch(self, _fake_import_manager):
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])
        h = _handler()
        h._apply_bricks_sketch(group, {'bricks': {'enabled': True, 'svg': _SVG}}, _PARAMS)
        h._apply_brick_outline_sketches(group, self._rows(), _PARAMS)
        h._apply_brick_outline_sketches(group, self._rows(frame=False), _PARAMS)  # the frame was cleared
        assert sorted(s.name for s in comp.sketches if not s.deleted) == ['Bricks', 'Wall outline']

    def test_no_instruction_leaves_them_alone(self, _fake_import_manager):
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])
        h = _handler()
        h._apply_brick_outline_sketches(group, self._rows(), _PARAMS)
        for payload in ({}, {'brickOutlines': None}):  # append: no instruction
            h._apply_brick_outline_sketches(group, payload, _PARAMS)
        assert sorted(s.name for s in comp.sketches) == ['Frame outline', 'Wall outline']

    def test_an_undeclared_name_never_replaces_or_removes_a_sketch(self, _fake_import_manager):
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])
        h = _handler()
        h._apply_bricks_sketch(group, {'bricks': {'enabled': True, 'svg': _SVG}}, _PARAMS)
        h._apply_brick_outline_sketches(group, {'brickOutlines': [{'name': 'Bricks', 'enabled': False}]}, _PARAMS)
        assert [s.name for s in comp.sketches if not s.deleted] == ['Bricks']

    def test_a_crash_never_propagates(self, monkeypatch):
        body = _FakeBody(faces=[_face_with_bounding_box(10)])
        occ, comp = _bricks_component(body)
        group = _import_group([occ])

        def boom(*a, **kw):
            raise RuntimeError('sketches.add exploded')
        monkeypatch.setattr(comp.sketches, 'add', boom)
        _handler()._apply_brick_outline_sketches(group, self._rows(), _PARAMS)  # must not raise
        _handler()._apply_brick_outline_sketches(group, {'brickOutlines': 'garbage'}, _PARAMS)
