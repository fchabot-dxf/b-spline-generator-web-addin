"""Template 11 (Diamond-top, 3-arc Hourglass side): the full outline (roof/eave + hourglass side + base),
pure-Python, no Fusion needed. Mirrors test_t7_geometry.py's own structure/coverage."""
import math
import os
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine.t7_roof_eave import roof_geometry, peak_inner_corner  # noqa: E402
from fb_engine.t11_geometry import (  # noqa: E402
    t11_outline, base_inner_corner, inner_corner_directions, inner_profile_radii,
    every_outer_point_inside_board, is_valid_t11_outline, clamp_t11_handles,
    line_line_inner_corner,
    WAIST_REACH_DEFAULT, CORNER_RADIUS_DEFAULT, WAIST_CENTER_Y_FRAC_DEFAULT,
)

T = 0.75

# T11's roof+hourglass composition genuinely does not fit every board T7's own simpler neck/body shape
# tolerates (MEASURED, not assumed -- a sweep across both extreme landscape and tiny boards found real,
# expected failures at default handles: see test_raw_handle_sweep_has_real_invalid_combinations and
# test_clamp_always_produces_a_valid_outline below for how those are handled, not ignored). This project is
# portrait-only in practice (see CLAUDE memory project_portrait_only) -- these are the sizes T11 actually
# needs to look right at by default.
PORTRAIT_BOARDS = [(7, 9), (9, 12), (8, 10), (10, 13), (16, 20), (20, 24)]
# Sizes that are valid at default handles, but barely/invalidly so in at least one way -- used only for the
# "doesn't crash, clamp still produces something valid" sweep below, not for "valid at literal defaults".
EXTREME_BOARDS = [(6, 9), (12, 6), (5.51, 1.97), (24, 4), (5, 6.5), (7, 7)]
ALL_BOARDS = PORTRAIT_BOARDS + EXTREME_BOARDS


@pytest.mark.parametrize("w,h", PORTRAIT_BOARDS)
def test_outline_stays_inside_board_default_handles(w, h):
    o = t11_outline(w, h, T)
    assert every_outer_point_inside_board(w, h, o), f"{w}x{h}"


@pytest.mark.parametrize("w,h", PORTRAIT_BOARDS)
def test_default_handles_are_fully_valid_on_portrait_boards(w, h):
    o = t11_outline(w, h, T)
    assert is_valid_t11_outline(w, h, T, o), f"{w}x{h}"


def test_outer_points_match_7x9_known_good_values():
    """A regression pin at exactly 7x9 (this build's own measured values, WORK-LOG-lane-b.md Turn 220) --
    catches an accidental formula change even though every other test in this file is size-general."""
    o = t11_outline(7.0, 9.0, T)
    assert o["peak"] == pytest.approx((3.5, 9.0), abs=1e-9)
    assert o["E"] == pytest.approx((5.67, 6.83), abs=1e-9)
    assert o["base"] == pytest.approx((7.0, 0.0), abs=1e-9)
    assert o["shoulder_horn"] == pytest.approx((5.67, 4.806662674644974), abs=1e-6)
    assert o["shoulder_waist_jct"] == pytest.approx((5.432, 4.2499976047869845), abs=1e-6)
    assert o["waist_hip_jct"] == pytest.approx((6.23, 2.26), abs=1e-6)
    assert o["hip_horn"] == pytest.approx((7.0, 1.49), abs=1e-6)
    assert o["C_waist"] == pytest.approx((6.23, 3.415), abs=1e-6)
    assert o["r_shoulder"] == pytest.approx(0.77, abs=1e-6)
    assert o["r_waist"] == pytest.approx(1.155, abs=1e-6)
    assert o["r_hip"] == pytest.approx(0.77, abs=1e-6)


@pytest.mark.parametrize("w,h", PORTRAIT_BOARDS)
def test_jct_points_lie_exactly_on_the_waist_circle(w, h):
    """Regression test for the Turn 220 C_waist bug: `hw - depth` is the waist pinch's own DEEPEST point,
    not the arc's centre -- using it directly as the centre left both junction points off by exactly
    `radius_waist`, which is why every_outer_point_inside_board's own sample_arc could never find a sweep
    that reached them (neither endpoint was actually ON the given circle). MUTATION-TESTED: reverting the
    `+ hc["radius_waist"]` term in t11_outline's own C_waist line makes this fail at every board size below
    (confirmed by hand before this fix was trusted). Scoped to PORTRAIT_BOARDS, not every extreme size --
    at a sufficiently short/wide board `top_inset` exceeds the waist's own `depth` entirely (the eave sits
    further in than the pinch itself), a separate, pre-existing degenerate-construction limit unrelated to
    this bug (caught instead by is_valid_t11_outline/clamp_t11_handles, tested below)."""
    o = t11_outline(w, h, T)
    cx, cy = o["C_waist"]
    for key in ("shoulder_waist_jct", "waist_hip_jct"):
        p = o[key]
        dist = math.hypot(p[0] - cx, p[1] - cy)
        assert dist == pytest.approx(o["r_waist"], abs=1e-9), f"{w}x{h}: {key} is {dist} from C_waist, not r_waist={o['r_waist']}"


