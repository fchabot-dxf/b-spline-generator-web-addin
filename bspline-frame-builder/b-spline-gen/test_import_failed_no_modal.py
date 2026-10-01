"""
H23 item 9 (worker's own H23 item 5 live finding, advisor-authorized fix): the failed-import path used
to pop a BLOCKING ui.messageBox() right alongside the palette toast (_send_import_failed), freezing
Fusion's whole main thread until someone clicked it -- confirmed live: a broken Send payload froze the
entire fusion_execute bridge (a trivial print() even timed out) until the dialog was dismissed. Since
Send is always palette-initiated, the palette is open at the moment of every one of these failures, so
"the message box is the only feedback when the palette is hidden" never actually applied to this path.

This drives the REAL `_handle_generate` (not a reimplementation of its branch) against the "no active
Fusion design" early-exit (b-spline-gen.py ~1253-1257), the simplest of the 4 removed call sites to reach
without a deep Fusion-API mock -- same minimal adsk stub idiom test_b_spline_gen_stale_params_wiring.py
already uses (install a fake adsk BEFORE import).

Run with:
    cd bspline-frame-builder/b-spline-gen
    python3 -m pytest test_import_failed_no_modal.py
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)


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
    for name in ("UserInterfaceGeneralEventHandler", "HTMLEventHandler",
                 "CommandEventHandler", "CommandCreatedEventHandler"):
        setattr(adsk.core, name, type(name, (object,), {}))

    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = adsk.core
    sys.modules["adsk.fusion"] = adsk.fusion
    sys.modules["adsk.cam"] = adsk.cam
    return adsk


_adsk = _install_fake_adsk()


def _import_module():
    """b-spline-gen.py's own filename isn't a valid Python identifier ('-') -- load it by path, the
    same way bspline-frame-builder.py's own `_load_submodule` bootstraps it for real in Fusion."""
    import importlib.util
    path = os.path.join(_HERE, "b-spline-gen.py")
    spec = importlib.util.spec_from_file_location("b_spline_gen_import_failed_under_test", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["b_spline_gen_import_failed_under_test"] = module
    spec.loader.exec_module(module)
    return module


bsg = _import_module()


class _SpyUI:
    """Stands in for Fusion's real adsk.core.UserInterface. Records every messageBox call so the test
    can prove, not assume, that the blocking dialog never fires on this path."""
    def __init__(self):
        self.message_box_calls = []

    def messageBox(self, text):
        self.message_box_calls.append(text)


class _SpyPalette:
    def __init__(self):
        self.sent = []

    def sendInfoToHTML(self, action, payload_json):
        self.sent.append((action, payload_json))


class _SpyApp:
    """activeProduct is irrelevant here -- adsk.fusion.Design.cast is stubbed to always return None,
    i.e. "no active Design product", the simplest of the 4 removed call sites to reach without mocking
    the rest of _handle_generate's own import/consolidation pipeline."""
    def __init__(self, palette):
        self.activeProduct = object()
        self.userInterface = types.SimpleNamespace(palettes=types.SimpleNamespace(itemById=lambda _id: palette))


class TestImportFailedNoModal:
    def test_no_active_design_sends_the_toast_and_never_opens_a_modal(self, monkeypatch):
        palette = _SpyPalette()
        spy_ui = _SpyUI()
        monkeypatch.setattr(bsg, "app", _SpyApp(palette))
        monkeypatch.setattr(bsg, "ui", spy_ui)
        monkeypatch.setattr(_adsk.fusion, "Design", types.SimpleNamespace(cast=staticmethod(lambda _product: None)), raising=False)

        handler = bsg.PaletteHTMLEventHandler()
        handler._handle_generate({"stepVariants": [], "frame": None, "isPreview": False})

        # the regression itself: before this fix, a messageBox call landed here and froze Fusion's main thread
        assert spy_ui.message_box_calls == []
        # the toast still fires -- the fix does not also delete the actual user-facing feedback
        # (a "Preparing Geometry..." progress toast precedes it -- unrelated, sent before the design check)
        failed_sends = [(a, p) for a, p in palette.sent if a == "import_failed"]
        assert len(failed_sends) == 1
        assert "No active Fusion design" in failed_sends[0][1]

    def test_preview_calls_stay_silent_on_both_channels_unchanged_behavior(self, monkeypatch):
        """isPreview short-circuits _send_import_failed too (pre-existing `if not is_preview:` guard,
        untouched by this fix) -- confirms removing messageBox didn't also silently change the toast's
        own preview gating, which would have made a live-preview failure fully silent."""
        palette = _SpyPalette()
        spy_ui = _SpyUI()
        monkeypatch.setattr(bsg, "app", _SpyApp(palette))
        monkeypatch.setattr(bsg, "ui", spy_ui)
        monkeypatch.setattr(_adsk.fusion, "Design", types.SimpleNamespace(cast=staticmethod(lambda _product: None)), raising=False)

        handler = bsg.PaletteHTMLEventHandler()
        handler._handle_generate({"stepVariants": [], "frame": None, "isPreview": True})

        assert spy_ui.message_box_calls == []
        assert palette.sent == []
