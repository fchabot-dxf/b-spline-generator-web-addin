"""
F26 item 2 (b), Fred ("add a delete frame button"): the palette's 'delete_frame' action deletes ONLY the frame(s)
this add-in built -- the same ones a Send replaces (_delete_frames -> fb_engine.send_frame.delete_previous_frames,
found by their own attribute) -- and reports delete_frame_result {ok, frames, error}. The B-spline sets, the last
import and anything else are never touched.
"""
import json
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


class _Pal:
    def __init__(self):
        self.sent = []

    def sendInfoToHTML(self, action, data):
        self.sent.append((action, json.loads(data)))


@pytest.fixture
def env(monkeypatch):
    pal = _Pal()
    design = types.SimpleNamespace(name='design')
    app = types.SimpleNamespace(activeProduct=design,
                                userInterface=types.SimpleNamespace(palettes=types.SimpleNamespace(itemById=lambda _id: pal)))
    monkeypatch.setattr(bsg, 'app', app, raising=False)
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    monkeypatch.setattr(bsg.adsk.fusion, 'Design', types.SimpleNamespace(cast=lambda x: x), raising=False)
    calls = {'delete_previous_frames': [], 'other': []}

    from fb_engine import send_frame as fb_send

    def fake_delete(design_, log):
        calls['delete_previous_frames'].append(design_)
        return ['Frame_1']
    monkeypatch.setattr(fb_send, 'delete_previous_frames', fake_delete)
    # nothing else this add-in built may go
    for name in ('_remove_last_import', '_delete_bspline_sets', '_clear_custom_graphics'):
        monkeypatch.setattr(bsg, name, (lambda n: (lambda *a, **k: calls['other'].append(n)))(name))
    return types.SimpleNamespace(pal=pal, design=design, calls=calls)


def _press():
    bsg.PaletteHTMLEventHandler().notify(types.SimpleNamespace(action='delete_frame', data='{}'))


def test_deletes_the_built_frames_through_the_send_path_and_reports_them(env):
    _press()
    assert env.calls['delete_previous_frames'] == [env.design]
    assert env.pal.sent == [('delete_frame_result', {'ok': True, 'frames': ['Frame_1'], 'error': None})]


def test_nothing_else_is_touched(env):
    _press()
    assert env.calls['other'] == []


def test_no_design_is_reported_not_raised(env, monkeypatch):
    monkeypatch.setattr(bsg.app, 'activeProduct', None)
    _press()
    action, r = env.pal.sent[-1]
    assert action == 'delete_frame_result' and r['ok'] is False and 'No active Fusion design' in r['error']
    assert env.calls['delete_previous_frames'] == []
