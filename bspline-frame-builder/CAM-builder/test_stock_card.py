"""Fred 2026-10-20 -- the stock / origin / hands-off rules of the CAM add-in (Stock card, 'top 1' origin, a rebuild leaves hand-set setups alone).

 * the WCS origin is Fusion's stock box point 'top 1' on the one shared box -- no helper sketch;
 * BUILD writes stock, box point, origin and orientation ONLY to a setup it just CREATED; an existing setup keeps its hand-set
   stock and origin (the real-shaped setups below), and heights are set only on operations the add-in just stamped;
 * the Stock card's box (stock_dims, an attribute on the Design) is the one exception: written to the B-spline setups' stock
   box (never the origin), existing ones too.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_stock_card.py
"""
import json
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_cam_reuse import eng, _full_build, _Coll, _Attrs, _Setup   # noqa: E402,F401  (the fake-adsk fixture + the fake build)


class _Param:
    def __init__(self, name, expr):
        self.name = name
        self._expr = expr
        self.writes = []

    @property
    def expression(self):
        return self._expr

    @expression.setter
    def expression(self, v):
        self.writes.append(v)
        self._expr = v


class _HandParams:
    """A setup set up by hand: every parameter already holds its value; any write is recorded."""
    def __init__(self, held):
        self._p = {n: _Param(n, e) for n, e in held.items()}

    def itemByName(self, n):
        return self._p.setdefault(n, _Param(n, None))

    def writes(self):
        return {n: p.writes for n, p in self._p.items() if p.writes}


# Real-shaped setups (2026-10-20): stockPoint 'bottom 1', 295.5 x 221.5 x 33 mm + 0.25 in, their own origins.
HAND = {'job_stockFixedX': '221.5 mm', 'job_stockFixedY': '295.5 mm', 'job_stockFixedZ': '33 mm',
        'job_stockOffsetSides': '0.25 in', 'wcs_origin_boxPoint': "'bottom 1'", 'wcs_origin_mode': "'stockPoint'"}
ORIGINS = {'B-spline Back': (-110.75, -147.75, 28.4368), 'B-spline Top': (110.75, -147.75, -4.5632)}


class _Frame:
    """Back's frame: its X is the model's Y, its Y the model's X, Z pointing down."""
    def __init__(self, origin):
        self.origin = origin

    def getAsCoordinateSystem(self):
        v = lambda x, y, z: types.SimpleNamespace(x=x, y=y, z=z)
        return (self.origin, v(0.0, 1.0, 0.0), v(1.0, 0.0, 0.0), v(0.0, 0.0, -1.0))


class _Design:
    def __init__(self, stock=None):
        self.attributes = _Attrs()
        if stock is not None:
            self.attributes.add('CAMBuilder', 'stock::B-spline', json.dumps(stock))


def _with_design(eng, cam, design):
    cam.parentDocument = types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=lambda t: design))
    eng.adsk.fusion.Design = type('Design', (), {'cast': staticmethod(lambda x: x)})


def _hand_set_build(eng, stock=None):
    cam, names = _full_build(eng)
    for s in cam.setups:
        s.parameters = _HandParams(HAND)
        s.stockMode = 'hand'
        s.workCoordinateSystem = _Frame(ORIGINS.get(s.name))
    _with_design(eng, cam, _Design(stock))
    return cam, names


def _rebuild(eng, monkeypatch, cam, names):
    sb = eng.sb
    monkeypatch.setattr(sb, '_propagate_part_position_pass', lambda setups, logger, cam=None: None)
    return sb.update_setups_in_place(cam, sb.find_reusable_build(cam, names))


# ---------------------------------------------------------------------------
# hands-off: a rebuild leaves a hand-set stock and origin alone
# ---------------------------------------------------------------------------

