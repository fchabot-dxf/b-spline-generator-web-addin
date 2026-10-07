"""
F35 item 70, the CAM add-in side: BUILD SETUPS / APPLY TOOLPATHS report each step to the CAM palette by its DECLARED
id ('cam_stage' {id}) from ui/html/cam-stages.js -- the one file the palette imports too (cam-loading.js) -- through
fb_shared.palette_stages (the shared reader + the paint pump). The palette side: tests/cam-stages.test.js.
"""
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _ROOT)

from fb_shared import palette_stages  # noqa: E402

STAGES_FILE = os.path.join(_HERE, 'ui', 'html', 'cam-stages.js')


def _src(name):
    with open(os.path.join(_HERE, name), encoding='utf-8') as f:
        return f.read()


def test_the_add_in_reads_the_palettes_own_declaration():
    with open(STAGES_FILE, encoding='utf-8') as f:
        ids_in_file = re.findall(r'"id":\s*"([^"]+)"', f.read())
    assert palette_stages.declared_stage_ids(STAGES_FILE) == ids_in_file


def test_every_reported_stage_is_declared_and_every_declared_stage_is_reported():
    used = set(re.findall(r"yield '(cam[A-Za-z]+)'", _src(os.path.join('cam_engine', 'cam_coordinator.py'))))
    used |= set(re.findall(r"_post_cam_stage\('(cam[A-Za-z]+)'\)", _src('cam-builder.py')))
    assert used == set(palette_stages.declared_stage_ids(STAGES_FILE))


def test_the_build_steps_are_reported_in_their_declared_order():
    src = _src(os.path.join('cam_engine', 'cam_coordinator.py'))
    order = [m.group(1) for m in re.finditer(r"yield '(cam[A-Za-z]+)'", src)]
    assert order == ['camWcs', 'camCleanup', 'camModels', 'camSetups']


def test_the_pump_keeps_pumping_for_its_window_not_once():
    calls = []
    t0 = palette_stages.time.monotonic()
    palette_stages.pump(lambda: calls.append(palette_stages.time.monotonic()))
    assert len(calls) > 1 and calls[-1] - t0 >= palette_stages.POST_PAINT_PUMP_S


# ---- F35 item 70: the BUILD runs one declared step per deferred event (seat A, measured live: the palette got no
# step message posted after the Manufacture switch, nor the one after the MMs were built, until the handler returned)

from test_cam_reuse import eng, _run_coordinator  # noqa: E402,F401  (the engine fixture + its fakes)


def _drain(steps, seen):
    while True:
        try:
            seen.append('step:' + next(steps))
        except StopIteration as done:
            return done.value


def test_the_pipeline_pauses_at_each_declared_step_before_its_work(eng, monkeypatch):
    seen_steps = []
    rep, seen = _run_coordinator_steps(eng, monkeypatch, None, seen_steps)
    assert seen_steps == ['step:camWcs', 'wcs', 'step:camCleanup', 'cleanup', 'step:camModels', 'build_mms',
                          'step:camSetups', 'build_setups']
    assert rep['ok'] is True


def test_a_reused_build_pauses_at_its_two_steps(eng, monkeypatch):
    seen_steps = []
    rep, _ = _run_coordinator_steps(eng, monkeypatch, {'mms': {r: object() for r in eng.mm.MM_RULES}, 'setups': {}}, seen_steps)
    assert seen_steps == ['step:camWcs', 'wcs', 'step:camSetups', 'in_place'] and rep['reused'] is True


def _run_coordinator_steps(eng, monkeypatch, reuse, out):
    """_run_coordinator's fakes, but the work calls and the steps land in ONE list, in the order they happen."""
    co, sb, mm = eng.co, eng.sb, eng.mm
    import types as _t
    fake_cam = object()
    monkeypatch.setattr(co.cam_workspace, 'acquire_cam', lambda app=None, logger=None: fake_cam)
    des = object()
    doc = _t.SimpleNamespace(products=_t.SimpleNamespace(itemByProductType=lambda t: des))
    eng.adsk.fusion.Design = type('Design', (), {'cast': staticmethod(lambda x: x)})
    app = _t.SimpleNamespace(activeDocument=doc)
    monkeypatch.setattr(sb, 'ensure_wcs_sketches', lambda d, l=None: out.append('wcs'))
    monkeypatch.setattr(sb, 'find_reusable_build', lambda cam, names, logger=None: reuse)
    monkeypatch.setattr(co, '_cleanup_previous_build', lambda cam, logger: out.append('cleanup'))
    monkeypatch.setattr(mm, 'build_all_mms', lambda cam, d, c, l: out.append('build_mms') or {r: object() for r in mm.MM_RULES})
    fake_setups = [_t.SimpleNamespace(name=s['name']) for s in sb.SETUP_SPECS]
    monkeypatch.setattr(sb, 'build_all_setups', lambda cam, mms, l, **k: out.append('build_setups') or fake_setups)
    monkeypatch.setattr(sb, 'update_setups_in_place', lambda cam, r, l=None: out.append('in_place') or fake_setups)
    steps = co.run_steps(classifier=None, app=app, logger=None, mode='bspline', skip_templates=True, skip_machine=True)
    return _drain(steps, out), out


def test_run_still_runs_the_whole_pipeline_in_one_call_with_on_stage(eng, monkeypatch):
    rep, seen = _run_coordinator(eng, monkeypatch, None)
    assert seen == ['wcs', 'cleanup', 'build_mms', 'build_setups'] and rep['ok'] is True


