"""H23 item 18: closed_form_arc.py's own three primitives, tested independently of any template
by constructing known circles and recovering them (not just checked against t7_geometry.py's own
already-passing numbers, which would only prove the extraction matched -- these prove the formulas
are right in the first place)."""
import math

import pytest

from fb_engine.closed_form_arc import (
    colinear_circle_through_point, sagitta_circle, tangent_circle_through_point, true_via_point,
)


class TestTangentCircleThroughPoint:
    def test_recovers_a_known_circle_tangent_to_a_vertical_line(self):
        # circle centre (2, 3), radius 5 -- tangent to the vertical line x=7 at (7, 3);
        # pick a second point ON the same circle, e.g. straight up from the centre: (2, 8).
        centre, r = tangent_circle_through_point((7.0, 3.0), (0.0, 1.0), (2.0, 8.0))
        assert centre == pytest.approx((2.0, 3.0))
        assert r == pytest.approx(5.0)

    def test_recovers_a_known_circle_tangent_to_a_horizontal_line(self):
        # centre (4, -1), radius 3 -- tangent to y=-4 at (4, -4); second point (1, -1).
        centre, r = tangent_circle_through_point((4.0, -4.0), (1.0, 0.0), (1.0, -1.0))
        assert centre == pytest.approx((4.0, -1.0))
        assert r == pytest.approx(3.0)

    def test_matches_t7_geometrys_own_body_arc_at_7x9(self):
        """The exact call shape t7_geometry.py's own t7_outline() makes for its body arc --
        confirms this module's own docstring claim, not just the formula in the abstract."""
        from fb_engine.t7_roof_eave import roof_geometry
        g = roof_geometry(7.0, 9.0)
        width_in, height_in = 7.0, 9.0
        a = g["a"]
        yE = height_in - a
        body_y = yE - 0.72 * yE
        neck_y = yE - 0.18 * yE
        nx = max(0.50 * g["hw"], a * 0.70)
        xN = g["cx"] + nx
        B = (width_in, body_y)
        N = (xN, neck_y)
        centre, r = tangent_circle_through_point(B, (0.0, 1.0), N)
        # the same formula t7_geometry.py computes inline
        dy = neck_y - body_y
        dxN = xN - width_in
        r_expected = -(dxN * dxN + dy * dy) / (2 * dxN)
        c_expected = (width_in - r_expected, body_y)
        assert r == pytest.approx(r_expected)
        assert centre == pytest.approx(c_expected)


class TestColinearCircleThroughPoint:
    """The intended use is two DIFFERENT circles sharing a vertex V, opposite-curvature-tangent
    there (an S-curve join): `ray_direction` points from the FIRST circle's own centre through V,
    and the SECOND circle's centre continues onward past V in that same direction -- a positive
    radius means "further along the ray", exactly t7_geometry.py's own C_body -> N -> C_neck."""

    def test_recovers_a_second_circle_continuing_past_the_shared_vertex(self):
        # circle A: centre (0,0), R=6, shared vertex N at angle 0 deg -> N=(6,0).
        ray_direction = (6.0, 0.0)  # N - centre_A, pointing +x
        # circle B: centre (10,0), R=4 (N is exactly on it too: |(=10,0)-(6,0)| = 4).
        E = (10.0, 4.0)  # a second point on circle B (angle 90 deg from its own centre)
        centre, r = colinear_circle_through_point((6.0, 0.0), ray_direction, E)
        assert centre == pytest.approx((10.0, 0.0))
        assert r == pytest.approx(4.0)

    def test_recovers_an_off_axis_pair(self):
        ca, Ra = (3.0, -2.0), 6.0
        ang_n = math.radians(50)
        N = (ca[0] + Ra * math.cos(ang_n), ca[1] + Ra * math.sin(ang_n))
        ray_direction = (N[0] - ca[0], N[1] - ca[1])
        ulen = math.hypot(*ray_direction)
        ux, uy = ray_direction[0] / ulen, ray_direction[1] / ulen
        Rb = 4.0
        cb = (N[0] + Rb * ux, N[1] + Rb * uy)  # circle B continues past N along the same ray
        ang_e = math.radians(170)
        E = (cb[0] + Rb * math.cos(ang_e), cb[1] + Rb * math.sin(ang_e))
        centre, r = colinear_circle_through_point(N, ray_direction, E)
        assert centre == pytest.approx(cb)
        assert r == pytest.approx(Rb)


