"""T82 item 6: the inset window's Fusion side (fb_engine/inset_window.py) -- the blocks it appends, and
declared_profiles.classify()'s new branches for them (fixed curve-id names, never stored in `regions`:
MEASURED live that solid_coordinator._declared_frame() re-resolves the STATIC template from disk at
solid-build time, so anything the sketch build stored in an in-memory `regions["window"]` never reaches
it -- classify() recomputes the window's hypothetical ids fresh every call instead, exactly like
panel_lip's own `lip_ids()`)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from fb_engine.template_resolver import resolve_template  # noqa: E402
from fb_engine.inset_window import apply_inset_window, OUTER_ID, INNER_ID, HOLE_ID, line_ids, window_miters, window_bars  # noqa: E402
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
    assert pairs == set(window_miters())


def test_window_bars_match_the_feature_bodynames_order():
    assert [b["name"] for b in window_bars()] == list(WINDOW_BARS_FEATURE["bodyNames"])
    assert [c for b in window_bars() for c in b["curves"]] == line_ids(OUTER_ID)


def test_lip_adds_a_third_rectangle():
    t, out = _with_window("template_1", panel_lip=0.0625)
    assert "p03_93_inset_window_hole" in [b["PhaseID"] for sk in out["Sketches"] for b in sk["Blocks"]]
    hole = [b["BuildSequence"][0] for sk in out["Sketches"] for b in sk["Blocks"]
            if b["PhaseID"] == "p03_93_inset_window_hole"][0]
    assert hole["Size"] == ["3.0 in - 2 * frame_thickness - 2 * panel_lip", "2.0 in - 2 * frame_thickness - 2 * panel_lip"]
    assert hole["LineIDs"] == line_ids(HOLE_ID)


def test_a_lip_wider_than_the_window_opening_skips_the_hole_bars_still_built():
    # w=3, h=2, FT=0.75 -> inner is 1.5 x 0.5; a 0.3 lip would need 0.9/-0.1, h side goes negative
    _, out = _with_window("template_1", panel_lip=0.3)
    phase_ids = [b["PhaseID"] for sk in out["Sketches"] for b in sk["Blocks"]]
    assert "p03_91_inset_window_outer" in phase_ids and "p03_94_inset_window_miters" in phase_ids
    assert "p03_93_inset_window_hole" not in phase_ids


# ------------------------------------------------------------------ declared_profiles.classify()
def _frame_with_window_features(tid):
    """A template's "Frame" block with the window's own features appended the way
    solid_coordinator._declared_frame does -- unconditionally, regardless of whether THIS frame actually
    has a window (that's the whole point: classify() decides from the curve ids it's handed, not from
    anything stored on `frame`)."""
    t, _ = resolve_template(tid)
    frame = dict(t["Frame"])
    frame["features"] = list(frame["features"]) + [WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE]
    return frame


@pytest.mark.parametrize("tid", TEMPLATES)
def test_a_window_bar_profile_classifies_to_the_right_window_bar(tid):
    frame = _frame_with_window_features(tid)
    outer, inner = line_ids(OUTER_ID), line_ids(INNER_ID)
    for side, curve in zip(WINDOW_BARS_FEATURE["bodyNames"], outer):
        feat, name = classify([curve, inner[0]], frame)
        assert feat["id"] == "window_bars" and name == side


@pytest.mark.parametrize("tid", TEMPLATES)
def test_a_window_profile_spanning_two_bars_is_refused(tid):
    frame = _frame_with_window_features(tid)
    outer = line_ids(OUTER_ID)
    with pytest.raises(DeclaredProfileError):
        classify([outer[0], outer[1]], frame)


@pytest.mark.parametrize("tid", TEMPLATES)
def test_the_window_hole_classifies_to_window_cut_no_lip(tid):
    frame = _frame_with_window_features(tid)
    feat, name = classify(line_ids(INNER_ID), frame)
    assert feat["id"] == "window_cut" and name is None


@pytest.mark.parametrize("tid", TEMPLATES)
def test_the_window_hole_and_lip_ring_classify_correctly_with_lip(tid):
    frame = _frame_with_window_features(tid)
    inner, hole = line_ids(INNER_ID), line_ids(HOLE_ID)
    feat, name = classify(hole, frame)
    assert feat["id"] == "window_cut" and name is None
    # the ring between inner and hole: no feature, whether or not it arrives pre-split by the miters
    assert classify(inner + hole, frame) == (None, None)
    m0 = miter_curve_id(*window_miters()[0])
    assert classify(inner[:2] + hole[:2] + [m0], frame) == (None, None)
    with pytest.raises(DeclaredProfileError):
        classify(inner + ["somewhere_else"], frame)


@pytest.mark.parametrize("tid", TEMPLATES)
def test_a_clamped_lip_build_with_no_hole_rect_still_cuts_the_full_inner_rectangle(tid):
    """SIMPLIFIED (T82 item 6, live build): when apply_inset_window skipped the hole rect (lip would clamp
    it shut), the sketch's own curve set is identical to the no-lip case -- the inner rectangle alone
    bounds the cut. classify() can't and doesn't need to tell this apart from "no lip" (see
    inset_window.py's own docstring)."""
    frame = _frame_with_window_features(tid)
    feat, name = classify(line_ids(INNER_ID), frame)
    assert feat["id"] == "window_cut" and name is None


@pytest.mark.parametrize("tid", TEMPLATES)
def test_the_main_opening_tolerates_the_windows_own_outer_loop_as_an_island(tid):
    frame = _frame_with_window_features(tid)
    main_inner = frame["regions"]["inner"]
    assert classify(list(main_inner) + line_ids(OUTER_ID), frame) == (None, None)


@pytest.mark.parametrize("tid", TEMPLATES)
def test_a_window_less_build_is_unaffected(tid):
    """No window curves in this profile's own ids at all (every template's own frame-defs.json, unchanged):
    the exact pre-T82-item-6 classify() behavior for the main opening, even though the window's own
    features are present on `frame` (solid_coordinator appends them to EVERY build, unconditionally)."""
    frame = _frame_with_window_features(tid)
    assert classify(frame["regions"]["inner"], frame) == (None, None)


def test_window_cut_feature_is_a_cut_through_all_from_the_sketch_plane():
    assert WINDOW_CUT_FEATURE["op"] == "cut" and WINDOW_CUT_FEATURE["extent"] == "throughAll"
    assert WINDOW_CUT_FEATURE["start"] == "0 in"  # the same sketch plane the main TRIM_CUT starts at


def test_window_bars_feature_uses_the_same_z_rule_as_the_main_bars():
    from fb_engine.frame_definition import FRAME_BOTTOM_PARAM, COMMON_FRAME_FEATURES
    main_bars = [f for f in COMMON_FRAME_FEATURES if f["id"] == "bars"][0]
    assert WINDOW_BARS_FEATURE["start"] == FRAME_BOTTOM_PARAM == main_bars["start"]
    assert WINDOW_BARS_FEATURE["extent"] == main_bars["extent"]
