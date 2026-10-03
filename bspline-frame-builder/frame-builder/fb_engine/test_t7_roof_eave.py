"""Template 7 (Diamond-top): the roof/eave geometry, pure-Python, no Fusion needed."""
import math
import os
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine.t7_roof_eave import (  # noqa: E402
    roof_geometry, peak_inner_corner, eave_inner_corner, circle_circle_corner,
)
from fb_engine.t7_geometry import t7_outline  # noqa: E402

BOARDS = [(7, 9), (6, 9), (9, 12), (12, 6), (5.51, 1.97), (24, 4)]


@pytest.mark.parametrize("w,h", BOARDS)
def test_roof_stays_inside_board_every_size(w, h):
    g = roof_geometry(w, h)
    assert 0 <= g["E"][0] <= w
    assert 0 <= g["E"][1] <= h
    assert g["a"] > 0


@pytest.mark.parametrize("w,h", BOARDS)
def test_peak_is_centered_and_at_top(w, h):
    g = roof_geometry(w, h)
    assert g["peak"] == (w / 2, h)


def test_peak_direction_distance_matches_true_line_intersection():
    """MEASURED, not assumed: peak_inner_corner's formula (frame_thickness*sqrt(2), straight down) must
    equal the TRUE intersection of the two offset roof lines, computed independently here by walking each
    offset line to x=cx (the same technique t7_roof_eave.eave_inner_corner uses for the eave, applied by
    hand here as an oracle so this test doesn't just re-run the function under test)."""
    T = 0.75
    for w, h in BOARDS:
        g = roof_geometry(w, h)
        peak, E = g["peak"], g["E"]
        cx = g["cx"]
        dx, dy = E[0] - peak[0], E[1] - peak[1]
        L = math.hypot(dx, dy)
        n = (-dy / L, dx / L)
        # inward = toward the board center below the peak
        if n[1] > 0:
            n = (-n[0], -n[1])
        p0 = (peak[0] + n[0] * T, peak[1] + n[1] * T)
        s = (cx - p0[0]) / (dx / L)
        true_inner_peak = (cx, p0[1] + s * (dy / L))
        true_dist = math.hypot(true_inner_peak[0] - peak[0], true_inner_peak[1] - peak[1])

        direction, dist = peak_inner_corner(T)
        computed_inner_peak = (peak[0] + direction[0] * dist, peak[1] + direction[1] * dist)
        assert computed_inner_peak == pytest.approx(true_inner_peak, abs=1e-9), f"{w}x{h}"
        assert dist == pytest.approx(true_dist, abs=1e-9), f"{w}x{h}"
        assert dist == pytest.approx(T * math.sqrt(2), abs=1e-9)


@pytest.mark.parametrize("w,h", BOARDS)
def test_eave_inner_corner_is_exactly_on_both_offset_curves(w, h):
    """The strict geometric definition, checked directly (not a loose heuristic): the TRUE inner eave
    corner must lie EXACTLY on the offset roof line (perpendicular distance T from the real roof line, on
    the interior side) AND EXACTLY on the offset neck circle (distance r_neck+T from C_neck) -- the actual
    intersection of those two offset curves is the only point satisfying both, so this fails immediately
    for a wrong-sign offset or a wrong-side line offset, unlike a "closer to the interior" proxy (MEASURED:
    that proxy only failed 1 of 6 board sizes under a deliberate sign-flip mutation test, since a roughly-
    central wrong point can still coincidentally read as "closer" -- this version is checked to fail at
    EVERY size below)."""
    T = 0.75
    o = t7_outline(w, h, T)
    direction, dist, e_in = eave_inner_corner(w, h, T, o["C_neck"], o["r_neck"])
    E, peak, C_neck, r_neck = o["E"], o["peak"], o["C_neck"], o["r_neck"]

    # On the offset neck circle at radius r_neck + T:
    dist_from_C_neck = math.hypot(e_in[0] - C_neck[0], e_in[1] - C_neck[1])
    assert dist_from_C_neck == pytest.approx(r_neck + T, abs=1e-9), f"{w}x{h}: not on the offset neck arc"

    # On the offset roof line, exactly T from the real roof line, on the INTERIOR side (not the exterior):
    dx, dy = E[0] - peak[0], E[1] - peak[1]
    L = math.hypot(dx, dy)
    # signed perpendicular distance from e_in to the infinite roof line through peak/E
    cross = ((e_in[0] - peak[0]) * dy - (e_in[1] - peak[1]) * dx) / L
    assert abs(abs(cross) - T) < 1e-9, f"{w}x{h}: eave inner point is {abs(cross)} from the roof line, not {T}"
    interior_pt = (o["cx"], h * 0.5)
    cross_interior = ((interior_pt[0] - peak[0]) * dy - (interior_pt[1] - peak[1]) * dx) / L
    assert (cross > 0) == (cross_interior > 0), f"{w}x{h}: eave inner point is on the WRONG side of the roof line (exterior, not interior)"

    # And `direction`/`dist` must reconstruct e_in exactly from the outer vertex E.
    reconstructed = (E[0] + direction[0] * dist, E[1] + direction[1] * dist)
    assert reconstructed == pytest.approx(e_in, abs=1e-9), f"{w}x{h}"


