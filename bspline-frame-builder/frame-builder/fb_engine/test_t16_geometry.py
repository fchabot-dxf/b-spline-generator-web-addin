"""T84 item 3: fb_engine.t16_geometry's own outline() + is_valid_outline(), tested independently of
Fusion (the JS production pipeline -- outlineDefects/offsetOutlineInward/frameMiters -- is exercised
separately, by tests/frame-template-16.test.js / -17.test.js; this file is the Python side only, the same
split t11_geometry.py and its own test_t11_geometry.py use)."""
import math

import pytest

from fb_engine.t16_geometry import (
    ARCH_RISE_FRAC_DEFAULT, BULGE_FRAC_DEFAULT, WAIST_HEIGHT_FRAC_DEFAULT, WAIST_WIDTH_FRAC_DEFAULT,
    is_valid_outline, outline,
)

SIZES = [(6.0, 9.0), (7.0, 9.0), (9.0, 12.0)]
T = 0.75


class TestArchIsSymmetric:
    """The arch's own via point must be EXACTLY the apex (0, hh) -- by construction (top_l/top_r share y,
    the bulge is straight up), not approximately."""

    @pytest.mark.parametrize("W,H", SIZES)
    def test_arch_via_point_is_the_exact_apex(self, W, H):
        o = outline(W, H, T)
        assert o["arch_via"] == pytest.approx((0.0, o["hh"]), abs=1e-9)
        assert o["apex"] == pytest.approx((0.0, o["hh"]))

    @pytest.mark.parametrize("W,H", SIZES)
    def test_arch_centre_is_on_the_board_centreline(self, W, H):
        o = outline(W, H, T)
        assert o["arch_centre"][0] == pytest.approx(0.0, abs=1e-9)


class TestDefaultOutlineIsValid:
    @pytest.mark.parametrize("W,H", SIZES)
    def test_funnel_defaults_are_valid(self, W, H):
        o = outline(W, H, T)  # upper_curve_frac defaults to 0 -- straight sides
        assert o["upper_r_centre"] is None  # confirms the straight-line path, not an accidental tiny arc
        assert is_valid_outline(o)

    @pytest.mark.parametrize("W,H", SIZES)
    def test_tulip_defaults_are_valid(self, W, H):
        o = outline(W, H, T, upper_curve_frac=0.15)
        assert o["upper_r_centre"] is not None
        assert is_valid_outline(o)


class TestContinuity:
    """Every piece's own declared end must exactly meet the next piece's declared start -- the F30 item 5
    lesson (a real gap mirror-symmetry checking alone missed), re-applied here independently of the JS
    diagram's own continuityCheck."""

    @pytest.mark.parametrize("W,H", SIZES)
    @pytest.mark.parametrize("ucf", [0.0, 0.15])
    def test_six_piece_loop_is_continuous(self, W, H, ucf):
        """Each piece's own END must be the exact same point as the NEXT piece's own START -- checked via
        each arc's own circle (true_via_point's end-direction math), not just by re-reading the shared
        corner dict value (which would only prove the dict was built self-consistently, not that each arc's
        own true endpoint -- as Fusion's addByThreePoints would actually place it -- lands there)."""
        o = outline(W, H, T, upper_curve_frac=ucf)

        def arc_end(centre, radius, p, atol=1e-9):
            # p must already be exactly on the circle -- assert that first (the thing a hand-computed
            # endpoint could get subtly wrong), THEN treat p itself as the arc's own true end.
            assert math.hypot(p[0] - centre[0], p[1] - centre[1]) == pytest.approx(radius, abs=atol)
            return p

        # arch: top_l -> apex -> top_r, both ends on the arch circle
        arc_end(o["arch_centre"], o["arch_radius"], o["top_l"])
        arc_end(o["arch_centre"], o["arch_radius"], o["top_r"])
        # lower_R: waist_r -> BR, both on the lower_r circle
        arc_end(o["lower_r_centre"], o["lower_r_radius"], o["waist_r"])
        arc_end(o["lower_r_centre"], o["lower_r_radius"], o["BR"])
        # lower_L: BL -> waist_l
        arc_end(o["lower_l_centre"], o["lower_l_radius"], o["BL"])
        arc_end(o["lower_l_centre"], o["lower_l_radius"], o["waist_l"])
        if ucf:
            arc_end(o["upper_r_centre"], o["upper_r_radius"], o["top_r"])
            arc_end(o["upper_r_centre"], o["upper_r_radius"], o["waist_r"])
            arc_end(o["upper_l_centre"], o["upper_l_radius"], o["waist_l"])
            arc_end(o["upper_l_centre"], o["upper_l_radius"], o["top_l"])
        # the loop as a whole, walked in travel order, closes back on its own start point.
        loop = [o["top_r"], o["waist_r"], o["BR"], o["BL"], o["waist_l"], o["top_l"], o["top_r"]]
        assert loop[0] == loop[-1]


