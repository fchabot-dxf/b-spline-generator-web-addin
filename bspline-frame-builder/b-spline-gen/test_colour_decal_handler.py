"""
H23 item 71: b-spline-gen.py's "Artwork colours" decal (_apply_colour_decal and its own helpers
_find_stamped_panel_body / _largest_area_face / _remove_named_decal) -- the Python side of the
optional Fusion colour decal. Pure-Python fakes for the Fusion API, same approach + the same
loaded module (`b_spline_gen_under_test`) test_send_frame_handler.py already established via
test_svg_layer_import_plan's own adsk stub + importlib.util loader.

MUST NEVER RAISE is the one property every test here checks for: a decal failure must never fail
the rest of a Send (the brief's own words), so every scenario -- including a Fusion API call
raising mid-way -- is checked for "no exception propagates", not just "the decal ended up right".
"""
import base64
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_svg_layer_import_plan import _bspline_gen as bsg  # noqa: E402  (same adsk stubs + loader)

import pytest  # noqa: E402


class _FakeCollection:
    """Mirrors the one Fusion collection shape b-spline-gen.py's own `_find_clean_stamped`
    actually calls (`.count`, `.item(i)`), not a plain list -- `occ.childOccurrences.count` on a
    plain Python list resolves to a bound method, not an int, and silently breaks `range(n)`."""
    def __init__(self, items=()):
        self._items = list(items)

    @property
    def count(self):
        return len(self._items)

    def item(self, i):
        return self._items[i]

    def __iter__(self):
        return iter(self._items)

    def __len__(self):
        return len(self._items)


class _FakeDecal:
    def __init__(self, name='', owner=None):
        self.name = name
        self.deleted = False
        self._owner = owner  # the _FakeDecals collection it lives in

    def deleteMe(self):
        # A real Fusion decal.deleteMe() removes itself from component.decals too -- without this
        # the fake would let a "removed" decal keep counting toward the collection's own length.
        self.deleted = True
        if self._owner is not None and self in self._owner._items:
            self._owner._items.remove(self)


class _FakeDecalInput:
    def __init__(self, path, faces, point):
        self.path, self.faces, self.point = path, faces, point
        self.transform = None
        self.isChainFaces = False
        self.opacity = 1.0


class _FakeDecals(_FakeCollection):
    def __init__(self):
        super().__init__([])
        self.create_calls = []

    def createInput(self, path, faces, point):
        self.create_calls.append((path, faces, point))
        return _FakeDecalInput(path, faces, point)

    def add(self, decal_input):
        d = _FakeDecal(name='', owner=self)
        d._input = decal_input
        self._items.append(d)
        return d


class _FakeComponent:
    def __init__(self, name, bodies=()):
        self.name = name
        self.bRepBodies = list(bodies)  # _find_stamped_panel_body iterates `for b in ...`, a list is fine
        self.decals = _FakeDecals()


class _FakeOcc:
    def __init__(self, comp_name, children=(), bodies=()):
        self.component = _FakeComponent(comp_name, bodies)
        self.childOccurrences = _FakeCollection(children)
        self.isValid = True


class _FakeFace:
    def __init__(self, area, point=(1.0, 2.0, 3.0)):
        self.area = area
        self.pointOnFace = types.SimpleNamespace(x=point[0], y=point[1], z=point[2])


class _FakeBody:
    def __init__(self, name='panel', solid=True, faces=()):
        self.name = name
        self.isSolid = solid
        self.faces = list(faces)
        self.parentComponent = None  # wired by _stamped_occ below -- real BRepBody has no `.component`


def _stamped_occ(body, comp_name='Stamped'):
    occ = _FakeOcc(comp_name, bodies=[body])
    body.parentComponent = occ.component
    return occ


def _import_group(children=()):
    return _FakeOcc('B-Spline Set', children=children)


