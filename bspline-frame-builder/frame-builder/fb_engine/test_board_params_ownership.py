"""
FB-ORDER (Fred 2026-09-26): "only Send to Fusion can create" widthIn/
heightIn — the frame builder must SKIP them entirely (never create,
never update), and must refuse to build at all if they're missing yet
(the user hasn't run Send to Fusion for this document).

Installs a minimal fake adsk.core/adsk.fusion BEFORE importing
frame_engine/parametric_engine (both import adsk at module level) — same
stub-then-import idiom this project's other Fusion-adjacent test files
already use (test_document_discovery.py, b-spline-gen's own
test_sketch_manifest_builder.py), kept deliberately small: neither
module under test calls into adsk at IMPORT time beyond the bare
`import adsk.core, adsk.fusion` statement itself (confirmed by getting
this file's own imports to succeed at all).

CROSS-FILE GOTCHA (found running the whole tree together, not just this
file): b-spline-gen's sketch_manifest_builder.py imports these SAME
fb_engine.* modules (fb_engine.build_context etc. are shared between the
frame-builder and b-spline-gen tools inside the one add-in — see that
module's own "already on sys.path by the time run() has bootstrapped"
comment). Python caches each module on FIRST import, so whichever test
file's stub-install runs first "wins" fb_engine.build_context for the
REST of the pytest process — test_sketch_manifest_builder.py's own
BuildContext ended up permanently bound to THIS file's minimal adsk
stub (missing `.userInterface`) when both ran in one invocation,
failing with an unrelated-looking AttributeError. Evicting every
fb_engine.* module (and this file's own frame_engine/parametric_engine)
from sys.modules before installing the stub forces a FRESH import under
THIS stub every time this file runs, regardless of what ran before it —
test_sketch_manifest_builder.py needs the same eviction for the reverse
order, and got it in this same turn.

Run with:
    cd bspline-frame-builder/frame-builder
    python3 -m pytest fb_engine/test_board_params_ownership.py
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.realpath(__file__))
_FRAME_BUILDER_ROOT = os.path.dirname(_HERE)
if _FRAME_BUILDER_ROOT not in sys.path:
    sys.path.insert(0, _FRAME_BUILDER_ROOT)


# EXPLICIT list, not a "fb_engine." prefix match — fb_engine/ is a real
# package (has __init__.py) and pytest registers THIS test file itself
# as `fb_engine.test_board_params_ownership`; a prefix match would evict
# the in-progress module currently being imported and crash with a
# confusing `KeyError` from inside importlib.
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

    class _FakeValueInput:
        @staticmethod
        def createByReal(v):
            return ("real", v)

        @staticmethod
        def createByString(s):
            return ("string", s)

    adsk.core.ValueInput = _FakeValueInput
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = adsk.core
    sys.modules["adsk.fusion"] = adsk.fusion
    sys.modules["adsk.cam"] = adsk.cam


_evict_shared_fb_engine_modules()
_install_fake_adsk()

import pytest

from fb_engine.parameter_schema import ParameterSchema
from fb_engine import frame_engine
from fb_engine.parametric_engine import ParametricSketchBuilder


# ---------------------------------------------------------------------
# ParameterSchema.is_board_owned / BOARD_OWNED_PARAMS — the declared list
# ---------------------------------------------------------------------
class TestBoardOwnedParams:
    def test_widthIn_and_heightIn_are_board_owned(self):
        assert ParameterSchema.is_board_owned("widthIn")
        assert ParameterSchema.is_board_owned("heightIn")

    def test_an_ordinary_frame_param_is_not_board_owned(self):
        assert not ParameterSchema.is_board_owned("frame_thickness")
        assert not ParameterSchema.is_board_owned("boundingboxoffset")

    def test_declared_list_is_exactly_the_two_board_params(self):
        assert ParameterSchema.BOARD_OWNED_PARAMS == ("widthIn", "heightIn")


# ---------------------------------------------------------------------
# Fake userParameters collection for the two test classes below.
# ---------------------------------------------------------------------
class FakeUserParam:
    def __init__(self, name, expression=""):
        self.name = name
        self.expression = expression


class FakeUserParams:
    def __init__(self, existing=()):
        self._by_name = {p.name: p for p in existing}
        self.added = []  # every (name, value_input, unit, comment) passed to .add

    def itemByName(self, name):
        return self._by_name.get(name)

    def add(self, name, value_input, unit, comment):
        p = FakeUserParam(name)
        self._by_name[name] = p
        self.added.append((name, value_input, unit, comment))
        return p


class FakeDesign:
    def __init__(self, existing_params=()):
        self.userParameters = FakeUserParams(existing_params)


class FakeLogger:
    def log(self, *a, **k):
        pass

    def log_error(self, *a, **k):
        pass


# ---------------------------------------------------------------------
# parametric_engine._sync_user_parameters — must SKIP board-owned names
# ---------------------------------------------------------------------
class FakeCtx:
    def __init__(self, design):
        self.design = design
        self.logger = FakeLogger()


class TestSyncUserParametersSkipsBoardOwned:
    def _builder(self):
        # _sync_user_parameters only reads self.resolver (via hasattr) —
        # a bare object with no `resolver` attribute at all takes the
        # "no resolver" branch cleanly, same as a real builder built
        # without one.
        return ParametricSketchBuilder.__new__(ParametricSketchBuilder)

    def test_widthIn_and_heightIn_are_never_created_even_when_missing(self):
        design = FakeDesign()
        ctx = FakeCtx(design)
        builder = self._builder()

        builder._sync_user_parameters(ctx, {"widthIn": "7", "heightIn": "9", "frame_thickness": "0.5"})

        added_names = [name for name, *_ in design.userParameters.added]
        assert "widthIn" not in added_names
        assert "heightIn" not in added_names
        assert "frame_thickness" in added_names  # an ordinary param is still synced

    def test_an_EXISTING_widthIn_is_never_updated_either(self):
        existing = FakeUserParam("widthIn", expression="7")
        design = FakeDesign(existing_params=[existing])
        ctx = FakeCtx(design)
        builder = self._builder()

        builder._sync_user_parameters(ctx, {"widthIn": "999"})

        assert existing.expression == "7"  # untouched -- Send to Fusion owns writes to this name

    def test_ui_data_with_only_board_params_creates_nothing(self):
        design = FakeDesign()
        ctx = FakeCtx(design)
        builder = self._builder()

        builder._sync_user_parameters(ctx, {"widthIn": "7", "heightIn": "9"})

        assert design.userParameters.added == []


# ---------------------------------------------------------------------
# frame_engine._require_board_params — refuse to build before Send to
# Fusion has run, with NO Fusion object created (checked before any
# component/sketch call).
# ---------------------------------------------------------------------
class FakeBuilder:
    def __init__(self, user_params):
        self.user_params = user_params


class TestRequireBoardParams:
    def test_raises_a_clear_message_when_both_are_missing(self):
        builder = FakeBuilder(FakeUserParams())
        with pytest.raises(RuntimeError, match="Run Send to Fusion first"):
            frame_engine._require_board_params(builder)

    def test_raises_when_only_one_is_missing(self):
        builder = FakeBuilder(FakeUserParams(existing=[FakeUserParam("widthIn")]))
        with pytest.raises(RuntimeError, match="heightIn"):
            frame_engine._require_board_params(builder)

    def test_does_not_raise_once_both_exist(self):
        builder = FakeBuilder(FakeUserParams(existing=[FakeUserParam("widthIn"), FakeUserParam("heightIn")]))
        frame_engine._require_board_params(builder)  # no raise


# ---------------------------------------------------------------------
# FB-APP S0: the template is the ONE declaration of every frame param.
# _create_skeletal_parameters must not create the two dead params
# (Skel_Slot_Tolerance / Skel_Frame_Taper — nothing reads them; the
# extrude hard-codes 0 deg) nor write an existing param's raw .value
# (the old hard-coded base requirements set frame_thickness to -1.905 cm
# on EVERY build before the template overwrote it).
# ---------------------------------------------------------------------
from fb_engine.fb_value_resolver import FBValueResolver
from fb_engine.template_resolver import resolve_template

_DEAD_PARAMS = ("Skel_Slot_Tolerance", "Skel_Frame_Taper")
# Params the engine's own phases / template_factory reference by name —
# with the base requirements gone, each template must declare them.
_ENGINE_REFERENCED_PARAMS = ("frame_thickness", "boundingboxoffset")


class RecordingParam(FakeUserParam):
    def __init__(self, name, expression=""):
        super().__init__(name, expression)
        self.value_writes = []

    @property
    def value(self):
        return 0.0

    @value.setter
    def value(self, v):
        self.value_writes.append(v)


def _skeletal_builder(existing):
    design = types.SimpleNamespace(userParameters=FakeUserParams(existing), unitsManager=None)
    fb = frame_engine.FrameBuilder.__new__(frame_engine.FrameBuilder)
    fb.design = design
    fb.user_params = design.userParameters
    fb.logger = FakeLogger()
    fb.resolver = FBValueResolver(design, fb.logger)
    return fb


class TestFrameParamsSingleDeclaration:
    @pytest.mark.parametrize("style_id", ["Template 1", "Template 2"])
    def test_dead_params_are_never_created(self, style_id):
        fb = _skeletal_builder([FakeUserParam("widthIn", "7"), FakeUserParam("heightIn", "9")])
        fb._create_skeletal_parameters(None, style_id, {})
        added = [name for name, *_ in fb.user_params.added]
        for dead in _DEAD_PARAMS:
            assert dead not in added
        assert "frame_thickness" in added  # the template's own declaration still creates it

    def test_an_existing_frame_param_never_gets_a_raw_value_write(self):
        ft = RecordingParam("frame_thickness", "0.75 in")
        bbo = RecordingParam("boundingboxoffset", "0.25 in")
        fb = _skeletal_builder([FakeUserParam("widthIn", "7"), FakeUserParam("heightIn", "9"), ft, bbo])
        fb._create_skeletal_parameters(None, "Template 1", {})
        assert ft.value_writes == []
        assert bbo.value_writes == []
        assert ft.expression == "0.75"  # set once, from the template's declared Val (unit comes from the param)

    def test_taper_is_no_longer_a_unit_rule(self):
        assert ParameterSchema.name_based_unit("Skel_Frame_Taper") == "in"

    @pytest.mark.parametrize("style_id", ["Template 1", "Template 2"])
    def test_every_template_declares_the_engine_referenced_params(self, style_id):
        # Pins a fact that is ALREADY true (both templates declare both) —
        # it guards the removal: nothing else creates these params now.
        template, _ = resolve_template(style_id)
        declared = {p["Name"] for s in template["Sketches"] for p in s.get("Parameters", [])}
        for name in _ENGINE_REFERENCED_PARAMS:
            assert name in declared




class TestTrimOffsetIsSentNotMaster:
    """FB-APP F9 (gate A): boundingboxoffset (the app's "Trim offset") is a
    normal template param, not a ReadOnly MASTER. A master is created once
    from the template default and never updated, so a value sent from the
    app was silently ignored. Now the resolver writes it on every build."""

    @pytest.mark.parametrize("style_id", ["Template 1", "Template 2"])
    def test_an_existing_trim_offset_takes_the_sent_value(self, style_id):
        bbo = RecordingParam("boundingboxoffset", "0.25 in")
        fb = _skeletal_builder([FakeUserParam("widthIn", "7"), FakeUserParam("heightIn", "9"), bbo])
        fb._create_skeletal_parameters(None, style_id, {"boundingboxoffset": 0.5})
        assert bbo.expression == "0.5"
        assert bbo.value_writes == []

    @pytest.mark.parametrize("style_id", ["Template 1", "Template 2"])
    def test_a_new_document_is_born_with_the_sent_value(self, style_id):
        fb = _skeletal_builder([FakeUserParam("widthIn", "7"), FakeUserParam("heightIn", "9")])
        fb._create_skeletal_parameters(None, style_id, {"boundingboxoffset": 0.375})
        assert fb.user_params.itemByName("boundingboxoffset").expression == "0.375"

    @pytest.mark.parametrize("style_id", ["Template 1", "Template 2"])
    def test_without_a_sent_value_the_template_default_is_used(self, style_id):
        fb = _skeletal_builder([FakeUserParam("widthIn", "7"), FakeUserParam("heightIn", "9")])
        fb._create_skeletal_parameters(None, style_id, {})
        assert fb.user_params.itemByName("boundingboxoffset").expression == "0.25"

# ---------------------------------------------------------------------
# FB-FIX (F4), engine parts: resolve_val through the ONE resolver (never a
# silent 0), addOffset2 given the curve LIST it requires, and the declared
# frame-fit warning in the build.
# ---------------------------------------------------------------------
from fb_engine.build_context import BuildContext
from fb_engine.parameter_schema import ResolveError
from fb_engine import offsets


class _RecLogger(FakeLogger):
    def __init__(self):
        self.entries = []

    def log(self, msg, level=None):
        self.entries.append((level, str(msg)))

    def log_error(self, msg):
        self.entries.append(("ERROR", str(msg)))


def _ctx(ui_data=None, evaluate=None):
    ctx = BuildContext.__new__(BuildContext)
    ctx.active_vars = ui_data or {}
    ctx.logger = _RecLogger()

    def _eval(expr, unit):
        if evaluate and expr in evaluate:
            return evaluate[expr]
        raise RuntimeError(f"no such parameter {expr!r}")

    ctx.design = types.SimpleNamespace(unitsManager=types.SimpleNamespace(evaluateExpression=_eval))
    return ctx


class TestResolveValUnits:
    def test_unit_suffixed_ui_value_resolves(self):
        assert _ctx({"frame_thickness": "0.75 in"}).resolve_val("frame_thickness") == pytest.approx(1.905)

    def test_bare_ui_number_is_inches_not_cm(self):
        assert _ctx({"frame_thickness": 0.75}).resolve_val("frame_thickness") == pytest.approx(1.905)

    def test_toggle_stays_unitless(self):
        assert _ctx({"ck_arc_hip_weld": 1.0}).resolve_val("ck_arc_hip_weld") == 1.0

    def test_unresolvable_ui_value_raises(self):
        ctx = _ctx({"frame_thickness": "thick"})
        with pytest.raises(ResolveError):
            ctx.resolve_val("frame_thickness")
        assert any(level == "ERROR" and "FAIL RESOLVE" in m for level, m in ctx.logger.entries)

    def test_unresolvable_expression_raises_not_zero(self):
        with pytest.raises(ResolveError):
            _ctx().resolve_val("no_such_param")

    def test_expressions_still_go_to_fusion(self):
        assert _ctx(evaluate={"widthIn/2": 8.89}).resolve_val("widthIn/2") == 8.89


class _Coll:
    def __init__(self, items):
        self._items = list(items)

    @property
    def count(self):
        return len(self._items)

    def item(self, i):
        return self._items[i]


def _boom(*a):
    raise RuntimeError("boom")


class TestParametricOffsetCall:
    def _sketch(self, seen):
        def create(curves, value):
            # Mirrors the SWIG signature: std::vector<Ptr<SketchCurve>> means a
            # Python list; an ObjectCollection raised "argument 2 of type ..." live.
            if not isinstance(curves, list):
                raise TypeError("in method GeometricConstraints_createOffsetInput, argument 2 "
                                "of type std::vector< adsk::core::Ptr< adsk::fusion::SketchCurve > >")
            seen.append(curves)
            return "input"

        param = types.SimpleNamespace(expression="")
        constraint = types.SimpleNamespace(isValid=True, offsetCurves=None,
                                           dimension=types.SimpleNamespace(parameter=param))
        gc = types.SimpleNamespace(createOffsetInput=create, addOffset2=lambda inp: constraint)
        return types.SimpleNamespace(geometricConstraints=gc), constraint

    def _patch(self, monkeypatch):
        monkeypatch.setattr(offsets.adsk.fusion, "SketchCurve",
                            types.SimpleNamespace(cast=lambda e: e), raising=False)
        monkeypatch.setattr(offsets.adsk.core, "ValueInput",
                            types.SimpleNamespace(createByString=lambda s: s), raising=False)

    def test_add_offset2_gets_a_curve_list_and_links_the_param(self, monkeypatch):
        self._patch(monkeypatch)
        seen = []
        sketch, constraint = self._sketch(seen)
        ctx = _ctx()
        offsets._try_parametric_offset(ctx, sketch, _Coll(["c1", "c2"]), "frame_thickness", "T1_3")
        assert seen == [["c1", "c2"]]
        assert constraint.dimension.parameter.expression == "frame_thickness"
        assert any("OFFSET PARAMETRIC OK" in m for _, m in ctx.logger.entries)

    def test_a_failed_parametric_offset_is_a_warning_not_debug(self, monkeypatch):
        self._patch(monkeypatch)
        gc = types.SimpleNamespace(createOffsetInput=_boom, addOffset2=None)
        ctx = _ctx()
        result = offsets._try_parametric_offset(ctx, types.SimpleNamespace(geometricConstraints=gc),
                                                _Coll(["c"]), "frame_thickness", "T1_3")
        assert result is None
        assert any(level == "WARNING" and "NON-parametric" in m for level, m in ctx.logger.entries)


class _ValParam(FakeUserParam):
    def __init__(self, name, value_cm):
        super().__init__(name)
        self.value = value_cm


class TestFrameFitInTheBuild:
    def _fb(self, w_in, h_in):
        fb = frame_engine.FrameBuilder.__new__(frame_engine.FrameBuilder)
        fb.fit = None
        fb.logger = _RecLogger()
        fb.user_params = FakeUserParams([
            _ValParam("widthIn", w_in * 2.54), _ValParam("heightIn", h_in * 2.54),
            _ValParam("frame_thickness", 0.75 * 2.54), _ValParam("boundingboxoffset", 0.25 * 2.54)])
        return fb

    def test_too_small_board_warns_and_reports(self):
        fb = self._fb(5.51, 1.97)
        fit = fb._check_frame_fit()
        assert fit["ok"] is False and fb.fit is fit
        assert any(level == "WARNING" and "Board too small" in m for level, m in fb.logger.entries)

    def test_normal_board_is_quiet(self):
        fb = self._fb(7, 9)
        assert fb._check_frame_fit()["ok"] is True
        assert not any(level == "WARNING" for level, _ in fb.logger.entries)


# ---------------------------------------------------------------------
# F14 (S6): the frame component carries the template it is built from, so
# the solid build can read that template's declared frame features
# (solid_coordinator.TEMPLATE_ID_ATTR).
# ---------------------------------------------------------------------
class TestFrameBuilderDefaultLogger:
    """H23 item 26 (seat B's own finding): FrameBuilder() constructed with NO external_logger used to crash --
    frame_engine.py's own `self.logger = logger.DebugLogger(addin_root)` read the MODULE-LEVEL `logger`
    variable (an already-constructed DebugLogger INSTANCE, module scope line ~33), not the `fb_logger` MODULE
    (imported two lines earlier) -- an AttributeError every time, since a DebugLogger instance has no
    `.DebugLogger` attribute of its own. Only the explicit-external_logger path (passed by every REAL caller
    today) ever avoided it, which is why this went unnoticed."""

    def _fake_design(self):
        return types.SimpleNamespace(
            rootComponent=types.SimpleNamespace(),
            userParameters=FakeUserParams(),
            unitsManager=types.SimpleNamespace(),
        )

    def test_constructing_with_no_logger_does_not_crash(self, monkeypatch):
        design = self._fake_design()
        monkeypatch.setattr(frame_engine.adsk.core, "Application",
                             types.SimpleNamespace(get=lambda: types.SimpleNamespace(activeProduct=design)), raising=False)
        monkeypatch.setattr(frame_engine.adsk.fusion, "Design",
                             types.SimpleNamespace(cast=lambda x: x), raising=False)
        recorded = []
        monkeypatch.setattr(frame_engine.fb_logger, "DebugLogger",
                             lambda root: recorded.append(root) or FakeLogger(), raising=False)

        fb = frame_engine.FrameBuilder()  # no external_logger -- the exact crashing call

        assert recorded, "fb_logger.DebugLogger (the MODULE) must be the one constructed, not the instance"
        assert fb.logger is not None


class TestTemplateIdStamp:
    def _builder(self, monkeypatch):
        # the adsk frame_engine bound at import (another test file may swap the stub)
        monkeypatch.setattr(frame_engine.adsk.core, "Matrix3D",
                            types.SimpleNamespace(create=lambda: None), raising=False)

        class _Attrs:
            def __init__(self):
                self.added = {}

            def add(self, group, name, value):
                self.added[(group, name)] = value

        class _Occs(list):
            def addNewComponent(self, m):
                occ = types.SimpleNamespace(component=types.SimpleNamespace(name="", attributes=_Attrs()))
                self.append(occ)
                return occ

        fb = frame_engine.FrameBuilder.__new__(frame_engine.FrameBuilder)
        fb.root = types.SimpleNamespace(occurrences=_Occs())
        fb.logger = types.SimpleNamespace(log=lambda *a, **k: None)
        return fb

    def test_the_component_is_stamped_with_its_template(self, monkeypatch):
        fb = self._builder(monkeypatch)
        comp = fb._create_incremental_component("template_2")
        assert comp.name == "Frame_1"
        assert comp.attributes.added == {("FrameBuilder", "ComponentType"): "Frame",
                                         ("FrameBuilder", "TemplateId"): "template_2"}