class TestCircleCircleCorner:
    """T84 item 3: circle_circle_corner, the arc-meets-arc sibling of line_circle_corner (needed by
    T17 Tulip's own concave-upper-side corners -- neither piece there is a straight line). Tested
    from known truth, not just checked against an already-passing caller: a TRUE point P is placed
    exactly on both OFFSET circles by construction (r*_in = |P - centre|), the offset radii are then
    converted back to the circles' own TRUE radii via each one's own Concave flag, and the function
    must recover P from those true radii + the frame thickness alone."""

    def test_recovers_the_known_intersection_both_circles_shrinking(self):
        # offset circles centre (0,0) r=5 and centre (8,0) r=5 intersect at (4, 3) and (4, -3)
        # (d=8, a=4, h=3) -- concave=False both sides means the TRUE radius is offset + t.
        t = 1.0
        c1, c2 = (0.0, 0.0), (8.0, 0.0)
        r1, r2 = 5.0 + t, 5.0 + t
        got = circle_circle_corner(c1, r1, False, c2, r2, False, t, outer_corner=(4.0, 10.0))
        assert got == pytest.approx((4.0, 3.0), abs=1e-9)
        got2 = circle_circle_corner(c1, r1, False, c2, r2, False, t, outer_corner=(4.0, -10.0))
        assert got2 == pytest.approx((4.0, -3.0), abs=1e-9), "outer_corner must pick the OTHER root"

    def test_recovers_the_same_intersection_both_circles_growing(self):
        # same offset circles (radius 5 both), reached via concave=True instead (TRUE radius =
        # offset - t) -- the two sign conventions must agree on the SAME offset geometry.
        t = 1.0
        c1, c2 = (0.0, 0.0), (8.0, 0.0)
        r1, r2 = 5.0 - t, 5.0 - t
        got = circle_circle_corner(c1, r1, True, c2, r2, True, t, outer_corner=(4.0, 10.0))
        assert got == pytest.approx((4.0, 3.0), abs=1e-9)

    def test_recovers_an_off_axis_known_point_mixed_concavity(self):
        # P sits exactly on both offset circles by construction; mixed concave flags (T17's own
        # actual mix: a convex lower bulge meeting a concave upper side).
        P = (5.0, 4.0)
        c1, c2 = (1.0, 1.0), (10.0, 2.0)
        r1_in = math.hypot(P[0] - c1[0], P[1] - c1[1])
        r2_in = math.hypot(P[0] - c2[0], P[1] - c2[1])
        t = 0.75
        r1, r2 = r1_in + t, r2_in - t  # concave1=False (+t), concave2=True (-t)
        got = circle_circle_corner(c1, r1, False, c2, r2, True, t, outer_corner=P)
        assert got == pytest.approx(P, abs=1e-9)

    def test_raises_when_the_offset_circles_do_not_intersect(self):
        with pytest.raises(ValueError):
            circle_circle_corner((0.0, 0.0), 1.0, False, (100.0, 0.0), 1.0, False, 0.1, outer_corner=(0.0, 0.0))
