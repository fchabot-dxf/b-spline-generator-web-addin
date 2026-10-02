"""H23 item 18: closed_form_arc.py's own three primitives, tested independently of any template
by constructing known circles and recovering them (not just checked against t7_geometry.py's own
already-passing numbers, which would only prove the extraction matched -- these prove the formulas
are right in the first place)."""
import math

import pytest

from fb_engine.closed_form_arc import (
    colinear_circle_through_point, tangent_circle_through_point, true_via_point,
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
