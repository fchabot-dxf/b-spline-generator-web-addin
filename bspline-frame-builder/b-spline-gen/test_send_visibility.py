"""
H23 item 83 / D6 (advisor: "one small fake-Fusion test that pins it"): the Send's visibility rule, Fred's
"Stamped wins". MEASURED live (item 83 re-check, deployed afdc4c0): after a Clean+Stamped Send the Clean
OCCURRENCE is off (effective isVisible False) while its panel body keeps its own bulb on; Stamped is on;
surfaces are off. _apply_send_visibility (moved unchanged out of _handle_generate) is that rule.

Also H23 item 85: _TransferTimer, the detection-only palette -> Python transfer timing (one line per chunk,
one summary), driven through the REAL notify() generate_start / chunk / finish path.

Run with:
    cd bspline-frame-builder/b-spline-gen
    python -m pytest test_send_visibility.py
"""
import json
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
            return None

    adsk.core.Application = _FakeApp
    adsk.core.ValueInput = type("ValueInput", (), {"createByReal": staticmethod(lambda v: v),
                                                   "createByString": staticmethod(lambda s: s)})
    adsk.core.HTMLEventArgs = type("HTMLEventArgs", (), {"cast": staticmethod(lambda a: a)})
    for name in ("UserInterfaceGeneralEventHandler", "HTMLEventHandler",
                 "CommandEventHandler", "CommandCreatedEventHandler"):
        setattr(adsk.core, name, type(name, (object,), {}))
    for name, mod in (("adsk", adsk), ("adsk.core", adsk.core), ("adsk.fusion", adsk.fusion), ("adsk.cam", adsk.cam)):
        sys.modules[name] = mod
    return adsk


_install_fake_adsk()


def _import_module():
    import importlib.util
    path = os.path.join(_HERE, "b-spline-gen.py")
    spec = importlib.util.spec_from_file_location("b_spline_gen_visibility_under_test", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["b_spline_gen_visibility_under_test"] = module
    spec.loader.exec_module(module)
    return module


bsg = _import_module()


class _Bodies(list):
    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


class _Body:
    def __init__(self, name):
        self.name = name
        self.isLightBulbOn = None


class _Occ:
    def __init__(self, comp_name, body_names=("panel", "surface")):
        self.component = types.SimpleNamespace(name=comp_name, bRepBodies=_Bodies(_Body(n) for n in body_names))
        self.isLightBulbOn = None

    def body(self, name):
        return next(b for b in self.component.bRepBodies if b.name == name)


def test_stamped_present_hides_the_clean_occurrence():
    clean, stamped = _Occ("Clean"), _Occ("Stamped")
    best, stamped_with_panel = bsg._apply_send_visibility([clean, stamped])
    assert best is stamped and stamped_with_panel is stamped
    assert (clean.isLightBulbOn, stamped.isLightBulbOn) == (False, True)
    for occ in (clean, stamped):                       # body level, always: panel on, surface off
        assert (occ.body("panel").isLightBulbOn, occ.body("surface").isLightBulbOn) == (True, False)


def test_no_stamped_shows_clean():
    clean = _Occ("Clean")
    best, stamped_with_panel = bsg._apply_send_visibility([clean])
    assert best is clean and stamped_with_panel is None
    assert clean.isLightBulbOn is True


def test_a_stamped_component_without_a_panel_body_does_not_win():
    clean, stamped = _Occ("Clean"), _Occ("Stamped", body_names=("surface",))
    best, _ = bsg._apply_send_visibility([clean, stamped])
    assert best is clean
    assert (clean.isLightBulbOn, stamped.isLightBulbOn) == (True, False)


# ---- H23 item 85: the transfer timer through the real notify() path ----

class _Args:
    def __init__(self, action, data=""):
        self.action = action
        self.data = data


def test_transfer_timer_lines_through_notify(monkeypatch):
    ticks = iter([10.0, 10.25, 10.5, 11.0, 13.0])     # start, chunk 0, chunk 1, finish, handled
    timer = bsg._TransferTimer(clock=lambda: next(ticks), wall=lambda: 1700000000.0)
    monkeypatch.setattr(bsg, "_transfer_timer", timer)
    lines = []
    monkeypatch.setattr(bsg, "_log", lambda msg, *a, **k: lines.append(msg))
    handler = bsg.PaletteHTMLEventHandler()
    got = []
    monkeypatch.setattr(handler, "_handle_generate", lambda payload: got.append(payload), raising=False)
    payload = json.dumps({"stepVariants": [], "params": {"widthIn": 7}})
    half = len(payload) // 2
    handler.notify(_Args("generate_start"))
    handler.notify(_Args("generate_chunk", json.dumps({"index": 0, "data": payload[:half]})))
    handler.notify(_Args("generate_chunk", json.dumps({"index": 1, "data": payload[half:]})))
    handler.notify(_Args("generate_finish"))
    xfer = [l for l in lines if l.startswith("[XFER]")]
    assert xfer == [
        "[XFER] start epoch_ms=1700000000000",
        f"[XFER] chunk 0: {half} bytes at +250 ms",
        f"[XFER] chunk 1: {len(payload) - half} bytes at +500 ms",
        f"[XFER] transfer 2 chunks, {len(payload) / 1e6:.2f} MB in 1.00 s",
        "[XFER] Send handled at +3.00 s (epoch_ms=1700000000000)",
    ]
    assert got == [json.loads(payload)]                # the payload still reaches _handle_generate intact
