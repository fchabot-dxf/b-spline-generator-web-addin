"""T82 item 6: the inset window's Fusion side (fb_engine/inset_window.py) -- the blocks it appends, the
window's own regions, and declared_profiles.classify()'s new branches for them."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from fb_engine.template_resolver import resolve_template  # noqa: E402
from fb_engine.inset_window import apply_inset_window  # noqa: E402
from fb_engine.declared_profiles import classify, miter_curve_id, DeclaredProfileError  # noqa: E402
from fb_engine.frame_definition import WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE  # noqa: E402

TEMPLATES = ["template_1", "template_2", "template_6", "template_11"]

ENABLED = {"enabled": True, "cx": 0.0, "cy": 0.0, "w": 3.0, "h": 2.0}
FT = 0.75  # frame_thickness (in), matching every template's own default


def _blocks(t):
    return [(sk["Name"], b["PhaseID"]) for sk in t["Sketches"] for b in sk["Blocks"]]


def _with_window(tid, **window_kw):
    t, _ = resolve_template(tid)
    window = {**ENABLED, **window_kw}
    return t, apply_inset_window(t, window, FT, window_kw.get("panel_lip", 0.0))


@pytest.mark.parametrize("tid", TEMPLATES)
def test_disabled_or_absent_leaves_the_template_exactly_as_today(tid):
    t, _ = resolve_template(tid)
    assert apply_inset_window(t, None, FT) is t
    assert apply_inset_window(t, {}, FT) is t
    assert apply_inset_window(t, {**ENABLED, "enabled": False}, FT) is t


@pytest.mark.parametrize("tid", TEMPLATES)
def test_below_the_bars_floor_leaves_the_template_unchanged(tid):
    t, _ = resolve_template(tid)
    # w/h <= 2 * frame_thickness: the window's own bars would be <= 0
    assert apply_inset_window(t, {**ENABLED, "w": 2 * FT}, FT) is t
    assert apply_inset_window(t, {**ENABLED, "h": 2 * FT}, FT) is t
    assert apply_inset_window(t, {**ENABLED, "w": 0.1}, FT) is t


@pytest.mark.parametrize("tid", TEMPLATES)
def test_a_malformed_record_leaves_the_template_unchanged(tid):
    t, _ = resolve_template(tid)
    assert apply_inset_window(t, {"enabled": True}, FT) is t  # no cx/cy/w/h at all
    assert apply_inset_window(t, {"enabled": True, "cx": "nope", "cy": 0, "w": 3, "h": 2}, FT) is t


@pytest.mark.parametrize("tid", TEMPLATES)
def test_three_blocks_are_appended_to_the_frame_sketch_no_lip(tid):
    t, out = _with_window(tid)
    before = _blocks(t)
    assert _blocks(t) == before  # the input is untouched (a copy)
    added = [x for x in _blocks(out) if x not in before]
    frame_sketch = [sk["Name"] for sk in t["Sketches"] if any(b["PhaseID"].startswith("p03_") for b in sk["Blocks"])][0]
    assert [sk for sk, _ in added] == [frame_sketch] * 3  # outer rect, inner rect, miters -- no hole block
    phase_ids = [pid for _, pid in added]
    assert phase_ids == ["p03_91_inset_window_outer", "p03_92_inset_window_inner", "p03_94_inset_window_miters"]


@pytest.mark.parametrize("tid", TEMPLATES)
def test_the_outer_and_inner_rectangles_are_centred_and_sized_from_the_record(tid):
    _, out = _with_window(tid)
    rects = {b["BuildSequence"][0]["ID"]: b["BuildSequence"][0]
             for sk in out["Sketches"] for b in sk["Blocks"] if b.get("BuildSequence") and
             b["BuildSequence"][0]["Type"] == "RectangleCenter"}
    outer, inner = rects["window_outer"], rects["window_inner"]
    assert outer["Center"] == ["0.0 in", "0.0 in"] and outer["Size"] == ["3.0 in", "2.0 in"]
    assert inner["Center"] == ["0.0 in", "0.0 in"]
    assert inner["Size"] == ["3.0 in - 2 * frame_thickness", "2.0 in - 2 * frame_thickness"]
    assert outer["LineIDs"] == ["window_outer", "window_outer_right", "window_outer_bottom", "window_outer_left"]


def test_a_centre_off_origin_is_read_directly_fusion_coordinates_no_board_conversion():
    _, out = _with_window("template_1", cx=1.5, cy=-0.5)
    rect = [b["BuildSequence"][0] for sk in out["Sketches"] for b in sk["Blocks"]
            if b.get("BuildSequence") and b["BuildSequence"][0].get("ID") == "window_outer"][0]
    assert rect["Center"] == ["1.5 in", "-0.5 in"]


def test_the_miters_connect_the_rectangles_own_tagged_vertices():
    _, out = _with_window("template_1")
    block = [b for sk in out["Sketches"] for b in sk["Blocks"] if b["PhaseID"] == "p03_94_inset_window_miters"][0]
    pairs = {(m["Source"], m["Target"]) for m in block["Miters"]}
    assert pairs == {
        ("window_outer_V_TL", "window_inner_V_TL"), ("window_outer_V_TR", "window_inner_V_TR"),
        ("window_outer_V_BL", "window_inner_V_BL"), ("window_outer_V_BR", "window_inner_V_BR"),
    }


def test_window_region_declares_the_bars_miters_and_no_hole_or_cut_at_lip_zero():
    _, out = _with_window("template_1")
    window = out["Frame"]["regions"]["window"]
    assert window["cut"] == "inner" and window["hole"] is None
    assert {b["name"] for b in window["bars"]} == set(WINDOW_BARS_FEATURE["bodyNames"])


def test_lip_adds_a_third_rectangle_and_the_hole_cut_region():
    t, out = _with_window("template_1", panel_lip=0.0625)
    before = _blocks(t)
    added = [pid for _, pid in _blocks(out) if (_, pid) not in [(s, p) for s, p in before]]
    assert "p03_93_inset_window_hole" in [b["PhaseID"] for sk in out["Sketches"] for b in sk["Blocks"]]
    hole = [b["BuildSequence"][0] for sk in out["Sketches"] for b in sk["Blocks"]
            if b["PhaseID"] == "p03_93_inset_window_hole"][0]
    assert hole["Size"] == ["3.0 in - 2 * frame_thickness - 2 * panel_lip", "2.0 in - 2 * frame_thickness - 2 * panel_lip"]
    window = out["Frame"]["regions"]["window"]
    assert window["cut"] == "hole" and window["hole"] == \
        ["window_hole", "window_hole_right", "window_hole_bottom", "window_hole_left"]


def test_a_lip_wider_than_the_window_opening_clamps_the_cut_shut_bars_still_built():
    # w=3, h=2, FT=0.75 -> inner is 1.5 x 0.5; a 0.3 lip would need 0.9/-0.1, h side goes negative
    _, out = _with_window("template_1", panel_lip=0.3)
    window = out["Frame"]["regions"]["window"]
    assert window["cut"] is None and window["hole"] is None
    # the bars/miters are still there -- only the hole/cut is suppressed
    phase_ids = [b["PhaseID"] for sk in out["Sketches"] for b in sk["Blocks"]]
    assert "p03_91_inset_window_outer" in phase_ids and "p03_94_inset_window_miters" in phase_ids
    assert "p03_93_inset_window_hole" not in phase_ids


# ------------------------------------------------------------------ declared_profiles.classify()
def _frame(tid, **window_kw):
    """`out["Frame"]` with the window's own features injected the way solid_coordinator._declared_frame does
    (apply_inset_window itself never touches `features` -- the static template's own list -- only the
    coordinator appends WINDOW_BARS_FEATURE/WINDOW_CUT_FEATURE, unconditionally, at build time)."""
    _, out = _with_window(tid, **window_kw)
    frame = dict(out["Frame"])
    frame["features"] = list(frame["features"]) + [WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE]
    return frame


@pytest.mark.parametrize("tid", TEMPLATES)
def test_a_window_bar_profile_classifies_to_the_right_window_bar(tid):
    frame = _frame(tid)
    window = frame["regions"]["window"]
    for side, curve in zip(WINDOW_BARS_FEATURE["bodyNames"], window["outer"]):
        feat, name = classify([curve, window["inner"][0]], frame)
        assert feat["id"] == "window_bars" and name == side


@pytest.mark.parametrize("tid", TEMPLATES)
def test_a_window_profile_spanning_two_bars_is_refused(tid):
    frame = _frame(tid)
    window = frame["regions"]["window"]
    with pytest.raises(DeclaredProfileError):
        classify([window["outer"][0], window["outer"][1]], frame)


@pytest.mark.parametrize("tid", TEMPLATES)
def test_the_window_hole_classifies_to_window_cut_no_lip(tid):
    frame = _frame(tid)
    window = frame["regions"]["window"]
    feat, name = classify(window["inner"], frame)
    assert feat["id"] == "window_cut" and name is None


@pytest.mark.parametrize("tid", TEMPLATES)
def test_the_window_hole_and_lip_ring_classify_correctly_with_lip(tid):
    frame = _frame(tid, panel_lip=0.0625)
    window = frame["regions"]["window"]
    feat, name = classify(window["hole"], frame)
    assert feat["id"] == "window_cut" and name is None
    # the ring between inner and hole: no feature, whether or not it arrives pre-split by the miters
    assert classify(window["inner"] + window["hole"], frame) == (None, None)
    m0 = miter_curve_id(*window["miters"][0])
    assert classify(window["inner"][:2] + window["hole"][:2] + [m0], frame) == (None, None)
    with pytest.raises(DeclaredProfileError):
        classify(window["inner"] + ["somewhere_else"], frame)


@pytest.mark.parametrize("tid", TEMPLATES)
def test_a_degenerate_lip_leaves_the_window_interior_with_no_feature(tid):
    frame = _frame(tid, panel_lip=0.3)
    window = frame["regions"]["window"]
    assert window["cut"] is None
    assert classify(window["inner"], frame) == (None, None)


@pytest.mark.parametrize("tid", TEMPLATES)
def test_the_main_opening_tolerates_the_windows_own_outer_loop_as_an_island(tid):
    frame = _frame(tid)
    window = frame["regions"]["window"]
    main_inner = frame["regions"]["inner"]
    assert classify(list(main_inner) + list(window["outer"]), frame) == (None, None)


@pytest.mark.parametrize("tid", TEMPLATES)
def test_a_window_less_build_is_unaffected(tid):
    """No `window` region at all (every template's own frame-defs.json, unchanged): the exact pre-T82-item-6
    classify() behavior for the main opening."""
    t, _ = resolve_template(tid)
    frame = t["Frame"]
    assert "window" not in frame["regions"]
    assert classify(frame["regions"]["inner"], frame) == (None, None)


def test_window_cut_feature_is_a_cut_through_all_from_the_sketch_plane():
    assert WINDOW_CUT_FEATURE["op"] == "cut" and WINDOW_CUT_FEATURE["extent"] == "throughAll"
    assert WINDOW_CUT_FEATURE["start"] == "0 in"  # the same sketch plane the main TRIM_CUT starts at


def test_window_bars_feature_uses_the_same_z_rule_as_the_main_bars():
    from fb_engine.frame_definition import FRAME_BOTTOM_PARAM, COMMON_FRAME_FEATURES
    main_bars = [f for f in COMMON_FRAME_FEATURES if f["id"] == "bars"][0]
    assert WINDOW_BARS_FEATURE["start"] == FRAME_BOTTOM_PARAM == main_bars["start"]
    assert WINDOW_BARS_FEATURE["extent"] == main_bars["extent"]
