"""T84 item 5: fb_engine.t14_sandtimer_geometry's own outline() + is_valid_outline(), tested
independently of Fusion (the JS production pipeline is exercised separately, by
tests/frame-template-14.test.js; this file is the Python side only, the same split t16_geometry.py's
own test_t16_geometry.py uses)."""
import math

import pytest

from fb_engine.t14_sandtimer_geometry import (
    BULGE_FRAC_DEFAULT, PINCH_HEIGHT_FRAC_DEFAULT, PINCH_REACH_FRAC_DEFAULT, TOP_WIDTH_FRAC_DEFAULT,
    is_valid_outline, outline,
)

SIZES = [(6.0, 9.0), (7.0, 9.0), (9.0, 12.0)]
T = 0.75
BBO = 0.25  # the diagram script's own boundingboxoffset -- outline() takes the already-subtracted
# safe-zone width/height (t16_geometry.py's own convention), the diagram's regionFor() does the
# subtraction itself (hw = W/2 - BBO); this file's own reference values below were measured by running
# the diagram's own buildSandTimer()/bulgeArc() against the RAW board sizes, so every outline() call
# here subtracts 2*BBO first to land on the exact same safe-zone input the diagram used.


def safe(W, H):
    return W - 2 * BBO, H - 2 * BBO


class TestDefaultOutlineIsValid:
    @pytest.mark.parametrize("W,H", SIZES)
    def test_defaults_are_valid(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T)
        assert o["upper_r_centre"] is not None  # confirms the arc path, not an accidental straight line
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

        arc_end(o["upper_r_centre"], o["upper_r_radius"], o["top_r"])
        arc_end(o["upper_r_centre"], o["upper_r_radius"], o["pinch_r"])
        arc_end(o["lower_r_centre"], o["lower_r_radius"], o["pinch_r"])
        arc_end(o["lower_r_centre"], o["lower_r_radius"], o["BR"])
        arc_end(o["lower_l_centre"], o["lower_l_radius"], o["BL"])
        arc_end(o["lower_l_centre"], o["lower_l_radius"], o["pinch_l"])
        arc_end(o["upper_l_centre"], o["upper_l_radius"], o["pinch_l"])
        arc_end(o["upper_l_centre"], o["upper_l_radius"], o["top_l"])
        # the loop as a whole, walked in travel order (upper_R, lower_R, base, lower_L, upper_L, top),
        # closes back on its own start point.
        loop = [o["top_r"], o["pinch_r"], o["BR"], o["BL"], o["pinch_l"], o["top_l"], o["top_r"]]
        assert loop[0] == loop[-1]


class TestUndercutGuard:
    """H23 item 63's own 'no arc past 180 deg' rule, ported to this module's own validity check -- same
    reasoning as t16_geometry.py's own TestUndercutGuard: the real failure mode is the sagitta reaching
    half the chord length, not the sweep angle directly (a sagitta-built arc's own minor-arc sweep is,
    by construction, always < 180 deg)."""

    def test_moderate_defaults_stay_well_under_180(self):
        w, h = safe(7.0, 9.0)
        o = outline(w, h, T)
        from fb_engine.t14_sandtimer_geometry import _arc_sweep_deg
        for key_c, key_r, p0, p1 in (
            ("upper_r_centre", "upper_r_radius", o["top_r"], o["pinch_r"]),
            ("lower_r_centre", "lower_r_radius", o["pinch_r"], o["BR"]),
        ):
            assert _arc_sweep_deg(o[key_c], o[key_r], p0, p1) < 140.0  # comfortably clear, not just <180

    def test_an_oversized_bulge_is_rejected_as_invalid(self):
        w, h = safe(7.0, 9.0)
        o = outline(w, h, T, bulge_frac=0.9)  # far beyond the declared app-side range, deliberately
        assert not is_valid_outline(o)

    def test_the_rejection_is_specifically_the_sag_vs_half_chord_check(self):
        """Proven non-vacuous both ways: the oversized bulge's own sag DOES exceed half its chord (the
        condition is_valid_outline actually checks), and the moderate default does NOT."""
        w, h = safe(7.0, 9.0)
        bad = outline(w, h, T, bulge_frac=0.9)
        chord = math.hypot(bad["BR"][0] - bad["pinch_r"][0], bad["BR"][1] - bad["pinch_r"][1])
        assert bad["bulge_sag"] >= chord / 2.0

        ok = outline(w, h, T)  # BULGE_FRAC_DEFAULT
        chord_ok = math.hypot(ok["BR"][0] - ok["pinch_r"][0], ok["BR"][1] - ok["pinch_r"][1])
        assert ok["bulge_sag"] < chord_ok / 2.0


