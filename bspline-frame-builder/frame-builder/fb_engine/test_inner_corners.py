"""
H23 item 38: fb_engine/inner_corners.py::line_circle_corner_step.

A cusp-like corner where a LINE is tangent to a CIRCLE (T7's own eave), resolved LIVE from the
real built geometry -- a fake sketch/entity_map standing in for Fusion, matching the project's
own established BuildContext.__new__ + _RecLogger pattern (test_board_params_ownership.py).

Installs the SAME minimal fake adsk.core/adsk.fusion BEFORE importing fb_engine.build_context
(it imports adsk at module level) -- the established stub-then-import idiom
(test_board_params_ownership.py's own docstring; its _SHARED_ENGINE_MODULES already lists
fb_engine.inner_corners for exactly this). Explicit module list, not a prefix match -- pytest
registers THIS file itself as fb_engine.test_inner_corners, and a prefix match would evict the
in-progress import.
"""
import math
import os
import sys
import types

_HERE = os.path.dirname(os.path.realpath(__file__))
_FRAME_BUILDER_ROOT = os.path.dirname(_HERE)
if _FRAME_BUILDER_ROOT not in sys.path:
    sys.path.insert(0, _FRAME_BUILDER_ROOT)

_SHARED_ENGINE_MODULES = (
    "fb_engine", "fb_engine.build_context", "fb_engine.geometry",
    "fb_engine.constraints", "fb_engine.dimensions", "fb_engine.projections",
    "fb_engine.offsets", "fb_engine.miters", "fb_engine.fb_value_resolver",
    "fb_engine.parameter_schema", "fb_engine.diagnostics", "fb_engine.inner_corners",
    "fb_engine.document_discovery", "fb_engine.template_resolver",
    "fb_engine.timeline_order", "fb_engine.frame_engine", "fb_engine.parametric_engine",
    "fb_engine.template_factory", "fb_engine.frame_definition", "frame_engine", "parametric_engine",
)


def _evict_shared_fb_engine_modules():
    for name in _SHARED_ENGINE_MODULES:
        sys.modules.pop(name, None)


def _install_fake_adsk():
    adsk = types.ModuleType("adsk")
    adsk.core = types.ModuleType("adsk.core")
    adsk.fusion = types.ModuleType("adsk.fusion")
    adsk.cam = types.ModuleType("adsk.cam")

    class _FakeApp:
        @classmethod
        def get(cls):
            return types.SimpleNamespace(activeProduct=None)

    adsk.core.Application = _FakeApp
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = adsk.core
    sys.modules["adsk.fusion"] = adsk.fusion
    sys.modules["adsk.cam"] = adsk.cam


_evict_shared_fb_engine_modules()
_install_fake_adsk()

import pytest

from fb_engine.build_context import BuildContext
from fb_engine import inner_corners
from fb_engine.t7_roof_eave import roof_geometry, line_circle_corner, circle_circle_corner


class FakeLogger:
    def __init__(self):
        self.entries = []

    def log(self, msg, level=None):
        self.entries.append((level, str(msg)))

    def log_error(self, msg):
        self.entries.append(("ERROR", str(msg)))


def _ctx(evaluate=None):
    ctx = BuildContext.__new__(BuildContext)
    ctx.logger = FakeLogger()
    ctx.entity_map = {}
    ctx.feature_count = 0

    def _eval(expr, unit):
        if evaluate and expr in evaluate:
            return evaluate[expr]
        raise RuntimeError(f"no such parameter {expr!r}")

    ctx.design = types.SimpleNamespace(unitsManager=types.SimpleNamespace(evaluateExpression=_eval))
    return ctx


class Vec2:
    def __init__(self, x, y):
        self.x, self.y = x, y


class FakePoint:
    def __init__(self, x, y):
        self.geometry = Vec2(x, y)


class FakeArc:
    def __init__(self, cx, cy, r):
        self.geometry = types.SimpleNamespace(center=Vec2(cx, cy), radius=r)


class FakeSketch:
    """`sketchPoints` holds every candidate inner-corner SketchPoint the step must find the
    nearest of -- the entity_map's own far/near/arc entities are SEPARATE (a real roof line's own
    endpoints are not themselves inner-corner candidates)."""
    def __init__(self, candidate_points):
        pts = [FakePoint(x, y) for x, y in candidate_points]
        self.sketchPoints = types.SimpleNamespace(count=len(pts), item=lambda i: pts[i])


