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
        self._isFixed = False
        FakeSketchPoint._next_token[0] += 1
        self.entityToken = f"pt-{FakeSketchPoint._next_token[0]}"

    @property
    def isFixed(self):
        return self._isFixed

    @isFixed.setter
    def isFixed(self, value):
        # T66 (Fred's own rule, "never use Fix"): the advisor's own real
        # Fusion run measured 63/63 relationship constraints failing
        # VCS_SKETCH_OVER_CONSTRAINTS, directly caused by T64's own
        # anchoring -- a Fixed point already has 0 DOF, so ANY constraint
        # touching it is redundant. The shim ITSELF refuses Fix here,
        # rather than leaving it to a separate assertion that checks for
        # its absence after the fact -- if a future change reintroduces
        # `.isFixed = True` anywhere production code runs, the very first
        # test that exercises that path fails immediately and loudly,
        # which is what "so this class can't pass again" (the dispatch's
        # own wording) means in practice.
        if value:
            raise AssertionError("isFixed set to True -- Fix is banned (Fred's own rule, T66)")
        self._isFixed = value


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

    @property
    def radius(self):
        # T68 item 2b: real adsk.fusion.SketchArc exposes a genuine
        # read-only `.radius` (computed from its own center/start) —
        # no production code needed it before verify_sketch_against_
        # manifest (this module's own FIRST caller that reads an arc's
        # radius back), so the fake never modeled it until now. A
        # @property works for BOTH construction paths below, including
        # addByThreePoints' own bypass of __init__ (FakeCurveBase.__new__),
        # since it only needs centerSketchPoint/startSketchPoint to
        # already be set, which both paths guarantee before returning.
        return self.centerSketchPoint.geometry.distanceTo(self.startSketchPoint.geometry)


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


