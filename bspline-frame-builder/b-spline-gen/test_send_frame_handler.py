"""
FB-APP S5 (F10): b-spline-gen.py's [Send frame] handler: the palette's
'send_frame' action reaches _handle_send_frame, which finds the B-spline body
this add-in built (B-Spline Set / Clean / panel), runs fb_engine.send_frame
with the injected frame engine, records the send in last_send.json and reports
back with 'frame_result'. The orchestration itself is tested on a fake Fusion
world in frame-builder/fb_engine/test_send_frame.py.
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


class _Named:
    def __init__(self, name, **kw):
        self.name = name
        self.__dict__.update(kw)


def _occ(comp_name, children=(), bodies=()):
    return types.SimpleNamespace(component=_Named(comp_name), childOccurrences=list(children), bRepBodies=list(bodies))


def _design(*root_occs):
    return types.SimpleNamespace(rootComponent=types.SimpleNamespace(occurrences=list(root_occs)))


def _panel(name='panel', solid=True):
    return _Named(name, isSolid=solid)


class TestFindCoreBody:
    def test_the_solid_panel_in_bspline_set_clean(self):
        panel = _panel()
        d = _design(_occ('Frame_1'), _occ('B-Spline Set', children=[_occ('Stamped', bodies=[_panel()]),
                                                                    _occ('Clean', bodies=[_panel('surface', False), panel])]))
        assert bsg._find_bspline_core_body(d) is panel

    @pytest.mark.parametrize('d', [
        _design(),                                                                     # nothing sent yet
        _design(_occ('B-Spline Set', children=[_occ('Clean', bodies=[_panel('surface', False)])])),
        _design(_occ('B-Spline Set', children=[_occ('Stamped', bodies=[_panel()])])),  # no Clean
        _design(_occ('Other', children=[_occ('Clean', bodies=[_panel()])])),
    ])
    def test_none_without_that_body(self, d):
        assert bsg._find_bspline_core_body(d) is None


class _Pal:
    def __init__(self):
        self.sent = []

    def sendInfoToHTML(self, action, data):
        self.sent.append((action, json.loads(data)))


@pytest.fixture
def env(tmp_path, monkeypatch):
    pal = _Pal()
    design = _design()
    app = types.SimpleNamespace(activeProduct=design,
                                userInterface=types.SimpleNamespace(palettes=types.SimpleNamespace(itemById=lambda _id: pal)))
    monkeypatch.setattr(bsg, 'app', app, raising=False)
    monkeypatch.setattr(bsg, 'LAST_SEND_FILE', str(tmp_path / 'last_send.json'))
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    # the adsk the module bound at import (other tests may have swapped sys.modules' stub since)
    monkeypatch.setattr(bsg.adsk.fusion, 'Design', types.SimpleNamespace(cast=lambda x: x), raising=False)
    calls = {}

    def fake_send_frame(design_, payload, core_body, logger, **kw):
        calls.update(design=design_, payload=payload, core_body=core_body, logger=logger, **kw)
        return {'ok': core_body is not None, 'error': None if core_body is not None else 'No B-spline body', 'frame': 'Frame_1'}

    from fb_engine import send_frame as fb_send
    monkeypatch.setattr(fb_send, 'send_frame', fake_send_frame)
    from fb_utils import fb_logger
    monkeypatch.setattr(fb_logger, 'DebugLogger', lambda root: types.SimpleNamespace(root=root))  # no log file written
    engine = types.SimpleNamespace(build_sketch_logic_v3=object())
    monkeypatch.setattr(bsg, 'frame_engine', engine)
    return types.SimpleNamespace(pal=pal, design=design, calls=calls, engine=engine, tmp=tmp_path)


def _press(payload):
    args = types.SimpleNamespace(action='send_frame', data=json.dumps(payload))
    bsg.PaletteHTMLEventHandler().notify(args)


class TestHandler:
    def test_the_palette_action_runs_the_send_with_the_injected_engine_and_reports_back(self, env):
        payload = {'templateId': 'template_1', 'params': {'frame_thickness': 0.75}, 'seeds': {'waistReach': 0.4}}
        _press(payload)
        assert env.calls['payload'] == payload and env.calls['design'] is env.design
        assert env.calls['build_sketch'] is env.engine.build_sketch_logic_v3  # the root's injected engine
        from fb_engine import solid_coordinator
        assert env.calls['build_solid'] is solid_coordinator.build_solid_logic_v3
        assert env.pal.sent == [('frame_result', {'ok': False, 'error': 'No B-spline body', 'frame': 'Frame_1'})]
        saved = json.load(open(env.tmp / 'last_send.json', encoding='utf-8'))
        assert saved['frame']['payload'] == payload

    def test_the_bspline_body_found_is_the_one_sent_to(self, env):
        panel = _panel()
        env.design.rootComponent.occurrences.append(_occ('B-Spline Set', children=[_occ('Clean', bodies=[panel])]))
        _press({'templateId': 'template_2'})
        assert env.calls['core_body'] is panel
        assert env.pal.sent[-1][1]['ok'] is True

    def test_a_crash_is_reported_to_the_palette_not_swallowed(self, env, monkeypatch):
        from fb_engine import send_frame as fb_send

        def boom(*a, **k):
            raise RuntimeError('engine exploded')
        monkeypatch.setattr(fb_send, 'send_frame', boom)
        _press({'templateId': 'template_1'})
        action, result = env.pal.sent[-1]
        assert action == 'frame_result' and result['ok'] is False and 'engine exploded' in result['error']
