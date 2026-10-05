"""H23 item 10 (worker's own live finding): `_setups_with_operations` (the CAM BUILD busy/confirm gate's own
detector) referenced a bare `app` global that was never assigned anywhere in cam-builder.py -- every call
raised NameError, silently swallowed by the function's own `except Exception: _log_error(...)`, so it ALWAYS
returned `[]` ("nothing busy") regardless of the real state. Confirmed live in Fusion: clicking BUILD a second
time after real toolpaths existed silently rebuilt over them with NO confirmation dialog ever shown -- the
exact protection `_do_generate`'s busy/confirm branch exists to provide.

This drives the REAL `_setups_with_operations` (not a reimplementation) against a fake adsk + a fake
Application.get(), the same minimal-stub idiom test_b_spline_gen_stale_params_wiring.py already uses.

Run with:
    cd bspline-frame-builder/CAM-builder
    python3 -m pytest test_setups_with_operations.py
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)


def _install_fake_adsk(cam_setups):
    adsk = types.ModuleType("adsk")
    adsk.core = types.ModuleType("adsk.core")
    adsk.fusion = types.ModuleType("adsk.fusion")
    adsk.cam = types.ModuleType("adsk.cam")

    class _FakeOperations:
        def __init__(self, count):
            self._count = count

        @property
        def count(self):
            return self._count

    class _FakeSetup:
        def __init__(self, name, op_count):
            self.name = name
            self.operations = _FakeOperations(op_count)

    class _FakeSetups:
        def __init__(self, setups):
            self._setups = setups

        @property
        def count(self):
            return len(self._setups)

        def item(self, i):
            return self._setups[i]

    class _FakeCamProduct:
        objectType = "adsk::cam::CAM"

        def __init__(self, setups):
            self.setups = _FakeSetups(setups)

    class _FakeProducts:
        def __init__(self, products):
            self._products = products

        @property
        def count(self):
            return len(self._products)

        def item(self, i):
            return self._products[i]

    class _FakeDoc:
        def __init__(self, products):
            self.products = _FakeProducts(products)

    cam_product = _FakeCamProduct([_FakeSetup(n, c) for n, c in cam_setups])
    fake_doc = _FakeDoc([cam_product])

    class _FakeApp:
        @classmethod
        def get(cls):
            return cls._instance

    _FakeApp._instance = types.SimpleNamespace(activeDocument=fake_doc)
    adsk.core.Application = _FakeApp

    class _FakeCAM:
        @staticmethod
        def cast(p):
            return p

    adsk.cam.CAM = _FakeCAM

    class _FakeValueInput:
        @staticmethod
        def createByReal(v):
            return ("real", v)

        @staticmethod
        def createByString(s):
            return ("string", s)

    adsk.core.ValueInput = _FakeValueInput
    for name in ("UserInterfaceGeneralEventHandler", "HTMLEventHandler",
                 "CommandCreatedEventHandler", "CustomEventHandler"):
        setattr(adsk.core, name, type(name, (object,), {}))

    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = adsk.core
    sys.modules["adsk.fusion"] = adsk.fusion
    sys.modules["adsk.cam"] = adsk.cam
    return adsk


def _import_module():
    """cam-builder.py's own filename isn't a valid Python identifier ('-') -- load it by path, the
    same way bspline-frame-builder.py's own `_load_submodule` bootstraps it for real in Fusion."""
    import importlib.util
    path = os.path.join(_HERE, "cam-builder.py")
    spec = importlib.util.spec_from_file_location("cam_builder_under_test", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["cam_builder_under_test"] = module
    spec.loader.exec_module(module)
    return module


class TestSetupsWithOperations:
    def test_finds_setups_that_hold_real_operations(self):
        _install_fake_adsk([("Stock", 0), ("B-spline Back", 2), ("B-spline Top", 3), ("Frame", 2)])
        cb = _import_module()
        busy = cb._setups_with_operations()
        assert busy == [
            {"name": "B-spline Back", "ops": 2},
            {"name": "B-spline Top", "ops": 3},
            {"name": "Frame", "ops": 2},
        ]

    def test_empty_when_no_setup_has_operations(self):
        _install_fake_adsk([("Stock", 0), ("B-spline Back", 0), ("B-spline Top", 0), ("Frame", 0)])
        cb = _import_module()
        assert cb._setups_with_operations() == []

    def test_the_carved_setup_counts_as_a_build_setup(self):
        """H23 item 82: BUILD rebuilds every SETUP_SPECS setup, so its busy check must cover the new
        'B-spline Carved' too -- the names come from the declaration, not a second hand-kept list."""
        _install_fake_adsk([("B-spline Carved", 4)])
        cb = _import_module()
        assert cb._setups_with_operations() == [{"name": "B-spline Carved", "ops": 4}]

    def test_ignores_a_setup_whose_name_is_not_a_build_setup(self):
        _install_fake_adsk([("Some Other Setup", 5)])
        cb = _import_module()
        assert cb._setups_with_operations() == []
