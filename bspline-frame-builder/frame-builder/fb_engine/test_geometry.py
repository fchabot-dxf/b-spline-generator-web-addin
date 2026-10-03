"""
H23 item 47: fb_engine/geometry.py's own `_create_point` -- a `Point` step may declare `SeedFrom`
(an already-built Line/Arc3Point's own left/right endpoint, chosen by actual x position) instead
of a literal `Points` value.

Installs the SAME minimal fake adsk.core/adsk.fusion BEFORE importing fb_engine.geometry (it
imports adsk at module level) -- the established stub-then-import idiom (test_inner_corners.py /
test_board_params_ownership.py).
"""
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


class _FakePoint3D:
    def __init__(self, x, y, z=0):
        self.x, self.y, self.z = x, y, z

    @classmethod
    def create(cls, x, y, z=0):
        return cls(x, y, z)


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
    adsk.core.Point3D = _FakePoint3D
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = adsk.core
    sys.modules["adsk.fusion"] = adsk.fusion
    sys.modules["adsk.cam"] = adsk.cam


_evict_shared_fb_engine_modules()
_install_fake_adsk()

import pytest  # noqa: E402

from fb_engine.build_context import BuildContext  # noqa: E402
from fb_engine import geometry  # noqa: E402


class FakeLogger:
    def __init__(self):
        self.entries = []

    def log(self, msg, level=None):
        self.entries.append((level, str(msg)))


class Vec2:
    def __init__(self, x, y):
        self.x, self.y = x, y


class FakePoint:
    def __init__(self, x, y):
        self.geometry = Vec2(x, y)


class FakeArc:
    """Stands in for a built SketchArc/SketchLine: only startSketchPoint/endSketchPoint matter
    to `_point_seed_from`."""
    def __init__(self, start_xy, end_xy):
        self.startSketchPoint = FakePoint(*start_xy)
        self.endSketchPoint = FakePoint(*end_xy)


class FakeSketchPoints:
    def __init__(self):
        self.added = []

    def add(self, p):
        self.added.append(p)
        return FakePoint(p.x, p.y)


class FakeSketch:
    def __init__(self):
        self.sketchPoints = FakeSketchPoints()


def _ctx():
    ctx = BuildContext.__new__(BuildContext)
    ctx.logger = FakeLogger()
    ctx.entity_map = {}
    ctx.feature_count = 0
    return ctx


S = 'template_10_2_shape_outline'


def test_seed_from_left_picks_the_smaller_x_endpoint_regardless_of_which_is_tagged_start():
    ctx = _ctx()
    # Fusion's own measured behavior (item 46): :E can physically be the LEFT point.
    ctx.entity_map[S] = {'top_edge': FakeArc(start_xy=(3.25, 2.76), end_xy=(-3.25, 2.76))}
    sketch = FakeSketch()
    geom = {'ID': 'top_S_anchor', 'Type': 'Point', 'Points': [{'SeedFrom': {'id': 'top_edge', 'side': 'left'}}]}
    entity = geometry._create_point(ctx, sketch, S, geom, 'top_S_anchor')
    assert (entity.geometry.x, entity.geometry.y) == (-3.25, 2.76)


def test_seed_from_right_picks_the_larger_x_endpoint():
    ctx = _ctx()
    ctx.entity_map[S] = {'top_edge': FakeArc(start_xy=(3.25, 2.76), end_xy=(-3.25, 2.76))}
    sketch = FakeSketch()
    geom = {'ID': 'top_E_anchor', 'Type': 'Point', 'Points': [{'SeedFrom': {'id': 'top_edge', 'side': 'right'}}]}
    entity = geometry._create_point(ctx, sketch, S, geom, 'top_E_anchor')
    assert (entity.geometry.x, entity.geometry.y) == (3.25, 2.76)


def test_seed_from_tracks_a_different_seed_not_just_the_default():
    """Not just correct at one geometry -- dragging archRise (a different seeded top_edge) must
    move the anchor WITH it, which is the entire point of item 47's own fix."""
    ctx = _ctx()
    ctx.entity_map[S] = {'top_edge': FakeArc(start_xy=(3.25, 4.0), end_xy=(-3.25, 4.0))}
    sketch = FakeSketch()
    s_anchor = geometry._create_point(
        ctx, sketch, S,
        {'ID': 'top_S_anchor', 'Points': [{'SeedFrom': {'id': 'top_edge', 'side': 'left'}}]}, 'top_S_anchor')
    assert (s_anchor.geometry.x, s_anchor.geometry.y) == (-3.25, 4.0)


def test_seed_from_missing_source_raises():
    ctx = _ctx()
    ctx.entity_map[S] = {}
    sketch = FakeSketch()
    geom = {'ID': 'top_S_anchor', 'Type': 'Point', 'Points': [{'SeedFrom': {'id': 'nonexistent', 'side': 'left'}}]}
    with pytest.raises(ValueError, match="nonexistent"):
        geometry._create_point(ctx, sketch, S, geom, 'top_S_anchor')


def test_without_seedfrom_still_resolves_a_literal_points_value():
    """Every OTHER template's Point steps must stay on the old, literal path -- SeedFrom is opt-in."""
    ctx = _ctx()
    ctx.design = types.SimpleNamespace(
        unitsManager=types.SimpleNamespace(evaluateExpression=lambda expr, unit: {'1.0': 1.0, '2.0': 2.0}[expr]))
    sketch = FakeSketch()
    geom = {'ID': 'plain_point', 'Type': 'Point', 'Points': [['1.0', '2.0']]}
    entity = geometry._create_point(ctx, sketch, S, geom, 'plain_point')
    assert (entity.geometry.x, entity.geometry.y) == (1.0, 2.0)
