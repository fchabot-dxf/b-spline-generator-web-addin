"""The add-in's side of the Toolpaths list (cam-builder.py): the palette's actions only RECORD what was asked (Fusion's
generateToolpath must not run inside the HTML handler), the queue's CustomEvent tick does every Fusion call, never two ops
at once, and the palette gets the doc's states after each step.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_op_list_addin.py
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_cam_stages import TestTheDeferredBuild as _Harness  # noqa: E402  (the add-in harness: fake adsk, fired events, recorded sends)
from test_op_list import _Op, _Cam, _world, _Design  # noqa: E402


def _addin(monkeypatch, groups):
    cb, fired, events = _Harness()._module(monkeypatch)
    cam = _world(*groups)
    design = _Design()
    doc = types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=lambda t: design))
    monkeypatch.setattr(cb, '_active_cam', lambda: (cam, doc))
    cb.adsk.fusion.Design = types.SimpleNamespace(cast=lambda x: x)
    monkeypatch.setattr(cb, '_gen_queue', None, raising=False)
    sent, timers = [], []
    monkeypatch.setattr(cb, '_send_to_html', lambda action, payload: sent.append((action, payload)))
    monkeypatch.setattr(cb, '_warm_cam_engine', lambda: None)
    monkeypatch.setattr(cb, '_schedule_queue_tick', lambda: timers.append('tick'))
    return cb, cam, fired, sent, timers


def test_get_op_states_sends_the_docs_operations_and_changes_nothing(monkeypatch):
    a = _Op('A', 'none')
    cb, cam, fired, sent, _ = _addin(monkeypatch, [('Back', [a])])
    cb._dispatch_palette_action('get_op_states', {})
    assert [s[0] for s in sent] == ['op_states'] and cam.generated == [] and fired == []
    payload = sent[0][1]
    assert payload['setups'][0]['ops'][0]['key'] == a.entityToken and payload['setups'][0]['ops'][0]['state'] == 'none'
    assert payload['run']['on'] is False


def test_generate_ops_only_records_the_request_and_fires_the_tick_event(monkeypatch):
    a, b = _Op('A', 'none'), _Op('B', 'none')
    cb, cam, fired, sent, _ = _addin(monkeypatch, [('Back', [a, b])])
    cb._dispatch_palette_action('generate_ops', {'targets': [['Back', a.entityToken]]})
    assert cam.generated == []                                   # nothing generated inside the HTML handler
    assert fired == [cb.OPQUEUE_EVENT_ID]
    assert sent[-1][1]['run']['on'] is True


def test_the_tick_starts_one_op_checks_it_and_reschedules_until_the_run_is_over(monkeypatch):
    a, b = _Op('A', 'none'), _Op('B', 'none')
    cb, cam, fired, sent, timers = _addin(monkeypatch, [('Back', [a, b])])
    cb._dispatch_palette_action('generate_ops', {'scope': 'missing', 'setup': None})
    cb._queue_tick()
    assert cam.generated == ['A'] and timers == ['tick']
    assert sent[-1][1]['run']['name'] == 'A' and sent[-1][1]['run']['queued'] == 1
    cb._queue_tick()
    assert cam.generated == ['A']                                # A is still running: B is not started
    cam.finish(a)
    cb._queue_tick()
    assert cam.generated == ['A', 'B']
    cam.finish(b)
    n = len(timers)
    cb._queue_tick()
    assert sent[-1][1]['run']['on'] is False and len(timers) == n    # idle: no further tick scheduled
    assert [r['state'] for r in sent[-1][1]['setups'][0]['ops']] == ['valid', 'valid']


def test_a_second_request_during_a_run_is_refused_and_fires_no_second_tick(monkeypatch):
    a = _Op('A', 'none')
    cb, cam, fired, sent, _ = _addin(monkeypatch, [('Back', [a])])
    cb._dispatch_palette_action('generate_ops', {'scope': 'missing', 'setup': None})
    cb._dispatch_palette_action('generate_ops', {'scope': 'missing', 'setup': 'Back'})
    assert fired == [cb.OPQUEUE_EVENT_ID]


def test_stop_is_recorded_then_cancels_the_running_op_in_the_tick(monkeypatch):
    a, b = _Op('A', 'none'), _Op('B', 'none')
    cb, cam, fired, sent, timers = _addin(monkeypatch, [('Back', [a, b])])
    cb._dispatch_palette_action('generate_ops', {'scope': 'missing', 'setup': None})
    cb._queue_tick()
    cb._dispatch_palette_action('stop_generate', {})
    assert cam.cleared == [] and fired[-1] == cb.OPQUEUE_EVENT_ID
    cb._queue_tick()
    assert cam.cleared == ['A'] and cam.generated == ['A'] and sent[-1][1]['run'] == {**sent[-1][1]['run'], 'on': False, 'message': 'Stopped.'}


def test_the_palette_actions_are_registered_with_the_dispatcher_and_the_event_is_registered(monkeypatch):
    import inspect
    cb, *_ = _addin(monkeypatch, [])
    src = inspect.getsource(cb._dispatch_palette_action)
    for action in ('get_op_states', 'generate_ops', 'stop_generate'):
        assert f"'{action}'" in src
    assert 'OPQUEUE_EVENT_ID' in inspect.getsource(cb._register_refresh_event)
    assert 'OPQUEUE_EVENT_ID' in inspect.getsource(cb.stop)
