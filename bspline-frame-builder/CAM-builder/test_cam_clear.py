"""H23 item 99 (Fred, CAM option (b)) -- cam_coordinator.clear_addin_build: the B-Spline Send calls it to remove the CAM
our BUILD made. It deletes the setups AND the Manufacturing Models whose names CAM-builder declares (SETUP_SPECS /
MM_RULES), setups first, and returns the removed names; a setup or MM with any other name stays.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_cam_clear.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_cam_reuse import eng  # noqa: E402,F401  (same adsk stubs + fresh engine import)


class _Item:
    def __init__(self, coll, name, order):
        self.coll, self.name, self.order = coll, name, order

    def deleteMe(self):
        self.coll.items.remove(self)
        self.order.append(self.name)
        return True


class _Coll:
    def __init__(self, names, order):
        self.items = [_Item(self, n, order) for n in names]

    @property
    def count(self):
        return len(self.items)

    def item(self, i):
        return self.items[i]

    def names(self):
        return [x.name for x in self.items]


class _Log:
    def __init__(self):
        self.lines = []

    def log(self, msg, level='INFO'):
        self.lines.append((level, msg))


def _cam(eng, extra_setups=(), extra_mms=()):
    order = []
    ours_s = [s['name'] for s in eng.sb.SETUP_SPECS]
    ours_m = [eng.mm._mm_display_name(r) for r in eng.mm.MM_RULES]
    cam = type('Cam', (), {})()
    cam.setups = _Coll(list(extra_setups) + ours_s, order)
    cam.manufacturingModels = _Coll(list(extra_mms) + ours_m, order)
    return cam, order, ours_s, ours_m


def test_removes_every_declared_setup_and_mm_and_returns_their_names(eng):
    cam, order, ours_s, ours_m = _cam(eng)
    removed = eng.co.clear_addin_build(cam, _Log())
    assert cam.setups.count == 0 and cam.manufacturingModels.count == 0
    assert sorted(removed['setups']) == sorted(ours_s)
    assert sorted(removed['mms']) == sorted(ours_m)
    # setups go before the MMs they reference
    assert set(order[:len(ours_s)]) == set(ours_s)


def test_a_user_setup_and_mm_with_other_names_survive(eng):
    cam, _, ours_s, _ = _cam(eng, extra_setups=['My setup'], extra_mms=['My MM'])
    removed = eng.co.clear_addin_build(cam, _Log())
    assert cam.setups.names() == ['My setup']
    assert cam.manufacturingModels.names() == ['My MM']
    assert 'My setup' not in removed['setups'] and 'My MM' not in removed['mms']


def test_logs_what_was_removed_by_name(eng):
    cam, _, ours_s, ours_m = _cam(eng)
    log = _Log()
    eng.co.clear_addin_build(cam, log)
    info = [m for lvl, m in log.lines if lvl == 'INFO']
    assert len(info) == 1
    assert all(n in info[0] for n in ours_s + ours_m)


def test_nothing_to_clear_returns_empty_lists(eng):
    cam, _, _, _ = _cam(eng)
    cam.setups.items.clear()
    cam.manufacturingModels.items.clear()
    assert eng.co.clear_addin_build(cam, None) == {'setups': [], 'mms': []}


def test_build_still_clears_through_the_same_function(eng, monkeypatch):
    seen = []
    monkeypatch.setattr(eng.co, 'clear_addin_build', lambda cam, logger=None: seen.append(cam) or {'setups': [], 'mms': []})
    eng.co._cleanup_previous_build('cam', None)
    assert seen == ['cam']
