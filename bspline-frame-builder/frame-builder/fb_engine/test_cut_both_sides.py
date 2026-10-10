"""2026-10-09 (seat A; Fred, circled on claude_1 + claude_10: "Edge not good"). MEASURED live: the frame's trim cut
(t1_TRIM_CUT, t16_TRIM_CUT) extruded through all on ONE side of its sketch plane (z 0) -- the thickened panel's
underside dips below it (claude_1 to -0.22 in), and every bit of panel under the plane outside the frame outline stayed:
a deck over the waist notch, a lip over the frame, claude_10's sawtooth. Editing that one cut to two-sided through all
trimmed the Stamped panel exactly to the frame (bbox -3.458..3.361 -> +-3.25). The trim and the window cut now declare
"throughAllBothSides"; here the extrusion engine is pinned to build exactly that (and the bars to stay one-sided).

Same adsk-stub idiom as test_trim_cut_paint.py, with the few enums / definitions the engine reads.
"""
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

import pytest  # noqa: E402
from fb_engine import extrusion_engine  # noqa: E402
from fb_engine import declared_profiles as dp  # noqa: E402
from fb_engine.frame_definition import COMMON_FRAME_FEATURES, WINDOW_CUT_FEATURE  # noqa: E402


@pytest.fixture
def fake_adsk(monkeypatch):
    a = extrusion_engine.adsk  # the engine's OWN reference (another test may have swapped sys.modules["adsk"])
    fusion, core = a.fusion, a.core
    monkeypatch.setattr(fusion, "FeatureOperations", types.SimpleNamespace(CutFeatureOperation="cut", NewBodyFeatureOperation="new"), raising=False)
    monkeypatch.setattr(fusion, "ExtentDirections", types.SimpleNamespace(PositiveExtentDirection="+"), raising=False)
    monkeypatch.setattr(fusion, "ThroughAllExtentDefinition", types.SimpleNamespace(create=lambda: "throughAll"), raising=False)
    monkeypatch.setattr(fusion, "ToEntityExtentDefinition", types.SimpleNamespace(create=lambda f, c, off: ("toEntity", off)), raising=False)
    monkeypatch.setattr(fusion, "OffsetStartDefinition", types.SimpleNamespace(create=lambda v: ("offsetStart", v)), raising=False)
    monkeypatch.setattr(core, "ValueInput", types.SimpleNamespace(createByString=lambda s: s), raising=False)
    return a


class _Input:
    def __init__(self):
        self.calls = []
        self.isParticipantsAutomated = None
        self.participantBodies = None

    def setOneSideExtent(self, *a):
        self.calls.append(("one", a))

    def setTwoSidesExtent(self, *a):
        self.calls.append(("two", a))


class _Extrudes:
    def __init__(self):
        self.inputs = []

    def createInput(self, prof, op):
        i = _Input(); i.op = op; self.inputs.append(i)
        return i

    def add(self, ext_in):
        return types.SimpleNamespace(name="", bodies=[], faces=[], attributes=types.SimpleNamespace(add=lambda *a: None))


def _engine():
    e = extrusion_engine.ExtrusionEngine.__new__(extrusion_engine.ExtrusionEngine)
    e.log = types.SimpleNamespace(log=lambda *a, **k: None)
    return e


def _build(feature, body_name=None):
    ex = _Extrudes()
    plan = dp.extrude_plan(feature, body_name, "frame_height_offset")
    _engine()._extrude_one_profile(ex, types.SimpleNamespace(area=1.0), plan, 0, "t1", "FACE", "Frame_1")
    return ex.inputs[0]


def test_the_trim_and_the_window_cut_are_declared_through_all_on_both_sides():
    trim = [f for f in COMMON_FRAME_FEATURES if f["id"] == "trim"][0]
    assert trim["extent"] == "throughAllBothSides" and WINDOW_CUT_FEATURE["extent"] == "throughAllBothSides"


def test_the_trim_cut_is_built_two_sided_through_all(fake_adsk):
    trim = [f for f in COMMON_FRAME_FEATURES if f["id"] == "trim"][0]
    i = _build(trim)
    assert i.op == "cut" and i.isParticipantsAutomated is True
    assert i.calls == [("two", ("throughAll", "throughAll", "0 deg", "0 deg"))]


def test_the_window_cut_is_built_two_sided_through_all(fake_adsk):
    i = _build(WINDOW_CUT_FEATURE)
    assert i.calls == [("two", ("throughAll", "throughAll", "0 deg", "0 deg"))]


def test_the_bars_stay_one_sided_to_the_panel_underside(fake_adsk):
    bars = [f for f in COMMON_FRAME_FEATURES if f["id"] == "bars"][0]
    i = _build(bars, "frame_top")
    assert i.op == "new" and len(i.calls) == 1 and i.calls[0][0] == "one"
    assert i.calls[0][1][0] == ("toEntity", "0 in") and i.calls[0][1][1] == "+"


def test_the_bounding_box_path_trims_both_sides_too(fake_adsk, monkeypatch):
    e = _engine()
    monkeypatch.setattr(e, "_classify_profile", lambda p: "SURROUND", raising=False)
    monkeypatch.setattr(e, "_profile_label", lambda p, i: "x", raising=False)
    sketch = types.SimpleNamespace(profiles=types.SimpleNamespace(count=1, item=lambda i: types.SimpleNamespace(area=1.0)))
    [(prof, plan, i)] = e._collect_profiles(sketch, "-1 in", "0 in")
    assert plan["extent"] == ("throughAllBothSides",)
