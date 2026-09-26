"""
T74 AMEND 5 (Fred, live: a hand-drawn layer got sent to Fusion as a
LATTICE constrained sketch instead of its own artwork) — `_svg_layer_
import_plan` (b-spline-gen.py) is the PURE, Fusion-API-free per-layer
decision `_import_all_svg_layers` now executes: given a layer's own
`sketchManifest`/`svg` payload fields and whether a Design is in scope,
decide whether to build a constrained sketch, import plain SVG, both, or
(for the "manifest present but no Design" edge case) log-and-skip the
sketch while still importing whatever SVG remains.

This is the FIRST test file to import `b-spline-gen.py` at all (a real
Fusion add-in entry point, hyphenated filename, several class definitions
that subclass adsk.core.* event-handler base classes at MODULE level) —
no existing pytest file exercises it. The adsk.* stub below is deliberately
NOT the full `_install_adsk_stubs()` from test_sketch_manifest_builder.py
(that one is tailored to sketch_manifest_builder.py's own narrower needs
and doesn't define the event-handler base classes this file's classes
extend) — it covers exactly the adsk.core/adsk.fusion/adsk.cam symbols
b-spline-gen.py references anywhere (grep-verified), giving each one just
enough behavior to let the module IMPORT successfully; nothing here needs
to be functionally complete, since this suite only ever calls the one
pure function under test, never anything that touches real Fusion state.
"""
import importlib.util
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)


def _install_bspline_gen_adsk_stubs():
    """Registers minimal adsk/adsk.core/adsk.fusion/adsk.cam stub modules
    in sys.modules, sufficient to import b-spline-gen.py. Idempotent (a
    repeat call is a no-op) via the same `_se15_fake`-style marker
    test_sketch_manifest_builder.py's own _install_adsk_stubs uses,
    though this is a DIFFERENT, broader stub (b-spline-gen.py needs
    event-handler base classes sketch_manifest_builder.py never touches),
    so it's registered under its own marker rather than reusing theirs."""
    if getattr(sys.modules.get('adsk.core', None), '_bspline_gen_fake', False):
        return

    adsk = types.ModuleType('adsk')
    adsk_core = types.ModuleType('adsk.core')
    adsk_fusion = types.ModuleType('adsk.fusion')
    adsk_cam = types.ModuleType('adsk.cam')
    adsk_core._bspline_gen_fake = True

    # Event-handler base classes every b-spline-gen.py handler subclasses
    # at MODULE level (PaletteClosedHandler, PaletteHTMLEventHandler,
    # CommandExecuteHandler, CommandCreatedHandler) -- trivial no-arg
    # bases are all Python's class machinery needs to make those
    # subclass definitions (and their own `super().__init__()` calls)
    # succeed at import time.
    class _HandlerBase:
        def __init__(self, *a, **kw):
            pass

    adsk_core.HTMLEventHandler = type('HTMLEventHandler', (_HandlerBase,), {})
    adsk_core.UserInterfaceGeneralEventHandler = type('UserInterfaceGeneralEventHandler', (_HandlerBase,), {})
    adsk_core.CommandEventHandler = type('CommandEventHandler', (_HandlerBase,), {})
    adsk_core.CommandCreatedEventHandler = type('CommandCreatedEventHandler', (_HandlerBase,), {})

    class _FakeApp:
        @classmethod
        def get(cls):
            # b-spline-gen.py's own module-level `app = adsk.core.Application.get()`
            # / `if app: ui = app.userInterface` -- None is enough to keep
            # that branch a safe no-op (ui stays None), matching a real
            # "not running inside Fusion" state, which is exactly what
            # this test environment actually is.
            return None

    adsk_core.Application = _FakeApp
    adsk_core.HTMLEventArgs = type('HTMLEventArgs', (), {'cast': staticmethod(lambda x: x)})
    adsk_core.Color = types.SimpleNamespace()
    adsk_core.Matrix = types.SimpleNamespace()
    adsk_core.PaletteDockingStates = types.SimpleNamespace()
    adsk_core.ValueInput = types.SimpleNamespace()

    adsk_fusion.CustomGraphicsCoordinates = types.SimpleNamespace()
    adsk_fusion.CustomGraphicsMaterialEffect = types.SimpleNamespace()
    adsk_fusion.CustomGraphicsPhongMaterial = types.SimpleNamespace()
    adsk_fusion.CustomGraphicsSolidColorEffect = types.SimpleNamespace()
    adsk_fusion.Design = types.SimpleNamespace()
    adsk_fusion.DesignTypes = types.SimpleNamespace()

    adsk.core = adsk_core
    adsk.fusion = adsk_fusion
    adsk.cam = adsk_cam
    sys.modules['adsk'] = adsk
    sys.modules['adsk.core'] = adsk_core
    sys.modules['adsk.fusion'] = adsk_fusion
    sys.modules['adsk.cam'] = adsk_cam


_install_bspline_gen_adsk_stubs()