def _ccw_normalized_ends(p1, p_mid, p2):
    """Shared by `addByThreePoints` and (T69) `addThreePointArcSlot`'s own
    fake: both real Fusion methods normalize their OWN result to run
    COUNTER-CLOCKWISE (T67's own real-Fusion measurement for the former;
    the SAME convention is assumed here for the latter, unverified live
    this turn — NO FUSION) — a clockwise-ordered (p1, pMid, p2) comes back
    with start/end SWAPPED relative to the given p1/p2. One declared
    signed-area test, not two copies of it."""
    signed_area = (p_mid.x - p1.x) * (p2.y - p1.y) - (p_mid.y - p1.y) * (p2.x - p1.x)
    return (p1, p2) if signed_area >= 0 else (p2, p1)


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
        # T67 (advisor's own real Fusion run): addByThreePoints always
        # normalizes its OWN result to run counter-clockwise — a
        # clockwise-ordered (p1, pMid, p2) input comes back with
        # startSketchPoint/endSketchPoint SWAPPED relative to the given
        # p1/p2. Modeled here via the standard signed-area/cross-product
        # test so this fake actually EXERCISES _create_arc3_entity's own
        # proximity-based S/E relabeling instead of trivially matching it
        # (T65's own first version of this fake always assigned
        # start=p1/end=p2 regardless of winding, which is why this exact
        # bug shipped once already without any test catching it).
        start, end = _ccw_normalized_ends(p1, p_mid, p2)
        arc.startSketchPoint = FakeSketchPoint(start)
        arc.endSketchPoint = FakeSketchPoint(end)
        self._sketch._curves.append(arc)
        return arc

    @property
    def count(self):
        # T69: addThreePointArcSlot's own fake (FakeSketch, below) diffs
        # this count before/after, the SAME "diff the collection" idiom
        # FakeSketchLines already provides for addCenterToCenterSlot.
        return len([c for c in self._sketch._curves if isinstance(c, FakeSketchArc)])

    def item(self, i):
        return [c for c in self._sketch._curves if isinstance(c, FakeSketchArc)][i]


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

    def addSymmetry(self, a, b, sym_line):
        return self._make("Symmetry")


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
        # NODE-D: was stubbed but never logged (never exercised by a real
        # manifest until node_diameter) -- matches addRadialDimension's own
        # logging convention now that it's a real, called path.
        CALL_LOG.append(("dim:Diameter",))
        d = FakeDimension()
        self._items.append(d)
        return d

    def addDistanceDimension(self, src, tgt, orient, text_pt):
        # T70 AMEND 5: logged now (matching addRadialDimension's own
        # existing convention) so a test can observe it fired, not just
        # that its own dimension object landed in self._items.
        # T71 (AMEND 6's own real-Fusion measurement): the REAL
        # addDistanceDimension only ever accepts 2 SketchPoints -- a
        # SketchLine/SketchArc crashes with "Wrong number or type of
        # arguments." The fake used to accept anything positionally,
        # silently passing a curve straight through and hiding this exact
        # bug from every test ("so this class can't pass again" -- the
        # same discipline FakeSketchPoint.isFixed's own setter already
        # applies to the Fix-ban, T66).
        if not isinstance(src, FakeSketchPoint) or not isinstance(tgt, FakeSketchPoint):
            raise TypeError(
                "addDistanceDimension requires 2 SketchPoint arguments "
                "(Wrong number or type of arguments.)"
            )
        CALL_LOG.append(("dim:Distance",))
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
        # T70 AMEND 4: a real Fusion sketch's own ALWAYS-fixed origin point
        # (local (0,0,0), same for any sketch on any construction plane) —
        # the manifest's own mirror-axis Coincident constraints target this
        # (via entity_map['origin'], registered in build_constrained_sketch)
        # to anchor an axis's absolute position without an isFixed flag.
        self.originPoint = FakeSketchPoint(FakePoint3D(0, 0, 0))

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
    def addCenterToCenterSlot(self, p1, p2, value_input, create_width_dim):
        CALL_LOG.append(("slot:addCenterToCenterSlot", p1.x, p1.y, p2.x, p2.y, value_input.value, create_width_dim))
        centerline = FakeSketchLine(p1, p2)
        self._curves.append(centerline)
        # T67 (advisor's own real Fusion run, corrects a T66 misdiagnosis):
        # this 4th argument is CREATE-WIDTH-DIMENSION, not Fix/anchor — a
        # DIFFERENT knob that happened to share T64's own anchor argument's
        # call-site position, which is exactly what made T66's "this must
        # be the same Fix mechanism" theory plausible without a live
        # measurement to check it against. Modeled here as literally as
        # its own name: True creates the SketchDiameterDimension below;
        # False means NO dimension gets appended at all, so
        # _drive_last_dimension correctly finds `dims.count == 0` and logs
        # DIM MISS — reproducing the advisor's own exact measured symptom
        # ("every slot DIM MISS") when this argument is wrongly False.
        # Fix (isFixed) is NEVER applied here at all, under either value —
        # that mechanism is banned outright (T66) and has nothing to do
        # with this argument; FakeSketchPoint's own isFixed defaults to
        # False and nothing in this method ever touches it.
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
        if create_width_dim:
            self.sketchDimensions._items.append(FakeDimension())
        result = FakeObjectCollection()
        for c in (side1, side2, end_arc1, end_arc2):
            result.add(c)
        return result

    # T69 (SE15b, Fred: "want the shape contour to be made of slots") — the
    # arc-shaped sibling of addCenterToCenterSlot above. Per the dispatch's
    # own advisor-measured shape: a construction CENTERLINE arc through the
    # 3 given points, two side arcs at +-width/2 (same center/radius +-
    # half_w — offsetting an ARC perpendicular means adjusting its RADIUS,
    # never translating its center, unlike a Line's own parallel-translate
    # side lines above), two end caps, one width dimension. NOT geometrically
    # faithful on the caps (plain lines, never truly tangent) — same "proves
    # orchestration, not Fusion's own solver" posture every fake in this
    # file already carries; what matters for _create_arc3_slot_entity's own
    # tests is that a UNIQUE, CONSTRUCTION, 3-point-matching arc exists to
    # find.
    #
    # T70 AMEND 2 (advisor's own real Fusion run on T69's own 02b9100 —
    # this is the SECOND version of this fake; the FIRST modeled the wrong
    # argument semantics and never caught T69's own real bug because a
    # circumcenter is order-independent regardless of which 3 raw values
    # land in which slot, so the WRONG call order still produced a
    # numerically correct CIRCLE — just built from the wrong pair of
    # endpoints, which the old fake never distinguished). The REAL method
    # signature is `(START, END, POINT-ON-ARC)`, not `(start, mid, end)` —
    # `start`/`end` are used DIRECTLY as the arc's own two ends (after
    # Fusion's own CCW-normalization, modeled here via the SAME signed-area
    # helper `addByThreePoints` already uses, fed this method's own
    # positional order so a WRONG call — e.g. the OLD buggy production
    # code's `(p1, p_mid, p2)`, meaning start=p1, end=p_mid, point-on-arc=p2
    # under THIS signature — genuinely produces an arc ending at p_mid, not
    # p2: a real, catchable geometric error, not just a relabeling); the
    # 3rd argument only ever feeds the CIRCUMCENTER (order-independent,
    # same formula as before) and is never guaranteed to land on the drawn
    # sweep in general (the advisor's own "quarter arc" measured case) —
    # irrelevant for every real call this module ever makes, since `pMid`
    # is always the TRUE geometric mid-sweep point of the SAME `p1..p2` arc.
    def addThreePointArcSlot(self, start, end, point_on_arc, value_input, create_width_dim):
        CALL_LOG.append(("slot:addThreePointArcSlot", start.x, start.y, end.x, end.y, point_on_arc.x, point_on_arc.y, value_input.value, create_width_dim))
        center = _circumcenter(start, end, point_on_arc)
        radius = center.distanceTo(start)
        centerline = FakeCurveBase.__new__(FakeSketchArc)
        FakeCurveBase.__init__(centerline)
        centerline.isConstruction = True
        centerline.centerSketchPoint = FakeSketchPoint(center)
        s, e = _ccw_normalized_ends(start, point_on_arc, end)
        centerline.startSketchPoint = FakeSketchPoint(s)
        centerline.endSketchPoint = FakeSketchPoint(e)
        self._curves.append(centerline)

        half_w = value_input.value / 2.0
        side_outer = FakeSketchArc(center, FakePoint3D(center.x + radius + half_w, center.y), math.pi)
        side_inner = FakeSketchArc(center, FakePoint3D(center.x + radius - half_w, center.y), math.pi)
        cap1 = FakeSketchLine(centerline.startSketchPoint.geometry, side_outer.startSketchPoint.geometry)
        cap2 = FakeSketchLine(centerline.endSketchPoint.geometry, side_outer.endSketchPoint.geometry)
        for c in (side_outer, side_inner, cap1, cap2):
            self._curves.append(c)
        if create_width_dim:
            self.sketchDimensions._items.append(FakeDimension())
        result = FakeObjectCollection()
        for c in (side_outer, side_inner, cap1, cap2):
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

    # T70 AMEND 5: a real enum (adsk.fusion.DimensionOrientations) that
    # `_create_dimension`'s own Distance branch (fb_engine/dimensions.py)
    # reads directly -- never needed by any test before this, since no
    # prior manifest exercised that specific DimType. Values are opaque
    # sentinels here (this fake never renders anything), matching every
    # other fb_engine enum reference this shim already stubs out.
    class _DimensionOrientations:
        HorizontalDimensionOrientation = "Horizontal"
        VerticalDimensionOrientation = "Vertical"
        AlignedDimensionOrientation = "Aligned"

    adsk_fusion.DimensionOrientations = _DimensionOrientations

    adsk.core = adsk_core
    adsk.fusion = adsk_fusion
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = adsk_core
    sys.modules["adsk.fusion"] = adsk_fusion
    return _FakeApp


