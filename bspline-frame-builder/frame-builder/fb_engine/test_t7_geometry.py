"""Template 7 (Diamond-top): the full outline (neck/body S-curve + base), pure-Python, no Fusion needed."""
import math
import os
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine.t7_geometry import (  # noqa: E402
    t7_outline, base_inner_corner, inner_corner_directions, inner_profile_radii,
    every_outer_point_inside_board, is_valid_t7_outline, clamp_t7_handles,
    NECK_WIDTH_OF_HW_DEFAULT, NECK_HEIGHT_FRAC_DEFAULT, BODY_FLARE_HEIGHT_FRAC_DEFAULT,
)

BOARDS = [(7, 9), (6, 9), (9, 12), (12, 6), (5.51, 1.97), (24, 4)]
T = 0.75


@pytest.mark.parametrize("w,h", BOARDS)
def test_outline_stays_inside_board_default_handles(w, h):
    o = t7_outline(w, h, T)
    assert every_outer_point_inside_board(w, h, o), f"{w}x{h}"


@pytest.mark.parametrize("w,h", BOARDS)
def test_outer_points_match_7x9_known_good_values_at_7x9_only(w, h):
    """A regression pin at exactly 7x9 (this build's own scratch-diagram numbers, WORK-LOG-lane-b.md Turn
    199/201, MEASURED there not re-derived here) -- catches an accidental formula change even though every
    other test in this file is size-general."""
    if (w, h) != (7, 9):
        pytest.skip("pinned at 7x9 only")
    o = t7_outline(w, h, T)
    assert o["a"] == pytest.approx(2.17, abs=1e-6)
    assert o["E"] == pytest.approx((5.67, 6.83), abs=1e-6)
    assert o["N"] == pytest.approx((5.25, 5.601), abs=1e-3)
    assert o["B"] == pytest.approx((7.0, 1.912), abs=1e-3)


@pytest.mark.parametrize("w,h", BOARDS)
def test_both_arc_radii_positive_and_inner_offset_never_collapses(w, h):
    o = t7_outline(w, h, T)
    assert o["r_neck"] > 0, f"{w}x{h}"
    assert o["r_body"] > 0, f"{w}x{h}"
    r_neck_in, r_body_in = inner_profile_radii(o["r_neck"], o["r_body"], T)
    assert r_neck_in > o["r_neck"], f"{w}x{h}: neck inner radius must GROW (concave offset)"
    assert 0 < r_body_in < o["r_body"], f"{w}x{h}: body inner radius must shrink but stay positive (no band collapse)"


@pytest.mark.parametrize("w,h", BOARDS)
def test_every_bar_is_at_least_frame_thickness_wide(w, h):
    """The exact 'wing' risk Template 7's own rejected first build shipped with (tests/frame-template-8.test.js
    line 87 cites it by name): no piece of the band may be narrower than frame_thickness anywhere along its
    own length. Checked two ways: the neck's own OUTER half-gap from centerline must exceed frame_thickness
    (so there's room for a bar at all), and the roof/side runs (straight pieces) must have positive length."""
    o = t7_outline(w, h, T)
    neck_half_gap = o["N"][0] - o["cx"]
    assert neck_half_gap > T, f"{w}x{h}: neck gap {neck_half_gap} does not clear frame_thickness {T} -- wing risk"
    # roof run (peak -> E) and the straight side run (B -> base) must both have real positive length
    roof_len = math.hypot(o["E"][0] - o["peak"][0], o["E"][1] - o["peak"][1])
    side_len = o["B"][1] - o["base"][1]
    assert roof_len > T, f"{w}x{h}: roof bar too short ({roof_len})"
    assert side_len >= 0, f"{w}x{h}: body arc reaches full width BELOW the base (B.y={o['B'][1]} < 0)"


@pytest.mark.parametrize("w,h", BOARDS)
def test_inner_corner_directions_peak_is_fixed_eave_and_base_are_computed(w, h):
    corners = inner_corner_directions(w, h, T)
    assert corners['peak'] == (((0.0, -1.0), T * math.sqrt(2)))
    assert corners['base_R'] == (((-1.0, 1.0), T))
    eave_dir, eave_dist = corners['eave_R']
    assert abs(math.hypot(*eave_dir) - 1.0) < 1e-9, f"{w}x{h}: eave direction must be a unit vector"
    assert eave_dist > 0


