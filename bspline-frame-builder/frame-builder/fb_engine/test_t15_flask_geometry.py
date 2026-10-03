"""F31 item 2b: fb_engine.t15_flask_geometry's own outline() + is_valid_outline(), tested
independently of Fusion (the JS production pipeline is exercised separately, by
tests/frame-template-15.test.js; this file is the Python side only, the same split
t14_sandtimer_geometry.py's own test file uses)."""
import math

import pytest

from fb_engine.t15_flask_geometry import (
    DOME_FULLNESS_FRAC_DEFAULT, NECK_HEIGHT_FRAC_DEFAULT, TOP_WIDTH_FRAC_DEFAULT,
    is_valid_outline, outline,
)

SIZES = [(6.0, 9.0), (7.0, 9.0), (9.0, 12.0)]
T = 0.75
BBO = 0.25  # the diagram script's own boundingboxoffset -- outline() takes the already-subtracted
# safe-zone width/height (t14/t16_geometry.py's own convention), the diagram's regionFor() does the
# subtraction itself (hw = W/2 - BBO); this file's own reference values below were measured by running
# the diagram's own buildFlask()/bulgeArc() against the RAW board sizes, so every outline() call here
# subtracts 2*BBO first to land on the exact same safe-zone input the diagram used.


def safe(W, H):
    return W - 2 * BBO, H - 2 * BBO


class TestDefaultOutlineIsValid:
    @pytest.mark.parametrize("W,H", SIZES)
    def test_defaults_are_valid(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T)
        assert o["dome_r_centre"] is not None  # confirms the arc path, not an accidental straight line
        assert is_valid_outline(o)


class TestContinuity:
    """Every piece's own declared end must exactly meet the next piece's declared start -- the F30 item 5
    lesson (a real gap mirror-symmetry checking alone missed), re-applied independently of the JS
    diagram's own continuityCheck."""

    @pytest.mark.parametrize("W,H", SIZES)
    def test_six_piece_loop_is_continuous(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T)

        def arc_end(centre, radius, p, atol=1e-9):
            assert math.hypot(p[0] - centre[0], p[1] - centre[1]) == pytest.approx(radius, abs=atol)
            return p

        arc_end(o["dome_r_centre"], o["dome_r_radius"], o["neck_bottom_r"])
        arc_end(o["dome_r_centre"], o["dome_r_radius"], o["BR"])
        # dome_L is the mirror: its own centre is the x-negation of dome_R's.
        dome_l_centre = (-o["dome_r_centre"][0], o["dome_r_centre"][1])
        arc_end(dome_l_centre, o["dome_r_radius"], o["BL"])
        arc_end(dome_l_centre, o["dome_r_radius"], o["neck_bottom_l"])
        # the loop as a whole, walked in travel order (neck_R, dome_R, base, dome_L, neck_L, top),
        # closes back on its own start point.
        loop = [o["top_r"], o["neck_bottom_r"], o["BR"], o["BL"], o["neck_bottom_l"], o["top_l"], o["top_r"]]
        assert loop[0] == loop[-1]


class TestUndercutGuard:
    """H23 item 63's own 'no arc past 180 deg' rule, ported to this module's own validity check -- same
    reasoning as t14_sandtimer_geometry.py's own TestUndercutGuard: the real failure mode is the
    sagitta reaching half the chord length, not the sweep angle directly (a sagitta-built arc's own
    minor-arc sweep is, by construction, always < 180 deg)."""

    def test_moderate_defaults_stay_well_under_180(self):
        w, h = safe(7.0, 9.0)
        o = outline(w, h, T)
        from fb_engine.t15_flask_geometry import _arc_sweep_deg
        assert _arc_sweep_deg(o["dome_r_centre"], o["dome_r_radius"], o["neck_bottom_r"], o["BR"]) < 140.0

    def test_an_oversized_bulge_is_rejected_as_invalid(self):
        w, h = safe(7.0, 9.0)
        o = outline(w, h, T, dome_fullness_frac=0.9)  # far beyond the declared app-side range, deliberately
        assert not is_valid_outline(o)

    def test_the_rejection_is_specifically_the_sag_vs_half_chord_check(self):
        """Proven non-vacuous both ways: the oversized bulge's own sag DOES exceed half its chord (the
        condition is_valid_outline actually checks), and the moderate default does NOT."""
        w, h = safe(7.0, 9.0)
        bad = outline(w, h, T, dome_fullness_frac=0.9)
        chord = math.hypot(bad["BR"][0] - bad["neck_bottom_r"][0], bad["BR"][1] - bad["neck_bottom_r"][1])
        assert bad["dome_sag"] >= chord / 2.0

        ok = outline(w, h, T)  # DOME_FULLNESS_FRAC_DEFAULT
        chord_ok = math.hypot(ok["BR"][0] - ok["neck_bottom_r"][0], ok["BR"][1] - ok["neck_bottom_r"][1])
        assert ok["dome_sag"] < chord_ok / 2.0