@pytest.mark.parametrize("w,h", ALL_BOARDS)
def test_every_outer_point_inside_board_never_raises(w, h):
    """The pre-fix `sample_arc` raised AssertionError on a genuinely degenerate sweep (hit at the extreme
    12x6 landscape aspect ratio) instead of reporting 'not valid here' -- breaks the 'clamped, never
    refused' contract every other caller (is_valid_t11_outline, clamp_t11_handles) relies on. This must
    always return a plain bool, never throw, at every board size including the extremes."""
    o = t11_outline(w, h, T)
    result = every_outer_point_inside_board(w, h, o)
    assert isinstance(result, bool)


@pytest.mark.parametrize("w,h", PORTRAIT_BOARDS)
def test_both_convex_arc_radii_positive_and_inner_offset_never_collapses(w, h):
    o = t11_outline(w, h, T)
    assert o["r_shoulder"] > 0, f"{w}x{h}"
    assert o["r_waist"] > 0, f"{w}x{h}"
    assert o["r_hip"] > 0, f"{w}x{h}"
    r_shoulder_in, r_waist_in, r_hip_in = inner_profile_radii(o["r_shoulder"], o["r_waist"], o["r_hip"], T)
    assert 0 < r_shoulder_in < o["r_shoulder"], f"{w}x{h}: shoulder inner radius must shrink but stay positive"
    assert r_waist_in > o["r_waist"], f"{w}x{h}: waist inner radius must GROW (concave offset)"
    assert 0 < r_hip_in < o["r_hip"], f"{w}x{h}: hip inner radius must shrink but stay positive"


@pytest.mark.parametrize("w,h", PORTRAIT_BOARDS)
def test_straight_runs_clear_frame_thickness(w, h):
    """The exact 'wing' risk T7's own rejected first build shipped with (see test_t7_geometry.py's own
    comment on this) -- neither straight run (eave->shoulder, hip->base) may be narrower than
    frame_thickness anywhere along its own length."""
    o = t11_outline(w, h, T)
    assert o["straight_eave_len"] > T, f"{w}x{h}: eave straight run too short"
    hip_to_base_len = math.hypot(o["base"][0] - o["hip_horn"][0], o["base"][1] - o["hip_horn"][1])
    assert hip_to_base_len > T, f"{w}x{h}: hip-to-base straight run too short"


@pytest.mark.parametrize("w,h", PORTRAIT_BOARDS)
def test_eave_inner_corner_points_toward_board_interior(w, h):
    """Regression test for the Turn 220 _line_line_inner_corner sign bug: an earlier version inferred
    'inward' from -(dir_in + dir_out) alone, which points OUTWARD at a cusp-like corner such as this eave
    (the exact bug class t7_roof_eave.eave_inner_corner's own docstring already warns about and had
    already fixed once, by using a real interior reference point instead). Checked directly: the computed
    inner point must be CLOSER to the board centre than the outer eave vertex E is -- MUTATION-TESTED
    (reverting to the direction-only heuristic fails this at every board size below)."""
    o = t11_outline(w, h, T)
    E = o["E"]
    direction, dist = o["eave_direction"], o["eave_distance"]
    inner_pt = (E[0] + direction[0] * dist, E[1] + direction[1] * dist)
    center = (w / 2.0, h / 2.0)
    d_outer = math.hypot(E[0] - center[0], E[1] - center[1])
    d_inner = math.hypot(inner_pt[0] - center[0], inner_pt[1] - center[1])
    assert d_inner < d_outer, f"{w}x{h}: eave inner corner moved AWAY from the board interior"


def test_line_line_inner_corner_matches_the_proven_peak_oracle():
    """Cross-validates the new GENERAL two-line miter against T7's own already-proven peak_inner_corner
    (itself verified against a true line intersection in test_t7_roof_eave.py): feeding it T7's own
    symmetric 90-degree peak corner must reproduce peak_inner_corner's exact answer. This is the oracle
    that caught the interior-point sign bug above in the first place."""
    for w, h in [(7, 9), (6, 9), (12, 6), (5.51, 1.97)]:
        g = roof_geometry(w, h)
        peak, E = g["peak"], g["E"]
        dx, dy = E[0] - peak[0], E[1] - peak[1]
        L = math.hypot(dx, dy)
        roof_dir = (dx / L, dy / L)
        left_dir = (-roof_dir[0], roof_dir[1])
        interior_pt = (g["cx"], h * 0.5)
        direction, dist, _inner = line_line_inner_corner(peak, left_dir, roof_dir, T, interior_pt)
        p_dir, p_dist = peak_inner_corner(T)
        assert direction == pytest.approx(p_dir, abs=1e-9), f"{w}x{h}"
        assert dist == pytest.approx(p_dist, abs=1e-9), f"{w}x{h}"