def test_a_rebuild_does_not_touch_a_hand_set_stock_origin_or_orientation(eng, monkeypatch):
    cam, names = _hand_set_build(eng)
    _rebuild(eng, monkeypatch, cam, names)
    for s in cam.setups:
        assert s.parameters.writes() == {}, (s.name, s.parameters.writes())      # no stock, box point, origin or axis written
        assert s.stockMode == 'hand'
        mm_rule = next(x for x in eng.sb.SETUP_SPECS if x['name'] == s.name)['mm_rule']
        assert list(s.models) == [f'{mm_rule}-body']                             # the model re-bind still runs


def test_a_rebuild_does_not_move_the_heights_of_an_operation_the_user_made(eng, monkeypatch):
    cam, names = _hand_set_build(eng)
    op = types.SimpleNamespace(strategy='adaptive', name='roughing', parameters=_HandParams({'topHeight_mode': "'from model top'"}))
    next(x for x in cam.setups if x.name == 'B-spline Back').operations = _Coll([op])
    _rebuild(eng, monkeypatch, cam, names)
    assert op.parameters.writes() == {}


def test_the_stock_card_box_is_written_on_a_rebuild_to_the_bspline_setups_never_the_origin(eng, monkeypatch):
    cam, names = _hand_set_build(eng, stock=[7.5, 9.5, 1.5])
    _rebuild(eng, monkeypatch, cam, names)
    w = {s.name: s.parameters.writes() for s in cam.setups}
    back = w['B-spline Back']
    # Back's frame: its X is the model's Y (9.5), its Y the model's X (7.5), its Z through the panel (1.5)
    assert back['job_stockFixedX'] == ['9.5 in'] and back['job_stockFixedY'] == ['7.5 in'] and back['job_stockFixedZ'] == ['1.5 in']
    assert not any(k.startswith('wcs_') for k in back)                           # the origin is never written
    assert w['Frame'] == {} and w['Stock'] == {}                                 # not the Frame's / Stock's boxes


def test_a_freshly_created_setup_is_configured_with_the_stock_card_box(eng, monkeypatch):
    sb = eng.sb
    eng.adsk.cam.OperationTypes = type('OperationTypes', (), {'MillingOperation': 0})
    seen = {}
    fresh = _Setup('placeholder')
    cam = types.SimpleNamespace(setups=types.SimpleNamespace(createInput=lambda t: types.SimpleNamespace(models=None),
                                                             add=lambda inp: fresh))
    _with_design(eng, cam, _Design([7.5, 9.5, 1.5]))
    monkeypatch.setattr(sb, '_collect_bodies', lambda mm: [])
    monkeypatch.setattr(sb, '_configure_setup', lambda setup, mm, spec, logger, stock_in=None: seen.update(stock_in=stock_in))
    spec = next(s for s in sb.SETUP_SPECS if s['name'] == 'B-spline Back')
    sb.build_setup(cam, {spec['mm_rule']: types.SimpleNamespace(name='MM')}, spec, skip_templates=True, skip_machine=True)
    assert seen['stock_in'] == (7.5, 9.5, 1.5)


# ---------------------------------------------------------------------------
# heights only on what the add-in just stamped
# ---------------------------------------------------------------------------

class _KeyedOp:
    def __init__(self, token, strategy='adaptive'):
        self.entityToken = token
        self.strategy = strategy
        self.name = token
        self.parameters = _HandParams({})


def test_heights_are_written_only_on_the_operations_the_addin_just_stamped(eng):
    mine, fred = _KeyedOp('tok-mine'), _KeyedOp('tok-fred')
    setup = types.SimpleNamespace(operations=_Coll([fred, mine]))
    assert eng.sb._apply_op_heights(setup, 'S', None, only={'tok-mine'}) == 1
    assert mine.parameters.writes() and fred.parameters.writes() == {}


