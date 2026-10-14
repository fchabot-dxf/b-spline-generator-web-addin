"""
Pull from Fusion, made safe (seat A 2026-10-14; advisor, Fred: "fix now"): _handle_pull_sketch never invents a board
size (it used to fall back to 7 x 9, which the palette then applied), reports the curve types it does not read, counts
the ones that fail, and reads a fitted spline's parameter range as getParamExtents returns it: (ok, start, end).
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


def _sketch(lines=(), fitted=(), ellipses=0, cp_splines=0):
    curves = types.SimpleNamespace(
        sketchLines=_Coll(lines), sketchCircles=_Coll(), sketchArcs=_Coll(), sketchFittedSplines=_Coll(fitted),
        sketchFixedSplines=_Coll(), sketchControlPointSplines=_Coll([object()] * cp_splines),
        sketchEllipses=_Coll([object()] * ellipses), sketchEllipticalArcs=_Coll(), sketchConicCurves=_Coll())
    return types.SimpleNamespace(name='probe', sketchCurves=curves)


def _design(sketch, params=None):
    params = params or {}
    allp = types.SimpleNamespace(itemByName=lambda n: types.SimpleNamespace(value=params[n] * IN) if n in params else None)
    root = types.SimpleNamespace(sketches=[sketch], allOccurrences=[])
    return types.SimpleNamespace(allParameters=allp, rootComponent=root)


@pytest.fixture
def pull(monkeypatch):
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    app = types.SimpleNamespace(activeEditObject=None, userInterface=None)
    monkeypatch.setattr(bsg, 'app', app, raising=False)

    def run(sketch, params=None, board=None):
        monkeypatch.setattr(bsg, '_active_design', lambda: _design(sketch, params))
        return bsg.PaletteHTMLEventHandler()._handle_pull_sketch(board)
    return run


def test_no_size_in_the_design_places_the_curves_on_the_palettes_board_and_resizes_nothing(pull):
    res = pull(_sketch(lines=[_line((0, 0), (1, 0))]), params=None, board={'widthIn': 12, 'heightIn': 16})
    assert res['ok'] is True
    assert res['sizeSource'] is None and res['widthIn'] is None and res['heightIn'] is None  # never a made-up 7 x 9
    assert res['curves'][0]['d'] == 'M 6.0 8.0 L 7.0 8.0'  # the sketch origin = the 12 x 16 board's centre
    assert res['bounds'] == {'x0': 6.0, 'y0': 8.0, 'x1': 7.0, 'y1': 8.0}


def test_the_designs_own_size_is_sent_as_the_board_size(pull):
    res = pull(_sketch(lines=[_line((0, 0), (1, 0))]), params={'widthIn': 10, 'heightIn': 12}, board={'widthIn': 7, 'heightIn': 9})
    assert (res['sizeSource'], round(res['widthIn'], 6), round(res['heightIn'], 6)) == ('fusion', 10, 12)
    assert res['curves'][0]['d'] == 'M 5.0 6.0 L 6.0 6.0'


def test_no_size_anywhere_is_an_error_not_a_guess(pull):
    res = pull(_sketch(lines=[_line((0, 0), (1, 0))]), params=None, board={})
    assert res['ok'] is False and 'no widthIn' in res['error']


def test_the_curve_types_it_does_not_read_are_reported_and_a_failed_curve_is_counted(pull):
    res = pull(_sketch(lines=[_line((0, 0), (1, 0)), _BadLine()], ellipses=2, cp_splines=1), board={'widthIn': 7, 'heightIn': 9})
    assert res['skipped'] == {'sketchEllipses': 2, 'sketchControlPointSplines': 1}
    assert res['failed'] == {'line': 1}
    assert len(res['curves']) == 1


def test_a_fitted_spline_reads_its_range_as_ok_start_end_and_is_imported(pull):
    res = pull(_sketch(fitted=[_fitted([(0, 0), (1, 1), (2, 0)])]), board={'widthIn': 7, 'heightIn': 9})
    assert res['failed'] == {}
    assert [c['type'] for c in res['curves']] == ['spline']
    assert res['curves'][0]['d'].count(' L ') == 25  # 26 samples