S = 'T7_3_frame_enclosure'


def _setup(far, near, arc_center, arc_radius, candidate_points, frame_thickness=0.75 * 2.54):
    ctx = _ctx({'frame_thickness': frame_thickness})
    ctx.entity_map[S] = {
        'proj_roof_R:S': FakePoint(*far),
        'proj_roof_R:E': FakePoint(*near),
        'proj_arc_neck_R': FakeArc(*arc_center, arc_radius),
    }
    sketch = FakeSketch(candidate_points)
    step = {
        'FrameThickness': 'frame_thickness',
        'Tolerance': 0.2,
        'Corners': {
            'eave_R': {'LineFarID': 'proj_roof_R:S', 'LineNearID': 'proj_roof_R:E',
                       'ArcID': 'proj_arc_neck_R', 'InnerID': 'inner_proj_arc_neck_R:S', 'Concave': True},
        },
    }
    return ctx, sketch, step


class TestLineCircleCornerStep:
    def test_resolves_the_true_corner_at_default_t7_proportions(self):
        # Cross-check against the already-proven eave_inner_corner (same board/thickness as
        # test_t7_roof_eave.py's own defaults) -- the live-reading step must land on the SAME
        # point when fed the SAME (default) geometry, in centimetres.
        from fb_engine.t7_geometry import t7_outline
        W, H, T = 6.5, 8.5, 0.75
        outline = t7_outline(W, H, T)
        g = roof_geometry(W, H)
        peak_in, E_in = g['peak'], g['E']
        e_in_expected_in = line_circle_corner(peak_in, E_in, (g['cx'], H * 0.5), T,
                                               outline['C_neck'], outline['r_neck'], concave=True)
        CM = 2.54
        far_cm = (peak_in[0] * CM, peak_in[1] * CM)
        near_cm = (E_in[0] * CM, E_in[1] * CM)
        center_cm = (outline['C_neck'][0] * CM, outline['C_neck'][1] * CM)
        radius_cm = outline['r_neck'] * CM
        expected_cm = (e_in_expected_in[0] * CM, e_in_expected_in[1] * CM)

        # the ONE real candidate point sits exactly at the expected position; a few decoys nearby
        decoys = [(expected_cm[0] + 1.0, expected_cm[1]), (expected_cm[0], expected_cm[1] - 1.0)]
        ctx, sketch, step = _setup(far_cm, near_cm, center_cm, radius_cm,
                                    candidate_points=[expected_cm] + decoys, frame_thickness=T * CM)

        inner_corners.line_circle_corner_step(ctx, sketch, S, step)

        resolved = ctx.entity_map[S].get('inner_proj_arc_neck_R:S')
        assert resolved is not None
        assert resolved.geometry.x == pytest.approx(expected_cm[0], abs=1e-6)
        assert resolved.geometry.y == pytest.approx(expected_cm[1], abs=1e-6)

    def test_a_DIFFERENT_neck_circle_than_default_still_resolves_correctly(self):
        # H23 item 38's own regression: the real (seeded) neck circle is NOT the default one.
        # Pick an arbitrary, clearly-non-default circle and confirm the step still lands on it --
        # proving this is a genuine LIVE read, not a disguised default-proportions computation.
        far_cm, near_cm = (0.0, 20.0), (8.0, 12.0)  # an arbitrary line, far != default peak/E
        center_cm, radius_cm = (3.0, 3.0), 2.0
        frame_thickness_cm = 1.905  # 0.75 in
        expected_cm = line_circle_corner(far_cm, near_cm, (0.0, 0.0), frame_thickness_cm,
                                          center_cm, radius_cm, concave=True)
        ctx, sketch, step = _setup(far_cm, near_cm, center_cm, radius_cm,
                                    candidate_points=[expected_cm, (0, 0), (100, 100)],
                                    frame_thickness=frame_thickness_cm)

        inner_corners.line_circle_corner_step(ctx, sketch, S, step)

        resolved = ctx.entity_map[S].get('inner_proj_arc_neck_R:S')
        assert resolved is not None
        assert resolved.geometry.x == pytest.approx(expected_cm[0], abs=1e-6)
        assert resolved.geometry.y == pytest.approx(expected_cm[1], abs=1e-6)

    def test_no_candidate_within_tolerance_logs_a_warning_and_sets_nothing(self):
        far_cm, near_cm = (0.0, 20.0), (8.0, 12.0)
        center_cm, radius_cm = (3.0, 3.0), 2.0
        ctx, sketch, step = _setup(far_cm, near_cm, center_cm, radius_cm,
                                    candidate_points=[(500.0, 500.0)])  # nowhere near the true corner

        inner_corners.line_circle_corner_step(ctx, sketch, S, step)

        assert ctx.entity_map[S].get('inner_proj_arc_neck_R:S') is None
        assert any(level == 'WARNING' and 'no SketchPoint within' in msg for level, msg in ctx.logger.entries)

    def test_missing_entity_map_reference_logs_a_warning_not_a_crash(self):
        ctx = _ctx({'frame_thickness': 1.905})
        ctx.entity_map[S] = {}  # nothing registered at all
        sketch = FakeSketch([(0, 0)])
        step = {
            'Corners': {
                'eave_R': {'LineFarID': 'proj_roof_R:S', 'LineNearID': 'proj_roof_R:E',
                           'ArcID': 'proj_arc_neck_R', 'InnerID': 'inner_proj_arc_neck_R:S', 'Concave': True},
            },
        }
        inner_corners.line_circle_corner_step(ctx, sketch, S, step)  # must not raise
        assert any(level == 'WARNING' for level, _msg in ctx.logger.entries)


