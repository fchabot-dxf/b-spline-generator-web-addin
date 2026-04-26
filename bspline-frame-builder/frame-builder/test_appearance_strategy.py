"""Unit tests for ``fb_engine.appearance_strategy``."""

import os
import sys
import traceback
import types


def _install_adsk_stubs():
    if 'adsk' in sys.modules:
        return
    adsk = types.ModuleType('adsk')
    adsk.core = types.ModuleType('adsk.core')
    adsk.fusion = types.ModuleType('adsk.fusion')
    sys.modules['adsk'] = adsk
    sys.modules['adsk.core'] = adsk.core
    sys.modules['adsk.fusion'] = adsk.fusion


_HERE = "/sessions/ecstatic-gracious-planck/mnt/b-spline-generator-web-addin/bspline-frame-builder/frame-builder"
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_install_adsk_stubs()


from fb_engine.appearance_strategy import (
    AppearanceStrategy,
    DefaultAppearanceStrategy,
)


class RecordingManager:
    def __init__(self, capture_return=None):
        self.calls = []
        self._capture_return = capture_return

    def capture_core_appearance(self, body):
        self.calls.append(('capture_core_appearance', body))
        return self._capture_return

    def restore_core_appearance(self, body, captured):
        self.calls.append(('restore_core_appearance', body, captured))

    def apply_appearance(self, bodies, name):
        self.calls.append(('apply_appearance', tuple(bodies), name))


class RecordingLogger:
    def __init__(self):
        self.entries = []

    def log(self, msg, level=None):
        self.entries.append((str(msg), level))


class FakeBody:
    def __init__(self, name):
        self.name = name
        self.appearance = None


class _MarkerAppearance:
    def __init__(self, name='captured-paint'):
        self.name = name


def _check(condition, message, errors):
    if not condition:
        errors.append(message)


def test_capture_delegates_to_manager():
    errors = []
    captured = _MarkerAppearance('signature-blue')
    mgr = RecordingManager(capture_return=captured)
    strat = DefaultAppearanceStrategy(mgr, RecordingLogger())
    body = FakeBody('panel')
    result = strat.capture(body)
    _check(result is captured, f"capture should return whatever the manager returned, got {result!r}", errors)
    _check(mgr.calls == [('capture_core_appearance', body)], f"capture call log mismatch: {mgr.calls}", errors)
    return errors


def test_restore_noops_when_body_missing():
    errors = []
    mgr = RecordingManager()
    strat = DefaultAppearanceStrategy(mgr, RecordingLogger())
    strat.restore(None, _MarkerAppearance())
    _check(mgr.calls == [], f"restore(None, ...) must not call into the manager: {mgr.calls}", errors)
    return errors


def test_restore_delegates_with_captured():
    errors = []
    mgr = RecordingManager()
    strat = DefaultAppearanceStrategy(mgr, RecordingLogger())
    body = FakeBody('panel')
    captured = _MarkerAppearance()
    strat.restore(body, captured)
    _check(mgr.calls == [('restore_core_appearance', body, captured)], f"restore call log mismatch: {mgr.calls}", errors)
    return errors


def test_finish_empty_bodies_noop():
    errors = []
    mgr = RecordingManager()
    strat = DefaultAppearanceStrategy(mgr, RecordingLogger())
    strat.finish([], 'Brass', _MarkerAppearance())
    _check(mgr.calls == [], f"finish([], ...) should make no calls: {mgr.calls}", errors)
    return errors


def test_finish_applies_requested_preset():
    errors = []
    mgr = RecordingManager()
    strat = DefaultAppearanceStrategy(mgr, RecordingLogger())
    bodies = [FakeBody('bar1'), FakeBody('bar2')]
    captured = _MarkerAppearance()
    strat.finish(bodies, 'Brass', captured)
    _check(mgr.calls == [('apply_appearance', tuple(bodies), 'Brass')], f"finish should delegate preset to apply_appearance: {mgr.calls}", errors)
    for b in bodies:
        _check(b.appearance is None, f"body {b.name} appearance leaked through preset path: {b.appearance!r}", errors)
    return errors


def test_finish_none_sentinel_skips_preset_only():
    errors = []
    mgr = RecordingManager()
    strat = DefaultAppearanceStrategy(mgr, RecordingLogger())
    bodies = [FakeBody('bar1')]
    captured = _MarkerAppearance('panel-paint')
    strat.finish(bodies, '(none)', captured)
    _check(mgr.calls == [], f"'(none)' must skip apply_appearance: {mgr.calls}", errors)
    _check(bodies[0].appearance is captured, f"'(none)' + captured should still apply fallback paint, got {bodies[0].appearance!r}", errors)
    return errors


