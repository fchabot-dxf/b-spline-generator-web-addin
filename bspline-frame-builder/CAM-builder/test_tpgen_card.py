"""
Fred (2026-10-07: "the load splash could list all the steps"; the steps "grow live"): the BUILD / APPLY loading card
stays open through the toolpaths -- its last declared step is 'generating the toolpaths' (cam-stages.js camTpgen) and
each LATER generation pass (item 95) joins the open card as its own step ("toolpaths, pass N"), sent with the change
that declares it (cam_stage 'grow'). The toolpath report closes the card; the BUILD / APPLY report leaves it open
(toolpaths_pending). The page side: tests/loading-steps-list.test.js + tests/cam-stages.test.js.
"""
import json
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_cam_stages import TestTheDeferredBuild  # noqa: E402  (the deferred-build harness)


def _addin(monkeypatch):
    cb, fired, events = TestTheDeferredBuild()._module(monkeypatch)
    return cb, events


def test_each_later_pass_joins_the_card_right_after_the_previous_step(monkeypatch):
    cb, events = _addin(monkeypatch)
    posted = []
    monkeypatch.setattr(cb, '_post_cam_stage', lambda sid, grow=None: posted.append((sid, grow)))
    cb._post_tpgen_pass(2)
    cb._post_tpgen_pass(3)
    assert posted == [
        ('camTpgenPass2', {'insertAfter': 'camTpgen', 'step': {'id': 'camTpgenPass2', 'label': 'Fusion: toolpaths, pass 2'}}),
        ('camTpgenPass3', {'insertAfter': 'camTpgenPass2', 'step': {'id': 'camTpgenPass3', 'label': 'Fusion: toolpaths, pass 3'}}),
    ]
    posted.clear()
    cb._post_tpgen_pass(2)  # the next run starts after the declared step again
    assert posted[0][1]['insertAfter'] == 'camTpgen'


def test_a_grown_step_is_sent_and_an_undeclared_one_without_a_grow_is_not(monkeypatch):
    from test_setups_with_operations import _install_fake_adsk, _import_module
    adsk = _install_fake_adsk([])
    sent = []
    pal = types.SimpleNamespace(sendInfoToHTML=lambda a, d: sent.append((a, json.loads(d))))
    adsk.core.Application._instance.userInterface = types.SimpleNamespace(palettes=types.SimpleNamespace(itemById=lambda _id: pal))
    adsk.doEvents = lambda: None
    cb = _import_module()
    logged = []
    monkeypatch.setattr(cb, '_log', lambda msg, level='INFO': logged.append(msg))
    monkeypatch.setattr(cb, '_palette_stages', lambda: types.SimpleNamespace(
        declared_stage_ids=lambda f: ['camTpgen'], pump=lambda ev: None))
    monkeypatch.setattr(cb, '_cam_stage_ids_cache', None)
    grow = {'insertAfter': 'camTpgen', 'step': {'id': 'camTpgenPass2', 'label': 'Fusion: toolpaths, pass 2'}}
    cb._post_cam_stage('camTpgenPass2', grow=grow)
    cb._post_cam_stage('camTpgenPass9')
    assert sent == [('cam_stage', {'id': 'camTpgenPass2', 'grow': grow})]
    assert any('undeclared stage id' in m for m in logged)


def test_the_build_and_apply_reports_keep_the_card_while_toolpaths_follow(monkeypatch):
    cb, events = _addin(monkeypatch)
    cb._do_generate(confirmed=True)
    for _ in range(6):
        cb._advance_build()
    sent = []
    monkeypatch.setattr(cb, '_send_to_html', lambda action, payload: sent.append((action, payload)))
    cb._apply_after_build = None
    cb._send_build_report({'ok': True, 'msg': 'x', 'apply': {'ok': True, 'msg': 'Applied.'}})
    cb._send_build_report({'ok': True, 'msg': 'x', 'apply': {'ok': False, 'msg': 'No CAM product.'}})
    assert [p.get('toolpaths_pending') for a, p in sent] == [True, None]
    sent.clear()
    monkeypatch.setattr(cb, '_apply_toolpaths', lambda post_stages=True: (True, 'done'))
    cb._do_apply_toolpaths()
    monkeypatch.setattr(cb, '_apply_toolpaths', lambda post_stages=True: (False, 'No setups.'))
    cb._do_apply_toolpaths()
    assert [p.get('toolpaths_pending') for a, p in sent] == [True, None]