class TestSquareCornerShortSideCollapsed:
    """H23 item 63 (live, T1 cornerRadiusTop max, 7x9): the horn at TR is shorter than
    frame_thickness, so the inward offset drops its copy and the real inner corner sits ON the
    inner top edge, slid 0.074 cm along it from (outer - t, outer - t) -- past the 0.05 tolerance,
    so the miter used to MISS and two bars merged."""

    T = 0.75 * 2.54

    def _run(self, candidates):
        ctx = _ctx({'frame_thickness': self.T})
        ctx.entity_map[S] = {'proj_horn_TR:S': FakePoint(8.255, 10.795)}
        step = {'Distance': 'frame_thickness', 'Tolerance': 0.05,
                'Corners': {'TR': {'OuterID': 'proj_horn_TR:S', 'InnerID': 'inner_proj_horn_TR:S',
                                   'Direction': (-1, -1)}}}
        inner_corners.inner_corner_step(ctx, FakeSketch(candidates), S, step)
        return ctx

    def test_point_slid_along_the_surviving_edge_is_resolved(self):
        ctx = self._run([(6.276, 8.890), (5.9, 7.1)])
        got = ctx.entity_map[S].get('inner_proj_horn_TR:S')
        assert got is not None
        assert (round(got.geometry.x, 3), round(got.geometry.y, 3)) == (6.276, 8.890)

    def test_exact_corner_still_preferred(self):
        ctx = self._run([(6.350, 8.890), (6.276, 8.890)])
        got = ctx.entity_map[S]['inner_proj_horn_TR:S']
        assert round(got.geometry.x, 3) == 6.350

    def test_point_off_both_axis_lines_is_still_rejected(self):
        ctx = self._run([(6.25, 8.80)])
        assert 'inner_proj_horn_TR:S' not in ctx.entity_map[S]

    def test_point_slid_far_along_the_edge_is_resolved(self):
        # T2 neckLength max: the inner bottom edge ends 2.85 cm along it (1.5 t)
        ctx = self._run([(6.350 - 2.85, 8.890)])
        assert 'inner_proj_horn_TR:S' in ctx.entity_map[S]

    def test_point_slid_further_than_three_frame_thicknesses_is_rejected(self):
        ctx = self._run([(6.350 - 3 * self.T - 0.1, 8.890)])
        assert 'inner_proj_horn_TR:S' not in ctx.entity_map[S]


