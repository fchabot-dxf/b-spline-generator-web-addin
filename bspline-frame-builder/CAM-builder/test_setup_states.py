"""
The CAM palette's setup cards read one declared source (cam_engine/toolpath_gen.py setup_states): the final TPGen
report and the palette's open (get_setup_states) both send it. MEASURED 2026-10-07: after APPLY a card still read "ok"
whatever its toolpaths; a palette opened on a built doc read "pending" on every card. Page side:
tests/cam-setup-state.test.js.
"""
import json
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from cam_engine import toolpath_gen as tg  # noqa: E402  (pure: no adsk import)
from test_setups_with_operations import _install_fake_adsk, _import_module  # noqa: E402


class _Ops:
    def __init__(self, ops):
        self._ops = ops
        self.count = len(ops)

    def item(self, j):
        return self._ops[j]


def _op(has, valid):
    return types.SimpleNamespace(hasToolpath=has, isToolpathValid=valid)


def _cam(*setups):
    items = [types.SimpleNamespace(name=n, operations=_Ops(ops)) for n, ops in setups]
    return types.SimpleNamespace(setups=types.SimpleNamespace(count=len(items), item=lambda i: items[i]))


def test_each_setup_with_its_ops_and_valid_toolpaths():
    cam = _cam(('Stock', []),
               ('B-spline Back', [_op(True, True), _op(True, True)]),
               ('B-spline Top', [_op(True, True), _op(False, False), _op(True, False)]),  # empty, and stale
               ('Frame', [_op(True, True), _op(True, True)]))
    assert tg.setup_states(cam) == [
        {'name': 'Stock', 'ok': True, 'ops': 0, 'toolpaths': 0},
        {'name': 'B-spline Back', 'ok': True, 'ops': 2, 'toolpaths': 2},
        {'name': 'B-spline Top', 'ok': True, 'ops': 3, 'toolpaths': 1},  # only a VALID toolpath counts
        {'name': 'Frame', 'ok': True, 'ops': 2, 'toolpaths': 2},
    ]


def test_no_cam_product_no_setups():
    assert tg.setup_states(None) == []


def test_the_palette_open_asks_for_them_and_gets_them(monkeypatch):
    adsk = _install_fake_adsk([])
    adsk.core.HTMLEventArgs = type('HTMLEventArgs', (), {'cast': staticmethod(lambda x: x)})
    cb = _import_module()
    sent = []
    monkeypatch.setattr(cb, '_send_to_html', lambda action, payload: sent.append((action, payload)))
    monkeypatch.setattr(cb, '_load_engine', lambda: None)
    cam = _cam(('Frame', [_op(True, True)]))
    doc = types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=lambda t: cam))
    adsk.core.Application = types.SimpleNamespace(get=lambda: types.SimpleNamespace(activeDocument=doc))
    adsk.cam.CAM = types.SimpleNamespace(cast=lambda x: x)
    cb._CamHtmlEventHandler().notify(types.SimpleNamespace(action='get_setup_states', data=json.dumps({})))
    assert sent == [('setup_states', {'setups': [{'name': 'Frame', 'ok': True, 'ops': 1, 'toolpaths': 1}]})]