def test_apply_sets_heights_on_the_ops_a_template_stamp_made_and_not_on_the_users(eng, monkeypatch):
    sb = eng.sb
    cam, names = _full_build(eng)
    fred, mine = _KeyedOp('tok-fred'), _KeyedOp('tok-mine')
    back = next(s for s in cam.setups if s.name == 'B-spline Back')
    back.operations = _Coll([fred])

    def stamp(setup, leaves, name, logger, design=None, stamped=None):
        setup.operations.append(mine)
        if stamped is not None:
            stamped.append(mine)
        return 1
    monkeypatch.setattr(sb, '_apply_cloud_templates', stamp)
    monkeypatch.setattr(sb, '_apply_hole_chain', lambda *a, **k: None)
    _with_design(eng, cam, _Design())
    for spec in sb.SETUP_SPECS:
        monkeypatch.setitem(spec, 'cloud_templates', ['x.f3dhsm-template'])
    sb.apply_templates_to_existing_setups(cam)
    assert mine.parameters.writes() and fred.parameters.writes() == {}


# ---------------------------------------------------------------------------
# the stock box point / helper sketches
# ---------------------------------------------------------------------------

def test_the_bspline_origin_is_the_stock_box_point_and_no_helper_sketch_remains(eng):
    specs = {s['name']: s for s in eng.sb.SETUP_SPECS}
    assert (specs['B-spline Back']['wcs_origin'], specs['B-spline Back']['box_point']) == ('box_point', 'top 1')
    assert 'wcs_point' not in specs['B-spline Back'] and 'wcs_point' not in specs['B-spline Top']
    assert not hasattr(eng.sb, 'ensure_wcs_sketches') and not hasattr(eng.sb, '_bind_wcs_point')


# ---------------------------------------------------------------------------
# stock_dims (the Design attribute)
# ---------------------------------------------------------------------------

@pytest.fixture
def sd(eng):
    from cam_engine import stock_dims
    return stock_dims


def test_stock_dims_round_trip_on_the_design_and_clear_removes_it(sd):
    class _A(_Attrs):
        def add(self, g, n, v):
            super().add(g, n, v)
            self._a[(g, n)].deleteMe = lambda k=(g, n): self._a.pop(k)
    d = types.SimpleNamespace(attributes=_A())
    assert sd.load(d) is None
    assert sd.save(d, [7.5, 9.5, 1.5]) is True
    assert d.attributes.itemByName('CAMBuilder', 'stock::B-spline').value == '[7.5, 9.5, 1.5]'
    assert sd.load(d) == (7.5, 9.5, 1.5)
    sd.save(d, None)                                   # Clear
    assert sd.load(d) is None
    assert d.attributes.itemByName('CAMBuilder', 'stock::B-spline') is None


@pytest.mark.parametrize('bad', [None, [], [1, 2], [1, 2, 0], [1, -2, 3], ['a', 2, 3], [float('nan'), 1, 1]])
def test_stock_dims_refuses_what_is_not_three_positive_sizes(sd, bad):
    assert sd.parse_dims(bad) is None


def test_stock_dims_with_no_design_is_a_no_op(sd):
    assert sd.load(None) is None and sd.save(None, [1, 1, 1]) is False and sd.clear(None) is False


def test_the_warning_axes_are_detection_only(sd):
    assert sd.smaller_axes((7.5, 9.5, 1.5), {'x': 8.1, 'y': 9.0, 'z': 1.5}) == ['X']
    assert sd.smaller_axes((9, 9, 9), {'x': 8.1, 'y': 9.0, 'z': 1.5}) == []
    assert sd.smaller_axes(None, {'x': 1}) == []


def test_the_model_axis_a_setup_axis_points_along(eng):
    v = lambda x=0.0, y=0.0, z=0.0: types.SimpleNamespace(x=x, y=y, z=z)
    assert eng.sb._model_axis_of(v(y=-1.0)) == 1
    assert eng.sb._model_axis_of(v(x=0.9, y=0.1)) == 0
    assert eng.sb._model_axis_of(v(z=-1.0)) == 2
