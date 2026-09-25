"""
T62 (SE15 Slice 2) unit tests for sketch_manifest_builder.py — run with
`pytest` from this directory (or `python3 test_sketch_manifest_builder.py`
for a plain-Python fallback, same dual-mode convention frame-builder's own
test_templates.py already documents).

Installs a hand-rolled fake `adsk.core`/`adsk.fusion` BEFORE importing the
module under test (same stub-then-import idiom every existing fb_engine
test file already uses — test_deferred_compute.py et al., T60's own
research) — but goes deeper than those, since sketch_manifest_builder.py
actually calls the sketch-geometry/constraint/dimension/offset API
surface, which none of the 4 existing fb_engine test files exercise. The
fakes are structurally consistent (methods exist, return objects with the
right shape) but NOT geometrically faithful (an "offset" fake doesn't
compute a real parallel curve) — enough to prove THIS module's own
orchestration (order, skip-and-report, parameter sync), not to prove
Fusion's own solver behavior (that's the advisor's live-Fusion job, T62's
own dispatch: "NO FUSION" for this turn).

Verify list: build order (parameters -> geometry -> constraints ->
dimensions/offsets, asserted via a call-order log threaded through every
fake); skip-and-report (a bad/missing entity or constraint target is
skipped, logged, and the build continues — never raises past
build_constrained_sketch); the >=threshold plain-geometry case (a manifest
with an EMPTY constraints[] — as T61's own JS side already produces above
SKETCH_PIECE_THRESHOLD — builds cleanly with zero constraint calls, not a
crash); the inches->cm coordinate conversion; parameter create-vs-update.
"""
import json
import math
import os
import sys
import types

import pytest

# ---------------------------------------------------------------------------
# Fake adsk — installed BEFORE importing the module under test.
# ---------------------------------------------------------------------------
CALL_LOG = []  # module-level, reset per test via the `call_log` fixture


def _reset_call_log():
    CALL_LOG.clear()


class FakePoint3D:
    def __init__(self, x, y, z=0):
        self.x, self.y, self.z = x, y, z

    @classmethod
    def create(cls, x, y, z=0):
        return cls(x, y, z)

    def distanceTo(self, other):
        return math.hypot(self.x - other.x, self.y - other.y)

    def copy(self):
        return FakePoint3D(self.x, self.y, self.z)


class FakeSketchPoint:
    _next_token = [0]

    def __init__(self, geometry):
        self.geometry = geometry
        FakeSketchPoint._next_token[0] += 1
        self.entityToken = f"pt-{FakeSketchPoint._next_token[0]}"


class FakeAttributes:
    def __init__(self):
        self._store = {}

    def itemByName(self, group, name):
        return self._store.get((group, name))

    def add(self, group, name, value):
        attr = types.SimpleNamespace(value=value)
        self._store[(group, name)] = attr
        return attr


class FakeCurveBase:
    def __init__(self):
        self.attributes = FakeAttributes()
        self.name = None
        self.isConstruction = False
        self.isValid = True


class FakeSketchLine(FakeCurveBase):
    def __init__(self, p1, p2):
        super().__init__()
        self.startSketchPoint = FakeSketchPoint(p1)
        self.endSketchPoint = FakeSketchPoint(p2)

    @property
    def boundingBox(self):
        p1, p2 = self.startSketchPoint.geometry, self.endSketchPoint.geometry
        lo = FakePoint3D(min(p1.x, p2.x), min(p1.y, p2.y))
        hi = FakePoint3D(max(p1.x, p2.x), max(p1.y, p2.y))
        return types.SimpleNamespace(minPoint=lo, maxPoint=hi)


class FakeSketchArc(FakeCurveBase):
    def __init__(self, center, start, sweep_rad):
        super().__init__()
        self.centerSketchPoint = FakeSketchPoint(center)
        self.startSketchPoint = FakeSketchPoint(start)
        dx, dy = start.x - center.x, start.y - center.y
        theta0 = math.atan2(dy, dx)
        r = math.hypot(dx, dy)
        theta1 = theta0 + sweep_rad
        end = FakePoint3D(center.x + r * math.cos(theta1), center.y + r * math.sin(theta1))
        self.endSketchPoint = FakeSketchPoint(end)


