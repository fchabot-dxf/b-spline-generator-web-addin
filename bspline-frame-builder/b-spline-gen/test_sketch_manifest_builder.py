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

    @property
    def count(self):
        return len([c for c in self._sketch._curves if isinstance(c, FakeSketchLine)])

    def item(self, i):
        return [c for c in self._sketch._curves if isinstance(c, FakeSketchLine)][i]


def _circumcenter(a, b, c):
    """T65: addByThreePoints derives its own center/radius FROM the 3
    points — this is the fake's own equivalent (standard circumcenter
    formula), so a 3-point-arc fake is geometrically consistent (its own
    startSketchPoint/endSketchPoint are the GIVEN p1/p2 exactly, its
    center is DERIVED, never the other way around, matching the real
    API's own semantics and unlike addByCenterStartSweep's fake below,
    where center is given and the end point is derived)."""
    ax, ay, bx, by, cx, cy = a.x, a.y, b.x, b.y, c.x, c.y
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return FakePoint3D((ax + cx) / 2, (ay + cy) / 2)
    ux = ((ax ** 2 + ay ** 2) * (by - cy) + (bx ** 2 + by ** 2) * (cy - ay) + (cx ** 2 + cy ** 2) * (ay - by)) / d
    uy = ((ax ** 2 + ay ** 2) * (cx - bx) + (bx ** 2 + by ** 2) * (ax - cx) + (cx ** 2 + cy ** 2) * (bx - ax)) / d
    return FakePoint3D(ux, uy)


