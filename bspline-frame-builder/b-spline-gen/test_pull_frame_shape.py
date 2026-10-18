"""
Pull from Fusion part 2 (seat B 2026-10-18): the wood-frame sketch shape comes back, read by the Send-written
FrameBuilder/ID tags on the project's OWN frame component -- never by sketch name, never another board's frame.
FAIL-BEFORE: _handle_pull_sketch had no `frameShape` field, and read_frame_shape did not exist.
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_pull_sketch_handler import Design, _Coll, _pt, _sketch, _line, IN  # noqa: E402
from test_send_targets import Comp  # noqa: E402
from test_svg_layer_import_plan import _bspline_gen as bsg  # noqa: E402
from fb_engine.board_scope import BoardScope  # noqa: E402
from fb_engine.send_frame import FRAME_TYPE_ATTR, FRAME_TYPE_VALUE  # noqa: E402
import pull_frame_shape as pfs  # noqa: E402

import pytest  # noqa: E402


class _Tag:
    def __init__(self, sid):
        self.sid = sid

    def itemByName(self, group, name):
        return types.SimpleNamespace(value=self.sid) if (group, name) == ('FrameBuilder', 'ID') and self.sid else None


def _tagged_line(sid, a, b):
    ln = _line(a, b)
    ln.attributes = _Tag(sid)
    return ln


def _tagged_arc(sid, start, mid, end):
    """An arc whose evaluator returns `mid` at the parameter midpoint (what Send's Arc3Point bulge is)."""
    ev = types.SimpleNamespace(getParameterAtPoint=lambda p: (True, 0.0 if p.x == _pt(*start).x and p.y == _pt(*start).y else 1.0),
                               getPointAtParameter=lambda t: (True, _pt(*mid)))
    return types.SimpleNamespace(startSketchPoint=types.SimpleNamespace(geometry=_pt(*start)),
                                 endSketchPoint=types.SimpleNamespace(geometry=_pt(*end)),
                                 geometry=types.SimpleNamespace(evaluator=ev), attributes=_Tag(sid), isConstruction=False)


def _frame_sketch(parent, lines=(), arcs=()):
    sk = _sketch('Shape Outline', parent, lines=list(lines))
    sk.sketchCurves.sketchArcs = _Coll(arcs)
    return sk


def _with_frame(design, board, lines=(), arcs=()):
    fc = Comp('Frame', **{'FrameBuilder.ComponentType': FRAME_TYPE_VALUE})
    board.children.append(fc)
    fc.sketches = [_frame_sketch(fc, lines, arcs)]
    design.attrs.append(types.SimpleNamespace(groupName=FRAME_TYPE_ATTR[0], name=FRAME_TYPE_ATTR[1], value=FRAME_TYPE_VALUE, parent=fc))
    return fc


@pytest.fixture
def design():
    d = Design()
    d.rootComponent.sketches = []
    d.a, d.b = d.board('Rose', 'bRoseid'), d.board('Oak', 'bOakid')
    d.a.sketches = [_sketch('Lattice A', d.a, lines=[_line((0, 0), (1, 0))])]
    d.b.sketches = [_sketch('Lattice B', d.b, lines=[_line((0, 0), (2, 0))])]
    for n, v in (('bRoseid_widthIn', 7), ('bRoseid_heightIn', 9), ('bOakid_widthIn', 7), ('bOakid_heightIn', 9)):
        d.param(n, v)
    return d


def test_reads_the_asked_ids_in_inches_line_start_end_arc_start_mid_end(design):
    _with_frame(design, design.a,
                lines=[_tagged_line('top_edge', (-2, 3), (2, 3)), _tagged_line('not_asked', (0, 0), (1, 1))],
                arcs=[_tagged_arc('arc_waist_R', (2, 1), (1.5, 0), (2, -1))])
    shape, rep = pfs.read_frame_shape(design, BoardScope(design, design.a), ['top_edge', 'arc_waist_R', 'horn_TR'])
    assert shape['top_edge']['points'] == [[-2.0, 3.0], [2.0, 3.0]]
    assert shape['arc_waist_R']['points'] == [[2.0, 1.0], [1.5, 0.0], [2.0, -1.0]]
    assert 'not_asked' not in shape
    assert rep['missing'] == ['horn_TR'] and rep['found'] == 2 and rep['frames'] == 1  # a gap is reported, not dropped


def test_another_boards_frame_is_never_read(design):
    _with_frame(design, design.a, lines=[_tagged_line('top_edge', (-2, 3), (2, 3))])
    _with_frame(design, design.b, lines=[_tagged_line('top_edge', (-9, 9), (9, 9))])
    shape, _ = pfs.read_frame_shape(design, BoardScope(design, design.a), ['top_edge'])
    assert shape['top_edge']['points'] == [[-2.0, 3.0], [2.0, 3.0]]


def test_no_ids_asked_or_no_frame_reads_nothing(design):
    _with_frame(design, design.a, lines=[_tagged_line('top_edge', (-2, 3), (2, 3))])
    assert pfs.read_frame_shape(design, BoardScope(design, design.a), [])[0] == {}
    assert pfs.read_frame_shape(design, BoardScope(design, design.b), ['top_edge'])[0] == {}


def test_the_pull_reply_carries_frameShape_and_keeps_the_lattice_half(design, monkeypatch):
    monkeypatch.setattr(bsg, '_log', lambda m: None)
    monkeypatch.setattr(bsg, 'app', types.SimpleNamespace(activeEditObject=None, userInterface=None), raising=False)
    monkeypatch.setattr(bsg, '_active_design', lambda: design)
    _with_frame(design, design.a, lines=[_tagged_line('top_edge', (-2, 3), (2, 3))])
    res = bsg.PaletteHTMLEventHandler()._handle_pull_sketch({'board': {'id': 'bRoseid'}, 'frameSeedIds': ['top_edge']})
    assert res['ok'] is True and res['sketchName'] == 'Lattice A'
    assert res['frameShape']['top_edge']['points'] == [[-2.0, 3.0], [2.0, 3.0]]
    assert res['frameShapeReport']['found'] == 1


def test_an_old_app_that_asks_for_no_ids_gets_an_empty_frameShape(design, monkeypatch):
    monkeypatch.setattr(bsg, '_log', lambda m: None)
    monkeypatch.setattr(bsg, 'app', types.SimpleNamespace(activeEditObject=None, userInterface=None), raising=False)
    monkeypatch.setattr(bsg, '_active_design', lambda: design)
    res = bsg.PaletteHTMLEventHandler()._handle_pull_sketch({'board': {'id': 'bRoseid'}})
    assert res['ok'] is True and res['frameShape'] == {}
