"""N-BAR: the CAM builder's frame lay-flat (cam_engine/mm_builder.py _populate_frame_geometry) on a fake Fusion.

The 4-bar layout (Templates 1-5: frame_top / right / bottom / left) keeps its exact Move features; a frame with
other bar names (Template 6's 8 bars) takes the generic row (n_bar_layout_plan) instead of being skipped.
The fake applies each Move to the body's bounding box (90 deg about Z at the origin, or a translation), so the
row can be checked the way Fusion would lay it out.
"""
import math
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))


def _install_fake_adsk():
    adsk = types.ModuleType("adsk")
    core, fusion, cam = (types.ModuleType(n) for n in ("adsk.core", "adsk.fusion", "adsk.cam"))

    class Vec:
        def __init__(self, x, y, z):
            self.x, self.y, self.z = x, y, z

        @classmethod
        def create(cls, x=0.0, y=0.0, z=0.0):
            return cls(x, y, z)

    class Matrix3D:
        def __init__(self):
            self.angle = 0.0

        @classmethod
        def create(cls):
            return cls()

        def setToRotation(self, angle, axis, origin):
            assert (axis.x, axis.y, axis.z) == (0.0, 0.0, 1.0) and (origin.x, origin.y, origin.z) == (0.0, 0.0, 0.0)
            self.angle = angle

    class ObjectCollection(list):
        @classmethod
        def create(cls):
            return cls()

        def add(self, x):
            self.append(x)

    class ValueInput:
        @staticmethod
        def createByReal(v):
            return v

    # another test may have installed bare adsk stubs first: reuse them (only add what is missing)
    adsk = sys.modules.setdefault("adsk", adsk)
    for short, mod in (("core", core), ("fusion", fusion), ("cam", cam)):
        mod = sys.modules.setdefault(f"adsk.{short}", getattr(adsk, short, None) or mod)
        setattr(adsk, short, mod)
    core = adsk.core
    for name, val in (("Vector3D", Vec), ("Point3D", Vec), ("Matrix3D", Matrix3D),
                      ("ObjectCollection", ObjectCollection), ("ValueInput", ValueInput)):
        if not hasattr(core, name):
            setattr(core, name, val)


_install_fake_adsk()
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
from cam_engine import mm_builder  # noqa: E402


class _P:
    def __init__(self, x, y, z):
        self.x, self.y, self.z = x, y, z


class _BB:
    def __init__(self, mn, mx):
        self.minPoint, self.maxPoint = _P(*mn), _P(*mx)


class FakeBody:
    def __init__(self, name, mn, mx, owner):
        self.name, self.mn, self.mx, self.parentComponent = name, list(mn), list(mx), owner

    @property
    def boundingBox(self):
        return _BB(self.mn, self.mx)


class _MoveInput:
    def __init__(self, bodies):
        self.bodies, self.op = list(bodies), None

    def defineAsFreeMove(self, m):
        self.op = ("rotate", round(m.angle, 12))

    def defineAsTranslateXYZ(self, dx, dy, dz, world):
        self.op = ("translate", dx, dy, dz, world)


class _Moves:
    def __init__(self):
        self.log = []

    @property
    def count(self):
        return len(self.log)

    def createInput2(self, coll):
        return _MoveInput(coll)

    def add(self, inp):
        for b in inp.bodies:
            if inp.op[0] == "rotate":  # 90 deg about Z at the origin: (x, y) -> (-y, x)
                assert inp.op[1] == round(math.pi / 2, 12)
                (x0, y0, z0), (x1, y1, z1) = b.mn, b.mx
                b.mn, b.mx = [-y1, x0, z0], [-y0, x1, z1]
            else:
                _, dx, dy, dz, _w = inp.op
                b.mn = [b.mn[0] + dx, b.mn[1] + dy, b.mn[2] + dz]
                b.mx = [b.mx[0] + dx, b.mx[1] + dy, b.mx[2] + dz]
        self.log.append((tuple(b.name for b in inp.bodies), inp.op))