def test_base_inner_corner_right_and_left_mirror():
    r_dir, _ = base_inner_corner('right')
    l_dir, _ = base_inner_corner('left')
    assert r_dir == (-1.0, 1.0)
    assert l_dir == (1.0, 1.0)


# ---- handle sweeps: "Generate never broken" equivalent -- many handle combinations, always a valid outline ----

NECK_WIDTH_RANGE = [0.44, 0.50, 0.55, 0.60]
NECK_HEIGHT_RANGE = [0.10, 0.18, 0.30]
BODY_FLARE_RANGE = [0.55, 0.72, 0.85]


def test_raw_handle_sweep_has_real_invalid_combinations():
    """MEASURED, not assumed: the 3 handles are NOT independently safe across their own plausible ranges --
    documents (and locks in, so a future "well actually it's fine" doesn't silently remove the clamp) that
    at least one combination in this sweep is genuinely invalid without clamping, somewhere across a
    representative set of board sizes (not required at EVERY size -- 12x6 alone happens to tolerate this
    whole sweep; 7x9 and 6x9 do not, which is enough to prove clamping is load-bearing, not decorative).
    This is exactly why clamp_t7_handles exists (tested for real below) rather than a simple per-key
    min/max."""
    any_invalid = False
    for w, h in [(7, 9), (6, 9), (12, 6)]:
        for nw in NECK_WIDTH_RANGE:
            for nh in NECK_HEIGHT_RANGE:
                for bf in BODY_FLARE_RANGE:
                    if nh >= bf:
                        continue
                    o = t7_outline(w, h, T, neck_width_of_hw=nw, neck_height_frac=nh, body_flare_height_frac=bf)
                    if not is_valid_t7_outline(w, h, T, o):
                        any_invalid = True
    assert any_invalid, "expected at least one invalid raw combo somewhere in this sweep (none found -- is the sweep range still representative?)"


@pytest.mark.parametrize("w,h", BOARDS)
def test_clamp_always_produces_a_valid_outline(w, h):
    """The actual 'Generate never broken, whatever the user drags' guarantee: every combination in the raw
    sweep above, after clamp_t7_handles, must validate -- at EVERY supported board size, not just the 3
    representative ones the raw sweep used (clamping is the thing that has to hold everywhere)."""
    failures = []
    for nw in NECK_WIDTH_RANGE:
        for nh in NECK_HEIGHT_RANGE:
            for bf in BODY_FLARE_RANGE:
                if nh >= bf:
                    continue
                nw2, nh2, bf2 = clamp_t7_handles(w, h, T, neck_width_of_hw=nw, neck_height_frac=nh, body_flare_height_frac=bf)
                o = t7_outline(w, h, T, neck_width_of_hw=nw2, neck_height_frac=nh2, body_flare_height_frac=bf2)
                if not is_valid_t7_outline(w, h, T, o):
                    failures.append((nw, nh, bf, "->", nw2, nh2, bf2))
    assert not failures, f"{w}x{h}: clamp_t7_handles produced an invalid outline for: {failures[:5]}"


def test_clamp_is_a_no_op_when_the_requested_values_are_already_valid():
    """Non-vacuous check that clamping doesn't just always collapse to the default: a mild, already-valid
    request should come back unchanged (within the bisection's own resolution)."""
    w, h = 7, 9
    nw, nh, bf = 0.48, 0.16, 0.68  # near the proven-safe default, should validate as-is
    o = t7_outline(w, h, T, nw, nh, bf)
    assert is_valid_t7_outline(w, h, T, o), "test setup: this combo should already be valid"
    nw2, nh2, bf2 = clamp_t7_handles(w, h, T, nw, nh, bf)
    assert (nw2, nh2, bf2) == pytest.approx((nw, nh, bf), abs=1e-6)


def test_default_handle_constants_match_the_approved_spec():
    """Pins the 3 defaults to the advisor-approved values (WORK-LOG-lane-b.md Turn 199/201) so a future
    edit to the module can't silently drift them."""
    assert NECK_WIDTH_OF_HW_DEFAULT == 0.50
    assert NECK_HEIGHT_FRAC_DEFAULT == 0.18
    assert BODY_FLARE_HEIGHT_FRAC_DEFAULT == 0.72
