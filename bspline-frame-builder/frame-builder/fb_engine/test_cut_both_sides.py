"""2026-10-09 (seat A; Fred, circled on claude_1 + claude_10: "Edge not good"). MEASURED live: the frame's trim cut
(t1_TRIM_CUT, t16_TRIM_CUT) extruded through all on ONE side of its sketch plane (z 0) -- the thickened panel's
underside dips below it (claude_1 to -0.22 in), and every bit of panel under the plane outside the frame outline stayed:
a deck over the waist notch, a lip over the frame, claude_10's sawtooth. Editing that one cut to two-sided through all
trimmed the Stamped panel exactly to the frame (bbox -3.458..3.361 -> +-3.25).

2026-11-24 (live check of Back: Flat): through all on BOTH sides then refused the cut on a panel with a flat bottom
("Cannot complete extrusion" / "Cannot extend extrusion to object" / a no-op; Bars On and Off; base 0 and 0.25 in below),
while a fixed distance on both sides cut it exactly -- but a fixed distance is not bit-identical to through all around a
shell board's inset-window hole. So the trim and the window cut declare frame_definition.CUT_THROUGH_EXTENT and the
extruder reads HOW from CUT_THROUGH_BY_BACK_MODE: shell (and absent) = through all on both sides, as every board was
built; flat = a symmetric fixed distance, each side reaching the farthest bounding-box corner of every body (along the
plane normal) plus the margin. Here the extrusion engine is pinned to build exactly that (and the bars to stay one-sided).

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
from fb_engine.frame_definition import (COMMON_FRAME_FEATURES, WINDOW_CUT_FEATURE, CUT_THROUGH_EXTENT,  # noqa: E402
                                        CUT_THROUGH_BY_BACK_MODE, DEFAULT_BACK_MODE, cut_through_rule)

P = lambda x, y, z: types.SimpleNamespace(x=x, y=y, z=z)  # noqa: E731
THROUGH_ALL_BOTH_SIDES = [("two", ("throughAll", "throughAll", "0 deg", "0 deg"))]  # the rule every board was built with


@pytest.fixture
def fake_adsk(monkeypatch):
    a = extrusion_engine.adsk  # the engine's OWN reference (another test may have swapped sys.modules["adsk"])
    fusion, core = a.fusion, a.core
    monkeypatch.setattr(fusion, "FeatureOperations", types.SimpleNamespace(CutFeatureOperation="cut", NewBodyFeatureOperation="new"), raising=False)
    monkeypatch.setattr(fusion, "ExtentDirections", types.SimpleNamespace(PositiveExtentDirection="+"), raising=False)
    monkeypatch.setattr(fusion, "ThroughAllExtentDefinition", types.SimpleNamespace(create=lambda: "throughAll"), raising=False)
    monkeypatch.setattr(fusion, "ToEntityExtentDefinition", types.SimpleNamespace(create=lambda f, c, off: ("toEntity", off)), raising=False)
    monkeypatch.setattr(fusion, "OffsetStartDefinition", types.SimpleNamespace(create=lambda v: ("offsetStart", v)), raising=False)
    monkeypatch.setattr(core, "ValueInput", types.SimpleNamespace(createByString=lambda s: s, createByReal=lambda v: ("real cm", v)), raising=False)
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

    def setSymmetricExtent(self, *a):
        self.calls.append(("symmetric", a))


class _Extrudes:
    def __init__(self):
        self.inputs = []

    def createInput(self, prof, op):
        i = _Input(); i.op = op; self.inputs.append(i)
        return i

    def add(self, ext_in):
        return types.SimpleNamespace(name="", bodies=[], faces=[], attributes=types.SimpleNamespace(add=lambda *a: None))


def _body(zmin, zmax, x=(-8.89, 8.89), y=(-11.43, 11.43)):
    """A body's root-context bounding box (cm), as Fusion reports it."""
    return types.SimpleNamespace(boundingBox=types.SimpleNamespace(minPoint=P(x[0], y[0], zmin), maxPoint=P(x[1], y[1], zmax)))


def _design(root_bodies=(), occurrence_bodies=()):
    occs = [types.SimpleNamespace(bRepBodies=list(bs)) for bs in occurrence_bodies]
    return types.SimpleNamespace(rootComponent=types.SimpleNamespace(bRepBodies=list(root_bodies), allOccurrences=occs))


# the live T1 7x9 Back: Flat board, base 0.25 in below (case f): panel z -0.25 .. 1.4788 in, bars z -1 .. -0.25 in
FLAT_PLINTH = _design(occurrence_bodies=[[_body(-0.635, 3.756)], [_body(-2.54, -0.635, x=(-8.255, -3.713))]])
PLANE_Z0 = types.SimpleNamespace(area=1.0, plane=types.SimpleNamespace(origin=P(0, 0, 0), normal=P(0, 0, 1)))


def _engine(design=FLAT_PLINTH, back_mode=None):
    e = extrusion_engine.ExtrusionEngine.__new__(extrusion_engine.ExtrusionEngine)
    e.log = types.SimpleNamespace(log=lambda *a, **k: None)
    e.design = design
    e.back_mode = back_mode
    return e