class TestUndercutGuard:
    """H23 item 63's own 'no arc past 180 deg' rule, ported to this module's own validity check. The real
    failure mode here isn't the sweep angle directly -- a sagitta-built arc's own minor-arc sweep is, by
    construction, always < 180 deg (min(d, 2*pi-d) cannot exceed pi). The actual degenerate case is the
    sagitta REACHING half the chord length: beyond that point sagitta_circle/true_via_point stop
    constructing the intended bulge at all (true_via_point stays pinned to the minor-arc bisector instead
    of following the bulge to the far side) -- confirmed by hand (2026-10-03): at 7x9, bulge_frac=0.9 gives
    a lower-bulge sag of 3.15in against a chord of 4.595in (half-chord 2.297in), i.e. sag > half_chord, and
    the resulting via point is NOT the sag-away-from-midpoint point the construction intends. That's what
    is_valid_outline's own `sag < half_chord` check (not the sweep check) must catch."""

    def test_moderate_defaults_stay_well_under_180(self, ):
        o = outline(7.0, 9.0, T)
        from fb_engine.t16_geometry import _arc_sweep_deg
        for centre, radius, p0, p1 in (
            (o["arch_centre"], o["arch_radius"], o["top_l"], o["top_r"]),
            (o["lower_r_centre"], o["lower_r_radius"], o["waist_r"], o["BR"]),
        ):
            assert _arc_sweep_deg(centre, radius, p0, p1) < 140.0  # comfortably clear, not just <180

    def test_an_oversized_bulge_is_rejected_as_invalid(self):
        """A bulge sagitta past half the chord length -- is_valid_outline must say so, not silently accept
        a construction whose via point no longer means what it's supposed to."""
        o = outline(7.0, 9.0, T, bulge_frac=0.9)  # far beyond the declared app-side range, deliberately
        assert not is_valid_outline(o)

    def test_the_rejection_is_specifically_the_sag_vs_half_chord_check(self):
        """Proven non-vacuous both ways: the oversized bulge's own sag DOES exceed half its chord (the
        condition is_valid_outline actually checks), and the moderate default does NOT -- so the check
        rejects the degenerate case without also rejecting the realistic one."""
        import math
        bad = outline(7.0, 9.0, T, bulge_frac=0.9)
        chord = math.hypot(bad["BR"][0] - bad["waist_r"][0], bad["BR"][1] - bad["waist_r"][1])
        assert bad["lower_r_sag"] >= chord / 2.0

        ok = outline(7.0, 9.0, T)  # BULGE_FRAC_DEFAULT
        chord_ok = math.hypot(ok["BR"][0] - ok["waist_r"][0], ok["BR"][1] - ok["waist_r"][1])
        assert ok["lower_r_sag"] < chord_ok / 2.0


class TestTulipDegeneratesToFunnelAtZeroCurve:
    """bulgeArc's own documented identity (sag<1e-9 -> a straight line) is the whole reason Funnel and
    Tulip share one builder -- confirm the Python port preserves it exactly."""

    @pytest.mark.parametrize("W,H", SIZES)
    def test_zero_curve_frac_gives_no_upper_arc(self, W, H):
        o = outline(W, H, T, upper_curve_frac=0.0)
        assert o["upper_r_centre"] is None and o["upper_l_centre"] is None

    @pytest.mark.parametrize("W,H", SIZES)
    def test_a_tiny_positive_curve_frac_gives_a_real_but_huge_radius_arc(self, W, H):
        o = outline(W, H, T, upper_curve_frac=1e-6)
        assert o["upper_r_centre"] is not None
        assert o["upper_r_radius"] > 1000  # a near-zero sagitta is a near-flat, very-large-radius arc


class TestMirrorSymmetry:
    @pytest.mark.parametrize("W,H", SIZES)
    @pytest.mark.parametrize("ucf", [0.0, 0.15])
    def test_left_side_is_the_exact_x_mirror_of_the_right(self, W, H, ucf):
        o = outline(W, H, T, upper_curve_frac=ucf)
        assert o["top_l"] == pytest.approx((-o["top_r"][0], o["top_r"][1]))
        assert o["waist_l"] == pytest.approx((-o["waist_r"][0], o["waist_r"][1]))
        assert o["BL"] == pytest.approx((-o["BR"][0], o["BR"][1]))
        assert o["lower_l_radius"] == pytest.approx(o["lower_r_radius"])
        if ucf:
            assert o["upper_l_radius"] == pytest.approx(o["upper_r_radius"])


class TestDefaultsMatchTheApprovedDiagram:
    """Pins the Fred-approved literal defaults (diagram commit 19f7bbb) so a future edit can't silently
    drift them."""

    def test_default_constants(self):
        assert ARCH_RISE_FRAC_DEFAULT == pytest.approx(0.39)
        assert WAIST_WIDTH_FRAC_DEFAULT == pytest.approx(0.38)
        assert WAIST_HEIGHT_FRAC_DEFAULT == pytest.approx(0.55)
        assert BULGE_FRAC_DEFAULT == pytest.approx(0.169)