class TestSagittaCircle:
    def test_recovers_a_known_circle_bulging_away_from_the_origin(self):
        # circle centre (0, 5), radius 5 -- chord from (-3,8) to (3,8) (both on the circle, since
        # 3^2+3^2=18... use exact points instead: angle +/-36.87 deg from centre gives (3,8)/(-3,8)? check:
        # centre(0,5) r=5: point at angle 90-36.87=53.13 -> (5*cos53.13, 5+5*sin53.13) = (3, 9). Use that.
        p0, p1 = (-3.0, 9.0), (3.0, 9.0)  # both at radius 5 from (0,5): hypot(3,4)=5 ✓.
        # chord midpoint (0,9); true apex of the MINOR arc bulging further from the origin is (0,10)
        # (centre + radius straight up) -> sagitta = 10-9 = 1.
        centre, r = sagitta_circle(p0, p1, 1.0, away_point=(0.0, 0.0))
        assert centre == pytest.approx((0.0, 5.0))
        assert r == pytest.approx(5.0)

    def test_bulges_toward_the_far_side_from_away_point_not_the_near_side(self):
        # same chord, but ask for the bulge on the SIDE CLOSER to the origin (sagitta pushes the arc TOWARD
        # (0,0) from the chord) -- this is the minor arc the other way, centre (0, 8+(9-8))=(0, 8)? derive:
        # apex must be BETWEEN origin and the chord, i.e. apex=(0,8) (sagitta 1 downward from the chord).
        p0, p1 = (-3.0, 9.0), (3.0, 9.0)
        centre, r = sagitta_circle(p0, p1, 1.0, away_point=(0.0, 20.0))  # "away" is now far ABOVE the chord
        # bulging away from (0,20) means bulging DOWNWARD (toward the origin side) -> apex (0,8), centre (0,9+... )
        # solve independently: chord half=3, sag=1 -> R=(9+1)/2=5; centre is sag-R=-4 along the (away) normal.
        # the normal pointing away from (0,20) at mid(0,9) is (0,-1); centre = (0,9) + (0,-1)*(1-5) = (0, 9+4) = (0,13).
        assert centre == pytest.approx((0.0, 13.0))
        assert r == pytest.approx(5.0)

    def test_via_point_round_trip_matches_the_requested_sagitta(self):
        """The whole point of this function: feed its own (centre, radius) into true_via_point and recover
        a point exactly `sag` away from the chord's own midpoint, on the requested side."""
        p0, p1 = (1.0, 2.0), (6.0, 2.5)
        sag = 0.73
        away = (3.5, -50.0)  # far below the chord -> bulge UPWARD, away from `away`
        centre, r = sagitta_circle(p0, p1, sag, away_point=away)
        via = true_via_point(centre, r, p0, p1)
        mx, my = (p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0
        assert math.hypot(via[0] - mx, via[1] - my) == pytest.approx(sag)
        # and it's on the far side from `away_point` (farther from `away` than the chord midpoint is)
        d_via = math.hypot(via[0] - away[0], via[1] - away[1])
        d_mid = math.hypot(mx - away[0], my - away[1])
        assert d_via > d_mid

    def test_small_sagitta_gives_a_large_nearly_flat_arc(self):
        p0, p1 = (0.0, 0.0), (10.0, 0.0)
        centre, r = sagitta_circle(p0, p1, 0.01, away_point=(5.0, -100.0))
        assert r == pytest.approx((5.0 ** 2 + 0.01 ** 2) / (2 * 0.01))
        assert r > 1000  # a tiny sagitta over a long chord is a very large, nearly-flat radius


class TestTrueViaPoint:
    def test_quarter_circle_midpoint_is_at_45_degrees(self):
        centre, r = (0.0, 0.0), 1.0
        end0, end1 = (1.0, 0.0), (0.0, 1.0)  # 0 deg and 90 deg
        via = true_via_point(centre, r, end0, end1)
        assert via == pytest.approx((math.sqrt(2) / 2, math.sqrt(2) / 2))

    def test_off_centre_off_radius_circle(self):
        centre, r = (5.0, 5.0), 2.0
        ang0, ang1 = math.radians(10), math.radians(80)
        end0 = (centre[0] + r * math.cos(ang0), centre[1] + r * math.sin(ang0))
        end1 = (centre[0] + r * math.cos(ang1), centre[1] + r * math.sin(ang1))
        via = true_via_point(centre, r, end0, end1)
        ang_mid = math.radians(45)
        expected = (centre[0] + r * math.cos(ang_mid), centre[1] + r * math.sin(ang_mid))
        assert via == pytest.approx(expected)

    def test_result_is_exactly_on_the_circle(self):
        centre, r = (-3.0, 7.0), 5.5
        end0 = (centre[0] + r * math.cos(0.2), centre[1] + r * math.sin(0.2))
        end1 = (centre[0] + r * math.cos(2.1), centre[1] + r * math.sin(2.1))
        vx, vy = true_via_point(centre, r, end0, end1)
        assert math.hypot(vx - centre[0], vy - centre[1]) == pytest.approx(r)
