"""Fred 2026-10-07: "the B-spline edge in Fusion is wood colour; it should be the same colour as the B-spline ...
depends on the component". MEASURED live (T1 7x9, main 722417e): the to_face body was Clean's panel (red,
restored), but t1_TRIM_CUT cut STAMPED's panel -- body appearance Pine (the material), its 12 new cut walls Pine,
only its 2 B-spline faces green, as face overrides. Every body the trim cut is now restored with its OWN paint.

Same adsk-stub idiom as test_solid_coordinator_reorder.py.
"""
import os
import sys
import types

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if "adsk" not in sys.modules:
    adsk = types.ModuleType("adsk")
    adsk.core = types.ModuleType("adsk.core")
    adsk.fusion = types.ModuleType("adsk.fusion")
    sys.modules.update({"adsk": adsk, "adsk.core": adsk.core, "adsk.fusion": adsk.fusion})

from fb_engine import solid_coordinator, extrusion_engine
from fb_engine.appearance_manager import AppearanceManager
from fb_engine.appearance_strategy import DefaultAppearanceStrategy


class _Log:
    def __init__(self):
        self.entries = []

    def log(self, msg, level=None):
        self.entries.append((str(msg), level))

    def session_start(self, *a):
        pass


class _App:
    def __init__(self, name):
        self.name = name


class _Face:
    def __init__(self, override, body):
        self._override, self._body = override, body

    @property
    def appearance(self):  # Fusion reads back the EFFECTIVE appearance: the override, else the body's
        return self._override or self._body.appearance

    @appearance.setter
    def appearance(self, v):
        self._override = v


class _Body:
    def __init__(self, name, comp, appearance, overrides):
        self.name, self.parentComponent, self.appearance = name, types.SimpleNamespace(name=comp), appearance
        self.assemblyContext = None
        self.faces = [_Face(o, self) for o in overrides]


PINE, GREEN, RED = _App("Pine"), _App("Opaque(51,204,51)"), _App("Opaque(204,51,51)")


def _stamped_after_cut():
    """Stamped's panel as measured after t1_TRIM_CUT: 12 walls on the material, 2 B-spline faces green."""
    return _Body("panel", "Stamped", PINE, [None] * 12 + [GREEN, GREEN])


def _coordinator(cut_bodies, strategy):
    sc = solid_coordinator.SolidCoordinator.__new__(solid_coordinator.SolidCoordinator)
    sc.log = _Log()
    sc.design = types.SimpleNamespace(userParameters=None)
    sc.to_face = types.SimpleNamespace(body=_Body("panel", "Clean", RED, [None] * 6))  # the face is Clean's (live)
    sc.start_offset_expr, sc.offset_expr, sc.appearance_name = "-1 in", "0 in", None
    comp = types.SimpleNamespace(name="Frame_1", attributes=types.SimpleNamespace(itemByName=lambda g, n: None))
    sc.discovery = types.SimpleNamespace(
        find_frame_component=lambda: comp,
        find_frame_sketch=lambda c: (types.SimpleNamespace(name="T1_3_frame_enclosure"), "t1"),
    )
    sc.extrusion_engine = types.SimpleNamespace(extrude_profiles=lambda *a, **k: [], cut_bodies=cut_bodies)
    sc.appearance_strategy = strategy
    return sc


def test_every_cut_body_is_restored_with_its_own_capture(monkeypatch):
    monkeypatch.setattr(solid_coordinator.timeline_order, "ensure_frame_before_inlay", lambda *a, **k: {})
    stamped = _stamped_after_cut()
    restored = []
    strategy = types.SimpleNamespace(
        capture=lambda body: {"Stamped": "green", "Clean": "red"}.get(body.parentComponent.name) if body else None,
        restore=lambda body, cap: restored.append((body.parentComponent.name if body else None, cap)),
        finish=lambda bodies, name, cap: None)
    sc = _coordinator([stamped], strategy)
    sc.run("Frame_1")
    assert not any("CRASH" in m for m, _ in sc.log.entries), sc.log.entries
    assert ("Stamped", "green") in restored  # the cut body, with ITS component's paint
    assert ("Clean", "red") in restored      # the to_face body, as before


def test_end_to_end_the_cut_stamped_panel_ends_green_on_every_face(monkeypatch):
    monkeypatch.setattr(solid_coordinator.timeline_order, "ensure_frame_before_inlay", lambda *a, **k: {})
    stamped = _stamped_after_cut()
    log = _Log()
    sc = _coordinator([stamped], DefaultAppearanceStrategy(AppearanceManager(None, None, log), log))
    sc.run("Frame_1")
    assert stamped.appearance is GREEN
    assert [f.appearance.name for f in stamped.faces] == [GREEN.name] * 14  # the walls (edges) included
    assert all(f._override is None for f in stamped.faces)                # no face overrides left


def test_the_surround_cut_records_the_bodies_it_cut():
    eng = extrusion_engine.ExtrusionEngine.__new__(extrusion_engine.ExtrusionEngine)
    eng.log = _Log()
    eng.cut_bodies = []
    stamped = _stamped_after_cut()
    feat = types.SimpleNamespace(name="", faces=[], bodies=[stamped], attributes=types.SimpleNamespace(add=lambda *a: None))
    assert eng._finalize_feature(feat, {"kind": "SURROUND", "order": "trim"}, 0, "t1", "Frame_1") == []
    assert feat.name == "t1_TRIM_CUT"
    assert eng.cut_bodies == [stamped]