@pytest.fixture(autouse=True)
def _fake_geometry_types(monkeypatch):
    """adsk.core.Point3D/Vector3D/Matrix3D -- not in test_svg_layer_import_plan's own stub (nothing
    else imported there needs them), so every test in this file gets minimal real-shaped fakes."""
    class _P3:
        def __init__(self, x, y, z): self.x, self.y, self.z = x, y, z
        @classmethod
        def create(cls, x, y, z): return cls(x, y, z)

    class _V3:
        def __init__(self, x, y, z): self.x, self.y, self.z = x, y, z
        @classmethod
        def create(cls, x, y, z): return cls(x, y, z)

    class _M3:
        def __init__(self): self.coordSystem = None
        @classmethod
        def create(cls): return cls()
        def setWithCoordinateSystem(self, origin, x, y, z):
            self.coordSystem = (origin, x, y, z)
            return True

    monkeypatch.setattr(bsg.adsk.core, 'Point3D', _P3, raising=False)
    monkeypatch.setattr(bsg.adsk.core, 'Vector3D', _V3, raising=False)
    monkeypatch.setattr(bsg.adsk.core, 'Matrix3D', _M3, raising=False)
    monkeypatch.setattr(bsg, '_log', lambda msg: None)


_PNG_B64 = base64.b64encode(b'not a real png, content is never inspected').decode()
_PARAMS = {'widthIn': 7, 'heightIn': 9}


class TestFindStampedPanelBody:
    def test_finds_the_solid_body_in_the_stamped_occurrence(self):
        body = _FakeBody('panel', solid=True)
        group = _import_group([_stamped_occ(body)])
        assert bsg._find_stamped_panel_body(group) is body

    def test_none_when_only_clean_was_sent_never_falls_back_to_it(self):
        body = _FakeBody('panel', solid=True)
        clean_occ = _FakeOcc('Clean', bodies=[body])
        group = _import_group([clean_occ])
        assert bsg._find_stamped_panel_body(group) is None

    def test_none_for_an_empty_import_group(self):
        assert bsg._find_stamped_panel_body(_import_group([])) is None
        assert bsg._find_stamped_panel_body(None) is None


class TestFindStampedComponent:
    """F35 item 12: _find_stamped_component is _find_stamped_panel_body's own sibling (same
    _find_clean_stamped search, same 'resolve Stamped, never fall back to Clean or root'
    contract) -- every carving sketch's own target, not a decal concern, but reusing this file's
    own already-established fakes rather than duplicating them in a new file for one small class."""
    def test_finds_the_stamped_component(self):
        body = _FakeBody('panel', solid=True)
        occ = _stamped_occ(body)
        group = _import_group([occ])
        assert bsg._find_stamped_component(group) is occ.component

    def test_none_when_only_clean_was_sent_never_falls_back_to_it(self):
        clean_occ = _FakeOcc('Clean', bodies=[_FakeBody('panel')])
        group = _import_group([clean_occ])
        assert bsg._find_stamped_component(group) is None

    def test_none_for_an_empty_import_group(self):
        assert bsg._find_stamped_component(_import_group([])) is None
        assert bsg._find_stamped_component(None) is None

    def test_stamped_nested_under_a_non_matching_wrapper_is_still_found(self):
        """_find_clean_stamped's own recursive search -- Stamped doesn't have to be a DIRECT
        child of import_group, matching the real import tree's own nesting."""
        body = _FakeBody('panel', solid=True)
        stamped = _stamped_occ(body)
        wrapper = _FakeOcc('some wrapper', children=[stamped])
        group = _import_group([wrapper])
        assert bsg._find_stamped_component(group) is stamped.component


class TestLargestAreaFace:
    def test_picks_the_largest_not_the_first_or_last(self):
        faces = [_FakeFace(8.4), _FakeFace(363.6), _FakeFace(1.2)]
        assert bsg._largest_area_face(_FakeBody(faces=faces)) is faces[1]

    def test_none_for_a_body_with_no_faces(self):
        assert bsg._largest_area_face(_FakeBody(faces=[])) is None