_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# FB-ORDER cross-file gotcha (found running the whole bspline-frame-builder
# tree together): sketch_manifest_builder.py imports fb_engine.build_context
# and friends — the SAME shared modules frame-builder's own tests import,
# each behind its OWN incompatible adsk stub. Python caches each module on
# first import, so whichever test file's stub wins does so for the REST of
# the process; this file's own BuildContext ended up bound to a frame-
# builder test's more minimal stub (missing .userInterface) when both ran
# in one pytest invocation. Evicting every fb_engine.* module (plus this
# file's own target, sketch_manifest_builder) before installing THIS file's
# stub forces a fresh import under it every time, regardless of collection
# order — see bspline-frame-builder/frame-builder/fb_engine/
# test_board_params_ownership.py's own matching comment for the other side.
for _mod in (
    "fb_engine", "fb_engine.build_context", "fb_engine.geometry",
    "fb_engine.constraints", "fb_engine.dimensions", "fb_engine.projections",
    "fb_engine.offsets", "fb_engine.miters", "fb_engine.fb_value_resolver",
    "fb_engine.parameter_schema", "fb_engine.diagnostics", "fb_engine.inner_corners",
    "fb_engine.document_discovery", "fb_engine.template_resolver",
    "fb_engine.timeline_order", "fb_engine.frame_engine", "fb_engine.parametric_engine",
    "fb_engine.template_factory", "frame_engine", "parametric_engine",
    "sketch_manifest_builder",
):
    sys.modules.pop(_mod, None)

_FakeApp = _install_adsk_stubs()

import adsk.core  # noqa: E402 -- the fake registered above, for tests that build a ValueInput directly

