"""
H23 item 101 (live, seat A readback 2): an APPLY clicked while a BUILD step blocked Fusion never reached the add-in.
The palette now keeps its own timestamped trail of each BUILD / APPLY click ('page_log'); the add-in logs those lines
on arrival and never dispatch them, so the log shows when a click left the page and when it
arrived. The page side: tests/cam-page-log.test.js.
"""
import json
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_setups_with_operations import _install_fake_adsk, _import_module  # noqa: E402  (same adsk stubs + loader)


def _handler(monkeypatch):
    adsk = _install_fake_adsk([])
    adsk.core.HTMLEventArgs = type('HTMLEventArgs', (), {'cast': staticmethod(lambda x: x)})
    cb = _import_module()
    logged, ran = [], []
    monkeypatch.setattr(cb, '_log', lambda msg, level='INFO': logged.append(msg))
    for fn in ('_do_generate', '_do_apply_toolpaths', '_do_preview'):
        monkeypatch.setattr(cb, fn, lambda *a, _fn=fn, **k: ran.append(_fn))
    send = lambda action, data: cb._CamHtmlEventHandler().notify(types.SimpleNamespace(action=action, data=json.dumps(data)))
    return send, logged, ran


def test_page_log_lines_are_logged_on_arrival_and_never_dispatched(monkeypatch):
    send, logged, ran = _handler(monkeypatch)
    send('page_log', {'action': 'page_log', 'lines': ['08:20:12.828 APPLY click', '08:20:12.900 camApply begin']})
    assert logged == ['[PAGE] 08:20:12.828 APPLY click', '[PAGE] 08:20:12.900 camApply begin']
    assert ran == []
    send('apply_toolpaths', {'action': 'apply_toolpaths'})  # the real action still runs as before
    assert ran == ['_do_apply_toolpaths']


def test_the_ring_resend_is_marked(monkeypatch):
    send, logged, ran = _handler(monkeypatch)
    send('page_log', {'action': 'page_log', 'ring': True, 'lines': ['a', 'b']})
    assert logged == ['[PAGE] a (ring)', '[PAGE] b (ring)']
    assert ran == []