class TestDegeneratesToAHexagonAtZeroBulge:
    """bulge_arc's own documented identity (bulge<=1e-9 -> every side a straight line) -- confirm the
    Python port preserves it exactly, the same way t16_geometry.py's own TestTulipDegeneratesToFunnel
    confirms its own degenerate case."""

    @pytest.mark.parametrize("W,H", SIZES)
    def test_zero_bulge_gives_no_arcs_at_all(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T, bulge_frac=0.0)
        assert o["upper_r_centre"] is None and o["lower_r_centre"] is None
        assert o["upper_l_centre"] is None and o["lower_l_centre"] is None
        assert is_valid_outline(o)  # a pinched hexagon is still a structurally valid outline

    @pytest.mark.parametrize("W,H", SIZES)
    def test_a_tiny_positive_bulge_gives_a_real_but_huge_radius_arc(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T, bulge_frac=1e-6)
        assert o["upper_r_centre"] is not None
        assert o["upper_r_radius"] > 1000  # a near-zero sagitta is a near-flat, very-large-radius arc


class TestMirrorSymmetry:
    @pytest.mark.parametrize("W,H", SIZES)
    def test_left_side_is_the_exact_x_mirror_of_the_right(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T)
        assert o["top_l"] == pytest.approx((-o["top_r"][0], o["top_r"][1]))
        assert o["pinch_l"] == pytest.approx((-o["pinch_r"][0], o["pinch_r"][1]))
        assert o["BL"] == pytest.approx((-o["BR"][0], o["BR"][1]))
        assert o["upper_l_radius"] == pytest.approx(o["upper_r_radius"])
        assert o["lower_l_radius"] == pytest.approx(o["lower_r_radius"])


class TestDefaultsMatchTheApprovedDiagram:
    """Pins the Fred-approved literal defaults (fb-app 5e0b5fa,
    tools/repro/f31_item1_sandtimer_diagram.mjs) so a future edit can't silently drift them. topWidth is
    the one NEW parameter this item adds (T84 item 4's shared-key convention) -- its default (1.0) is
    chosen to reproduce the diagram's own full-width top exactly, not pinned to the diagram script
    itself (which never had this handle)."""

    def test_default_constants(self):
        assert TOP_WIDTH_FRAC_DEFAULT == pytest.approx(1.0)
        assert PINCH_REACH_FRAC_DEFAULT == pytest.approx(0.6)
        assert BULGE_FRAC_DEFAULT == pytest.approx(0.14)
        assert PINCH_HEIGHT_FRAC_DEFAULT == pytest.approx(0.5)


class TestMatchesTheApprovedDiagramNumerically:
    """Cross-check against tools/repro/f31_item1_sandtimer_diagram.mjs's own buildSandTimer()/bulgeArc()
    at its own default (pinchReachFrac=0.6, bulgeFrac=0.14, pinchHeightFrac=0.5, topWidthFrac=1.0 i.e.
    not yet narrowed), measured by running that script's own functions directly (not re-derived by
    hand) at 3 board sizes -- the same discipline t16_geometry's own tests use to cross-check against
    its own JS diagram. The diagram's own y convention is flipped top/bottom relative to this module's
    y-UP board-local convention (Fusion's own, matching t16_geometry.py) -- confirmed immaterial by the
    sagitta construction having no inherent up/down bias; only pinch_r's y hits 0.0 either way since
    pinchHeightFrac=0.5 is the symmetric centre in both conventions."""

    REF = {
        (7.0, 9.0): dict(pinch_r=(1.3, 0.0), upper_r_centre=(-2.9778445423630076, 4.535128672378321), upper_r_radius=6.2343681318681305),
        (9.0, 12.0): dict(pinch_r=(1.7000000000000002, 0.0), upper_r_centre=(-4.351344340654309, 6.124074446724954), upper_r_radius=8.609474789915962),
        (6.0, 9.0): dict(pinch_r=(1.1, 0.0), upper_r_centre=(-4.186455973929038, 4.497682907525391), upper_r_radius=6.940876623376623),
    }

    @pytest.mark.parametrize("W,H", SIZES)
    def test_matches_the_diagram_script_exactly(self, W, H):
        w, h = safe(W, H)
        o = outline(w, h, T)
        ref = self.REF[(W, H)]
        assert o["pinch_r"] == pytest.approx(ref["pinch_r"], abs=1e-9)
        assert o["upper_r_centre"] == pytest.approx(ref["upper_r_centre"], abs=1e-9)
        assert o["upper_r_radius"] == pytest.approx(ref["upper_r_radius"], abs=1e-9)