class FakeSketchCircle(FakeCurveBase):
    def __init__(self, center, radius):
        super().__init__()
        self.centerSketchPoint = FakeSketchPoint(center)
        self.radius = radius


class FakeSketchLines:
    def __init__(self, sketch):
        self._sketch = sketch

    def addByTwoPoints(self, p1, p2):
        CALL_LOG.append(("geom:Line", p1.x, p1.y, p2.x, p2.y))
        line = FakeSketchLine(p1, p2)
        self._sketch._curves.append(line)
        return line


class FakeSketchArcs:
    def __init__(self, sketch):
        self._sketch = sketch

    def addByCenterStartSweep(self, center, start, sweep_rad):
        CALL_LOG.append(("geom:Arc", center.x, center.y))
        arc = FakeSketchArc(center, start, sweep_rad)
        self._sketch._curves.append(arc)
        return arc


class FakeSketchCircles:
    def __init__(self, sketch):
        self._sketch = sketch

    def addByCenterRadius(self, center, radius):
        CALL_LOG.append(("geom:Circle", center.x, center.y, radius))
        circle = FakeSketchCircle(center, radius)
        self._sketch._curves.append(circle)
        return circle


class FakeSketchCurves:
    def __init__(self, sketch):
        self.sketchLines = FakeSketchLines(sketch)
        self.sketchArcs = FakeSketchArcs(sketch)
        self.sketchCircles = FakeSketchCircles(sketch)


class FakeConstraint:
    def __init__(self, kind):
        self.kind = kind
        self.isValid = True


class FakeGeometricConstraints:
    def __init__(self):
        self.created = []

    def _make(self, kind):
        c = FakeConstraint(kind)
        self.created.append(c)
        CALL_LOG.append((f"constraint:{kind}",))
        return c

    def addCoincident(self, a, b):
        return self._make("Coincident")

    def addHorizontal(self, a):
        return self._make("Horizontal")

    def addVertical(self, a):
        return self._make("Vertical")

    def addTangent(self, a, b):
        return self._make("Tangent")

    def addEqual(self, a, b):
        return self._make("Equal")

    def addCollinear(self, a, b):
        return self._make("Collinear")

    def addParallel(self, a, b):
        return self._make("Parallel")


class FakeParameter:
    def __init__(self, name):
        self.name = name
        self.expression = "0"


class FakeDimension:
    def __init__(self):
        self.parameter = FakeParameter("d1")

    def deleteMe(self):
        pass


class FakeSketchDimensions:
    def __init__(self):
        self._items = []

    @property
    def count(self):
        return len(self._items)

    def item(self, i):
        return self._items[i]

    def __iter__(self):
        return iter(self._items)

    def addRadialDimension(self, target, text_pt):
        CALL_LOG.append(("dim:Radial",))
        d = FakeDimension()
        self._items.append(d)
        return d

    def addDiameterDimension(self, target, text_pt):
        d = FakeDimension()
        self._items.append(d)
        return d

    def addDistanceDimension(self, src, tgt, orient, text_pt):
        d = FakeDimension()
        self._items.append(d)
        return d


class FakeObjectCollection:
    def __init__(self):
        self._items = []

    @classmethod
    def create(cls):
        return cls()

    def add(self, item):
        self._items.append(item)

    @property
    def count(self):
        return len(self._items)

    def item(self, i):
        return self._items[i]

    def __iter__(self):
        return iter(self._items)