class FakeComp:
    def __init__(self, name):
        self.name, self.bRepBodies, self.allOccurrences = name, [], []
        self.features = types.SimpleNamespace(moveFeatures=_Moves())
        self.parentDesign = types.SimpleNamespace(userParameters=types.SimpleNamespace(itemByName=lambda n: None))


def _mm(bars):
    """A fake MM-Frame holding a Frame_1 component with `bars` = {name: (min xyz, max xyz)} (cm)."""
    root, frame = FakeComp("MM-Frame"), FakeComp("Frame_1")
    root.allOccurrences = [types.SimpleNamespace(component=frame)]
    frame.bRepBodies = [FakeBody(n, mn, mx, frame) for n, (mn, mx) in bars.items()]
    mm = types.SimpleNamespace(name="MM-Frame", occurrence=types.SimpleNamespace(component=root), activate=lambda: None)
    return mm, frame


# Template 1 7x9 bars (cm, roughly): top / bottom horizontal, left / right vertical.
T1_BARS = {
    "frame_top": ((-8.3, 8.9, -2.54), (8.3, 10.8, 0.0)),
    "frame_right": ((6.4, -10.8, -2.54), (8.3, 10.8, 0.0)),
    "frame_bottom": ((-8.3, -10.8, -2.54), (8.3, -8.9, 0.0)),
    "frame_left": ((-8.3, -10.8, -2.54), (-6.4, 10.8, 0.0)),
}
# Template 6 7x9 bars (cm): the tab (4.13 in wide, 2.125 in tall), the shoulders, the sides, the base.
_i = 2.54
T6_BARS = {
    "frame_tab_top": ((-2.0625 * _i, 3.5 * _i, -2.54), (2.0625 * _i, 4.25 * _i, 0.0)),
    "frame_tab_right": ((1.3125 * _i, 1.375 * _i, -2.54), (2.0625 * _i, 4.25 * _i, 0.0)),
    "frame_shoulder_right": ((1.3125 * _i, 1.375 * _i, -2.54), (3.25 * _i, 2.125 * _i, 0.0)),
    "frame_side_right": ((2.5 * _i, -4.25 * _i, -2.54), (3.25 * _i, 2.125 * _i, 0.0)),
    "frame_base": ((-3.25 * _i, -4.25 * _i, -2.54), (3.25 * _i, -3.5 * _i, 0.0)),
    "frame_side_left": ((-3.25 * _i, -4.25 * _i, -2.54), (-2.5 * _i, 2.125 * _i, 0.0)),
    "frame_shoulder_left": ((-3.25 * _i, 1.375 * _i, -2.54), (-1.3125 * _i, 2.125 * _i, 0.0)),
    "frame_tab_left": ((-2.0625 * _i, 1.375 * _i, -2.54), (-1.3125 * _i, 4.25 * _i, 0.0)),
}


def test_four_bar_layout_is_the_template_1_row():
    """The 4-bar path: frame_bottom / frame_top turned 90 deg, then right, left, bottom, top in a row."""
    mm, frame = _mm(T1_BARS)
    assert mm_builder._populate_frame_geometry(mm, None, None) is True
    log = frame.features.moveFeatures.log
    assert [(names, op[0]) for names, op in log] == [
        (("frame_bottom",), "rotate"), (("frame_top",), "rotate"),
        (("frame_left",), "translate"), (("frame_bottom",), "translate"), (("frame_top",), "translate")]
    b = {x.name: x for x in frame.bRepBodies}
    order = ["frame_right", "frame_left", "frame_bottom", "frame_top"]
    for a, c in zip(order, order[1:]):
        assert b[c].mn[0] - b[a].mx[0] == pytest.approx(1.397)  # the default 0.55 in clearance