from sketch_manifest_builder import (  # noqa: E402
    build_constrained_sketch,
    build_from_manifest_file,
    _to_point3d,
    _sync_manifest_parameters,
    _create_arc3_entity,
    _create_slot_entity,
    _create_circle_entity,
    _create_line_entity,
    _create_arc3_slot_entity,
    verify_sketch_against_manifest,
    _Logger,
    IN_TO_CM,
)
from fb_engine.build_context import BuildContext  # noqa: E402


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
            {"name": "node_diameter", "value": 0.15, "unit": "in"},
        ],
        "dimensions": [
            {"type": "Diameter", "target": "node0", "expression": "node_diameter"},
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
    first_dim_idx = min(i for i, k in enumerate(kinds) if k == "dim:Diameter")  # NODE-D: node0's own dim, was dim:Radial

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


def test_arc3point_S_E_survive_addByThreePoints_own_CCW_normalization_even_for_a_clockwise_input(call_log):
    """T67 (advisor's own real Fusion run — "this alone fixed the shape
    bbox"): addByThreePoints always normalizes to CCW, so a clockwise-
    ordered (p1, pMid, p2) input comes back with start/end SWAPPED
    relative to the given p1/p2. Direct unit test of _create_arc3_entity
    (not through the full orchestration): raw `arc.startSketchPoint`/
    `.endSketchPoint` are Fusion-internal and NEVER reassigned by the fix
    (they can't be — Fusion decides that itself); what the fix actually
    controls is WHICH point object gets registered under `:S`/`:E` in the
    entity map, which is what constraint resolution actually reads. A CW
    fixture forces the fake's own CCW-normalization swap, so if the
    proximity correction weren't there, `:S` would resolve to the WRONG
    point (confirmed by mutation below)."""
    design = FakeDesign()
    logger = _Logger()
    ctx = BuildContext(design.rootComponent, design, logger)
    s_name = "TestSketch"
    ctx.entity_map[s_name] = {}
    sketch = design.rootComponent.sketches.add(design.rootComponent.xYConstructionPlane)
    curves = sketch.sketchCurves
    # p1/pMid/p2 ordered CLOCKWISE (mirror of the CCW fixture the test
    # above already covers) -- forces the fake's own swap.
    ent = {"id": "seg1", "p1": [1.0, 1.0], "pMid": [1.5, 0.5], "p2": [1.0, 0.0]}
    _create_arc3_entity(ctx, curves, s_name, ent)

    tagged_start = ctx.entity_map[s_name]["seg1:S"]
    tagged_end = ctx.entity_map[s_name]["seg1:E"]
    assert tagged_start.geometry.distanceTo(_to_point3d(ent["p1"])) < 1e-9
    assert tagged_end.geometry.distanceTo(_to_point3d(ent["p2"])) < 1e-9


def test_slot_False_create_width_dim_yields_DIM_MISS_not_a_silently_undimensioned_slot(call_log):
    """T67 (advisor's own real Fusion run, corrects a T66 misdiagnosis):
    False for the API call's own 4th argument means NO
    SketchDiameterDimension gets created at all — reproducing the
    advisor's own exact measured symptom ("every slot DIM MISS") when
    this argument is wrongly False, via a manifest built with an
    explicit False width_expression path bypassed by calling the slot
    entity creation directly is awkward from the public API, so this
    drives it through a manifest whose OWN SlotWidth dimension is
    declared but the CALL ARGUMENT is forced False at the fake level —
    proving the shim's own new True/False branch (not just its default)
    is real and observable."""
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    sketch = design.rootComponent.sketches.add(design.rootComponent.xYConstructionPlane)
    p1, p2 = FakePoint3D(0, 0), FakePoint3D(1 * IN_TO_CM, 0)
    sketch.addCenterToCenterSlot(p1, p2, adsk.core.ValueInput.createByReal(0.07 * IN_TO_CM), False)
    assert sketch.sketchDimensions.count == 0  # no dimension created at all -- the exact reported symptom


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


def test_slot_creation_is_never_anchored_but_still_creates_its_own_width_dimension(call_log):
    """T66 (Fred's own rule, "never use Fix"; advisor's own real Fusion
    run: ALL 63 relationship constraints on a real fixture failed
    VCS_SKETCH_OVER_CONSTRAINTS, directly because T64's own POST-HOC
    `isFixed = True` made every slot centerline's own two end points
    Fixed — a Fixed point has 0 DOF, so ANY constraint touching it is
    redundant). That mechanism stays removed here — checked (isFixed is
    False) for ALL THREE fixture pieces, not just the first created,
    matching the original T64 test's own non-vacuity discipline (a lookup
    that degenerates to "item(0)" would still find rail0's own centerline
    by luck).

    T67 (advisor's own real Fusion run, corrects a T66 misdiagnosis): the
    API call's own 4th argument is a SEPARATE knob (CREATE-WIDTH-
    DIMENSION), not Fix — T66 wrongly set it False on the theory it was
    the SAME mechanism; this is now back to True, checked explicitly
    below, DISTINCT from the isFixed check (which stays False)."""
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    build_constrained_sketch(design.rootComponent, design, manifest)
    slot_calls = [c for c in call_log if c[0] == "slot:addCenterToCenterSlot"]
    assert len(slot_calls) == 3  # rail0, rail1, tie0
    for call in slot_calls:
        assert call[-1] is True  # create_width_dim -- a DIFFERENT knob from Fix/isFixed

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

    for ent in manifest["entities"]:
        if ent["type"] != "Slot":
            continue
        centerline = find_by_endpoints(ent["p1"], ent["p2"])
        assert centerline is not None, f"{ent['id']}'s own centerline is genuinely findable"
        assert centerline.startSketchPoint.isFixed is False, f"{ent['id']} start NOT fixed"
        assert centerline.endSketchPoint.isFixed is False, f"{ent['id']} end NOT fixed"


def test_shim_itself_refuses_isFixed_True_so_this_regression_class_cannot_pass_silently(call_log):
    """T66 (dispatch's own explicit ask): 'assert the builder never sets
    isFixed... model over-constraint... as a failure so this class can't
    pass again.' Directly proves the FakeSketchPoint.isFixed setter is a
    real, structural guard, not a decoration -- if any future change
    reintroduces `.isFixed = True` anywhere (the exact T64 mistake this
    turn removes), the very first test that exercises that code path
    fails immediately with this same AssertionError, rather than silently
    re-passing the way a plain missing-attribute duck-typed field would
    have."""
    pt = FakeSketchPoint(FakePoint3D(0, 0))
    assert pt.isFixed is False
    pt.isFixed = False  # still legal -- explicitly setting False is not banned
    assert pt.isFixed is False
    with pytest.raises(AssertionError):
        pt.isFixed = True


def test_slot_width_dimension_expressions_match_the_manifest(call_log):
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    build_constrained_sketch(design.rootComponent, design, manifest)
    sketch = design.rootComponent._sketches[0]
    exprs = [d.parameter.expression for d in sketch.sketchDimensions]
    assert exprs.count("rail_width") == 2  # rail0, rail1
    assert exprs.count("tie_width") == 1  # tie0
    assert "node_diameter" in exprs


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


# ---------------------------------------------------------------------------
# T68 item 2b — verify_sketch_against_manifest (Fred: "make sure the drawing
# in the addin matches the one we insert in fusion")
# ---------------------------------------------------------------------------
def test_verify_sketch_against_manifest_reports_no_mismatches_on_an_exact_unmoved_build(call_log):
    """An end-to-end build via build_constrained_sketch, never touched
    after creation — FakeSketch's own addCenterToCenterSlot/addByCenterRadius
    build the centerline/circle EXACTLY at the manifest's own p1/p2/center
    (see FakeSketch's own doc comment), so parity should read as a clean
    exact match: maxErr ~0, mismatches empty."""
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["parity"]["mismatches"] == []
    assert summary["parity"]["maxErr"] < 1e-6


def test_verify_sketch_against_manifest_reports_a_moved_point_as_mismatch():
    """Direct unit test (same ctx/sketch-construction style as the
    addByThreePoints CCW test above): build a Slot's own centerline via
    _create_slot_entity, then mutate its endSketchPoint's geometry AFTER
    creation (simulating a constraint/dimension solve that dragged it away
    from where the manifest declared it) — the moved entity's own id must
    come back in `mismatches`, and maxErr must reflect the actual distance
    moved, comfortably above the default 0.002in tol."""
    design = FakeDesign()
    logger = _Logger()
    ctx = BuildContext(design.rootComponent, design, logger)
    s_name = "TestSketch"
    ctx.entity_map[s_name] = {}
    sketch = design.rootComponent.sketches.add(design.rootComponent.xYConstructionPlane)
    curves = sketch.sketchCurves
    ent = {"id": "rail0", "type": "Slot", "p1": [0.25, 1.0], "p2": [6.75, 1.0], "width": 0.07}
    _create_slot_entity(ctx, sketch, curves, s_name, ent, None)

    centerline = ctx.entity_map[s_name]["rail0"]
    centerline.endSketchPoint.geometry.x += 0.05 * IN_TO_CM  # moved 0.05in in X

    manifest = {"entities": [ent]}
    parity = verify_sketch_against_manifest(ctx, sketch, manifest, tol=0.002)
    assert parity["mismatches"] == ["rail0"]
    assert parity["maxErr"] == pytest.approx(0.05, abs=1e-6)


def test_verify_sketch_against_manifest_arc3point_ends_compared_order_free():
    """Companion to test_arc3point_S_E_survive_addByThreePoints_own_CCW_
    normalization_even_for_a_clockwise_input above: feed a CLOCKWISE
    (p1, pMid, p2) so the fake's own addByThreePoints swaps start/end
    relative to the manifest's own p1/p2 (matching real Fusion's own CCW
    normalization, per T67's doc comment on _create_arc3_entity). Even
    though `.startSketchPoint` != manifest p1 here, verify_sketch_against_
    manifest must NOT report a mismatch — its own end comparison is
    order-free by design, unlike _create_arc3_entity's own proximity-
    tagged :S/:E (which this check deliberately does not rely on)."""
    design = FakeDesign()
    logger = _Logger()
    ctx = BuildContext(design.rootComponent, design, logger)
    s_name = "TestSketch"
    ctx.entity_map[s_name] = {}
    sketch = design.rootComponent.sketches.add(design.rootComponent.xYConstructionPlane)
    curves = sketch.sketchCurves
    ent = {"id": "seg1", "type": "Arc3Point", "p1": [1.0, 1.0], "pMid": [1.5, 0.5], "p2": [1.0, 0.0]}
    _create_arc3_entity(ctx, curves, s_name, ent)

    manifest = {"entities": [ent]}
    parity = verify_sketch_against_manifest(ctx, sketch, manifest, tol=0.002)
    assert parity["mismatches"] == []
    assert parity["maxErr"] < 1e-6


# ---------------------------------------------------------------------------
# T69 (SE15b) — the shape contour becomes slots too: _create_arc3_slot_entity
# (Fred: "want the shape contour to be made of slots")
# ---------------------------------------------------------------------------
def test_arc3_point_slot_entity_builds_via_addThreePointArcSlot_and_registers_the_construction_centerline():
    design = FakeDesign()
    logger = _Logger()
    ctx = BuildContext(design.rootComponent, design, logger)
    s_name = "TestSketch"
    ctx.entity_map[s_name] = {}
    sketch = design.rootComponent.sketches.add(design.rootComponent.xYConstructionPlane)
    curves = sketch.sketchCurves
    ent = {"id": "seg1", "type": "Arc3PointSlot", "p1": [1.0, 0.0], "pMid": [1.5, 0.5], "p2": [1.0, 1.0], "width": 0.07}
    _create_arc3_slot_entity(ctx, sketch, curves, s_name, ent, "stroke_width")

    centerline = ctx.entity_map[s_name]["seg1"]
    assert centerline.isConstruction is True
    assert ctx.entity_map[s_name]["seg1:S"].geometry.distanceTo(_to_point3d(ent["p1"])) < 1e-9
    assert ctx.entity_map[s_name]["seg1:E"].geometry.distanceTo(_to_point3d(ent["p2"])) < 1e-9
    expected_center = _circumcenter(_to_point3d(ent["p1"]), _to_point3d(ent["pMid"]), _to_point3d(ent["p2"]))
    assert ctx.entity_map[s_name]["seg1:C"].geometry.distanceTo(expected_center) < 1e-9
    # A width dimension was created AND driven by the given expression.
    assert sketch.sketchDimensions.count == 1
    assert sketch.sketchDimensions.item(0).parameter.expression == "stroke_width"


def test_arc3_point_slot_S_E_survive_addThreePointArcSlot_own_CCW_normalization_even_for_a_clockwise_input():
    """Mirror of test_arc3point_S_E_survive_addByThreePoints_own_CCW_
    normalization... above, for the slot version: a CLOCKWISE (p1, pMid,
    p2) forces the fake's own addThreePointArcSlot to swap start/end
    relative to the manifest's own p1/p2 — _create_arc3_slot_entity's own
    proximity-based relabeling must still tag :S/:E correctly regardless."""
    design = FakeDesign()
    logger = _Logger()
    ctx = BuildContext(design.rootComponent, design, logger)
    s_name = "TestSketch"
    ctx.entity_map[s_name] = {}
    sketch = design.rootComponent.sketches.add(design.rootComponent.xYConstructionPlane)
    curves = sketch.sketchCurves
    # p1/pMid/p2 ordered CLOCKWISE (same fixture already used for the
    # plain-Arc3Point CCW test above).
    ent = {"id": "seg1", "type": "Arc3PointSlot", "p1": [1.0, 1.0], "pMid": [1.5, 0.5], "p2": [1.0, 0.0], "width": 0.07}
    _create_arc3_slot_entity(ctx, sketch, curves, s_name, ent, None)

    tagged_start = ctx.entity_map[s_name]["seg1:S"]
    tagged_end = ctx.entity_map[s_name]["seg1:E"]
    assert tagged_start.geometry.distanceTo(_to_point3d(ent["p1"])) < 1e-9
    assert tagged_end.geometry.distanceTo(_to_point3d(ent["p2"])) < 1e-9


def test_addThreePointArcSlot_shim_models_the_real_start_end_pointOnArc_argument_order():
    """T70 AMEND 2's own acceptance test (advisor's own real Fusion run on
    T69's own 02b9100): the FIRST version of this fake modeled a plain
    3-point-through construction (like addByThreePoints) and could NEVER
    have caught T69's own real bug, because a circumcenter is order-
    independent — the WRONG call order still produced a numerically
    correct circle, just labeled wrong, which the old fake's own CCW
    normalization then silently "fixed" back to the right pair by
    accident. This proves the CURRENT fake actually distinguishes argument
    ROLE, not just which 3 raw values got passed: the OLD, buggy call
    shape `addThreePointArcSlot(p1, p_mid, p2, ...)` — under the REAL
    `(start, end, point_on_arc)` signature, meaning start=p1, end=p_mid,
    point_on_arc=p2 — must build an arc whose actual END is p_mid, NEVER
    the real end p2, matching the advisor's own measured symptom (every
    contour arc built only half its intended sweep)."""
    design = FakeDesign()
    sketch = design.rootComponent.sketches.add(design.rootComponent.xYConstructionPlane)
    p1, p_mid, p2 = FakePoint3D(0, 0), FakePoint3D(5, 5), FakePoint3D(10, 0)
    value_input = adsk.core.ValueInput.createByReal(0.07)
    sketch.addThreePointArcSlot(p1, p_mid, p2, value_input, True)  # the OLD, buggy call shape
    centerline = [c for c in sketch._curves if isinstance(c, FakeSketchArc) and c.isConstruction][0]
    ends = {
        (round(centerline.startSketchPoint.geometry.x, 6), round(centerline.startSketchPoint.geometry.y, 6)),
        (round(centerline.endSketchPoint.geometry.x, 6), round(centerline.endSketchPoint.geometry.y, 6)),
    }
    assert (p2.x, p2.y) not in ends  # the old call order never reaches the real end p2
    assert (p_mid.x, p_mid.y) in ends  # ...it ends at pMid instead -- the actual measured bug


def test_arc3_point_slot_centerline_not_uniquely_identifiable_raises_never_guesses():
    """The dispatch's own explicit instruction: 'if you can't identify an
    arc slot's centerline robustly... log it and skip that seg, never
    guess.' Simulated by swapping in a broken addThreePointArcSlot that
    never marks its own centerline as a construction curve — _find_arc_
    slot_centerline then finds ZERO candidates (not one it merely
    dislikes), so _create_arc3_slot_entity must raise rather than picking
    the wrong arc; wrapped in _create_geometry (a separate test below)
    this becomes a skip+report, never a silent wrong pick or a crash.
    Manual save/restore of the class method (not the pytest `monkeypatch`
    fixture) so this test also runs under this file's own plain-`python3`
    fallback mode, same as every other test here."""
    real_add = FakeSketch.addThreePointArcSlot

    def _broken_add(self, p1, p_mid, p2, value_input, create_width_dim):
        result = real_add(self, p1, p_mid, p2, value_input, create_width_dim)
        for c in self._curves:
            if isinstance(c, FakeSketchArc):
                c.isConstruction = False
        return result

    FakeSketch.addThreePointArcSlot = _broken_add
    try:
        design = FakeDesign()
        logger = _Logger()
        ctx = BuildContext(design.rootComponent, design, logger)
        s_name = "TestSketch"
        ctx.entity_map[s_name] = {}
        sketch = design.rootComponent.sketches.add(design.rootComponent.xYConstructionPlane)
        curves = sketch.sketchCurves
        ent = {"id": "seg1", "type": "Arc3PointSlot", "p1": [1.0, 0.0], "pMid": [1.5, 0.5], "p2": [1.0, 1.0], "width": 0.07}
        with pytest.raises(RuntimeError, match="could not identify the arc slot"):
            _create_arc3_slot_entity(ctx, sketch, curves, s_name, ent, None)
    finally:
        FakeSketch.addThreePointArcSlot = real_add


def _shape_contour_slot_manifest():
    """T69: a minimal, hand-built manifest for a Shape Lattice contour in
    slot mode -- one Line-slot segment tangent-Coincident to one arc-slot
    segment (mirroring what manifestFromShape now actually emits by
    default), both driven by the SAME 'stroke_width' parameter rails/ties
    use, matching the dispatch's own "same param as rails/ties" ask."""
    return {
        "version": 1, "layerId": "1", "sketchName": "Test Shape Contour Slots",
        "units": "in", "region": {"x": 0, "y": 0, "w": 7, "h": 9}, "widthMode": "slot",
        "entities": [
            {"id": "seg0", "type": "Slot", "p1": [0.0, 0.0], "p2": [1.0, 0.0], "width": 0.07},
            {"id": "seg1", "type": "Arc3PointSlot", "p1": [1.0, 0.0], "pMid": [1.5, 0.5], "p2": [1.0, 1.0], "width": 0.07},
        ],
        "constraints": [
            {"type": "Horizontal", "targets": ["seg0"]},
            {"type": "Coincident", "targets": ["seg0:E", "seg1:S"]},
            {"type": "Tangent", "targets": ["seg0", "seg1"]},
        ],
        "parameters": [{"name": "stroke_width", "value": 0.07, "unit": "in"}],
        "dimensions": [
            {"type": "SlotWidth", "target": "seg0", "expression": "stroke_width"},
            {"type": "SlotWidth", "target": "seg1", "expression": "stroke_width"},
        ],
        "groups": {"silhouette": ["seg0", "seg1"]},
        "latticePieceCount": 0,
        "latticeConstrained": True,
    }


def test_shape_contour_as_slots_end_to_end_builds_dimensions_and_reports_zero_parity_mismatches(call_log):
    """End-to-end via build_constrained_sketch (the real orchestration,
    not a direct unit call): both the Line contour segment (a Slot,
    already-existing machinery) and the Arc3PointSlot contour segment
    (T69, new) get created, dimensioned via 'stroke_width', their
    EXISTING constraints (Horizontal/Coincident/Tangent) re-target onto
    the centerlines with no special-casing, and the parity check (T68)
    reads them both back with zero mismatches on this untouched build."""
    design = FakeDesign()
    manifest = _shape_contour_slot_manifest()
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["entities"]["created"] == 2
    assert summary["entities"]["skipped"] == []
    kinds = [entry[0] for entry in call_log]
    assert "slot:addCenterToCenterSlot" in kinds
    assert "slot:addThreePointArcSlot" in kinds
    assert kinds.count("constraint:Horizontal") == 1
    assert kinds.count("constraint:Coincident") == 1
    assert kinds.count("constraint:Tangent") == 1
    assert summary["dimensions"]["count"] == 0  # no DIM MISS/CRASH/... markers
    assert summary["parity"]["mismatches"] == []
    assert summary["parity"]["maxErr"] < 1e-6


# ---------------------------------------------------------------------------
# T70 AMEND 3 — the new Symmetry constraint + a construction mirror-axis
# Line (Fred, via the advisor's own live measurement: the old mirror-Equal
# alone left the contour's two halves the same SIZE with no shared
# POSITION, drifting/collapsing under a width change or a rigid move)
# ---------------------------------------------------------------------------
def test_line_entity_isConstruction_flag_sets_the_real_attribute_when_declared():
    """The mirror-axis Line is the FIRST manifest Line that ever needs
    `isConstruction` -- every other Line entity omits the field entirely,
    so this also proves the omission path stays a real, unchanged False."""
    design = FakeDesign()
    logger = _Logger()
    ctx = BuildContext(design.rootComponent, design, logger)
    s_name = "TestSketch"
    ctx.entity_map[s_name] = {}
    sketch = design.rootComponent.sketches.add(design.rootComponent.xYConstructionPlane)
    curves = sketch.sketchCurves

    axis_ent = {"id": "axis", "type": "Line", "isConstruction": True, "p1": [0.0, -1.0], "p2": [0.0, 2.0]}
    axis_line = _create_line_entity(ctx, curves, s_name, axis_ent)
    assert axis_line.isConstruction is True

    plain_ent = {"id": "plain", "type": "Line", "p1": [0.0, 0.0], "p2": [1.0, 0.0]}
    plain_line = _create_line_entity(ctx, curves, s_name, plain_ent)
    assert plain_line.isConstruction is False


def _mirror_symmetry_manifest():
    """T70 AMEND 3: a minimal hand-built manifest proving the NEW Symmetry
    constraint end-to-end -- 2 mirrored Line entities + 1 construction
    mirror-axis Line, each end pair tied by Symmetry about the axis.
    Deliberately carries NO Equal at all: two lines whose own 4 endpoints
    are ALL pinned symmetric about the same axis have an equal length as a
    direct CONSEQUENCE, exactly the "Symmetry subsumes the old mirror-Equal
    for lines" reasoning this fix is built on -- if that reasoning were
    wrong, this fixture's own points (chosen non-trivially, not axis-
    aligned) simply wouldn't parity-match after a build."""
    return {
        "version": 1, "layerId": "1", "sketchName": "Test Mirror Symmetry",
        "units": "in", "region": {"x": 0, "y": 0, "w": 7, "h": 9}, "widthMode": "centerline",
        "entities": [
            {"id": "axis", "type": "Line", "isConstruction": True, "p1": [0.0, -1.0], "p2": [0.0, 2.0]},
            {"id": "segR", "type": "Line", "p1": [2.0, 0.0], "p2": [3.0, 1.0]},
            {"id": "segL", "type": "Line", "p1": [-2.0, 0.0], "p2": [-3.0, 1.0]},
        ],
        "constraints": [
            {"type": "Symmetry", "targets": ["segR:S", "segL:S", "axis"]},
            {"type": "Symmetry", "targets": ["segR:E", "segL:E", "axis"]},
        ],
        "parameters": [],
        "dimensions": [],
        "groups": {"silhouette": ["segR", "segL"]},
        "latticePieceCount": 0,
        "latticeConstrained": True,
    }


def test_mirror_symmetry_constraint_dispatches_via_constraint_step_with_zero_parity_mismatches(call_log):
    """End-to-end via build_constrained_sketch: the axis builds as a real
    construction Line, both Symmetry constraints dispatch through
    fb_engine's own constraint_step (a genuinely NEW type there, T70), and
    the parity check reads back an untouched build with zero mismatches."""
    design = FakeDesign()
    manifest = _mirror_symmetry_manifest()
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["entities"]["created"] == 3
    assert summary["entities"]["skipped"] == []
    kinds = [entry[0] for entry in call_log]
    assert kinds.count("constraint:Symmetry") == 2
    assert summary["constraints"]["count"] == 0  # no CONSTRAINT SKIP/FAIL/MISS/WRAP FAIL markers
    assert summary["parity"]["mismatches"] == []
    assert summary["parity"]["maxErr"] < 1e-6


# ---------------------------------------------------------------------------
# T70 AMEND 4/5 — the mirror axis anchored to the sketch origin (never
# Fix), and param-driven overall-size Distance dims (referencing the
# board's own PRE-EXISTING widthIn/heightIn parameters, never re-declared)
# ---------------------------------------------------------------------------
def _mirror_anchor_and_size_manifest():
    """A construction mirror axis Coincident to the origin (AMEND 4), 2
    mirrored Line segments tied to it via Symmetry (AMEND 3's own
    mechanism, unchanged), and a Distance dim between them driven by
    'widthIn' (AMEND 5) -- proves the full anchor+size chain end-to-end,
    not just origin-Coincident in isolation.

    T71: the Distance dim's own targets are point-suffixed ('segR:S'/
    'segL:S'), not the OLD bare curve ids -- this fixture predates T71's
    own addDistanceDimension curve-rejection fix (below), and a bare-id
    target would now correctly raise inside the fake, turning this into a
    DIM CRASH instead of the dim:Distance dispatch this test actually
    means to prove. The mirror-axis/Symmetry machinery itself is
    UNCHANGED/still-generic fb_engine capability (T71 only stops the JS
    manifest PRODUCER from emitting it for the contour, see
    editor-sketch-manifest.js) -- this fixture is a hand-built manifest,
    independent of what that producer currently emits."""
    return {
        "version": 1, "layerId": "1", "sketchName": "Test Mirror Anchor Size",
        "units": "in", "region": {"x": 0, "y": 0, "w": 7, "h": 9}, "widthMode": "centerline",
        "entities": [
            {"id": "axis", "type": "Line", "isConstruction": True, "p1": [0.0, -1.0], "p2": [0.0, 2.0]},
            {"id": "segR", "type": "Line", "p1": [2.0, 0.0], "p2": [3.0, 1.0]},
            {"id": "segL", "type": "Line", "p1": [-2.0, 0.0], "p2": [-3.0, 1.0]},
        ],
        "constraints": [
            {"type": "Coincident", "targets": ["origin", "axis"]},
            {"type": "Symmetry", "targets": ["segR:S", "segL:S", "axis"]},
            {"type": "Symmetry", "targets": ["segR:E", "segL:E", "axis"]},
        ],
        "parameters": [],
        "dimensions": [
            {"type": "Distance", "targets": ["segR:S", "segL:S"], "orientation": "Horizontal", "expression": "widthIn"},
        ],
        "groups": {"silhouette": ["segR", "segL"]},
        "latticePieceCount": 0,
        "latticeConstrained": True,
    }


def _curve_targeted_distance_manifest():
    """T71: the OLD, buggy shape the fixture above just moved away from --
    a Distance dim targeting 2 bare curve ids instead of 2 points. Real
    Fusion's addDistanceDimension rejects this outright ("Wrong number or
    type of arguments", AMEND 6's own live measurement); proves the fake
    now catches the SAME regression instead of silently accepting it."""
    return {
        "version": 1, "layerId": "1", "sketchName": "Test Curve Distance Rejected",
        "units": "in", "region": {"x": 0, "y": 0, "w": 7, "h": 9}, "widthMode": "centerline",
        "entities": [
            {"id": "segR", "type": "Line", "p1": [2.0, 0.0], "p2": [3.0, 1.0]},
            {"id": "segL", "type": "Line", "p1": [-2.0, 0.0], "p2": [-3.0, 1.0]},
        ],
        "constraints": [],
        "parameters": [],
        "dimensions": [
            {"type": "Distance", "targets": ["segR", "segL"], "orientation": "Horizontal", "expression": "widthIn"},
        ],
        "groups": {"silhouette": ["segR", "segL"]},
        "latticePieceCount": 0,
        "latticeConstrained": True,
    }


def test_distance_dim_targeting_a_bare_curve_id_is_rejected_not_silently_accepted(call_log):
    """T71: build_constrained_sketch's own skip-and-report contract (this
    file's own header docstring: a bad target is skipped, logged, and the
    build continues -- never raises past this function) means the shim's
    new TypeError surfaces as a graceful DIM CRASH, not a hard crash of
    the whole build -- and, critically, the dimension is NEVER actually
    created (dim:Distance never logged), unlike before this fix where the
    fake silently accepted the curve and logged success."""
    design = FakeDesign()
    manifest = _curve_targeted_distance_manifest()
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    kinds = [entry[0] for entry in call_log]
    assert kinds.count("dim:Distance") == 0  # rejected before ever logging success
    assert summary["dimensions"]["count"] == 1  # exactly one DIM CRASH marker, not a silent pass
    assert summary["entities"]["created"] == 2  # the geometry itself still built fine


def test_origin_anchor_and_distance_dim_dispatch_end_to_end_with_zero_parity_mismatches(call_log):
    """End-to-end via build_constrained_sketch: Coincident(['origin','axis'])
    dispatches (resolving 'origin' via the entity_map registration in
    build_constrained_sketch, zero fb_engine changes), the Distance dim
    dispatches through dimension_step's own pre-existing Targets/
    Orientation branch (a previously-unused existing path, not new
    surface), and the parity check reads back an untouched build clean."""
    design = FakeDesign()
    manifest = _mirror_anchor_and_size_manifest()
    summary = build_constrained_sketch(design.rootComponent, design, manifest)
    assert summary["entities"]["created"] == 3
    assert summary["entities"]["skipped"] == []
    kinds = [entry[0] for entry in call_log]
    assert kinds.count("constraint:Coincident") == 1
    assert kinds.count("constraint:Symmetry") == 2
    assert kinds.count("dim:Distance") == 1
    assert summary["constraints"]["count"] == 0
    assert summary["dimensions"]["count"] == 0
    assert summary["parity"]["mismatches"] == []
    assert summary["parity"]["maxErr"] < 1e-6


if __name__ == "__main__":
    # Plain-Python fallback (no pytest needed), same dual-mode convention
    # frame-builder/test_templates.py already documents.
    import traceback
    tests = [
        test_to_point3d_converts_inches_to_cm,
        test_build_order_parameters_before_geometry_before_constraints_before_dimensions,
        test_all_geometry_entities_created,
        test_arc3point_entity_builds_via_addByThreePoints_and_connects_to_its_neighbours_by_geometry,
        test_arc3point_S_E_survive_addByThreePoints_own_CCW_normalization_even_for_a_clockwise_input,
        test_slot_False_create_width_dim_yields_DIM_MISS_not_a_silently_undimensioned_slot,
        test_sketch_name_override_takes_priority_over_the_manifest_own_sketchName,
        test_coordinates_land_in_cm_not_inches,
        test_parameters_created_then_updated_on_a_second_build,
        test_skip_and_report_a_missing_geometry_target_never_aborts_the_build,
        test_skip_and_report_an_unknown_entity_type_never_aborts_the_build,
        test_threshold_case_still_creates_slots_and_slot_width_dims_but_no_relationship_constraints,
        test_slot_creation_is_never_anchored_but_still_creates_its_own_width_dimension,
        test_shim_itself_refuses_isFixed_True_so_this_regression_class_cannot_pass_silently,
        test_slot_width_dimension_expressions_match_the_manifest,
        test_no_symmetry_constraint_is_ever_added_for_a_slot,
        test_centerline_width_mode_still_builds_a_plain_line_with_no_slot_mechanism,
        test_length_parameters_created_with_unit_bearing_expression,
        test_unitless_parameters_created_with_createByReal,
        test_build_from_manifest_file_raises_clearly_with_no_active_design,
        test_verify_sketch_against_manifest_reports_no_mismatches_on_an_exact_unmoved_build,
        test_verify_sketch_against_manifest_reports_a_moved_point_as_mismatch,
        test_verify_sketch_against_manifest_arc3point_ends_compared_order_free,
        test_arc3_point_slot_entity_builds_via_addThreePointArcSlot_and_registers_the_construction_centerline,
        test_arc3_point_slot_S_E_survive_addThreePointArcSlot_own_CCW_normalization_even_for_a_clockwise_input,
        test_addThreePointArcSlot_shim_models_the_real_start_end_pointOnArc_argument_order,
        test_arc3_point_slot_centerline_not_uniquely_identifiable_raises_never_guesses,
        test_shape_contour_as_slots_end_to_end_builds_dimensions_and_reports_zero_parity_mismatches,
        test_line_entity_isConstruction_flag_sets_the_real_attribute_when_declared,
        test_mirror_symmetry_constraint_dispatches_via_constraint_step_with_zero_parity_mismatches,
        test_origin_anchor_and_distance_dim_dispatch_end_to_end_with_zero_parity_mismatches,
        test_distance_dim_targeting_a_bare_curve_id_is_rejected_not_silently_accepted,
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
