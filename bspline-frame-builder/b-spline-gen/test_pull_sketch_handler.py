"""
Pull from Fusion, board-aware (seat D 2026-10-16; advisor 45, Fred): _handle_pull_sketch resolves the PROJECT's own
board (BoardScope/BoardNamer, board_scope.py -- the same 'replace' resolution Send/delete_frame already use), never
a design-wide guess. FAIL-BEFORE: a 2-board design, each with its own sketch and its own prefixed widthIn/heightIn --
the old _handle_pull_sketch(self) took no board argument at all and scanned the WHOLE design, so it could only ever
read whichever board's sketch happened to be last in allOccurrences, not the project's own.

Also ported from the closed pull-fusion-safe branch (board-unaware, 1 commit, never merged): the no-size-is-never-
a-guess rule, the skipped/failed curve reporting, and the getParamExtents (ok, start, end) fix -- now board-scoped.
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
_FB = os.path.join(os.path.dirname(_HERE), 'frame-builder')
if _FB not in sys.path:
    sys.path.insert(0, _FB)

from test_svg_layer_import_plan import _bspline_gen as bsg  # noqa: E402  (same adsk stubs + loader)
from test_send_targets import Comp  # noqa: E402  (the same tagged-board component fake Send's own tests use)
from fb_engine.board_scope import BOARD_ATTR, BoardScope  # noqa: E402

import pytest  # noqa: E402

IN = 2.54  # cm per inch


class _Coll(list):
    @property
    def count(self):
        return len(self)


def _pt(x_in, y_in):
    return types.SimpleNamespace(x=x_in * IN, y=y_in * IN, z=0)


def _line(a, b, construction=False):
    return types.SimpleNamespace(startSketchPoint=types.SimpleNamespace(geometry=_pt(*a)),
                                 endSketchPoint=types.SimpleNamespace(geometry=_pt(*b)), isConstruction=construction)


class _BadLine:
    isConstruction = False

    @property
    def startSketchPoint(self):
        raise RuntimeError('degenerate')


def _fitted(points_in):
    def at(t):
        k = min(int(t * (len(points_in) - 1)), len(points_in) - 2)
        f = t * (len(points_in) - 1) - k
        a, b = points_in[k], points_in[k + 1]
        return True, _pt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
    ev = types.SimpleNamespace(getParamExtents=lambda: (True, 0.0, 1.0), getPointAtParameter=at)
    return types.SimpleNamespace(geometry=types.SimpleNamespace(evaluator=ev), isConstruction=False)


def _sketch(name, parent, lines=(), fitted=(), ellipses=0, cp_splines=0):
    curves = types.SimpleNamespace(
        sketchLines=_Coll(lines), sketchCircles=_Coll(), sketchArcs=_Coll(), sketchFittedSplines=_Coll(fitted),
        sketchFixedSplines=_Coll(), sketchControlPointSplines=_Coll([object()] * cp_splines),
        sketchEllipses=_Coll([object()] * ellipses), sketchEllipticalArcs=_Coll(), sketchConicCurves=_Coll())
    return types.SimpleNamespace(name=name, sketchCurves=curves, parentComponent=parent)


class _Param:
    def __init__(self, name, value_in):
        self.name, self.value = name, value_in * IN


class _ParamCollection:
    """des.allParameters as the real Fusion API shape: BOTH iterable (step (b)'s own board-owned scan) and
    itemByName (the existing widthIn/heightIn lookup) -- a plain SimpleNamespace supports neither."""

    def __init__(self, params):
        self._params = params

    def itemByName(self, name):
        return self._params.get(name)

    def __iter__(self):
        return iter(self._params.values())


class Design:
    """A design with N tagged boards (Comp, same fake test_send_targets.py's own Send tests use), each with its
    own sketch(es) and its own prefixed params -- scope.owns must tell them apart."""

    def __init__(self):
        self.rootComponent = Comp('(Root)')
        self.attrs = []
        self._params = {}

    def findAttributes(self, group, name):
        return [a for a in self.attrs if (a.groupName, a.name) == (group, name)]

    def board(self, name, bid):
        b = Comp(name, **{'Bspline.board': bid})
        self.rootComponent.children.append(b)
        self.attrs.append(types.SimpleNamespace(groupName=BOARD_ATTR[0], name=BOARD_ATTR[1], value=bid, parent=b))
        return b

    def param(self, name, value_in):
        self._params[name] = _Param(name, value_in)

    @property
    def allParameters(self):
        return _ParamCollection(self._params)


@pytest.fixture
def two_boards(monkeypatch):
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    app = types.SimpleNamespace(activeEditObject=None, userInterface=None)
    monkeypatch.setattr(bsg, 'app', app, raising=False)

    d = Design()
    d.rootComponent.sketches = []  # nothing directly under root -- both boards hold their own
    a = d.board('Rose', 'bRoseid')
    b = d.board('Oak', 'bOakid')
    a.sketches = [_sketch('Lattice A', a, lines=[_line((0, 0), (1, 0))])]
    b.sketches = [_sketch('Lattice B', b, lines=[_line((0, 0), (2, 0))])]
    d.param('bRoseid_widthIn', 10); d.param('bRoseid_heightIn', 12)
    d.param('bOakid_widthIn', 7); d.param('bOakid_heightIn', 9)
    d.param('bRoseid_L3_node_diameter', 0.3)  # board A's own lattice layer 3
    d.param('bRoseid_frame_thickness', 0.8)
    d.param('bRoseid_fred_custom_margin', 2.5)  # Fred's own param, under board A's own prefix -- a real param this
    # board owns, but not one core/pull-map.js declares -- the "not mapped" case
    d.param('bOakid_L9_node_diameter', 0.15)  # board B's own lattice layer 9 -- a DIFFERENT value
    d.a, d.b = a, b

    def run(board_id):
        monkeypatch.setattr(bsg, '_active_design', lambda: d)
        return bsg.PaletteHTMLEventHandler()._handle_pull_sketch({'board': {'id': board_id}})
    return run


# ---- FAIL-BEFORE: a 2-board design, each board read in isolation --------------------------------------------------
def test_pulling_board_a_reads_as_own_sketch_and_size_never_bs(two_boards):
    res = two_boards('bRoseid')
    assert res['ok'] is True
    assert res['sketchName'] == 'Lattice A'
    assert (res['sizeSource'], res['widthIn'], res['heightIn']) == ('fusion', 10.0, 12.0)
    assert res['curves'][0]['d'] == 'M 5.0 6.0 L 6.0 6.0'  # the 10x12 board's own centre


def test_pulling_board_b_reads_bs_own_sketch_and_size_never_as(two_boards):
    res = two_boards('bOakid')
    assert res['ok'] is True
    assert res['sketchName'] == 'Lattice B'
    assert (res['sizeSource'], res['widthIn'], res['heightIn']) == ('fusion', 7.0, 9.0)
    assert res['curves'][0]['d'] == 'M 3.5 4.5 L 5.5 4.5'  # the 7x9 board's own centre


# ---- step (b): boardParams -- every length param this board owns, board-prefix stripped, layer prefix kept -------
def test_board_a_params_are_stripped_of_the_board_prefix_only_layer_prefix_kept(two_boards):
    res = two_boards('bRoseid')
    assert res['boardParams']['L3_node_diameter'] == pytest.approx(0.3)
    assert res['boardParams']['frame_thickness'] == pytest.approx(0.8)
    assert res['boardParams']['fred_custom_margin'] == pytest.approx(2.5)  # Fred's own: present, the app decides "not mapped"
    assert 'widthIn' not in res['boardParams'] and 'heightIn' not in res['boardParams']  # already their own fields


def test_board_bs_params_never_leak_board_as_and_vice_versa(two_boards):
    res_a = two_boards('bRoseid')
    res_b = two_boards('bOakid')
    # the exact key SET, not just "the stripped name is absent" -- a scoping bug that reads another board's
    # param under its own UNSTRIPPED name (namer.base only strips a name that starts with ITS prefix, leaving a
    # foreign one untouched) would still pass a narrower "'L9_node_diameter' not in res_a" check
    assert set(res_a['boardParams']) == {'L3_node_diameter', 'frame_thickness', 'fred_custom_margin'}
    assert set(res_b['boardParams']) == {'L9_node_diameter'}
    assert res_b['boardParams']['L9_node_diameter'] == pytest.approx(0.15)


def test_an_unknown_board_id_falls_back_to_the_legacy_scope_which_owns_neither_tagged_board(two_boards):
    res = two_boards('not-a-real-board')
    assert res['ok'] is False
    assert 'No sketch found' in res['error']


def test_without_board_scoping_a_2_tagged_board_design_cannot_be_pulled_at_all(monkeypatch, two_boards):
    """Mutation check: force the legacy (unscoped) resolution regardless of the requested board id -- with BOTH
    boards tagged, the legacy scope owns neither, so every pull fails. Confirms the scoping this slice adds is
    load-bearing, not decorative."""
    monkeypatch.setattr(bsg, '_resolve_send_scope', lambda des, target, board, params: BoardScope(des))
    res = two_boards('bRoseid')
    assert res['ok'] is False
    assert 'No sketch found' in res['error']


# ---- ported from pull-fusion-safe: no-size-is-never-a-guess, skipped/failed reporting ------------------------------
def test_no_size_on_this_board_places_the_curves_on_the_palettes_board_and_resizes_nothing(monkeypatch):
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    monkeypatch.setattr(bsg, 'app', types.SimpleNamespace(activeEditObject=None, userInterface=None), raising=False)
    d = Design()
    root_sketch = _sketch('plain', d.rootComponent, lines=[_line((0, 0), (1, 0))])
    d.rootComponent.sketches = [root_sketch]
    monkeypatch.setattr(bsg, '_active_design', lambda: d)
    res = bsg.PaletteHTMLEventHandler()._handle_pull_sketch({'board': {'id': ''}, 'widthIn': 12, 'heightIn': 16})
    assert res['ok'] is True
    assert res['sizeSource'] is None and res['widthIn'] is None and res['heightIn'] is None  # never a made-up size
    assert res['curves'][0]['d'] == 'M 6.0 8.0 L 7.0 8.0'  # the palette's 12 x 16 board's own centre
    assert res['bounds'] == {'x0': 6.0, 'y0': 8.0, 'x1': 7.0, 'y1': 8.0}


def test_no_size_anywhere_is_an_error_not_a_guess(monkeypatch):
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    monkeypatch.setattr(bsg, 'app', types.SimpleNamespace(activeEditObject=None, userInterface=None), raising=False)
    d = Design()
    d.rootComponent.sketches = [_sketch('plain', d.rootComponent, lines=[_line((0, 0), (1, 0))])]
    monkeypatch.setattr(bsg, '_active_design', lambda: d)
    res = bsg.PaletteHTMLEventHandler()._handle_pull_sketch({'board': {'id': ''}})
    assert res['ok'] is False and 'no widthIn' in res['error']


def test_the_curve_types_it_does_not_read_are_reported_and_a_failed_curve_is_counted(monkeypatch):
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    monkeypatch.setattr(bsg, 'app', types.SimpleNamespace(activeEditObject=None, userInterface=None), raising=False)
    d = Design()
    d.rootComponent.sketches = [_sketch('plain', d.rootComponent, lines=[_line((0, 0), (1, 0)), _BadLine()], ellipses=2, cp_splines=1)]
    d.param('widthIn', 7); d.param('heightIn', 9)
    monkeypatch.setattr(bsg, '_active_design', lambda: d)
    res = bsg.PaletteHTMLEventHandler()._handle_pull_sketch({'board': {'id': ''}})
    assert res['skipped'] == {'sketchEllipses': 2, 'sketchControlPointSplines': 1}
    assert res['failed'] == {'line': 1}
    assert len(res['curves']) == 1


def test_a_fitted_spline_reads_its_range_as_ok_start_end_and_is_imported(monkeypatch):
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    monkeypatch.setattr(bsg, 'app', types.SimpleNamespace(activeEditObject=None, userInterface=None), raising=False)
    d = Design()
    d.rootComponent.sketches = [_sketch('plain', d.rootComponent, fitted=[_fitted([(0, 0), (1, 1), (2, 0)])])]
    d.param('widthIn', 7); d.param('heightIn', 9)
    monkeypatch.setattr(bsg, '_active_design', lambda: d)
    res = bsg.PaletteHTMLEventHandler()._handle_pull_sketch({'board': {'id': ''}})
    assert res['failed'] == {}
    assert [c['type'] for c in res['curves']] == ['spline']
    assert res['curves'][0]['d'].count(' L ') == 25  # 26 samples