def test_n_bar_frame_is_laid_out_not_skipped():
    """Template 6's 8 bars: every horizontal bar turned, all 8 in one row along +X (name order), no overlap."""
    mm, frame = _mm(T6_BARS)
    assert mm_builder._populate_frame_geometry(mm, None, None) is True
    log = frame.features.moveFeatures.log
    rotated = sorted(names[0] for names, op in log if op[0] == "rotate")
    assert rotated == ["frame_base", "frame_shoulder_left", "frame_shoulder_right", "frame_tab_top"]
    b = {x.name: x for x in frame.bRepBodies}
    order = sorted(b)
    for n in order:  # every bar now stands long axis along Y
        assert b[n].mx[1] - b[n].mn[1] >= b[n].mx[0] - b[n].mn[0]
    for a, c in zip(order, order[1:]):
        assert b[c].mn[0] - b[a].mx[0] == pytest.approx(1.397)
    for n in order[1:]:
        assert (b[n].mn[1] + b[n].mx[1]) / 2 == pytest.approx(0.0)
    # idempotent: a second run adds nothing
    n_moves = len(log)
    assert mm_builder._populate_frame_geometry(mm, None, None) is False
    assert len(frame.features.moveFeatures.log) == n_moves


def test_a_partial_four_bar_frame_is_still_skipped():
    """Unchanged: a Template 1-5 frame missing a bar is skipped (not laid out by the generic path)."""
    bars = dict(T1_BARS)
    del bars["frame_left"]
    mm, frame = _mm(bars)
    assert mm_builder._populate_frame_geometry(mm, None, None) is False
    assert frame.features.moveFeatures.log == []


# T82 item 6: the inset window's own 4 bars, alongside a classic Template 1 frame (same component).
WINDOW_BARS = {
    "frame_window_top": ((-2.0, 2.0, -1.5), (2.0, 2.75, 0.0)),
    "frame_window_right": ((1.25, -2.0, -1.5), (2.0, 2.0, 0.0)),
    "frame_window_bottom": ((-2.0, -2.75, -1.5), (2.0, -2.0, 0.0)),
    "frame_window_left": ((-2.0, -2.0, -1.5), (-1.25, 2.0, 0.0)),
}


def test_a_classic_four_bar_frame_with_a_window_also_lays_out_the_window_bars():
    """T82 item 6: frame_window_* bodies sit alongside the classic 4 in the SAME component -- before the
    fix, _populate_n_bar_frame_geometry's own 'only when the classic 4 are absent' guard meant these were
    collected into other_bars and then never laid out at all."""
    mm, frame = _mm({**T1_BARS, **WINDOW_BARS})
    assert mm_builder._populate_frame_geometry(mm, None, None) is True
    log = frame.features.moveFeatures.log
    # the classic 4-bar row is unchanged (same 5 ops, same order) ...
    assert [(names, op[0]) for names, op in log[:5]] == [
        (("frame_bottom",), "rotate"), (("frame_top",), "rotate"),
        (("frame_left",), "translate"), (("frame_bottom",), "translate"), (("frame_top",), "translate")]
    # ... and the window's own 4 bars are ALSO laid out, continuing the same row.
    window_ops = log[5:]
    rotated = sorted(names[0] for names, op in window_ops if op[0] == "rotate")
    assert rotated == ["frame_window_bottom", "frame_window_top"]
    moved_names = {names[0] for names, _ in window_ops}
    assert moved_names == set(WINDOW_BARS)  # all 4 window bars got at least one move (rotate and/or translate)

    b = {x.name: x for x in frame.bRepBodies}
    full_row = ["frame_right", "frame_left", "frame_bottom", "frame_top"] + sorted(WINDOW_BARS)
    for a, c in zip(full_row, full_row[1:]):
        assert b[c].mn[0] >= b[a].mx[0]  # strictly continuing rightward: no overlap with the previous piece
    for n in sorted(WINDOW_BARS):  # the window row is also centred on Y = 0
        assert (b[n].mn[1] + b[n].mx[1]) / 2 == pytest.approx(0.0)

    # idempotent: a second run (one shared gate for the whole row) adds nothing
    n_moves = len(log)
    assert mm_builder._populate_frame_geometry(mm, None, None) is False
    assert len(frame.features.moveFeatures.log) == n_moves


def test_n_bar_layout_plan_is_pure_and_deterministic():
    rotate, order, widths = mm_builder.n_bar_layout_plan({"frame_b": (4.0, 1.0), "frame_a": (1.0, 5.0)}, 1.397)
    assert rotate == ["frame_b"] and order == ["frame_a", "frame_b"] and widths == {"frame_a": 1.0, "frame_b": 1.0}