def test_finish_none_sentinel_no_capture_is_noop():
    errors = []
    mgr = RecordingManager()
    strat = DefaultAppearanceStrategy(mgr, RecordingLogger())
    bodies = [FakeBody('bar1')]
    strat.finish(bodies, '(none)', None)
    _check(mgr.calls == [], f"'(none)' + no capture should make zero manager calls: {mgr.calls}", errors)
    _check(bodies[0].appearance is None, "'(none)' + no capture must leave bodies untouched", errors)
    return errors


def test_finish_falls_back_to_captured():
    errors = []
    mgr = RecordingManager()
    strat = DefaultAppearanceStrategy(mgr, RecordingLogger())
    bodies = [FakeBody('bar1'), FakeBody('bar2'), FakeBody('bar3')]
    captured = _MarkerAppearance('panel-paint')
    strat.finish(bodies, None, captured)
    _check(mgr.calls == [], f"fallback path should not call manager.apply_appearance: {mgr.calls}", errors)
    for b in bodies:
        _check(b.appearance is captured, f"body {b.name} should carry the captured appearance, got {b.appearance!r}", errors)
    return errors


def test_finish_no_preset_no_capture_is_noop():
    errors = []
    mgr = RecordingManager()
    strat = DefaultAppearanceStrategy(mgr, RecordingLogger())
    bodies = [FakeBody('bar1')]
    strat.finish(bodies, None, None)
    _check(mgr.calls == [], f"no preset + no capture must make no manager calls: {mgr.calls}", errors)
    _check(bodies[0].appearance is None, "no preset + no capture must leave body appearance untouched", errors)
    return errors


def test_finish_swallows_per_body_apply_errors():
    errors = []
    mgr = RecordingManager()
    log = RecordingLogger()
    strat = DefaultAppearanceStrategy(mgr, log)
    captured = _MarkerAppearance()

    class FlakyBody:
        name = 'flaky'
        @property
        def appearance(self):
            return None
        @appearance.setter
        def appearance(self, val):
            raise RuntimeError("Fusion says no")

    good = FakeBody('good')
    bodies = [FlakyBody(), good]
    strat.finish(bodies, None, captured)
    _check(good.appearance is captured, "good body should still receive the fallback appearance after a sibling raised", errors)
    _check(any('Could not apply appearance' in e[0] for e in log.entries), f"expected a debug log entry for the flaky body, got {log.entries!r}", errors)
    return errors


def test_custom_strategy_satisfies_protocol():
    errors = []

    class AlwaysBrushedSteel(AppearanceStrategy):
        def __init__(self):
            self.events = []

        def capture(self, core_body):
            self.events.append(('capture', core_body))
            return None

        def restore(self, core_body, captured):
            self.events.append(('restore', core_body, captured))

        def finish(self, bodies, requested_name, captured):
            self.events.append(('finish', tuple(bodies), requested_name, captured))

    strat = AlwaysBrushedSteel()
    body = FakeBody('panel')
    bars = [FakeBody('bar1'), FakeBody('bar2')]
    cap = strat.capture(body)
    strat.restore(body, cap)
    strat.finish(bars, 'Brushed Steel', cap)
    _check(
        strat.events == [
            ('capture', body),
            ('restore', body, None),
            ('finish', tuple(bars), 'Brushed Steel', None),
        ],
        f"custom strategy event log mismatch: {strat.events}",
        errors,
    )
    return errors


TESTS = [
    test_capture_delegates_to_manager,
    test_restore_noops_when_body_missing,
    test_restore_delegates_with_captured,
    test_finish_empty_bodies_noop,
    test_finish_applies_requested_preset,
    test_finish_none_sentinel_skips_preset_only,
    test_finish_none_sentinel_no_capture_is_noop,
    test_finish_falls_back_to_captured,
    test_finish_no_preset_no_capture_is_noop,
    test_finish_swallows_per_body_apply_errors,
    test_custom_strategy_satisfies_protocol,
]


def main():
    all_errors = []
    for test in TESTS:
        print(f"== running {test.__name__} ==")
        try:
            errs = test()
        except Exception as e:
            errs = [
                f"{test.__name__} raised {type(e).__name__}: {e}\n"
                f"{traceback.format_exc()}"
            ]
        if errs:
            print(f"  FAIL ({len(errs)} error(s)):")
            for e in errs:
                print(f"    - {e}")
        else:
            print("  OK")
        all_errors.extend(errs)

    print()
    if all_errors:
        print(f"FAILED -- {len(all_errors)} total error(s)")
        return 1
    print(f"PASSED ({len(TESTS)} tests)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