class TestTheDeferredBuild:
    """The add-in: _do_generate returns from the HTML handler BEFORE the build starts; each tick runs one step and
    posts it; the end sends the report; palette actions that arrive during the build wait and are replayed."""

    def _module(self, monkeypatch):
        from test_setups_with_operations import _install_fake_adsk, _import_module
        adsk = _install_fake_adsk([])
        fired, events = [], []
        adsk.core.Application._instance.fireCustomEvent = lambda eid, data: fired.append(eid)
        adsk.core.HTMLEventArgs = type('HTMLEventArgs', (), {'cast': staticmethod(lambda a: a)})
        cb = _import_module()
        monkeypatch.setattr(cb, '_log', lambda *a, **k: None)
        monkeypatch.setattr(cb, '_load_engine', lambda: None)
        monkeypatch.setattr(cb, '_setups_with_operations', lambda: [])
        monkeypatch.setattr(cb, '_post_cam_stage', lambda sid: events.append(('stage', sid)))
        monkeypatch.setattr(cb, '_send_to_html', lambda action, payload: events.append((action, payload.get('msg'))))
        self.delays = []
        test = self

        class _Timer:  # the next step's tick, after PALETTE_SETTLE_S: recorded, then fired at once
            def __init__(self, delay, fn):
                test.delays.append(delay)
                self.fn = fn

            def start(self):
                self.fn()
        monkeypatch.setattr(cb.threading, 'Timer', _Timer)

        def run_steps(**k):
            events.append('build started')
            for sid in ['camWcs', 'camCleanup', 'camModels', 'camSetups']:
                yield sid
                events.append(f'work after {sid}')
            return {'ok': True, 'mode': 'bspline', 'mms': {'stock': True}, 'setups': [{'name': 'Setup 1', 'ok': True}]}
        monkeypatch.setattr(cb, '_engine', type('E', (), {'run_steps': staticmethod(run_steps)}), raising=False)
        # H23 item 101: the build's own APPLY step (the APPLY core, mocked)
        monkeypatch.setattr(cb, '_apply_toolpaths', lambda post_stages=True: events.append(('apply', post_stages)) or (True, 'Applied.'))
        return cb, fired, events

    def test_the_html_handler_returns_before_the_build_starts(self, monkeypatch):
        cb, fired, events = self._module(monkeypatch)
        cb._do_generate(confirmed=True)
        assert fired == [cb.BUILD_STEP_EVENT_ID]
        assert events == []  # not one step of the build has run inside the handler

    def test_each_tick_runs_one_step_posts_it_and_schedules_the_next_then_reports(self, monkeypatch):
        cb, fired, events = self._module(monkeypatch)
        cb._do_generate(confirmed=True)
        for _ in range(6):
            cb._advance_build()
        # H23 item 101: after the build's steps, its own APPLY step (camBuildApply) is posted, run on the NEXT tick
        # (so the palette paints it first), then ONE report
        assert events == ['build started', ('stage', 'camWcs'), 'work after camWcs', ('stage', 'camCleanup'),
                          'work after camCleanup', ('stage', 'camModels'), 'work after camModels', ('stage', 'camSetups'),
                          'work after camSetups', ('stage', 'camBuildApply'), ('apply', False),
                          ('report', 'BUILD complete — 1 MM(s), 1 setup(s) created. Applied.')]
        assert fired == [cb.BUILD_STEP_EVENT_ID] * 6  # one per step + the APPLY step; none after the report
        # seat A, live: a tick fired at once ran the setup build before the palette took the step -- each later tick
        # waits PALETTE_SETTLE_S after its post
        assert self.delays == [cb.PALETTE_SETTLE_S] * 5 and cb.PALETTE_SETTLE_S >= 0.2
        assert cb._build_steps is None and cb._apply_after_build is None

    def test_a_palette_action_during_the_build_waits_and_runs_after_the_report(self, monkeypatch):
        cb, fired, events = self._module(monkeypatch)
        monkeypatch.setattr(cb, '_do_add_machine', lambda: events.append('add machine ran'))
        cb._do_generate(confirmed=True)
        cb._advance_build()
        import types as _t
        cb._CamHtmlEventHandler().notify(_t.SimpleNamespace(action='add_machine', data='{}'))
        assert 'add machine ran' not in events
        for _ in range(5):
            cb._advance_build()
        assert events[-2:] == [('report', 'BUILD complete — 1 MM(s), 1 setup(s) created. Applied.'), 'add machine ran']

    def test_a_waiting_apply_is_dropped_when_the_build_has_just_applied(self, monkeypatch):
        # H23 item 101: replaying it would apply the templates a second time (doubled operations)
        cb, fired, events = self._module(monkeypatch)
        monkeypatch.setattr(cb, '_do_apply_toolpaths', lambda: events.append('apply button ran'))
        cb._do_generate(confirmed=True)
        cb._advance_build()
        import types as _t
        cb._CamHtmlEventHandler().notify(_t.SimpleNamespace(action='apply_toolpaths', data='{}'))
        for _ in range(5):
            cb._advance_build()
        assert 'apply button ran' not in events
        assert events.count(('apply', False)) == 1

    def test_an_action_during_the_builds_own_apply_step_still_waits(self, monkeypatch):
        cb, fired, events = self._module(monkeypatch)
        monkeypatch.setattr(cb, '_do_add_machine', lambda: events.append('add machine ran'))
        cb._do_generate(confirmed=True)
        for _ in range(5):
            cb._advance_build()  # the steps are done; the APPLY step is posted, not yet run
        assert cb._build_steps is None and cb._apply_after_build is not None and cb._build_running()
        import types as _t
        cb._CamHtmlEventHandler().notify(_t.SimpleNamespace(action='add_machine', data='{}'))
        assert 'add machine ran' not in events
        cb._advance_build()
        assert events[-1] == 'add machine ran'