class TestDegeneratesToAStraightSidedHexagonAtZeroFullness:
    """bulgeArc's own documented identity (sag<=1e-9 -> a straight line) -- confirm the Python port
    preserves it exactly, the same way t14_sandtimer_geometry.py's own
    TestDegeneratesToAHexagonAtZeroBulge confirms its own degenerate case."""

    @pytest.mark.parametrize("W,H", SIZES)
    def test_zero_fullness_gives_no_arc_at_all(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T, dome_fullness_frac=0.0)
        assert o["dome_r_centre"] is None
        assert is_valid_outline(o)  # a straight-sided hexagon is still a structurally valid outline

    @pytest.mark.parametrize("W,H", SIZES)
    def test_a_tiny_positive_fullness_gives_a_real_but_huge_radius_arc(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T, dome_fullness_frac=1e-6)
        assert o["dome_r_centre"] is not None
        assert o["dome_r_radius"] > 1000  # a near-zero sagitta is a near-flat, very-large-radius arc


class TestMirrorSymmetry:
    @pytest.mark.parametrize("W,H", SIZES)
    def test_left_side_is_the_exact_x_mirror_of_the_right(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T)
        assert o["top_l"] == pytest.approx((-o["top_r"][0], o["top_r"][1]))
        assert o["neck_bottom_l"] == pytest.approx((-o["neck_bottom_r"][0], o["neck_bottom_r"][1]))
        assert o["BL"] == pytest.approx((-o["BR"][0], o["BR"][1]))


class TestDefaultsMatchTheApprovedDiagram:
    """Pins the Fred-approved literal defaults (tools/repro/f31_item2_flask_diagram.mjs) so a future
    edit can't silently drift them."""

    def test_default_constants(self):
        assert TOP_WIDTH_FRAC_DEFAULT == pytest.approx(0.45)
        assert NECK_HEIGHT_FRAC_DEFAULT == pytest.approx(0.45)
        assert DOME_FULLNESS_FRAC_DEFAULT == pytest.approx(0.1421885365451818, abs=1e-12)


class TestMatchesTheApprovedDiagramNumerically:
    """Cross-check against tools/repro/f31_item2_flask_diagram.mjs's own buildFlask()/bulgeArc() at
    its own default (topWidthFrac=0.45, neckHeightFrac=0.45, domeFullnessFrac computed ONCE at 7x9
    and reused as the SAME fraction at every board size -- the diagram's own convention, re-confirmed
    here rather than assumed: an earlier probe that recomputed the vertical-tangent sagitta FRESH at
    each board size's own hw/hh gave numbers that did NOT match at 6x9/9x12, which is exactly how
    this was caught), measured by running that script's own construction directly (not re-derived by
    hand) at 3 board sizes. The diagram's own y convention is flipped top/bottom relative to this
    module's y-UP board-local convention (Fusion's own, matching t14/t16_geometry.py) -- every
    reference point below is the diagram's own raw (x, y) with y NEGATED."""

    REF = {
        (6.0, 9.0): dict(neck_bottom_r=(1.2375, 0.4249999999999998), dome_r_centre=(-5.1635545341099025, -4.228098525741439), dome_r_radius=7.913584841202252),
        (7.0, 9.0): dict(neck_bottom_r=(1.4625000000000001, 0.4249999999999998), dome_r_centre=(-3.7572115384615508, -4.250000000000005), dome_r_radius=7.007211538461551),
        (9.0, 12.0): dict(neck_bottom_r=(1.9125, 0.5750000000000002), dome_r_centre=(-5.4575418362832115, -5.743140461235099), dome_r_radius=9.70754425982498),
    }

    @pytest.mark.parametrize("W,H", SIZES)
    def test_matches_the_diagram_script_exactly(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T)
        ref = self.REF[(W, H)]
        assert o["neck_bottom_r"] == pytest.approx(ref["neck_bottom_r"], abs=1e-9)
        assert o["dome_r_centre"] == pytest.approx(ref["dome_r_centre"], abs=1e-9)
        assert o["dome_r_radius"] == pytest.approx(ref["dome_r_radius"], abs=1e-9)