class FakeSketchArcs:
    def __init__(self, sketch):
        self._sketch = sketch

    def addByCenterStartSweep(self, center, start, sweep_rad):
        CALL_LOG.append(("geom:Arc", center.x, center.y))
        arc = FakeSketchArc(center, start, sweep_rad)
        self._sketch._curves.append(arc)
        return arc

    def addByThreePoints(self, p1, p_mid, p2):
        CALL_LOG.append(("geom:Arc3Point", p1.x, p1.y, p_mid.x, p_mid.y, p2.x, p2.y))
        arc = FakeCurveBase.__new__(FakeSketchArc)
        FakeCurveBase.__init__(arc)
        arc.centerSketchPoint = FakeSketchPoint(_circumcenter(p1, p_mid, p2))
        arc.startSketchPoint = FakeSketchPoint(p1)
        arc.endSketchPoint = FakeSketchPoint(p2)
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

    # T65 (advisor's own real Fusion run, verified via dir()): the slot
    # methods (addCenterToCenterSlot, addThreePointArcSlot,
    # addCenterPointArcSlot, addCenterPointSlot, addOverallSlot) live on
    # SKETCH itself, NOT on SketchLines — T64's fake had this on
    # FakeSketchLines, matching T64's OWN wrong call site exactly, which is
    # why that bug slipped past every test: shim and code agreed with each
    # other, just not with real Fusion. Moved here to match the real API;
    # the module under test's OWN call site is fixed to match in the same
    # commit, so this would have failed loudly (AttributeError on
    # FakeSketchLines) had the shim alone been fixed without the module.
    #
    # Still creates the centerline EXACTLY at p1/p2 (so _find_slot_
    # centerline's own exact-match search is genuinely exercised, not
    # trivially satisfied), PLUS two side lines offset away (never at
    # p1/p2), PLUS two end arcs, PLUS one new width dimension — mirroring
    # the advisor's own reported shape ("2 side lines + 2 end arcs + a
    # construction centerline + ONE width dimension"). Returns the VISIBLE
    # body only (side lines + end arcs), matching the advisor's own report
    # that the return value was "a generic vector" not reliably carrying
    # the centerline — this is WHY the real module diffs sketchLines'
    # own count before/after instead of trusting this return value.
    def addCenterToCenterSlot(self, p1, p2, value_input, is_fixed):
        CALL_LOG.append(("slot:addCenterToCenterSlot", p1.x, p1.y, p2.x, p2.y, value_input.value, is_fixed))
        centerline = FakeSketchLine(p1, p2)
        self._curves.append(centerline)
        dx, dy = p2.x - p1.x, p2.y - p1.y
        length = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / length, dx / length
        half_w = value_input.value / 2.0
        side1 = FakeSketchLine(
            FakePoint3D(p1.x + nx * half_w, p1.y + ny * half_w),
            FakePoint3D(p2.x + nx * half_w, p2.y + ny * half_w))
        side2 = FakeSketchLine(
            FakePoint3D(p1.x - nx * half_w, p1.y - ny * half_w),
            FakePoint3D(p2.x - nx * half_w, p2.y - ny * half_w))
        end_arc1 = FakeSketchArc(p1, side1.startSketchPoint.geometry, math.pi)
        end_arc2 = FakeSketchArc(p2, side1.endSketchPoint.geometry, math.pi)
        for c in (side1, side2, end_arc1, end_arc2):
            self._curves.append(c)
        self.sketchDimensions._items.append(FakeDimension())
        result = FakeObjectCollection()
        for c in (side1, side2, end_arc1, end_arc2):
            result.add(c)
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
    own CURRENT real output shape (T64: Slot entities + SlotWidth
    dimensions, NOT the old Line+Offset+cap-arc shape) — 2 rails, 1 tie,
    1 node, one Coincident. `constrained=False` mimics what T61's own JS
    side ALREADY produces above SKETCH_PIECE_THRESHOLD: entities +
    SlotWidth dimensions present, constraints[] EMPTY."""
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
        "widthMode": "slot",
        "entities": [
            {"id": "rail0", "type": "Slot", "p1": [0.25, 1.0], "p2": [6.75, 1.0], "width": 0.07},
            {"id": "rail1", "type": "Slot", "p1": [0.25, 3.0], "p2": [6.75, 3.0], "width": 0.07},
            {"id": "tie0", "type": "Slot", "p1": [2.0, 1.0], "p2": [2.0, 3.0], "width": 0.07},
            {"id": "node0", "type": "Circle", "center": [2.0, 1.0], "radius": 0.075},
        ],
        "constraints": constraints,
        "parameters": [
            {"name": "rail_width", "value": 0.07, "unit": "in"},
            {"name": "tie_width", "value": 0.07, "unit": "in"},
            {"name": "node_radius", "value": 0.075, "unit": "in"},
        ],
        "dimensions": [
            {"type": "Radial", "target": "node0", "expression": "node_radius"},
            {"type": "SlotWidth", "target": "rail0", "expression": "rail_width"},
            {"type": "SlotWidth", "target": "rail1", "expression": "rail_width"},
            {"type": "SlotWidth", "target": "tie0", "expression": "tie_width"},
        ],
        "groups": {"rails": ["rail0", "rail1"], "ties": ["tie0"], "nodes": ["node0"]},
        "latticePieceCount": 3,
        "latticeConstrained": constrained,
    }


def _centerline_manifest():
    """T64 ADD-ON 3: a plain box-Lattice manifest, widthMode 'centerline' —
    matching what T61's own JS producer now emits for a layer with no
    generated silhouette: bare rail/tie Lines + relationship constraints
    + the stroke_width PARAMETER (a CAM reference). Used by
    test_centerline_width_mode_still_builds_a_plain_line_with_no_slot_mechanism
    to prove the plain-Line entity-dispatch branch in _create_geometry
    still works standalone, unaffected by the Slot branch's addition —
    the Python side never reads manifest.widthMode itself (only each
    entity's own `type`), so no Offset/SlotWidth dimension is declared
    here at all; there is nothing left for either mechanism to act on."""
    return {
        "version": 1, "layerId": "1", "sketchName": "Test Box Lattice (centerline)",
        "units": "in", "region": {"x": 0, "y": 0, "w": 7, "h": 9}, "widthMode": "centerline",
        "entities": [
            {"id": "rail0", "type": "Line", "p1": [0.25, 1.0], "p2": [6.75, 1.0]},
        ],
        "constraints": [{"type": "Horizontal", "targets": ["rail0"]}],
        "parameters": [{"name": "stroke_width", "value": 0.07, "unit": "in"}],
        "dimensions": [],
        "groups": {"rails": ["rail0"], "ties": [], "nodes": []},
        "latticePieceCount": 1,
        "latticeConstrained": True,
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
    first_geom_idx = min(i for i, k in enumerate(kinds) if k.startswith("geom:") or k == "slot:addCenterToCenterSlot")
    first_constraint_idx = min(i for i, k in enumerate(kinds) if k.startswith("constraint:"))
    first_dim_idx = min(i for i, k in enumerate(kinds) if k == "dim:Radial")

    assert first_param_idx < first_geom_idx, "parameters must be created BEFORE geometry"
    assert first_geom_idx < first_constraint_idx, "geometry (incl. slots) must exist BEFORE constraints reference it"
    assert first_constraint_idx < first_dim_idx, "constraints run BEFORE the deferred Radial-dimension window"


def test_all_geometry_entities_created(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["entities"]["created"] == len(manifest["entities"])
    assert summary["entities"]["skipped"] == []


def _shape_manifest_with_arc3point():
    """T65: a minimal silhouette manifest — 2 lines + 1 Arc3Point in
    between, exactly the shape `toCarveArc3Point` (JS) now produces for a
    carve-placed Shape Lattice arc — arranged so the arc's own p1/p2
    coincide with its neighbours' own matching endpoints BY CONSTRUCTION,
    same as the real silhouette generator's own chained segments."""
    return {
        "version": 1, "layerId": "1", "sketchName": "Test Shape",
        "units": "in", "region": {"x": 0, "y": 0, "w": 7, "h": 9}, "widthMode": "slot",
        "entities": [
            {"id": "seg0", "type": "Line", "p1": [0.0, 0.0], "p2": [1.0, 0.0]},
            {"id": "seg1", "type": "Arc3Point", "p1": [1.0, 0.0], "pMid": [1.5, 0.5], "p2": [1.0, 1.0]},
            {"id": "seg2", "type": "Line", "p1": [1.0, 1.0], "p2": [0.0, 1.0]},
        ],
        "constraints": [],
        "parameters": [],
        "dimensions": [],
        "groups": {"silhouette": ["seg0", "seg1", "seg2"]},
        "latticePieceCount": 0,
        "latticeConstrained": True,
    }


def test_arc3point_entity_builds_via_addByThreePoints_and_connects_to_its_neighbours_by_geometry(call_log):
    """T65 (dispatch's own explicit ask): 'arcs must be checked by geometry
    (endpoint continuity)', not just by a call-log count — an angle-based
    build could log the right CALL and still land the wrong POINT. Checks
    the arc's own real geometry (startSketchPoint/endSketchPoint) against
    its neighbouring lines' own real geometry, independent of ids."""
    design = FakeDesign()
    manifest = _shape_manifest_with_arc3point()
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["entities"]["created"] == 3
    assert summary["entities"]["skipped"] == []

    arc_calls = [c for c in call_log if c[0] == "geom:Arc3Point"]
    assert len(arc_calls) == 1
    _, p1x, p1y, pmx, pmy, p2x, p2y = arc_calls[0]
    assert (p1x, p1y) == pytest.approx((1.0 * IN_TO_CM, 0.0 * IN_TO_CM))
    assert (pmx, pmy) == pytest.approx((1.5 * IN_TO_CM, 0.5 * IN_TO_CM))
    assert (p2x, p2y) == pytest.approx((1.0 * IN_TO_CM, 1.0 * IN_TO_CM))

    sketch = design.rootComponent._sketches[0]
    arc = next(c for c in sketch._curves if isinstance(c, FakeSketchArc))
    seg0 = sketch.sketchCurves.sketchLines.item(0)
    seg2 = sketch.sketchCurves.sketchLines.item(1)
    assert arc.startSketchPoint.geometry.distanceTo(seg0.endSketchPoint.geometry) < 1e-9
    assert arc.endSketchPoint.geometry.distanceTo(seg2.startSketchPoint.geometry) < 1e-9


def test_sketch_name_override_takes_priority_over_the_manifest_own_sketchName(call_log):
    """T64 (advisor's own real Fusion run): the manifest's own `sketchName`
    field (set by export-flow.js to a generic "Layer <id>") must NOT win
    once a caller (b-spline-gen.py's own _build_constrained_sketch_for_
    layer) supplies a real name matching the plain-SVG path's own naming
    scheme. Omitting the override falls back to the manifest's own field,
    unchanged from before this fix (the dev-entry-point path)."""
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    assert manifest["sketchName"] == "Test Box Lattice"

    build_constrained_sketch(design.rootComponent, design, manifest, sketch_name_override="Source - L1 - vbit (0.25in) [constrained]")
    sketch1 = design.rootComponent._sketches[-1]
    assert sketch1.name == "Source - L1 - vbit (0.25in) [constrained]"

    build_constrained_sketch(design.rootComponent, design, manifest)  # no override
    sketch2 = design.rootComponent._sketches[-1]
    assert sketch2.name == "Test Box Lattice"


def test_coordinates_land_in_cm_not_inches(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    build_constrained_sketch(design.rootComponent, design, manifest)
    slot_calls = [c for c in call_log if c[0] == "slot:addCenterToCenterSlot"]
    # rail0's own p1 is [0.25, 1.0] inches -> must land at 0.25*2.54 cm.
    rail0_call = slot_calls[0]
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
    manifest["entities"].append({"id": "mystery0", "type": "Bezier", "p1": [0, 0], "p2": [1, 1]})
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["entities"]["skipped"] == [{"id": "mystery0", "type": "Bezier", "reason": "unknown entity type"}]
    # every OTHER, valid entity still got created.
    assert summary["entities"]["created"] == len(manifest["entities"]) - 1


def test_threshold_case_still_creates_slots_and_slot_width_dims_but_no_relationship_constraints(call_log):
    """The >=SKETCH_PIECE_THRESHOLD case (T61's own JS side already
    produces this: entities + SlotWidth dimensions present, constraints[]
    EMPTY) must build without error and without _apply_constraints ever
    calling constraint_step for a manifest-declared relationship (H/V/
    Coincident/Equal — constraints[] is empty here). T64: the slot
    mechanism itself is NOT gated by the threshold either (§6: "not a
    separate code path") — every rail/tie still becomes a real, anchored,
    width-dimensioned Slot regardless."""
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=False)
    assert manifest["constraints"] == []
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["latticeConstrained"] is False
    assert summary["entities"]["created"] == len(manifest["entities"])
    relationship_calls = [c for c in call_log if c[0].startswith("constraint:")]
    assert relationship_calls == []
    slot_calls = [c for c in call_log if c[0] == "slot:addCenterToCenterSlot"]
    assert len(slot_calls) == 3  # rail0, rail1, tie0 -- unaffected by the threshold


def test_slot_creation_is_anchored_and_calls_addCenterToCenterSlot_once_per_piece(call_log):
    """T64 (final design): every rail/tie becomes ONE addCenterToCenterSlot
    call, with the anchoring argument True (per the advisor's own literal
    example and instruction) — measured live: an anchored slot grows
    EVENLY on a width change; an unanchored one drifts lopsided. Also
    verifies the registered centerline's own two endpoints get
    isFixed=True explicitly (belt-and-suspenders, since which of the two
    mechanisms actually anchors it is itself unverified this turn)."""
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    build_constrained_sketch(design.rootComponent, design, manifest)
    slot_calls = [c for c in call_log if c[0] == "slot:addCenterToCenterSlot"]
    assert len(slot_calls) == 3  # rail0, rail1, tie0
    for call in slot_calls:
        assert call[-1] is True  # the is_fixed/anchor argument

    sketch = design.rootComponent._sketches[0]

    def find_by_endpoints(p1_in, p2_in):
        for i in range(sketch.sketchCurves.sketchLines.count):
            c = sketch.sketchCurves.sketchLines.item(i)
            if (c.startSketchPoint.geometry.x == pytest.approx(p1_in[0] * IN_TO_CM)
                    and c.startSketchPoint.geometry.y == pytest.approx(p1_in[1] * IN_TO_CM)
                    and c.endSketchPoint.geometry.x == pytest.approx(p2_in[0] * IN_TO_CM)
                    and c.endSketchPoint.geometry.y == pytest.approx(p2_in[1] * IN_TO_CM)):
                return c
        return None

    # Checked for ALL THREE pieces, not just the first created — a lookup
    # that degenerates to "return sketchLines.item(0)" would still find
    # rail0's own centerline by luck (it's the very first line the fake
    # ever appends) but would silently mis-anchor rail1/tie0's own
    # centerlines, which this loop is what actually catches (confirmed by
    # mutation: item(0) passed rail0 alone, failed here on rail1).
    for ent in manifest["entities"]:
        if ent["type"] != "Slot":
            continue
        centerline = find_by_endpoints(ent["p1"], ent["p2"])
        assert centerline is not None, f"{ent['id']}'s own centerline is genuinely findable"
        assert centerline.startSketchPoint.isFixed is True, f"{ent['id']} start anchored"
        assert centerline.endSketchPoint.isFixed is True, f"{ent['id']} end anchored"


def test_slot_width_dimension_expressions_match_the_manifest(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    build_constrained_sketch(design.rootComponent, design, manifest)
    sketch = design.rootComponent._sketches[0]
    exprs = [d.parameter.expression for d in sketch.sketchDimensions]
    assert exprs.count("rail_width") == 2  # rail0, rail1
    assert exprs.count("tie_width") == 1  # tie0
    assert "node_radius" in exprs


def test_no_symmetry_constraint_is_ever_added_for_a_slot(call_log):
    """T64: the advisor's own measurement ("Do NOT add symmetry — the
    slot is already symmetric by construction") — never implemented in
    the first place (this module never calls a symmetry-shaped
    constraint), but worth a real, checkable assertion rather than
    trusting the absence silently: no Tangent (also never re-added after
    T63's own removal) and no constraint type named "Symmetric" or
    "Symmetry" appears anywhere in the build."""
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    build_constrained_sketch(design.rootComponent, design, manifest)
    forbidden = [c for c in call_log if c[0] in ("constraint:Tangent", "constraint:Symmetric", "constraint:Symmetry")]
    assert forbidden == []


def test_centerline_width_mode_still_builds_a_plain_line_with_no_slot_mechanism(call_log):
    """T64 (final design): the Python side dispatches purely on each
    entity's own `type` field (Line vs Slot vs Circle vs ArcCenter) —
    it never reads manifest.widthMode at all (that field only steers the
    JS producer's own choice of entity type). 'centerline' is kept as a
    real, available-but-not-default value (§ SKETCH_WIDTH_MODE), so a
    plain Line entity must still build as a bare line — no
    addCenterToCenterSlot call, no SlotWidth dimension-driving — proving
    the Slot dispatch branch's addition didn't swallow the Line branch."""
    design = FakeDesign()
    manifest = _centerline_manifest()
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["entities"]["created"] == 1
    line_calls = [c for c in call_log if c[0] == "geom:Line"]
    assert len(line_calls) == 1
    slot_calls = [c for c in call_log if c[0] == "slot:addCenterToCenterSlot"]
    assert slot_calls == []
    assert summary["parameters"]["created"] == 1  # stroke_width still declared
    hv_calls = [c for c in call_log if c[0] == "constraint:Horizontal"]
    assert len(hv_calls) == 1  # the relationship constraint DID still apply


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
        test_arc3point_entity_builds_via_addByThreePoints_and_connects_to_its_neighbours_by_geometry,
        test_sketch_name_override_takes_priority_over_the_manifest_own_sketchName,
        test_coordinates_land_in_cm_not_inches,
        test_parameters_created_then_updated_on_a_second_build,
        test_skip_and_report_a_missing_geometry_target_never_aborts_the_build,
        test_skip_and_report_an_unknown_entity_type_never_aborts_the_build,
        test_threshold_case_still_creates_slots_and_slot_width_dims_but_no_relationship_constraints,
        test_slot_creation_is_anchored_and_calls_addCenterToCenterSlot_once_per_piece,
        test_slot_width_dimension_expressions_match_the_manifest,
        test_no_symmetry_constraint_is_ever_added_for_a_slot,
        test_centerline_width_mode_still_builds_a_plain_line_with_no_slot_mechanism,
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