class TestLineCircleCornerLineCollapsed:
    """H23 item 63 (live, T10 waistCenterY min): the horn is shorter than frame_thickness, so the
    inner corner sits further round the arch's offset circle, past the 0.2 cm tolerance."""

    T = 0.75 * 2.54

    def _run(self, candidates):
        ctx = _ctx({'frame_thickness': self.T})
        # arch: convex, centre (0, 0), radius 10; horn from (8, 2) up to the tangent-ish point (8, 6)
        ctx.entity_map[S] = {'proj_horn_TR:E': FakePoint(8.0, 2.0), 'proj_horn_TR:S': FakePoint(8.0, 6.0),
                             'proj_top_edge': FakeArc(0.0, 0.0, 10.0)}
        step = {'FrameThickness': 'frame_thickness', 'Tolerance': 0.2,
                'Corners': {'TR': {'LineFarID': 'proj_horn_TR:E', 'LineNearID': 'proj_horn_TR:S',
                                   'ArcID': 'proj_top_edge', 'InnerID': 'inner_proj_horn_TR:S', 'Concave': False}}}
        inner_corners.line_circle_corner_step(ctx, FakeSketch(candidates), S, step)
        return ctx

    def _expected(self):
        return line_circle_corner((8.0, 2.0), (8.0, 6.0), (0.0, 0.0), self.T, (0.0, 0.0), 10.0, concave=False)

    def test_point_further_round_the_offset_circle_is_resolved(self):
        import math
        ex, ey = self._expected()
        r_in = 10.0 - self.T
        a = math.atan2(ey, ex) + 0.08  # ~0.65 cm further round the inner circle
        cand = (r_in * math.cos(a), r_in * math.sin(a))
        ctx = self._run([cand, (0.0, 0.0)])
        got = ctx.entity_map[S].get('inner_proj_horn_TR:S')
        assert got is not None and abs(got.geometry.x - cand[0]) < 1e-9

    def test_point_off_the_offset_circle_is_rejected(self):
        ex, ey = self._expected()
        ctx = self._run([(ex - 0.5, ey - 0.5)])
        assert 'inner_proj_horn_TR:S' not in ctx.entity_map[S]


class _Attr:
    def __init__(self, v):
        self.value = v


class _FakeCurve:
    def __init__(self, cid, a, b):
        self.attributes = types.SimpleNamespace(itemByName=lambda g, n: _Attr(cid) if cid else None)
        self.startSketchPoint, self.endSketchPoint = FakePoint(*a), FakePoint(*b)


class TestSquareCornerWholeRunCollapsed:
    """H23 item 63 (live, T5 waistCenterY min): top edge, horn and shoulder arc all vanish in the
    offset; the inner corner is where two inner arcs meet, 1.83 cm away, on neither axis line."""

    T = 0.75 * 2.54

    def _run(self, curves, points):
        ctx = _ctx({'frame_thickness': self.T})
        ctx.entity_map[S] = {'proj_horn_TR:S': FakePoint(8.255, 10.795)}
        sk = FakeSketch(points)
        sk.sketchCurves = curves
        step = {'Distance': 'frame_thickness', 'Tolerance': 0.05,
                'Corners': {'TR': {'OuterID': 'proj_horn_TR:S', 'InnerID': 'inner_proj_horn_TR:S',
                                   'Direction': (-1, -1)}}}
        inner_corners.inner_corner_step(ctx, sk, S, step)
        return ctx

    def test_inner_loop_vertex_is_resolved(self):
        curves = [_FakeCurve('inner_proj_arc_top_shoulder_R', (4.528, 8.774), (3.508, 8.541)),
                  _FakeCurve('inner_proj_arc_waist_R', (4.528, 8.774), (6.350, 2.980))]
        ctx = self._run(curves, [(4.528, 8.774), (3.508, 8.541)])
        got = ctx.entity_map[S].get('inner_proj_horn_TR:S')
        assert got is not None and (round(got.geometry.x, 3), round(got.geometry.y, 3)) == (4.528, 8.774)

    def test_outer_points_never_qualify(self):
        curves = [_FakeCurve('proj_top_edge_R', (5.946, 10.795), (8.255, 10.795))]
        ctx = self._run(curves, [(5.946, 10.795)])
        assert 'inner_proj_horn_TR:S' not in ctx.entity_map[S]


def _setup_cc(c1, r1, c2, r2, outer, candidate_points, frame_thickness=0.75 * 2.54,
              concave1=False, concave2=True):
    ctx = _ctx({'frame_thickness': frame_thickness})
    ctx.entity_map[S] = {
        'proj_arch': FakeArc(*c1, r1),
        'proj_upper_R': FakeArc(*c2, r2),
        'proj_arch:S': FakePoint(*outer),
    }
    sketch = FakeSketch(candidate_points)
    step = {
        'FrameThickness': 'frame_thickness',
        'Tolerance': 0.2,
        'Corners': {
            'topR': {'Arc1ID': 'proj_arch', 'Arc2ID': 'proj_upper_R', 'OuterID': 'proj_arch:S',
                     'InnerID': 'inner_proj_arch:S', 'Concave1': concave1, 'Concave2': concave2},
        },
    }
    return ctx, sketch, step