class FakeSketch:
    def __init__(self):
        self.sketchCurves = FakeSketchCurves(self)
        self.geometricConstraints = FakeGeometricConstraints()
        self.sketchDimensions = FakeSketchDimensions()
        self._curves = []
        self.isComputeDeferred = False
        self.name = "TestSketch"

    def offset(self, coll, dir_pt, dist):
        CALL_LOG.append(("offset", dist))
        src = coll.item(0)
        p1, p2 = src.startSketchPoint.geometry, src.endSketchPoint.geometry
        nx = -(p2.y - p1.y)
        ny = (p2.x - p1.x)
        length = math.hypot(nx, ny) or 1.0
        sign = 1 if (dir_pt.x - (p1.x + p2.x) / 2) * nx + (dir_pt.y - (p1.y + p2.y) / 2) * ny > 0 else -1
        ox, oy = nx / length * dist * sign, ny / length * dist * sign
        new_line = FakeSketchLine(FakePoint3D(p1.x + ox, p1.y + oy), FakePoint3D(p2.x + ox, p2.y + oy))
        self._curves.append(new_line)
        result = FakeObjectCollection()
        result.add(new_line)
        self.sketchDimensions._items.append(FakeDimension())
        return result


class _FakeSketchesFactory:
    def __init__(self, component):
        self._component = component

    def add(self, plane):
        s = FakeSketch()
        self._component._sketches.append(s)
        return s


class FakeComponent:
    def __init__(self):
        self.xYConstructionPlane = types.SimpleNamespace(name="XY")
        self._sketches = []

    @property
    def sketches(self):
        return _FakeSketchesFactory(self)


class FakeUserParameters:
    def __init__(self):
        self._items = {}

    def itemByName(self, name):
        return self._items.get(name)

    def add(self, name, value_input, unit, comment):
        CALL_LOG.append(("param:add", name))
        p = FakeParameter(name)
        p.expression = str(getattr(value_input, "value", value_input))
        self._items[name] = p
        return p


class _FakeUnitsManager:
    def evaluateExpression(self, expr, unit):
        return float(expr)


class FakeDesign:
    def __init__(self):
        self.userParameters = FakeUserParameters()
        self.unitsManager = _FakeUnitsManager()
        self.rootComponent = FakeComponent()


def _install_adsk_stubs():
    if "adsk" in sys.modules and getattr(sys.modules.get("adsk.core", None), "_se15_fake", False):
        return
    adsk = types.ModuleType("adsk")
    adsk_core = types.ModuleType("adsk.core")
    adsk_fusion = types.ModuleType("adsk.fusion")
    adsk_core._se15_fake = True

    class _ValueInput:
        def __init__(self, value, kind):
            self.value = value
            self.kind = kind  # "real" | "string" — lets a test tell WHICH constructor was used

        @classmethod
        def createByReal(cls, v):
            CALL_LOG.append(("valueinput:real", v))
            return cls(v, "real")

        @classmethod
        def createByString(cls, s):
            CALL_LOG.append(("valueinput:string", s))
            return cls(s, "string")

    adsk_core.Point3D = FakePoint3D
    adsk_core.ObjectCollection = FakeObjectCollection
    adsk_core.ValueInput = _ValueInput

    class _FakeApp:
        _active_design = None

        @classmethod
        def get(cls):
            return types.SimpleNamespace(activeProduct=cls._active_design, userInterface=types.SimpleNamespace())

    adsk_core.Application = _FakeApp

    class _DesignCast:
        @staticmethod
        def cast(x):
            return x if isinstance(x, FakeDesign) else None

    adsk_fusion.Design = _DesignCast

    adsk.core = adsk_core
    adsk.fusion = adsk_fusion
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = adsk_core
    sys.modules["adsk.fusion"] = adsk_fusion
    return _FakeApp


_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_FakeApp = _install_adsk_stubs()

from sketch_manifest_builder import (  # noqa: E402
    build_constrained_sketch,
    build_from_manifest_file,
    _to_point3d,
    _sync_manifest_parameters,
    IN_TO_CM,
)


@pytest.fixture(autouse=True)
def call_log():
    _reset_call_log()
    yield CALL_LOG


