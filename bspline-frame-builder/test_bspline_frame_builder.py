"""
ADD1 (measured live in Fusion): after deploying new files and Stop -> Run,
`bspline_ui.build_constrained_sketch` was still the OLD module object from
Fusion's startup (missing the `sketch_name_override` parameter), because
`sketch_manifest_builder` had no entry in bspline-frame-builder.py's own
`_force_wipe` list — b-spline-gen.py's fresh reload still bound the STALE
cached sketch_manifest_builder via its own plain `from sketch_manifest_builder
import build_constrained_sketch`.

Installs a minimal fake `adsk.core`/`adsk.fusion`/`adsk.cam` before loading
bspline-frame-builder.py (a hyphenated filename, loaded by path via
importlib like the add-in's own `_load_submodule` loads ITS siblings) —
same stub-then-import idiom test_sketch_manifest_builder.py already
established, but far smaller: this file's own module-level code (checked
by reading it) never calls into adsk beyond the bare `import`, so the fake
modules can be empty.
"""
import importlib.util
import os
import sys
import types

_HERE = os.path.dirname(os.path.realpath(__file__))


def _install_fake_adsk():
    adsk = types.ModuleType("adsk")
    adsk.core = types.ModuleType("adsk.core")
    adsk.fusion = types.ModuleType("adsk.fusion")
    adsk.cam = types.ModuleType("adsk.cam")
    # bspline-frame-builder.py subclasses these two at MODULE level
    # (_DeferredRefreshHandler, _ReloadCommandCreatedHandler) — Python
    # evaluates a class statement's base classes immediately at exec
    # time, so these need to exist as real (if empty) classes, not just
    # be importable names.
    adsk.core.CustomEventHandler = type("CustomEventHandler", (), {})
    adsk.core.CommandCreatedEventHandler = type("CommandCreatedEventHandler", (), {})
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = adsk.core
    sys.modules["adsk.fusion"] = adsk.fusion
    sys.modules["adsk.cam"] = adsk.cam


def _load_bspline_frame_builder():
    _install_fake_adsk()
    filepath = os.path.join(_HERE, "bspline-frame-builder.py")
    spec = importlib.util.spec_from_file_location("bspline_frame_builder_under_test", filepath)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_bspline_gen_sibling_modules_covers_sketch_manifest_builder():
    """The exact bug: sketch_manifest_builder.py (imported by b-spline-gen.py
    via a plain bare-name `from sketch_manifest_builder import ...`) must be
    in the wipe list b-spline-frame-builder.py._bootstrap() uses, or it
    survives Stop->Start untouched while b-spline-gen.py itself gets a
    fresh reload — the exact split that produced the stale-signature bug."""
    mod = _load_bspline_frame_builder()
    covered = mod._bspline_gen_sibling_modules()
    assert "sketch_manifest_builder" in covered


def test_bspline_gen_sibling_modules_excludes_the_entry_file_itself():
    """'b-spline-gen' (the entry file) is loaded by PATH via `_load_submodule`,
    never by bare name — wiping it here would be a harmless no-op today, but
    asserting its absence keeps this list's own stated contract ("every
    SIBLING it owns", not "everything in the folder") honest."""
    mod = _load_bspline_frame_builder()
    assert "b-spline-gen" not in mod._bspline_gen_sibling_modules()


def test_bspline_gen_sibling_modules_is_derived_not_hand_typed():
    """Proves the list can't drift the way it just did for
    sketch_manifest_builder (TM1/TM2's own class of bug) — it's computed
    from the folder's ACTUAL contents at call time, not a literal list a
    future new sibling file could silently fall outside of. Adds a throwaway
    sibling .py file to the real b-spline-gen folder and confirms it's
    picked up automatically, then removes it."""
    mod = _load_bspline_frame_builder()
    probe_path = os.path.join(_HERE, "b-spline-gen", "_add1_probe_sibling.py")
    assert not os.path.exists(probe_path), "probe file should not pre-exist"
    try:
        with open(probe_path, "w", encoding="utf-8") as f:
            f.write("# ADD1 test probe — deleted immediately after this test runs\n")
        covered = mod._bspline_gen_sibling_modules()
        assert "_add1_probe_sibling" in covered
    finally:
        os.remove(probe_path)


def test_force_wipe_removes_a_cached_module_and_its_subpackages():
    """Sanity check on _force_wipe itself (the mechanism the fix relies on)
    against a REAL sys.modules entry, not just reading its source: a bare
    name and any dotted sub-name both disappear."""
    mod = _load_bspline_frame_builder()
    sys.modules["_add1_fake_pkg"] = types.ModuleType("_add1_fake_pkg")
    sys.modules["_add1_fake_pkg.child"] = types.ModuleType("_add1_fake_pkg.child")
    try:
        mod._force_wipe(["_add1_fake_pkg"])
        assert "_add1_fake_pkg" not in sys.modules
        assert "_add1_fake_pkg.child" not in sys.modules
    finally:
        sys.modules.pop("_add1_fake_pkg", None)
        sys.modules.pop("_add1_fake_pkg.child", None)