def _load_bspline_gen_module():
    """b-spline-gen.py has a hyphenated filename (not a valid Python
    identifier), so a plain `import` can't reach it -- same
    importlib.util.spec_from_file_location approach frame-builder/
    test_templates.py's own _load_template_module already establishes
    for exactly this reason, and fb_engine.frame_engine's own real
    add-in loader mirrors at runtime."""
    data_path = os.path.join(_HERE, 'b-spline-gen.py')
    spec = importlib.util.spec_from_file_location('b_spline_gen_under_test', data_path)
    if spec is None or spec.loader is None:
        raise ImportError(f'Could not build spec for {data_path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_bspline_gen = _load_bspline_gen_module()
_svg_layer_import_plan = _bspline_gen._svg_layer_import_plan


def _layer(index=1, profile='flat', depth=0.1, svg='', manifest=None):
    return {
        'index': index,
        'config': {'profile': profile, 'depth': depth},
        'svg': svg,
        **({'sketchManifest': manifest} if manifest is not None else {}),
    }


def test_hand_drawn_only_layer_with_a_stale_or_absent_manifest_imports_plain_svg_never_builds_a_sketch():
    """The reported bug's own resolved shape: export-flow.js's own fix
    means a hand-drawn layer's payload never carries a sketchManifest at
    all any more -- this plan must never invent one, and must import the
    (full, unfiltered) svg exactly as a hand-drawn-only layer always has."""
    layers = [_layer(svg='<path d="M0 0 L1 1"/>')]
    plan = _svg_layer_import_plan(layers, design_available=True)
    assert len(plan) == 1
    step = plan[0]
    assert step['build_constrained'] is False
    assert step['manifest_skipped_no_design'] is False
    assert step['import_svg'] is True
    assert step['svg'] == '<path d="M0 0 L1 1"/>'
    assert step['manifest'] is None


def test_mixed_layer_builds_the_constrained_sketch_and_ALSO_imports_the_remaining_svg():
    """A layer with real lattice content (manifest attached by export-
    flow.js's own now-correct gate) AND hand-drawn extras (export-flow.js
    already stripped the lattice/contour pieces out of `svg`, leaving
    only the hand-drawn remainder) gets BOTH steps -- never an either/or."""
    manifest = {'entities': [{'id': 'seg0'}]}
    layers = [_layer(svg='<path d="M5 5 L6 6"/>', manifest=manifest)]
    plan = _svg_layer_import_plan(layers, design_available=True)
    step = plan[0]
    assert step['build_constrained'] is True
    assert step['manifest_skipped_no_design'] is False
    assert step['import_svg'] is True
    assert step['manifest'] is manifest
    assert step['svg'] == '<path d="M5 5 L6 6"/>'


def test_pure_lattice_layer_builds_only_the_constrained_sketch_no_svg_import_at_all():
    """A layer with ONLY lattice content: export-flow.js's own exclusion
    strips its svg down to nothing (an empty string), so there is
    genuinely nothing left to import -- never a spurious empty-sketch
    import alongside the real constrained one."""
    manifest = {'entities': [{'id': 'seg0'}]}
    layers = [_layer(svg='', manifest=manifest)]
    plan = _svg_layer_import_plan(layers, design_available=True)
    step = plan[0]
    assert step['build_constrained'] is True
    assert step['import_svg'] is False


def test_manifest_present_but_no_design_in_scope_skips_the_sketch_and_still_imports_whatever_svg_remains():
    """The narrow, pre-existing "no active Design" fallback: the
    constrained sketch is never attempted (there's nothing to build it
    IN), but whatever `svg` the payload carries -- possibly already
    stripped down by export-flow.js, possibly not -- is still imported,
    exactly as the plain-SVG path always has for a layer with no usable
    manifest path available."""
    manifest = {'entities': [{'id': 'seg0'}]}
    layers = [_layer(svg='<path d="M5 5 L6 6"/>', manifest=manifest)]
    plan = _svg_layer_import_plan(layers, design_available=False)
    step = plan[0]
    assert step['build_constrained'] is False
    assert step['manifest_skipped_no_design'] is True
    assert step['import_svg'] is True


def test_a_layer_with_neither_manifest_nor_svg_content_does_nothing_non_vacuous_guard_against_a_spurious_empty_import():
    layers = [_layer(svg='')]
    plan = _svg_layer_import_plan(layers, design_available=True)
    step = plan[0]
    assert step['build_constrained'] is False
    assert step['manifest_skipped_no_design'] is False
    assert step['import_svg'] is False


def test_sketch_name_matches_the_established_scheme_index_profile_depth():
    layers = [_layer(index=3, profile='vbit', depth=0.25)]
    plan = _svg_layer_import_plan(layers, design_available=True)
    assert plan[0]['sketch_name'] == 'L3 - vbit (0.25")'


def test_multiple_layers_each_get_their_own_independent_decision_the_real_bug_report_shape_two_layers_one_lattice_one_hand_drawn():
    """The advisor's own live regression fixture (~/.bspline-frame-builder/
    last_send.json): L1 = a real Shape Lattice (owned pieces + contour,
    earns a manifest), L2 = pure hand-drawn art with a STALE box-lattice
    pattern that export-flow.js's own fix now correctly declines to
    attach a manifest for at all (so L2's own payload here simply has no
    sketchManifest field, matching what the fixed JS side actually sends)."""
    manifest_l1 = {'entities': [{'id': 'seg0'}], 'contourWidthMode': 'slot'}
    layers = [
        _layer(index=1, profile='vbit', depth=0.1, svg='', manifest=manifest_l1),
        _layer(index=2, profile='vbit', depth=0.1, svg='<path d="M0 0 L1 1"/><path d="M2 2 L3 3"/>'),
    ]
    plan = _svg_layer_import_plan(layers, design_available=True)
    assert len(plan) == 2
    assert plan[0]['build_constrained'] is True
    assert plan[0]['import_svg'] is False
    assert plan[1]['build_constrained'] is False
    assert plan[1]['import_svg'] is True
    assert plan[1]['manifest'] is None
