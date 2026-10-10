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


# ------------------------------------------------------------------ T82 item 7: overlap degrades, never raises
def test_an_overlap_sliver_touching_only_main_inner_and_window_ids_is_no_feature_not_a_raise():
    """MEASURED live (T82 item 7, template_1 7x9, an intentionally-overlapping w=3,h=2 window at the
    board's own centre): when the window's own outer edge physically crosses the main frame's own inner
    contour (template_1's hourglass waist pinch), Fusion's profile finder produced slivers bounded by a MIX
    of a main `inner` curve id and window ids that fit none of the clean branches -- e.g. this EXACT
    combination: one main waist-arc id + the window's own inner-left edge + both of its own left-side
    miters, all from ONE profile. Before this item, that raised DeclaredProfileError and refused the whole
    build; Fred's own ruling is "ugly but not broken, then it's my responsibility" -- no feature, the
    material simply keeps that sliver, same as the plain opening default."""
    t, _ = resolve_template("template_1")
    frame = dict(t["Frame"])
    frame["features"] = list(frame["features"]) + [WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE]
    main_inner = frame["regions"]["inner"]
    main_waist_l = [c for c in main_inner if "waist_L" in c][0]
    outer, inner = line_ids(OUTER_ID), line_ids(INNER_ID)
    tl_miter = miter_curve_id(*window_miters()[0])  # TL: (window_outer_V_TL, window_inner_V_TL)
    bl_miter = miter_curve_id(*window_miters()[2])  # BL
    sliver = {main_waist_l, outer[3], inner[3], tl_miter, bl_miter}  # index 3 = "_left" (line_ids' own order)
    assert classify(sliver, frame) == (None, None)


def test_a_pure_main_frame_sliver_with_only_one_window_outer_id_is_also_no_feature():
    """The smaller sliver MEASURED live alongside the one above: a profile touching just ONE main inner id
    and ONE window outer id (no inner/miter at all) -- the opening-side crescent the waist pinch carves
    between itself and the window's own outer edge."""
    t, _ = resolve_template("template_1")
    frame = dict(t["Frame"])
    frame["features"] = list(frame["features"]) + [WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE]
    main_inner = frame["regions"]["inner"]
    main_waist_l = [c for c in main_inner if "waist_L" in c][0]
    sliver = {main_waist_l, line_ids(OUTER_ID)[3]}
    assert classify(sliver, frame) == (None, None)


def test_a_profile_touching_neither_main_inner_nor_any_window_id_still_raises():
    """The broadened tolerance is targeted at the window/opening overlap, not a blanket catch-all: a
    profile with a genuinely unrecognized, unrelated id (a real template bug, not an overlap artifact)
    must still raise -- the one thing this item must NOT silently swallow."""
    frame = _frame_with_window_features("template_1")
    with pytest.raises(DeclaredProfileError):
        classify({"somewhere_else_entirely"}, frame)


# ------------------------------------------------------------------ T85 item 2: a bare main-miter sliver
def test_a_phantom_profile_spanning_all_four_window_outer_sides_is_no_feature():
    """MEASURED live (T85 item 3, template_10_defaultWindow_7x9, window comfortably inside the
    opening): Fusion's profile finder can return a PHANTOM extra profile bounded by nothing but the
    window's own 4 outer sides, duplicating a ring the 4 corner miters already split correctly --
    confirmed live by dumping the sketch's own profiles: the 4 real bar profiles and the hole profile
    were separately present and correctly classified in the SAME sketch alongside this phantom. It
    touches no main `inner` id (ruling out the T82 item 7 overlap tolerance above, which needs one),
    so without this item it reached the window_bars branch and raised instead."""
    t, _ = resolve_template("template_10")
    frame = dict(t["Frame"])
    frame["features"] = list(frame["features"]) + [WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE]
    phantom = set(line_ids(OUTER_ID))
    assert classify(phantom, frame) == (None, None)


def test_a_genuine_partial_merge_of_window_bars_still_raises():
    """The phantom tolerance above is targeted at the EXACT full-outer-loop duplicate, not a blanket
    pass for any window_bars mismatch: a profile spanning only SOME of the 4 declared bars (e.g. a
    real miter genuinely failing to split 2 of them) is a different, real defect and must still
    raise -- the one thing this item must NOT silently swallow."""
    t, _ = resolve_template("template_10")
    frame = dict(t["Frame"])
    frame["features"] = list(frame["features"]) + [WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE]
    partial = set(list(line_ids(OUTER_ID))[:3])
    with pytest.raises(DeclaredProfileError):
        classify(partial, frame)


def test_a_sliver_bounded_solely_by_a_main_miter_curve_is_also_no_feature():
    """MEASURED live (T85 item 2, the window stress test): adding the window's own geometry to the SAME
    sketch can make Fusion's profile finder discover a tiny extra profile bounded by nothing but one of
    the MAIN frame's own pre-existing miter curves (template_6, 'shoulder_R': the window-less build never
    produces this profile at all -- it is an artifact of the window's own extra geometry, not a corner-
    resolution error: confirmed on an exact-90-degree line-line corner here and a line-circle corner on
    template_15, neither of which item 9's true-intersection fix touches). Same tolerance shape as the
    main-inner/window tangle above, just a main miter alone."""
    t, _ = resolve_template("template_6")
    frame = dict(t["Frame"])
    frame["features"] = list(frame["features"]) + [WINDOW_BARS_FEATURE, WINDOW_CUT_FEATURE]
    shoulder_r_miter = [m for m in frame["regions"]["miters"] if "shoulder_R" in m[0]][0]
    sliver = {miter_curve_id(*shoulder_r_miter)}
    assert classify(sliver, frame) == (None, None)


@pytest.mark.parametrize("tid", TEMPLATES)
def test_a_window_less_build_is_unaffected(tid):
    """No window curves in this profile's own ids at all (every template's own frame-defs.json, unchanged):
    the exact pre-T82-item-6 classify() behavior for the main opening, even though the window's own
    features are present on `frame` (solid_coordinator appends them to EVERY build, unconditionally)."""
    frame = _frame_with_window_features(tid)
    assert classify(frame["regions"]["inner"], frame) == (None, None)


def test_window_cut_feature_is_a_cut_through_all_from_the_sketch_plane():
    # BOTH sides of the plane (2026-10-09): the panel's underside can lie below it -- a hole through the whole panel
    assert WINDOW_CUT_FEATURE["op"] == "cut" and WINDOW_CUT_FEATURE["extent"] == "throughAllBothSides"
    assert WINDOW_CUT_FEATURE["start"] == "0 in"  # the same sketch plane the main TRIM_CUT starts at


def test_window_bars_feature_uses_the_same_z_rule_as_the_main_bars():
    from fb_engine.frame_definition import FRAME_BOTTOM_PARAM, COMMON_FRAME_FEATURES
    main_bars = [f for f in COMMON_FRAME_FEATURES if f["id"] == "bars"][0]
    assert WINDOW_BARS_FEATURE["start"] == FRAME_BOTTOM_PARAM == main_bars["start"]
    assert WINDOW_BARS_FEATURE["extent"] == main_bars["extent"]