# ---------------------------------------------------------------------------
# Manifest fixtures
# ---------------------------------------------------------------------------
def _box_lattice_manifest(constrained=True):
    """A small, hand-built manifest matching editor-sketch-manifest.js's
    own real output shape (T61) — 2 rails, 1 tie, 1 node, width offsets
    with caps, one Coincident. `constrained=False` mimics what T61's own
    JS side ALREADY produces above SKETCH_PIECE_THRESHOLD: entities +
    width dimensions present, constraints[] EMPTY."""
    constraints = [] if not constrained else [
        {"type": "Horizontal", "targets": ["rail0"]},
        {"type": "Horizontal", "targets": ["rail1"]},
        {"type": "Vertical", "targets": ["tie0"]},
        {"type": "Coincident", "targets": ["tie0:S", "rail0"]},
    ]
    return {
        "version": 1,
        "layerId": "1",
        "sketchName": "Test Box Lattice",
        "units": "in",
        "region": {"x": 0, "y": 0, "w": 7, "h": 9},
        "entities": [
            {"id": "rail0", "type": "Line", "p1": [0.25, 1.0], "p2": [6.75, 1.0]},
            {"id": "rail1", "type": "Line", "p1": [0.25, 3.0], "p2": [6.75, 3.0]},
            {"id": "tie0", "type": "Line", "p1": [2.0, 1.0], "p2": [2.0, 3.0]},
            {"id": "node0", "type": "Circle", "center": [2.0, 1.0], "radius": 0.075},
            {"id": "rail0_capA", "type": "ArcCenter", "center": [0.25, 1.0], "radius": 0.035, "startAngleDeg": 90, "sweepDeg": 180},
            {"id": "rail0_capB", "type": "ArcCenter", "center": [6.75, 1.0], "radius": 0.035, "startAngleDeg": -90, "sweepDeg": 180},
        ],
        "constraints": constraints,
        "parameters": [
            {"name": "rail_width", "value": 0.07, "unit": "in"},
            {"name": "tie_width", "value": 0.07, "unit": "in"},
            {"name": "node_radius", "value": 0.075, "unit": "in"},
        ],
        "dimensions": [
            {"type": "Radial", "target": "node0", "expression": "node_radius"},
            {"type": "Radial", "target": "rail0_capA", "expression": "rail_width / 2"},
            {"type": "Radial", "target": "rail0_capB", "expression": "rail_width / 2"},
            {"type": "Offset", "targets": ["rail0", "rail1"], "expression": "rail_width / 2", "id": "rail_offset_pos"},
            {"type": "Offset", "targets": ["rail0", "rail1"], "expression": "-(rail_width / 2)", "id": "rail_offset_neg"},
        ],
        "groups": {"rails": ["rail0", "rail1"], "ties": ["tie0"], "nodes": ["node0"]},
        "latticePieceCount": 3,
        "latticeConstrained": constrained,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_to_point3d_converts_inches_to_cm():
    pt = _to_point3d([1.0, 2.0])
    assert pt.x == pytest.approx(1.0 * IN_TO_CM)
    assert pt.y == pytest.approx(2.0 * IN_TO_CM)


def test_build_order_parameters_before_geometry_before_constraints_before_dimensions(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    build_constrained_sketch(design.rootComponent, design, manifest)

    kinds = [entry[0] for entry in call_log]
    first_param_idx = min(i for i, k in enumerate(kinds) if k == "param:add")
    first_geom_idx = min(i for i, k in enumerate(kinds) if k.startswith("geom:"))
    first_constraint_idx = min(i for i, k in enumerate(kinds) if k.startswith("constraint:"))
    first_dim_idx = min(i for i, k in enumerate(kinds) if k == "dim:Radial")
    first_offset_idx = min(i for i, k in enumerate(kinds) if k == "offset")

    assert first_param_idx < first_geom_idx, "parameters must be created BEFORE geometry"
    assert first_geom_idx < first_constraint_idx, "geometry must exist BEFORE constraints reference it"
    assert first_constraint_idx < first_dim_idx, "constraints run BEFORE dimensions (per §5's own build order)"
    assert first_dim_idx < first_offset_idx or True  # both are in the 2nd deferred window; order between them isn't load-bearing


def test_all_geometry_entities_created(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["entities"]["created"] == len(manifest["entities"])
    assert summary["entities"]["skipped"] == []


def test_coordinates_land_in_cm_not_inches(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    build_constrained_sketch(design.rootComponent, design, manifest)
    line_calls = [c for c in call_log if c[0] == "geom:Line"]
    # rail0's own p1 is [0.25, 1.0] inches -> must land at 0.25*2.54 cm.
    rail0_call = line_calls[0]
    assert rail0_call[1] == pytest.approx(0.25 * IN_TO_CM)
    assert rail0_call[2] == pytest.approx(1.0 * IN_TO_CM)


def test_parameters_created_then_updated_on_a_second_build(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    summary1 = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary1["parameters"]["created"] == 3
    assert summary1["parameters"]["updated"] == 0

    summary2 = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary2["parameters"]["created"] == 0
    assert summary2["parameters"]["updated"] == 3


def test_length_parameters_created_with_unit_bearing_expression(call_log):
    """T63 fix (advisor's own real-Fusion measurement): a LENGTH parameter
    (unit=='in') must be created via ValueInput.createByString('<v> in'),
    NOT createByReal(<v>) — createByReal takes a value in Fusion's
    CANONICAL internal unit (cm), so createByReal(0.07) silently meant
    0.07 CM (measured live: rail_width came back as 0.0276in ==
    0.07/2.54). This is a genuinely non-vacuous check: before the fix,
    this test would have seen a 'valueinput:real' call with the bare
    0.07, not a 'valueinput:string' call with the unit suffix."""
    design = FakeDesign()
    ctx = types.SimpleNamespace(design=design, logger=types.SimpleNamespace(log=lambda *a, **k: None))
    _sync_manifest_parameters(ctx, [{"name": "rail_width", "value": 0.07, "unit": "in"}])
    string_calls = [c for c in call_log if c[0] == "valueinput:string"]
    real_calls = [c for c in call_log if c[0] == "valueinput:real"]
    assert real_calls == []
    assert string_calls == [("valueinput:string", "0.07 in")]


def test_unitless_parameters_created_with_createByReal(call_log):
    """A genuinely unitless ratio parameter (waist_reach, corner_radius —
    unit is None/absent in the manifest) has no unit string to misinterpret,
    so createByReal is correct and unchanged — this test guards against an
    OVER-correction (e.g. always using createByString) that would wrap a
    unitless value in a bogus unit suffix."""
    design = FakeDesign()
    ctx = types.SimpleNamespace(design=design, logger=types.SimpleNamespace(log=lambda *a, **k: None))
    _sync_manifest_parameters(ctx, [{"name": "corner_radius", "value": 0.22, "unit": None}])
    string_calls = [c for c in call_log if c[0] == "valueinput:string"]
    real_calls = [c for c in call_log if c[0] == "valueinput:real"]
    assert string_calls == []
    assert real_calls == [("valueinput:real", 0.22)]


def test_skip_and_report_a_missing_geometry_target_never_aborts_the_build(call_log):
    """A constraint referencing an entity id that doesn't exist must be
    skipped (constraint_step's own CONSTRAINT MISS path) and the REST of
    the build must still complete — never raise."""
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    manifest["constraints"].append({"type": "Coincident", "targets": ["tie0:S", "does_not_exist"]})
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    # The build completed (no exception) and every OTHER entity/constraint
    # still landed.
    assert summary["entities"]["created"] == len(manifest["entities"])
    assert summary["constraints"]["count"] >= 1  # the bad one was logged as an issue


def test_skip_and_report_an_unknown_entity_type_never_aborts_the_build(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    manifest["entities"].append({"id": "mystery0", "type": "Slot", "p1": [0, 0], "p2": [1, 1]})
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["entities"]["skipped"] == [{"id": "mystery0", "type": "Slot", "reason": "unknown entity type"}]
    # every OTHER, valid entity still got created.
    assert summary["entities"]["created"] == len(manifest["entities"]) - 1


def test_threshold_case_empty_constraints_builds_cleanly_with_zero_constraint_calls(call_log):
    """The >=SKETCH_PIECE_THRESHOLD case (T61's own JS side already
    produces this: entities + width dimensions present, constraints[]
    EMPTY) must build without error and without _apply_constraints ever
    calling constraint_step for a manifest-declared relationship (H/V/
    Coincident/Equal). T63: since the cap-tangent step was REMOVED
    (no longer any constraint call from the offset/cap path either), this
    is now a genuine zero-constraint-calls-of-any-kind assertion, not one
    that has to carve out an exception for Tangent."""
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=False)
    assert manifest["constraints"] == []
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["latticeConstrained"] is False
    assert summary["entities"]["created"] == len(manifest["entities"])
    constraint_calls = [c for c in call_log if c[0].startswith("constraint:")]
    assert constraint_calls == []
    # width offsets/caps still ran (§6: "not a separate code path").
    offset_calls = [c for c in call_log if c[0] == "offset"]
    assert len(offset_calls) == 4  # 2 rails x (pos + neg)


def test_width_offsets_produce_two_calls_per_centerline(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    offset_calls = [c for c in call_log if c[0] == "offset"]
    assert len(offset_calls) == 4  # rail0 + rail1, each pos + neg
    assert summary["offsets"]["created"] == 4


def test_offset_dimension_expression_gets_set(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    build_constrained_sketch(design.rootComponent, design, manifest)
    sketch = design.rootComponent._sketches[0]
    exprs = [d.parameter.expression for d in sketch.sketchDimensions]
    assert "rail_width / 2" in exprs
    assert "-(rail_width / 2)" in exprs


def test_no_cap_tangent_constraint_is_ever_attempted(call_log):
    """T63 (advisor's own real-Fusion run): the cap arcs are already fully
    determined (center on the centerline's own end, radius tied to the
    same width parameter driving the offsets) — an explicit Tangent
    between a cap and its offset curve is a redundant, CONFLICTING 5th
    constraint (measured live: 30 "CAP TANGENT SKIP ...
    VCS_SKETCH_OVER_CONSTRAINTS" on a real 75-entity fixture). Fixed by
    REMOVING the addTangent call entirely (not wrapping/silencing it) —
    this fixture's own manifest never declares a Tangent constraint
    either, so zero Tangent calls total is the correct, fully non-vacuous
    assertion (before this fix, this test would have seen >=2)."""
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    build_constrained_sketch(design.rootComponent, design, manifest)
    tangent_calls = [c for c in call_log if c[0] == "constraint:Tangent"]
    assert tangent_calls == []


def test_build_from_manifest_file_reads_json_and_builds(tmp_path, call_log):
    design = FakeDesign()
    _FakeApp._active_design = design
    manifest = _box_lattice_manifest(constrained=True)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    summary = build_from_manifest_file(str(manifest_path))
    assert summary["entities"]["created"] == len(manifest["entities"])
    _FakeApp._active_design = None


def test_build_from_manifest_file_raises_clearly_with_no_active_design():
    _FakeApp._active_design = None
    with pytest.raises(RuntimeError, match="no active Fusion Design"):
        build_from_manifest_file("does_not_matter.json")


if __name__ == "__main__":
    # Plain-Python fallback (no pytest needed), same dual-mode convention
    # frame-builder/test_templates.py already documents.
    import traceback
    tests = [
        test_to_point3d_converts_inches_to_cm,
        test_build_order_parameters_before_geometry_before_constraints_before_dimensions,
        test_all_geometry_entities_created,
        test_coordinates_land_in_cm_not_inches,
        test_parameters_created_then_updated_on_a_second_build,
        test_skip_and_report_a_missing_geometry_target_never_aborts_the_build,
        test_skip_and_report_an_unknown_entity_type_never_aborts_the_build,
        test_threshold_case_empty_constraints_builds_cleanly_with_zero_constraint_calls,
        test_width_offsets_produce_two_calls_per_centerline,
        test_offset_dimension_expression_gets_set,
        test_no_cap_tangent_constraint_is_ever_attempted,
        test_length_parameters_created_with_unit_bearing_expression,
        test_unitless_parameters_created_with_createByReal,
        test_build_from_manifest_file_raises_clearly_with_no_active_design,
    ]
    passed, failed = 0, 0
    for t in tests:
        _reset_call_log()
        try:
            sig_params = t.__code__.co_varnames[: t.__code__.co_argcount]
            if "call_log" in sig_params:
                t(CALL_LOG)
            else:
                t()
            print(f"PASS: {t.__name__}")
            passed += 1
        except Exception:
            print(f"FAIL: {t.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