class TestApplyColourDecal:
    def test_no_decal_key_at_all_leaves_an_existing_decal_untouched(self):
        """append sends `decal: null`; so does a transient PNG-render failure while enabled --
        neither is 'the user turned it off', so neither may delete a previously-working decal."""
        body = _FakeBody(faces=[_FakeFace(10)])
        group = _import_group([_stamped_occ(body)])
        existing = _FakeDecal(bsg.DECAL_NAME, owner=body.parentComponent.decals)
        body.parentComponent.decals._items.append(existing)

        bsg._apply_colour_decal(group, {}, _PARAMS)  # no 'decal' key at all
        assert existing.deleted is False
        assert len(body.parentComponent.decals._items) == 1

        bsg._apply_colour_decal(group, {'decal': None}, _PARAMS)  # explicit None, same meaning
        assert existing.deleted is False
        assert len(body.parentComponent.decals._items) == 1

    def test_disabled_removes_an_existing_decal(self):
        body = _FakeBody(faces=[_FakeFace(10)])
        group = _import_group([_stamped_occ(body)])
        existing = _FakeDecal(bsg.DECAL_NAME, owner=body.parentComponent.decals)
        body.parentComponent.decals._items.append(existing)

        bsg._apply_colour_decal(group, {'decal': {'enabled': False}}, _PARAMS)

        assert existing.deleted is True
        assert len(body.parentComponent.decals._items) == 0

    def test_disabled_with_none_present_is_a_safe_no_op(self):
        body = _FakeBody(faces=[_FakeFace(10)])
        group = _import_group([_stamped_occ(body)])
        bsg._apply_colour_decal(group, {'decal': {'enabled': False}}, _PARAMS)  # must not raise
        assert len(body.parentComponent.decals._items) == 0

    def test_no_stamped_body_enabled_is_skipped_not_raised(self):
        group = _import_group([])  # nothing sent at all
        bsg._apply_colour_decal(group, {'decal': {'enabled': True, 'png': _PNG_B64}}, _PARAMS)  # must not raise

    def test_enabled_with_no_existing_decal_adds_exactly_one_named_correctly(self):
        faces = [_FakeFace(8.4), _FakeFace(363.6)]
        body = _FakeBody(faces=faces)
        group = _import_group([_stamped_occ(body)])

        bsg._apply_colour_decal(group, {'decal': {'enabled': True, 'png': _PNG_B64, 'opacity': 80}}, _PARAMS)

        items = body.parentComponent.decals._items
        assert len(items) == 1
        assert items[0].name == bsg.DECAL_NAME
        # the LARGEST-area face (item 69's own correction), not the first in the list
        assert body.parentComponent.decals.create_calls[0][1] == [faces[1]]
        assert items[0]._input.opacity == pytest.approx(0.8)
        assert items[0]._input.isChainFaces is True

    def test_re_send_replaces_rather_than_duplicates(self):
        """The exact scenario the brief itself names: enabled, re-Send, still exactly 1."""
        body = _FakeBody(faces=[_FakeFace(10)])
        group = _import_group([_stamped_occ(body)])
        decal_payload = {'decal': {'enabled': True, 'png': _PNG_B64}}

        bsg._apply_colour_decal(group, decal_payload, _PARAMS)
        first = body.parentComponent.decals._items[0]
        bsg._apply_colour_decal(group, decal_payload, _PARAMS)

        items = body.parentComponent.decals._items
        assert len(items) == 1  # never 2
        assert first.deleted is True  # the OLD one was actually removed, not just outnumbered
        assert items[0] is not first

    def test_missing_png_data_is_skipped_not_raised(self):
        body = _FakeBody(faces=[_FakeFace(10)])
        group = _import_group([_stamped_occ(body)])
        bsg._apply_colour_decal(group, {'decal': {'enabled': True, 'png': ''}}, _PARAMS)
        assert len(body.parentComponent.decals._items) == 0

    def test_missing_board_dimensions_is_skipped_not_raised(self):
        body = _FakeBody(faces=[_FakeFace(10)])
        group = _import_group([_stamped_occ(body)])
        bsg._apply_colour_decal(group, {'decal': {'enabled': True, 'png': _PNG_B64}}, {})
        assert len(body.parentComponent.decals._items) == 0

    def test_a_fusion_api_crash_never_propagates(self, monkeypatch):
        """The property the brief states outright: 'never fails a Send'."""
        body = _FakeBody(faces=[_FakeFace(10)])
        group = _import_group([_stamped_occ(body)])

        def boom(*a, **kw):
            raise RuntimeError('decals.add exploded')
        monkeypatch.setattr(body.parentComponent.decals, 'add', boom)

        bsg._apply_colour_decal(group, {'decal': {'enabled': True, 'png': _PNG_B64}}, _PARAMS)  # must not raise

    def test_accepts_a_data_url_prefix_same_as_a_bare_base64_string(self):
        body = _FakeBody(faces=[_FakeFace(10)])
        group = _import_group([_stamped_occ(body)])
        data_url = 'data:image/png;base64,' + _PNG_B64
        bsg._apply_colour_decal(group, {'decal': {'enabled': True, 'png': data_url}}, _PARAMS)
        assert len(body.parentComponent.decals._items) == 1
