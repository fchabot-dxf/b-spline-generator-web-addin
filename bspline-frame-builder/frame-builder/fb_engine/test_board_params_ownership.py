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
    "fb_engine.template_factory", "frame_engine", "parametric_engine",
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
