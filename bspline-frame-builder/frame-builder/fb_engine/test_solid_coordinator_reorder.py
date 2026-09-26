"""F3: SolidCoordinator.run must END with the same FB-ORDER reorder the
sketch build ends with. Measured live in F2: without it the BAR extrudes
+ TRIM_CUT stay after the inlay in the timeline.

Minimal adsk stub installed only if none is present (same idiom as
test_appearance_strategy.py). run() only touches adsk through the
collaborators replaced below, so the stub's contents never matter.
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

from fb_engine import solid_coordinator


class _Log:
    def __init__(self):
        self.entries = []

    def log(self, msg, level=None):
        self.entries.append((str(msg), level))

    def session_start(self, *a):
        pass


def _coordinator(order_calls):
    sc = solid_coordinator.SolidCoordinator.__new__(solid_coordinator.SolidCoordinator)
    sc.log = _Log()
    sc.design = types.SimpleNamespace(userParameters=None)  # _sync_offset_param falls back to the literal
    sc.to_face = None
    sc.start_offset_expr = "-1 in"
    sc.offset_expr = "0 in"
    sc.appearance_name = None
    comp = types.SimpleNamespace(name="Frame_1")
    sc.discovery = types.SimpleNamespace(
        find_frame_component=lambda: comp,
        find_frame_sketch=lambda c: (types.SimpleNamespace(name="T1_3_frame_enclosure"), "t1"),
    )
    sc.extrusion_engine = types.SimpleNamespace(extrude_profiles=lambda *a: [])
    sc.appearance_strategy = types.SimpleNamespace(
        capture=lambda body: None, restore=lambda body, cap: None, finish=lambda bodies, name, cap: None)
    return sc


def test_solid_build_ends_with_the_frame_before_inlay_reorder(monkeypatch):
    calls = []
    monkeypatch.setattr(
        solid_coordinator.timeline_order, "ensure_frame_before_inlay",
        lambda design, name, logger=None: calls.append((design, name)) or {"moved": True, "reason": None},
    )
    sc = _coordinator(calls)
    sc.run("Frame_1")
    assert not any("CRASH" in msg for msg, _ in sc.log.entries), sc.log.entries
    assert calls == [(sc.design, "Frame_1")]