@pytest.mark.parametrize("w,h", PORTRAIT_BOARDS)
def test_inner_corner_directions_peak_is_fixed_eave_and_base_are_computed(w, h):
    corners = inner_corner_directions(w, h, T)
    assert corners["peak"] == (((0.0, -1.0), T * math.sqrt(2)))
    assert corners["base_R"] == (((-1.0, 1.0), T))
    eave_dir, eave_dist = corners["eave_R"]
    assert abs(math.hypot(*eave_dir) - 1.0) < 1e-9, f"{w}x{h}: eave direction must be a unit vector"
    assert eave_dist > 0


def test_base_inner_corner_right_and_left_mirror():
    r_dir, _ = base_inner_corner("right")
    l_dir, _ = base_inner_corner("left")
    assert r_dir == (-1.0, 1.0)
    assert l_dir == (1.0, 1.0)


# ---- handle sweeps: "Generate never broken" equivalent -- many handle combinations, always a valid outline ----

WAIST_REACH_RANGE = [0.40, 0.55, 0.70]
CORNER_RADIUS_RANGE = [0.15, 0.22, 0.32]
WAIST_CENTER_Y_RANGE = [-0.3, 0.0, 0.3]


def test_raw_handle_sweep_has_real_invalid_combinations():
    """MEASURED, not assumed: documents (and locks in) that at least one combination in this sweep is
    genuinely invalid without clamping, somewhere across a representative set of board sizes -- exactly why
    clamp_t11_handles exists (tested for real below) rather than a simple per-key min/max."""
    any_invalid = False
    for w, h in [(7, 9), (6, 9), (12, 6)]:
        for wr in WAIST_REACH_RANGE:
            for cr in CORNER_RADIUS_RANGE:
                for wc in WAIST_CENTER_Y_RANGE:
                    o = t11_outline(w, h, T, waist_reach=wr, corner_radius_top=cr, corner_radius_bottom=cr, waist_center_y_frac=wc)
                    if not is_valid_t11_outline(w, h, T, o):
                        any_invalid = True
    assert any_invalid, "expected at least one invalid raw combo somewhere in this sweep"


@pytest.mark.parametrize("w,h", ALL_BOARDS)
def test_clamp_always_produces_a_valid_or_default_outline(w, h):
    """The 'Generate never broken' guarantee -- every combination in the raw sweep above, after
    clamp_t11_handles, must EITHER validate OR (same contract as t7_geometry.clamp_t7_handles) fall all the
    way back to the proven default, never raise and never silently keep an invalid combination."""
    for wr in WAIST_REACH_RANGE:
        for cr in CORNER_RADIUS_RANGE:
            for wc in WAIST_CENTER_Y_RANGE:
                wr2, cr2t, cr2b, wc2 = clamp_t11_handles(w, h, T, waist_reach=wr, corner_radius_top=cr, corner_radius_bottom=cr, waist_center_y_frac=wc)
                o = t11_outline(w, h, T, waist_reach=wr2, corner_radius_top=cr2t, corner_radius_bottom=cr2b, waist_center_y_frac=wc2)
                is_default = (wr2, cr2t, cr2b, wc2) == (WAIST_REACH_DEFAULT, CORNER_RADIUS_DEFAULT, CORNER_RADIUS_DEFAULT, WAIST_CENTER_Y_FRAC_DEFAULT)
                assert is_valid_t11_outline(w, h, T, o) or is_default, f"{w}x{h}: clamp produced neither a valid nor the default outline for {(wr, cr, wc)}"


def test_clamp_is_a_no_op_when_the_requested_values_are_already_valid():
    """Non-vacuous check that clamping doesn't just always collapse to the default: a mild, already-valid
    request should come back unchanged (within the bisection's own resolution)."""
    w, h = 7, 9
    wr, cr, wc = WAIST_REACH_DEFAULT, CORNER_RADIUS_DEFAULT, WAIST_CENTER_Y_FRAC_DEFAULT
    o = t11_outline(w, h, T, waist_reach=wr, corner_radius_top=cr, corner_radius_bottom=cr, waist_center_y_frac=wc)
    assert is_valid_t11_outline(w, h, T, o), "test setup: this combo should already be valid"
    wr2, cr2t, cr2b, wc2 = clamp_t11_handles(w, h, T, waist_reach=wr, corner_radius_top=cr, corner_radius_bottom=cr, waist_center_y_frac=wc)
    assert (wr2, cr2t, cr2b, wc2) == pytest.approx((wr, cr, cr, wc), abs=1e-6)


def test_default_handle_constants_match_the_approved_spec():
    """Pins the defaults to T1's own literal values (editor-shape-lattice-generator.js PRESETS.hourglass),
    reused verbatim per this module's own docstring -- a future edit can't silently drift them."""
    assert WAIST_REACH_DEFAULT == 0.55
    assert CORNER_RADIUS_DEFAULT == 0.22
    assert WAIST_CENTER_Y_FRAC_DEFAULT == 0.0
