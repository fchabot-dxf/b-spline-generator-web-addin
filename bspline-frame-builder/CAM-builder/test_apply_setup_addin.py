"""The add-in's side of the per-setup APPLY (Fred 2026-10-21): the palette's 'apply_setup' action applies ONE setup; the old
all-setups 'apply_toolpaths' action is gone.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_apply_setup_addin.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_cam_stages import TestTheDeferredBuild as _Harness  # noqa: E402


def test_apply_setup_applies_only_the_named_setup_and_reports(monkeypatch):
    cb, fired, events = _Harness()._module(monkeypatch)
    calls, sent = [], []
    monkeypatch.setattr(cb, '_apply_toolpaths', lambda post_stages=True, only=None: calls.append(only) or (True, 'done'))
    monkeypatch.setattr(cb, '_send_to_html', lambda action, payload: sent.append((action, payload)))
    cb._dispatch_palette_action('apply_setup', {'setup': 'Frame'})
    assert calls == ['Frame'] and sent == [('report', {'ok': True, 'msg': 'done'})]


def test_there_is_no_all_setups_apply_action(monkeypatch):
    cb, fired, events = _Harness()._module(monkeypatch)
    calls = []
    monkeypatch.setattr(cb, '_apply_toolpaths', lambda post_stages=True, only=None: calls.append(only) or (True, 'done'))
    assert not hasattr(cb, '_do_apply_toolpaths')
    cb._dispatch_palette_action('apply_toolpaths', {'mode': 'bspline'})
    assert calls == []
