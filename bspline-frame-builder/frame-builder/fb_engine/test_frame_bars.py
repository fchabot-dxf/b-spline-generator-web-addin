"""Bars Off (Fred 2026-11-23: "a version of a board WITHOUT the wood frame, but with the board's outline cut to the
frame's shape"). The app's `bars: false` reaches the sketch build (data["bars"]), is stamped on the frame component,
and the solid build then extrudes no BAR profile (main or window bars) while the SURROUND trim and the window hole cut
are built as always. An old payload / an untagged frame builds exactly as before."""
import os
import sys
import types

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if "adsk" not in sys.modules:
    adsk = types.ModuleType("adsk")
    adsk.core = types.ModuleType("adsk.core")
    adsk.fusion = types.ModuleType("adsk.fusion")
    sys.modules.update({"adsk": adsk, "adsk.core": adsk.core, "adsk.fusion": adsk.fusion})

from fb_engine import frame_bars as fbars  # noqa: E402
from fb_engine import extrusion_engine  # noqa: E402
from fb_engine import declared_profiles as dp  # noqa: E402
from fb_engine.frame_definition import COMMON_FRAME_FEATURES, WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE  # noqa: E402
from fb_engine.test_send_frame import World, run, payload, send_bspline  # noqa: E402


class _Attr:
    def __init__(self, value):
        self.value = value


class _Comp:
    def __init__(self, name="Frame_1"):
        self.name, self.store = name, {}
        self.attributes = types.SimpleNamespace(
            add=lambda g, n, v: self.store.__setitem__((g, n), v),
            itemByName=lambda g, n: _Attr(self.store[(g, n)]) if (g, n) in self.store else None)


# ------------------------------------------------------------------ the payload -> the sketch build
class TestSendFrameThreadsBars:
    def test_bars_false_reaches_the_sketch_build(self):
        w = World()
        send_bspline(w)
        r, b = run(w, payload(bars=False))
        assert r["ok"]
        assert b.sketch_calls[0]["data"]["bars"] is False
        assert "bars" not in b.sketch_calls[0]["data"]["ui_data"]  # never a user parameter

    def test_an_old_payload_sends_no_bars_key(self):
        w = World()
        send_bspline(w)
        r, b = run(w, payload())
        assert r["ok"] and "bars" not in b.sketch_calls[0]["data"]

    def test_bars_of_is_strict(self):
        assert fbars.bars_of({}) is True
        assert fbars.bars_of({"bars": True}) is True
        for v in ("false", 0, None, "off"):
            assert fbars.bars_of({"bars": v}) is True  # only a literal false is off
        assert fbars.bars_of({"bars": False}) is False
        assert fbars.bars_of(None) is True


# ------------------------------------------------------------------ the component stamp
class TestTheStamp:
    def test_off_is_stamped_and_read_back(self):
        c = _Comp()
        assert fbars.stamp_bars(c, False) is True
        assert c.store == {fbars.BARS_ATTR: fbars.BARS_OFF}
        assert fbars.bars_on_comp(c) is False

    def test_on_stamps_nothing_and_an_untagged_frame_has_bars(self):
        c = _Comp()
        assert fbars.stamp_bars(c, True) is False
        assert c.store == {}
        assert fbars.bars_on_comp(c) is True
        assert fbars.bars_on_comp(object()) is True  # unreadable = bars on, as before


# ------------------------------------------------------------------ the solid build
def _plans():
    """One profile per declared feature (main bars, trim, window bars, window cut), as _collect_declared returns them."""
    bars, trim = COMMON_FRAME_FEATURES[0], COMMON_FRAME_FEATURES[1]
    return [(types.SimpleNamespace(area=1.0), dp.extrude_plan(f, n, "frame_height_offset"), i)
            for i, (f, n) in enumerate([(bars, "frame_top"), (bars, "frame_left"), (WINDOW_BARS_FEATURE, "frame_window_top"),
                                        (trim, None), (WINDOW_CUT_FEATURE, None)])]


def _extrude(bars):
    e = extrusion_engine.ExtrusionEngine.__new__(extrusion_engine.ExtrusionEngine)
    e.log = types.SimpleNamespace(log=lambda *a, **k: None)
    built = []
    e._collect_declared = lambda sketch, frame, start: _plans()
    e._extrude_one_profile = lambda ex, prof, plan, i, *a, **k: built.append((plan["kind"], plan["order"], plan["name"])) or []
    comp = types.SimpleNamespace(name="Frame_1", features=types.SimpleNamespace(extrudeFeatures=None))
    sketch = types.SimpleNamespace(name="sk", profiles=types.SimpleNamespace(count=5))
    e.extrude_profiles(comp, sketch, "t1", "FACE", "frame_height_offset", "0 in", declared={"features": []}, bars=bars)
    return built


def test_bars_on_builds_every_declared_profile():
    assert [k for k, _, _ in _extrude(True)] == ["BAR", "BAR", "BAR", "SURROUND", "SURROUND"]


def test_bars_off_builds_the_trim_and_the_window_hole_only():
    assert _extrude(False) == [("SURROUND", "trim", None), ("SURROUND", "window_cut", None)]


def test_the_default_is_bars_on():
    e = extrusion_engine.ExtrusionEngine.extrude_profiles
    assert e.__defaults__[-1] is True