class TestCircleCircleCornerStep:
    """T84 item 3: fb_engine/inner_corners.py::circle_circle_corner_step -- the arc-meets-arc
    sibling of TestLineCircleCornerStep above, same fake-sketch harness, needed by T17 Tulip's own
    concave-upper-side corners (neither piece there is a straight line)."""

    def test_resolves_the_true_corner_from_two_known_offset_circles(self):
        # Same known construction as test_t7_roof_eave.TestCircleCircleCorner's own off-axis case:
        # P sits exactly on both offset circles by construction.
        P = (5.0, 4.0)
        c1, c2 = (1.0, 1.0), (10.0, 2.0)
        r1_in = ((P[0] - c1[0]) ** 2 + (P[1] - c1[1]) ** 2) ** 0.5
        r2_in = ((P[0] - c2[0]) ** 2 + (P[1] - c2[1]) ** 2) ** 0.5
        t = 1.905  # 0.75 in, in cm
        r1, r2 = r1_in + t, r2_in - t  # concave1=False (+t), concave2=True (-t)
        expected = circle_circle_corner(c1, r1, False, c2, r2, True, t, outer_corner=P)

        # the ONE real candidate point sits exactly at the expected position; a decoy nearby
        decoy = (expected[0] + 1.0, expected[1])
        ctx, sketch, step = _setup_cc(c1, r1, c2, r2, P, candidate_points=[expected, decoy],
                                       frame_thickness=t, concave1=False, concave2=True)

        inner_corners.circle_circle_corner_step(ctx, sketch, S, step)

        resolved = ctx.entity_map[S].get('inner_proj_arch:S')
        assert resolved is not None
        assert resolved.geometry.x == pytest.approx(expected[0], abs=1e-6)
        assert resolved.geometry.y == pytest.approx(expected[1], abs=1e-6)

    def test_no_candidate_within_tolerance_logs_a_warning_and_sets_nothing(self):
        ctx, sketch, step = _setup_cc((0.0, 0.0), 6.0, (8.0, 0.0), 6.0, (4.0, 10.0),
                                       candidate_points=[(500.0, 500.0)], frame_thickness=1.0,
                                       concave1=False, concave2=False)
        inner_corners.circle_circle_corner_step(ctx, sketch, S, step)
        assert ctx.entity_map[S].get('inner_proj_arch:S') is None
        assert any(level == 'WARNING' and 'no SketchPoint within' in msg for level, msg in ctx.logger.entries)

    def test_missing_entity_map_reference_logs_a_warning_not_a_crash(self):
        ctx = _ctx({'frame_thickness': 1.905})
        ctx.entity_map[S] = {}  # nothing registered at all
        sketch = FakeSketch([(0, 0)])
        step = {
            'Corners': {
                'topR': {'Arc1ID': 'proj_arch', 'Arc2ID': 'proj_upper_R', 'OuterID': 'proj_arch:S',
                         'InnerID': 'inner_proj_arch:S', 'Concave1': False, 'Concave2': True},
            },
        }
        inner_corners.circle_circle_corner_step(ctx, sketch, S, step)  # must not raise
        assert any(level == 'WARNING' for level, _msg in ctx.logger.entries)

    def test_no_intersection_falls_back_to_searching_near_the_outer_corner_not_a_crash(self):
        # Two circles whose offsets don't reach each other at all -- circle_circle_corner itself
        # raises ValueError; the step must catch it and keep searching (around outer_corner),
        # not propagate the exception.
        ctx, sketch, step = _setup_cc((0.0, 0.0), 1.0, (100.0, 0.0), 1.0, (0.0, 0.0),
                                       candidate_points=[(500.0, 500.0)], frame_thickness=0.1,
                                       concave1=False, concave2=False)
        inner_corners.circle_circle_corner_step(ctx, sketch, S, step)  # must not raise
        assert ctx.entity_map[S].get('inner_proj_arch:S') is None
        assert any(level == 'WARNING' and 'no SketchPoint within' in msg for level, msg in ctx.logger.entries)


