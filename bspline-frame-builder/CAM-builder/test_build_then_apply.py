"""
H23 item 101 (Fred: "perhaps simply add the step in a splash load image"): an APPLY clicked while a BUILD step blocks
Fusion never reaches the page (live trail), so a BUILD that built ends with APPLY itself -- its own declared step
(cam-stages.js camBuild: camBuildApply) on the same loading card, run on the tick AFTER it is posted (F35 item 70's
deferred build: the palette paints it first), then ONE report. A failed build reports at once. The APPLY TOOLPATHS
button stays (its own steps + report). The step order / waiting actions: test_cam_stages.py TestTheDeferredBuild.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_cam_stages import TestTheDeferredBuild  # noqa: E402  (the deferred-build harness: fake engine + ticks)


def _reports(events):
    return [e[1] for e in events if isinstance(e, tuple) and e[0] == 'report']


def _run(monkeypatch, report_ok=True, apply_result=(True, 'Applied.'), apply_raises=False):
    cb, fired, events = TestTheDeferredBuild()._module(monkeypatch)
    if not report_ok:
        def run_steps(**k):
            yield 'camWcs'
            return {'ok': False, 'mode': 'bspline', 'mms': {}, 'setups': []}
        monkeypatch.setattr(cb, '_engine', type('E', (), {'run_steps': staticmethod(run_steps)}), raising=False)

    def apply(post_stages=True):
        events.append(('apply', post_stages))
        if apply_raises:
            raise RuntimeError('boom')
        return apply_result
    monkeypatch.setattr(cb, '_apply_toolpaths', apply)
    monkeypatch.setattr(cb, '_log_error', lambda msg: events.append(('error', msg.split(chr(10))[0])))
    cb._do_generate(confirmed=True)
    for _ in range(8):
        cb._advance_build()
    return cb, events


def test_a_build_that_failed_does_not_apply_and_reports_at_once(monkeypatch):
    cb, events = _run(monkeypatch, report_ok=False)
    assert ('stage', 'camBuildApply') not in events
    assert not [e for e in events if isinstance(e, tuple) and e[0] == 'apply']
    assert len(_reports(events)) == 1
    assert not cb._build_running()


def test_an_apply_that_failed_says_so_in_the_build_report(monkeypatch):
    cb, events = _run(monkeypatch, apply_result=(False, 'No CAM product.'))
    assert _reports(events) == ['BUILD complete — 1 MM(s), 1 setup(s) created. APPLY failed: No CAM product.']


def test_an_apply_that_raised_still_reports_and_ends_the_build(monkeypatch):
    cb, events = _run(monkeypatch, apply_raises=True)
    assert ('error', "BUILD's APPLY step raised") in events
    assert _reports(events) == ['BUILD complete — 1 MM(s), 1 setup(s) created. APPLY failed: APPLY raised — see log.']
    assert not cb._build_running()


def test_the_apply_button_still_posts_its_own_steps_and_report(monkeypatch):
    cb, fired, events = TestTheDeferredBuild()._module(monkeypatch)
    monkeypatch.setattr(cb, '_apply_toolpaths', lambda post_stages=True: events.append(('apply', post_stages)) or (True, 'done'))
    cb._do_apply_toolpaths()
    assert ('apply', True) in events
    assert _reports(events) == ['done']