def _build(feature, body_name=None, prof=PLANE_Z0, design=FLAT_PLINTH, back_mode=None):
    ex = _Extrudes()
    plan = dp.extrude_plan(feature, body_name, "frame_height_offset")
    _engine(design, back_mode)._extrude_one_profile(ex, prof, plan, 0, "t1", "FACE", "Frame_1")
    return ex.inputs[0]


TRIM = [f for f in COMMON_FRAME_FEATURES if f["id"] == "trim"][0]


def test_the_trim_and_the_window_cut_declare_the_cut_through_extent_and_its_table():
    assert TRIM["extent"] == CUT_THROUGH_EXTENT and WINDOW_CUT_FEATURE["extent"] == CUT_THROUGH_EXTENT
    assert dp.extrude_plan(TRIM, None, "x")["extent"] == (CUT_THROUGH_EXTENT,)
    assert DEFAULT_BACK_MODE == "shell"
    assert CUT_THROUGH_BY_BACK_MODE == {"shell": {"extent": "throughAllBothSides"},
                                        "flat": {"extent": "symmetricPastBodies", "marginIn": 1.0}}
    assert cut_through_rule(None) is cut_through_rule("shell") is cut_through_rule("bogus")


@pytest.mark.parametrize("back_mode", ["shell", None])
def test_a_shell_board_or_one_without_a_back_mode_trims_through_all_on_both_sides(fake_adsk, back_mode):
    i = _build(TRIM, back_mode=back_mode)
    assert i.op == "cut" and i.isParticipantsAutomated is True
    assert i.calls == THROUGH_ALL_BOTH_SIDES  # saved boards: exactly the old cut
    assert _build(WINDOW_CUT_FEATURE, back_mode=back_mode).calls == THROUGH_ALL_BOTH_SIDES


def test_a_flat_board_trims_symmetric_past_the_farthest_body_plus_the_margin(fake_adsk):
    i = _build(TRIM, back_mode="flat")
    assert i.op == "cut" and i.isParticipantsAutomated is True
    # farthest corner from z 0: the panel top, 3.756 cm; each side = 3.756 + 2.54 (1 in); full length = twice that
    [(kind, (dist, full_length, taper))] = i.calls
    assert kind == "symmetric" and full_length is True and taper == "0 deg"
    assert dist[0] == "real cm" and dist[1] == pytest.approx(2 * (3.756 + 2.54))


def test_the_flat_reach_is_measured_from_the_sketch_plane_along_its_normal(fake_adsk):
    # the plane 1 cm up: the bars' bottom (-2.54) is now the farthest, 3.54 cm away; a tilted normal is normalised
    up = types.SimpleNamespace(area=1.0, plane=types.SimpleNamespace(origin=P(0, 0, 1), normal=P(0, 0, 2)))
    [(_, (dist, _, _))] = _build(TRIM, prof=up, back_mode="flat").calls
    assert dist[1] == pytest.approx(2 * (3.54 + 2.54))
    # a root body and a body under an occurrence both count (a through-all reached every body)
    d = _design(root_bodies=[_body(-20, 0)], occurrence_bodies=[[_body(0, 1)]])
    [(_, (dist, _, _))] = _build(TRIM, design=d, back_mode="flat").calls
    assert dist[1] == pytest.approx(2 * (20 + 2.54))


def test_a_flat_boards_window_cut_is_the_same_symmetric_cut(fake_adsk):
    [(kind, (dist, full_length, _))] = _build(WINDOW_CUT_FEATURE, back_mode="flat").calls
    assert kind == "symmetric" and full_length is True and dist[1] == pytest.approx(2 * (3.756 + 2.54))


def test_extrude_profiles_takes_the_back_mode_for_its_cuts(fake_adsk):
    e = _engine()
    sketch = types.SimpleNamespace(name="T1_3", profiles=types.SimpleNamespace(count=0))
    e.extrude_profiles(types.SimpleNamespace(name="Frame_1"), sketch, "t1", None, "-1 in", "0 in", back_mode="flat")
    assert e.back_mode == "flat"
    e.extrude_profiles(types.SimpleNamespace(name="Frame_1"), sketch, "t1", None, "-1 in", "0 in")
    assert e.back_mode is None  # not given = shell


def test_the_bars_stay_one_sided_to_the_panel_underside(fake_adsk):
    bars = [f for f in COMMON_FRAME_FEATURES if f["id"] == "bars"][0]
    for back_mode in (None, "shell", "flat"):
        i = _build(bars, "frame_top", back_mode=back_mode)
        assert i.op == "new" and len(i.calls) == 1 and i.calls[0][0] == "one"
        assert i.calls[0][1][0] == ("toEntity", "0 in") and i.calls[0][1][1] == "+"


def test_the_bounding_box_path_trims_with_the_same_rule(fake_adsk, monkeypatch):
    e = _engine()
    monkeypatch.setattr(e, "_classify_profile", lambda p: "SURROUND", raising=False)
    monkeypatch.setattr(e, "_profile_label", lambda p, i: "x", raising=False)
    sketch = types.SimpleNamespace(profiles=types.SimpleNamespace(count=1, item=lambda i: types.SimpleNamespace(area=1.0)))
    [(prof, plan, i)] = e._collect_profiles(sketch, "-1 in", "0 in")
    assert plan["extent"] == (CUT_THROUGH_EXTENT,)