class TestCircleCircleCornerOffsetCircleCollapsed:
    """H23 item 63-style fallback, ported from TestLineCircleCornerLineCollapsed to the
    circle-circle resolver (advisor-directed 2026-10-03: give ResolveCircleCircleCorner the same
    live fallback tiers its siblings have, ahead of the live matrix sweep). Known construction: P
    sits exactly on both offset circles; the candidate SketchPoint instead sits further ROUND
    circle 1's own offset circle (past the base Tolerance but within 2 x frame_thickness)."""

    def _expected(self):
        c1, c2 = (1.0, 1.0), (10.0, 2.0)
        P = (5.0, 4.0)
        r1_in = math.hypot(P[0] - c1[0], P[1] - c1[1])
        r2_in = math.hypot(P[0] - c2[0], P[1] - c2[1])
        t = 1.905
        r1, r2 = r1_in + t, r2_in - t  # concave1=False (+t), concave2=True (-t)
        return c1, r1, c2, r2, t, circle_circle_corner(c1, r1, False, c2, r2, True, t, outer_corner=P)

    def test_point_further_round_one_offset_circle_is_resolved(self):
        c1, r1, c2, r2, t, (ex, ey) = self._expected()
        r1_in = r1 - t  # concave1=False
        a = math.atan2(ey - c1[1], ex - c1[0]) + 0.15  # ~0.75 cm further round circle 1's own offset
        cand = (c1[0] + r1_in * math.cos(a), c1[1] + r1_in * math.sin(a))
        ctx, sketch, step = _setup_cc(c1, r1, c2, r2, (ex, ey), candidate_points=[cand, (0.0, 0.0)],
                                       frame_thickness=t, concave1=False, concave2=True)
        inner_corners.circle_circle_corner_step(ctx, sketch, S, step)
        got = ctx.entity_map[S].get('inner_proj_arch:S')
        assert got is not None and abs(got.geometry.x - cand[0]) < 1e-9

    def test_point_off_both_offset_circles_is_still_rejected(self):
        c1, r1, c2, r2, t, (ex, ey) = self._expected()
        ctx, sketch, step = _setup_cc(c1, r1, c2, r2, (ex, ey), candidate_points=[(ex - 0.5, ey - 0.5)],
                                       frame_thickness=t, concave1=False, concave2=True)
        inner_corners.circle_circle_corner_step(ctx, sketch, S, step)
        assert 'inner_proj_arch:S' not in ctx.entity_map[S]


class TestCircleCircleCornerWholeRunCollapsed:
    """H23 item 63-style fallback, ported from TestSquareCornerWholeRunCollapsed: when the whole
    corner run collapses in the offset, fall back to the nearest vertex of the inner loop itself
    (an 'inner_*'-tagged curve endpoint), within 1.5 x frame_thickness. Outer points never
    qualify."""

    def _run(self, curves, points, frame_thickness=1.905):
        ctx, _sketch, step = _setup_cc((0.0, 0.0), 6.0, (8.0, 0.0), 6.0, (4.0, 10.0),
                                        candidate_points=points, frame_thickness=frame_thickness,
                                        concave1=False, concave2=False)
        sk = FakeSketch(points)
        sk.sketchCurves = curves
        inner_corners.circle_circle_corner_step(ctx, sk, S, step)
        return ctx

    def test_inner_loop_vertex_is_resolved(self):
        # expected intersection (r1=r2=6, concave=False both, t=1.905): e_in = (4.0, 0.877) --
        # computed directly, not guessed. Place an inner-loop vertex 1.5 cm away (past the base
        # Tolerance=0.2 and off both offset circles, within 1.5 x frame_thickness = 2.8575 cm).
        v = (5.5, 0.8769407049510242)
        curves = [_FakeCurve('inner_proj_arch', v, (3.5, 3.8)),
                  _FakeCurve('inner_proj_upper_R', v, (6.0, 4.0))]
        ctx = self._run(curves, [v, (3.5, 3.8)])
        got = ctx.entity_map[S].get('inner_proj_arch:S')
        assert got is not None and (round(got.geometry.x, 3), round(got.geometry.y, 3)) == (round(v[0], 3), round(v[1], 3))

    def test_outer_points_never_qualify(self):
        curves = [_FakeCurve('proj_upper_R', (5.5, 0.8769407049510242), (6.0, 4.0))]
        ctx = self._run(curves, [(5.5, 0.8769407049510242)])
        assert 'inner_proj_arch:S' not in ctx.entity_map[S]
