"""FRAME-SPLIT (Fred 2026-10-24): the Frame cut as 1-4 setups, each piece its own bars and optional thickness, all on the
same passes. cam_engine/frame_layout.py (pure) + its wiring in setup_builder (setup_specs, _spec_bodies, the stock box)."""
import json
import types

import pytest

from test_cam_position import eng, _Setup  # noqa: F401  (the fake-adsk engine fixture + a fake setup)


class _Attr:
    def __init__(self, store, key, value):
        self._store, self._key, self.value = store, key, value

    def deleteMe(self):
        self._store.pop(self._key, None)


class _Attrs:
    def __init__(self):
        self.store = {}

    def itemByName(self, group, name):
        v = self.store.get((group, name))
        return _Attr(self.store, (group, name), v) if v is not None else None

    def add(self, group, name, value):
        self.store[(group, name)] = value


def _design():
    return types.SimpleNamespace(attributes=_Attrs())


# ---------------------------------------------------------------------------
# the layout data (pure)
# ---------------------------------------------------------------------------

def test_presets_cover_every_bar_exactly_once(eng):
    fl = eng.co.frame_layout
    for n in (1, 2, 3, 4):
        lay = fl.preset(n)
        assert len(lay) == n
        assert fl.parse(lay) == lay
    assert fl.preset(2) == [{'bars': ['bottom', 'right'], 'thickness_in': None},
                            {'bars': ['top', 'left'], 'thickness_in': None}]      # Fred's usual split
    assert fl.preset(5) is None


def test_a_bar_missing_or_in_two_pieces_is_refused(eng):
    fl = eng.co.frame_layout
    assert fl.parse([{'bars': ['bottom', 'right']}, {'bars': ['top']}]) is None              # left missing
    assert fl.parse([{'bars': ['bottom', 'right', 'top']}, {'bars': ['top', 'left']}]) is None  # top twice
    assert fl.parse([{'bars': ['bottom', 'right', 'top', 'left', 'side']}]) is None          # unknown bar
    assert fl.parse([]) is None
    assert fl.parse([{'bars': [b]} for b in fl.BARS] + [{'bars': ['top']}]) is None          # 5 pieces


def test_thickness_is_a_positive_number_or_empty(eng):
    fl = eng.co.frame_layout
    two = lambda t: [{'bars': ['bottom', 'right'], 'thickness_in': t}, {'bars': ['top', 'left']}]
    assert fl.parse(two('1.75'))[0]['thickness_in'] == 1.75
    assert fl.parse(two(''))[0]['thickness_in'] is None
    assert fl.parse(two(None))[1]['thickness_in'] is None
    assert fl.parse(two(0)) is None
    assert fl.parse(two(-1)) is None
    assert fl.parse(two('abc')) is None


def test_saved_on_the_design_and_the_default_clears(eng):
    fl = eng.co.frame_layout
    d = _design()
    assert fl.load(d) == fl.default_layout()
    assert fl.save(d, fl.preset(2))
    assert json.loads(d.attributes.store[('CAMBuilder', 'frame::layout')]) == fl.preset(2)
    assert fl.load(d) == fl.preset(2)
    assert not fl.save(d, [{'bars': ['top']}])          # invalid: refused, the saved layout stays
    assert fl.load(d) == fl.preset(2)
    assert fl.save(d, fl.preset(1))                      # back to the default = no attribute
    assert d.attributes.store == {}
    assert fl.load(None) == fl.default_layout()


# ---------------------------------------------------------------------------
# expansion into setup specs
# ---------------------------------------------------------------------------

def _frame_spec(sb):
    return next(s for s in sb.SETUP_SPECS if s['role'] == 'frame')


def test_no_saved_layout_is_exactly_the_declared_specs(eng):
    sb = eng.sb
    assert sb.setup_specs(None) == sb.SETUP_SPECS
    assert sb.setup_specs(_design()) == sb.SETUP_SPECS
    assert eng.co.frame_layout.expand(_frame_spec(sb), None)[0] is _frame_spec(sb)


def test_two_pieces_make_frame_a_and_b_on_the_same_passes(eng):
    sb, fl = eng.sb, eng.co.frame_layout
    d = _design()
    lay = fl.preset(2)
    lay[1]['thickness_in'] = 1.97
    fl.save(d, lay)
    specs = sb.setup_specs(d)
    names = [s['name'] for s in specs]
    assert names == [s['name'] for s in sb.SETUP_SPECS if s['role'] != 'frame'] + ['Frame A', 'Frame B']
    a, b = specs[-2:]
    frame = _frame_spec(sb)
    assert a['bars'] == ('bottom', 'right') and b['bars'] == ('top', 'left')
    assert a['thickness_in'] is None and b['thickness_in'] == 1.97
    for p in (a, b):
        assert p['cloud_templates'] == frame['cloud_templates']        # one template for every piece
        assert p['tpl_key'] == 'Frame'                                  # template overrides kept per role
        assert p['role'] == 'frame' and p['mm_rule'] == 'frame'
    assert frame['name'] == 'Frame' and 'bars' not in frame             # the declaration itself is untouched


