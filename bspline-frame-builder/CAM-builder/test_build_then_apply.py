"""
H23 item 101 (Fred: "perhaps simply add the step in a splash load image"): an APPLY clicked while a BUILD step blocks
Fusion never reaches the page (live trail), so a BUILD that built ends with APPLY itself -- its own declared step
(cam-stages.js camBuild: camBuildApply) on the same loading card, then ONE report. The APPLY TOOLPATHS button stays.
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_setups_with_operations import _install_fake_adsk, _import_module  # noqa: E402  (same adsk stubs + loader)


def _addin(monkeypatch, build_ok=True, apply_result=(True, 'Templates applied to 3 setup(s). Toolpath generation in progress.')):
    _install_fake_adsk([])
    cb = _import_module()
    events = []
    report = {'ok': build_ok, 'mms': {'a': True, 'b': True, 'c': True}, 'setups': [{'name': n, 'ok': True} for n in 'wxyz']}
    fake_engine = types.SimpleNamespace(run=lambda **k: events.append(('engine', k.get('skip_templates'))) or dict(report))
    monkeypatch.setattr(cb, '_load_engine', lambda: None)
    monkeypatch.setattr(cb, '_engine', fake_engine, raising=False)
    monkeypatch.setattr(cb, '_setups_with_operations', lambda: [])
    monkeypatch.setattr(cb, '_post_cam_stage', lambda sid: events.append(('stage', sid)))
    monkeypatch.setattr(cb, '_send_to_html', lambda action, payload: events.append((action, payload)))
    monkeypatch.setattr(cb, '_log', lambda msg, level='INFO': events.append(('log', msg)))
    monkeypatch.setattr(cb, '_apply_toolpaths', lambda post_stages=True: events.append(('apply', post_stages)) or apply_result)
    return cb, events


def test_a_build_that_built_ends_with_apply_as_its_own_step_then_one_report(monkeypatch):
    cb, events = _addin(monkeypatch)
    cb._do_generate()
    names = [e[0] if e[0] != 'stage' else f"stage:{e[1]}" for e in events if e[0] in ('engine', 'stage', 'apply', 'report')]
    assert names == ['engine', 'stage:camBuildApply', 'apply', 'report']
    assert ('apply', False) in events  # APPLY's own steps are not in the BUILD sequence
    assert ('log', '[CAM BUILD] then APPLY') in events
    reports = [p for a, p in events if a == 'report']
    assert len(reports) == 1
    assert reports[0]['apply']['ok'] is True
    assert 'BUILD complete' in reports[0]['msg'] and 'Toolpath generation in progress' in reports[0]['msg']


def test_a_build_that_failed_does_not_apply(monkeypatch):
    cb, events = _addin(monkeypatch, build_ok=False)
    cb._do_generate()
    assert not [e for e in events if e[0] == 'apply' or e == ('stage', 'camBuildApply')]
    assert len([e for e in events if e[0] == 'report']) == 1


def test_an_apply_that_failed_says_so_in_the_build_report(monkeypatch):
    cb, events = _addin(monkeypatch, apply_result=(False, 'No CAM product.'))
    cb._do_generate()
    rep = [p for a, p in events if a == 'report'][0]
    assert rep['apply'] == {'ok': False, 'msg': 'No CAM product.'}
    assert rep['msg'].endswith('APPLY failed: No CAM product.')


def test_the_apply_button_still_posts_its_own_steps_and_report(monkeypatch):
    cb, events = _addin(monkeypatch)
    monkeypatch.setattr(cb, '_apply_toolpaths', lambda post_stages=True: events.append(('apply', post_stages)) or (True, 'done'))
    cb._do_apply_toolpaths()
    assert ('apply', True) in events
    assert [p for a, p in events if a == 'report'] == [{'ok': True, 'msg': 'done'}]
