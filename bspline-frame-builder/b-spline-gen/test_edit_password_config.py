"""
F35 item 34, the Fusion side: the add-in keeps the edit password in the user's own config OUTSIDE the deployed
add-in folder (%APPDATA%/bspline-frame-builder/config.json; a deploy replaces the add-in folder, this file
survives), hands it to the palette at startup ('edit_password') and stores a new one from the palette
('store_edit_password'), so Fusion never asks twice. The value is never logged.
"""
import json
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_svg_layer_import_plan import _bspline_gen as bsg  # noqa: E402  (same adsk stubs + loader)


def _use_config(tmp_path, monkeypatch):
    path = tmp_path / 'cfg' / 'config.json'
    monkeypatch.setenv(bsg.USER_CONFIG_ENV, str(path))
    return path


def test_default_path_is_outside_the_add_in_folder(monkeypatch):
    monkeypatch.delenv(bsg.USER_CONFIG_ENV, raising=False)
    monkeypatch.setenv('APPDATA', os.path.join('C:', os.sep, 'Users', 'u', 'AppData', 'Roaming'))
    p = bsg.user_config_path()
    assert p.endswith(os.path.join('bspline-frame-builder', 'config.json'))
    addin_dir = os.path.dirname(os.path.dirname(os.path.realpath(bsg.__file__)))
    assert not os.path.realpath(p).startswith(addin_dir)


def test_store_then_startup_handshake_hands_it_back(tmp_path, monkeypatch):
    path = _use_config(tmp_path, monkeypatch)
    bsg.write_user_config({'other': 1})
    bsg._store_edit_password(json.dumps({'password': 'dummy-test-password'}))
    assert json.loads(path.read_text(encoding='utf-8')) == {'other': 1, 'editPassword': 'dummy-test-password'}
    sent = []
    bsg._send_edit_password(types.SimpleNamespace(sendInfoToHTML=lambda a, d: sent.append((a, json.loads(d)))))
    assert sent == [('edit_password', {'password': 'dummy-test-password'})]


def test_clear_removes_only_the_password(tmp_path, monkeypatch):
    path = _use_config(tmp_path, monkeypatch)
    bsg.write_user_config({'other': 1, 'editPassword': 'x'})
    bsg._store_edit_password(json.dumps({'password': None}))
    assert json.loads(path.read_text(encoding='utf-8')) == {'other': 1}
    sent = []
    bsg._send_edit_password(types.SimpleNamespace(sendInfoToHTML=lambda a, d: sent.append(json.loads(d))))
    assert sent == [{'password': None}]


def test_the_value_is_never_logged(tmp_path, monkeypatch):
    _use_config(tmp_path, monkeypatch)
    logged = []
    monkeypatch.setattr(bsg, '_log', lambda m: logged.append(m))
    bsg._store_edit_password(json.dumps({'password': 'dummy-test-password'}))
    assert logged and not any('dummy-test-password' in m for m in logged)


def test_a_missing_or_broken_config_reads_as_empty(tmp_path, monkeypatch):
    path = _use_config(tmp_path, monkeypatch)
    assert bsg.read_user_config() == {}
    path.parent.mkdir(parents=True)
    path.write_text('{not json', encoding='utf-8')
    assert bsg.read_user_config() == {}


def test_the_palette_actions_are_wired():
    src = open(os.path.join(_HERE, 'b-spline-gen.py'), encoding='utf-8').read()
    assert "if action == 'store_edit_password':" in src
    assert '_send_edit_password(pal)' in src