def test_four_pieces_and_one_piece_with_a_thickness(eng):
    sb, fl = eng.sb, eng.co.frame_layout
    d = _design()
    fl.save(d, fl.preset(4))
    assert [s['name'] for s in sb.setup_specs(d)][-4:] == ['Frame A', 'Frame B', 'Frame C', 'Frame D']
    fl.save(d, [{'bars': list(fl.BARS), 'thickness_in': 1.5}])
    last = sb.setup_specs(d)[-1]
    assert last['name'] == 'Frame' and last['thickness_in'] == 1.5


def test_every_piece_name_is_in_the_cleanup_set(eng):
    for n in (1, 2, 3, 4):
        for i in range(n):
            assert eng.co.frame_layout.piece_name(i, n) in eng.co._ADDIN_SETUP_NAMES


# ---------------------------------------------------------------------------
# what a piece's setup binds and its stock
# ---------------------------------------------------------------------------

def test_a_piece_binds_only_its_own_bars(eng, monkeypatch):
    sb = eng.sb
    bodies = [types.SimpleNamespace(name=n) for n in ('frame_bottom', 'frame_right', 'frame_top', 'frame_left')]
    monkeypatch.setattr(sb, '_collect_bodies', lambda mm: list(bodies))
    piece = {'name': 'Frame A', 'bars': ('bottom', 'right')}
    assert [b.name for b in sb._spec_bodies(None, piece)] == ['frame_bottom', 'frame_right']
    assert len(sb._spec_bodies(None, {'name': 'Frame'})) == 4          # no 'bars' = every body (one-piece Frame)
    assert sb._spec_bodies(None, {'name': 'Frame A', 'bars': ('nothing',)}) == []


def test_a_piece_takes_every_bar_on_its_sides_numbered_ones_too(eng, monkeypatch):
    """BAR NAMING: a side = frame_<side> or frame_<side>_N; the window bars are their own group."""
    sb = eng.sb
    names = ['frame_top', 'frame_right_1', 'frame_right_2', 'frame_bottom', 'frame_left_2', 'frame_left_1',
             'frame_window_top', 'frame_window_left', 'frame_thickness_marker']
    monkeypatch.setattr(sb, '_collect_bodies', lambda mm: [types.SimpleNamespace(name=n) for n in names])
    got = lambda bars: [b.name for b in sb._spec_bodies(None, {'name': 'P', 'bars': bars})]
    assert got(('bottom', 'right')) == ['frame_right_1', 'frame_right_2', 'frame_bottom']
    assert got(('top', 'left')) == ['frame_top', 'frame_left_2', 'frame_left_1']
    assert got(('window',)) == ['frame_window_top', 'frame_window_left']


def test_a_piece_with_no_bar_is_not_built_and_the_letters_close_up(eng):
    """Template 7 / 11 (peaked roof): no top. Preset 3 = bottom + right / top / left -> 'top' has no bar."""
    fl = eng.co.frame_layout
    present = fl.present_sides(['frame_right_1', 'frame_right_2', 'frame_bottom', 'frame_left_2', 'frame_left_1'])
    built = fl.built_pieces(fl.preset(3), present)
    assert [(b['name'], b['bars'], b['index']) for b in built] == [
        ('Frame A', ('bottom', 'right'), 0), ('Frame B', ('left',), 2)]


def test_a_split_frame_puts_the_window_bars_in_their_own_setup(eng):
    fl = eng.co.frame_layout
    frame = next(s for s in eng.sb.SETUP_SPECS if s['role'] == 'frame')
    present = fl.present_sides(['frame_top', 'frame_right', 'frame_bottom', 'frame_left', 'frame_window_top'])
    specs = fl.expand(frame, fl.preset(2), present)
    assert [(s['name'], s['bars']) for s in specs] == [
        ('Frame A', ('bottom', 'right')), ('Frame B', ('top', 'left')), ('Frame Window', ('window',))]
    assert fl.expand(frame, fl.default_layout(), present) == [frame]      # one piece: everything, window included
    assert 'Frame Window' in eng.co._ADDIN_SETUP_NAMES


def test_a_piece_thickness_is_the_stock_z_and_xy_stay_declared(eng):
    s = _Setup(z_up=True)
    eng.sb._apply_stock_box(s, 'Frame B', None, 'frame_stock', z_in=1.97)
    w = s.parameters.written()
    m = eng.pos.CAM_POSITION['frame_stock']['margin_xy_in']
    assert w['job_stockFixedZ'] == "1.97 in"
    assert w['job_stockFixedX'] == f"(surfaceXHigh - surfaceXLow) + {m} in"
    s2 = _Setup(z_up=True)
    eng.sb._apply_stock_box(s2, 'Frame', None, 'frame_stock')
    assert s2.parameters.written()['job_stockFixedZ'] == "(surfaceZHigh - surfaceZLow)"   # no thickness: the bars' own
