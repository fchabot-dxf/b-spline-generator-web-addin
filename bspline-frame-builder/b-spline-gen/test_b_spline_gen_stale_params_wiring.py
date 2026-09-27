"""
R7 item 0(a)+(b) (home advisor, LIVE bugs found in real Fusion, both verified in code): the stale-
params wiring in b-spline-gen.py's own `_handle_generate` Finalise block never ran a single successful
pass because of two independent bugs:
  (a) the logger adapter passed `_log` (1 positional arg) directly as `.log`, but
      `param_ownership.compute_stale_params` calls `logger.log(msg, level)` (2 args) whenever it has
      anything to report — every such call raised TypeError.
  (b) the payload-names loop read `layer.get('manifest')`, a key that never exists in a real payload
      (the app sends `layer['sketchManifest']`) — every lattice parameter looked out-of-payload.

This file drives the REAL module-level helpers b-spline-gen.py now shares between both readers
(`_layer_manifest`) and the new logger shape (`_LogAdapter`), with the SAME minimal adsk stub idiom
`frame-builder/fb_engine/test_board_params_ownership.py` already uses (install a fake adsk BEFORE
import, since b-spline-gen.py subclasses adsk.core.* at class-definition time).

Run with:
    cd bspline-frame-builder/b-spline-gen
    python3 -m pytest test_b_spline_gen_stale_params_wiring.py
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
_FRAME_BUILDER = os.path.join(os.path.dirname(_HERE), "frame-builder")
if _FRAME_BUILDER not in sys.path:
    sys.path.insert(0, _FRAME_BUILDER)  # param_ownership.py's own `from fb_engine.parameter_schema import ...`


def _install_fake_adsk():
    adsk = types.ModuleType("adsk")
    adsk.core = types.ModuleType("adsk.core")
    adsk.fusion = types.ModuleType("adsk.fusion")
    adsk.cam = types.ModuleType("adsk.cam")

    class _FakeApp:
        @classmethod
        def get(cls):
            return None  # b-spline-gen.py's own module-level `if app:` takes the False branch cleanly

    adsk.core.Application = _FakeApp

    class _FakeValueInput:
        @staticmethod
        def createByReal(v):
            return ("real", v)

        @staticmethod
        def createByString(s):
            return ("string", s)

    adsk.core.ValueInput = _FakeValueInput
    # The four adsk.core.* base classes b-spline-gen.py subclasses AT MODULE LOAD TIME (class
    # PaletteClosedHandler(adsk.core.UserInterfaceGeneralEventHandler): etc.) — plain object stand-ins,
    # sufficient for the module to import; none of their real behavior is exercised by this file.
    for name in ("UserInterfaceGeneralEventHandler", "HTMLEventHandler",
                 "CommandEventHandler", "CommandCreatedEventHandler"):
        setattr(adsk.core, name, type(name, (object,), {}))

    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = adsk.core
    sys.modules["adsk.fusion"] = adsk.fusion
    sys.modules["adsk.cam"] = adsk.cam


_install_fake_adsk()

def _import_module():
    """b-spline-gen.py's own filename isn't a valid Python identifier ('-') — load it by path, the
    same way bspline-frame-builder.py's own `_load_submodule` bootstraps it for real in Fusion."""
    import importlib.util
    path = os.path.join(_HERE, "b-spline-gen.py")
    spec = importlib.util.spec_from_file_location("b_spline_gen_under_test", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["b_spline_gen_under_test"] = module
    spec.loader.exec_module(module)
    return module


bsg = _import_module()


class TestLayerManifest:
    def test_reads_the_REAL_key_sketchManifest(self):
        layer = {"index": 1, "sketchManifest": {"parameters": [{"name": "rail_width", "value": 0.1}]}}
        assert bsg._layer_manifest(layer) == {"parameters": [{"name": "rail_width", "value": 0.1}]}

    def test_the_WRONG_key_manifest_is_never_read_even_if_present(self):
        # A regression guard for the exact live bug: a layer that happens to carry some OTHER key
        # called 'manifest' (never sent by the real app) must not be picked up as if it were real.
        layer = {"manifest": {"parameters": [{"name": "should_never_be_seen"}]}}
        assert bsg._layer_manifest(layer) is None

    def test_a_layer_with_no_manifest_at_all_returns_None_not_KeyError(self):
        assert bsg._layer_manifest({}) is None
        assert bsg._layer_manifest({"svg": "<svg/>"}) is None

    def test_a_real_shaped_payload_fixture_yields_every_lattice_param_name(self):
        # Shaped from export-flow.js:472-484's own sketchManifest attachment + editor-sketch-manifest.js's
        # own parameters[] pushes (R4's own survey) -- the fixture tools/repro/capture_send_payload.mjs
        # would capture live, reproduced by hand here since this file has no Fusion access this turn.
        layers = [
            {"index": 1, "sketchName": "L1 - flat (0\")",
             "sketchManifest": {"kind": "rails", "parameters": [{"name": "stroke_width", "value": 0.25, "unit": "in"}]}},
            {"index": 2, "sketchName": "L2 - flat (0\")",
             "sketchManifest": {"kind": "ties", "parameters": [{"name": "node_diameter", "value": 0.15, "unit": "in"}]}},
            {"index": 3, "sketchName": "L3 - flat (0\")", "svg": "<svg/>"},  # a hand-drawn layer, no manifest at all
        ]
        names = set()
        for layer in layers:
            manifest = bsg._layer_manifest(layer) or {}
            for p in manifest.get("parameters", []) or []:
                if p.get("name"):
                    names.add(p["name"])
        assert names == {"stroke_width", "node_diameter"}


class TestLogAdapter:
    def test_a_2_arg_log_call_never_raises_against_the_REAL_1_arg__log(self):
        # This is the actual regression: before the fix, `logger.log(msg, level)` called `_log`
        # DIRECTLY (a 1-arg function) with 2 positional args and raised TypeError.
        adapter = bsg._LogAdapter()
        adapter.log("a message", "WARNING")   # must not raise
        adapter.log("a message")              # must not raise (level omitted, matching how compute_stale_params
                                               # calls .log(msg) with no level in some branches)

    def test_folds_the_level_into_the_message_bsg_s_own__log_only_takes_one_arg(self, monkeypatch):
        seen = []
        monkeypatch.setattr(bsg, "_log", lambda msg: seen.append(msg))
        bsg._LogAdapter().log("hello", "WARNING")
        assert seen == ["[WARNING] hello"]
        seen.clear()
        bsg._LogAdapter().log("hello", None)
        assert seen == ["hello"]  # no level -> no bracket noise
        seen.clear()
        bsg._LogAdapter().log("hello")
        assert seen == ["hello"]

    def test_drives_the_REAL_wiring_shape_compute_stale_params_actually_calls(self, monkeypatch):
        """The literal regression: exercise param_ownership.compute_stale_params (the real function,
        not a stand-in) against the real _LogAdapter, over a candidate that forces a 2-arg .log call
        (an unstamped registered param — 'adopted' — which calls neither log(msg) nor raises)."""
        from param_ownership import compute_stale_params

        class _P:
            def __init__(self, name, stamped):
                self.name = name
                self._stamped = stamped
                self.dependentParameters = types.SimpleNamespace(count=0)
                self.deleted = False

            @property
            def attributes(self):
                store = {("Bspline", "owner"): types.SimpleNamespace(value="1")} if self._stamped else {}
                return types.SimpleNamespace(itemByName=lambda g, n: store.get((g, n)))

            def deleteMe(self):
                self.deleted = True
                return True

        seen = []
        monkeypatch.setattr(bsg, "_log", lambda msg: seen.append(msg))
        p = _P("rail_width", stamped=False)  # unstamped + registered + stale -> "adopted" -> log(msg, "DEBUG")
        result = compute_stale_params([p], payload_names=[], logger=bsg._LogAdapter())
        assert result["adopted"] == ["rail_width"]
        assert p.deleted is True
        assert any("DELETED" in m or "rail_width" in m for m in seen)  # no TypeError ever reached `seen`
