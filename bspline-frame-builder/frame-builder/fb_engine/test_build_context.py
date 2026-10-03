"""
H23 item 41: BuildContext.resolve_val must never treat a DNA/derived param's own declared FORMULA
STRING (e.g. T7's own 't7_a', T10's own 'archRise' chain) as a plain value.

Root cause (traced, not guessed, file:line): `active_vars` is `ui_data` VERBATIM
(build_context.py's own `__init__`: `self.active_vars = ui_data if ui_data else {}`). For an
UNSEEDED/default Send, frame-panel.js's `framePayload()` -> `frameParam()` falls back to the
template's own declared `default` for every frame-owned param (frame-defs.json), which for a
DNA/derived param IS a formula string, not a number -- send_frame.py's own `frame_ui_data()`
(`{k: str(v) for k, v in params.items() if k in declared_names}`) passes it straight through. So
`active_vars['t7_a']` is the formula string `'((0.62*(widthIn/2 - boundingboxoffset)...))'`, and
`resolve_val('t7_a')` found it present and tried `ParameterSchema.to_cm` on it directly --
`to_cm` only ever parses "a number or a unit-suffixed string" (its own docstring), never a
multi-term expression, so it raised. MEASURED live (H23 item 40): this is the EXACT crash T7 and
T10's own real default Sends hit, 0 bars built, via the real send_frame.py -> frame_engine.py ->
BuildContext path (not a harness artifact -- frame_engine.py's own `_create_skeletal_parameters`,
Phase 1/2, ALREADY creates `t7_a` etc. as a real Fusion user parameter with this exact expression,
correctly resolvable by Fusion's own `unitsManager.evaluateExpression` -- `active_vars` is simply
never updated to reflect that, so `resolve_val` never asks).

Installs the SAME minimal fake adsk.core/adsk.fusion BEFORE importing fb_engine.build_context (it
imports adsk at module level) -- the established stub-then-import idiom
(test_board_params_ownership.py's own docstring; test_inner_corners.py's own matching pattern),
`BuildContext.__new__` + a fake `design.unitsManager.evaluateExpression` standing in for Fusion's
own expression engine.
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

import pytest  # noqa: E402

from fb_engine.build_context import BuildContext  # noqa: E402
from fb_engine.parameter_schema import ResolveError  # noqa: E402


class FakeLogger:
    def __init__(self):
        self.entries = []

    def log(self, msg, level=None):
        self.entries.append((level, str(msg)))

    def log_error(self, msg):
        self.entries.append(("ERROR", str(msg)))


def _ctx(active_vars, evaluate=None):
    ctx = BuildContext.__new__(BuildContext)
    ctx.logger = FakeLogger()
    ctx.active_vars = active_vars

    def _eval(expr, unit):
        if evaluate and expr in evaluate:
            return evaluate[expr]
        raise RuntimeError(f"no such Fusion parameter {expr!r}")

    ctx.design = types.SimpleNamespace(unitsManager=types.SimpleNamespace(evaluateExpression=_eval))
    return ctx


T7_A_FORMULA = ('((0.62*(widthIn/2 - boundingboxoffset) + 0.84*(heightIn/2 - boundingboxoffset)) - '
                'abs(0.62*(widthIn/2 - boundingboxoffset) - 0.84*(heightIn/2 - boundingboxoffset))) / 2')


def test_a_plain_number_override_resolves_via_to_cm_never_touching_fusion():
    """A genuine user override (a bare number) must resolve WITHOUT ever calling Fusion's own
    evaluator -- the fake raises if asked for an unexpected name, so reaching it would fail loudly."""
    ctx = _ctx({'frame_thickness': '0.9'})
    assert ctx.resolve_val('frame_thickness') == pytest.approx(0.9 * 2.54)


def test_a_unit_suffixed_override_resolves_via_to_cm_never_touching_fusion():
    ctx = _ctx({'frame_thickness': '0.9 in'})
    assert ctx.resolve_val('frame_thickness') == pytest.approx(0.9 * 2.54)


def test_a_dna_formula_string_falls_through_to_fusions_own_evaluator():
    """H23 item 41's own fix: active_vars holding the DECLARED FORMULA (not a number) for a
    DNA/derived param must fall through to design.unitsManager.evaluateExpression -- the exact
    live crash (T7's own t7_a, T10's own archRise chain) this item traced and fixed at the root."""
    ctx = _ctx({'t7_a': T7_A_FORMULA}, evaluate={'t7_a': 1.234})
    assert ctx.resolve_val('t7_a') == pytest.approx(1.234)
    assert any('falling through' in msg for _, msg in ctx.logger.entries)


def test_a_name_absent_from_active_vars_still_resolves_via_fusion_unchanged():
    """The pre-existing, already-working path (a name Fusion alone knows, e.g. widthIn/2) --
    confirms the fix didn't touch this branch's own behaviour."""
    ctx = _ctx({}, evaluate={'widthIn/2': 8.89})
    assert ctx.resolve_val('widthIn/2') == pytest.approx(8.89)


def test_a_dna_formula_string_with_no_matching_fusion_parameter_still_raises_resolve_error():
    """If Fusion genuinely has no such parameter either (a real gap, not this item's own case),
    the fallthrough's own failure still surfaces as ResolveError -- no silent 0, matching
    resolve_val's own pre-existing contract for every other unresolvable name."""
    ctx = _ctx({'t7_a': T7_A_FORMULA}, evaluate={})
    with pytest.raises(ResolveError):
        ctx.resolve_val('t7_a')
