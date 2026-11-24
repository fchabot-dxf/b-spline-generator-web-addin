"""2026-11-24 (live check of Back: Flat): Fusion refused t1_TRIM_CUT ("3 : EXTRUDE_CREATION_FAIL_ERROR - Cannot complete
extrusion.") and the only trace was one ERROR line in frame-builder-debug.log -- the solid build logged "SOLID SYNTHESIS
FINISHED OK", the Send's frame result said ok: true, the board stayed an untrimmed rectangle. A declared feature Fusion
refuses (the trim cut, a bar) is now the Send's answer: the extruder records it, the coordinator returns it, send_frame
reports ok: false with the feature and Fusion's own message. Detection only: nothing is retried.

Fakes: test_cut_both_sides.py's extruder idiom, test_trim_cut_paint.py's coordinator, test_send_frame.py's world.
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

import pytest  # noqa: E402
from fb_engine import extrusion_engine, solid_coordinator  # noqa: E402
from fb_engine import declared_profiles as dp  # noqa: E402
from fb_engine.frame_definition import COMMON_FRAME_FEATURES  # noqa: E402
from fb_engine.test_cut_both_sides import fake_adsk, _Extrudes, _engine, PLANE_Z0  # noqa: E402,F401  (shared fakes)
from fb_engine.test_trim_cut_paint import _coordinator, _Log  # noqa: E402
from fb_engine import test_send_frame as tsf  # noqa: E402

FUSION_SAYS = "3 : EXTRUDE_CREATION_FAIL_ERROR - Cannot complete extrusion."  # verbatim, live case c
TRIM = [f for f in COMMON_FRAME_FEATURES if f["id"] == "trim"][0]
BARS = [f for f in COMMON_FRAME_FEATURES if f["id"] == "bars"][0]


class _Refusing(_Extrudes):
    def add(self, ext_in):
        raise RuntimeError(FUSION_SAYS)


def test_a_refused_extrude_is_recorded_with_its_feature_name_and_fusions_message(fake_adsk):
    e = _engine()
    trim_plan = dp.extrude_plan(TRIM, None, "frame_height_offset")
    bar_plan = dp.extrude_plan(BARS, "frame_top", "frame_height_offset")
    assert e._extrude_one_profile(_Refusing(), PLANE_Z0, trim_plan, 4, "t1", "FACE", "Frame_1") == []
    assert e._extrude_one_profile(_Refusing(), PLANE_Z0, bar_plan, 3, "t1", "FACE", "Frame_1") == []
    assert e.failed == [{"feature": "t1_TRIM_CUT", "error": FUSION_SAYS}, {"feature": "frame_top", "error": FUSION_SAYS}]


def test_extrude_profiles_starts_each_build_with_no_failures(fake_adsk):
    e = _engine()
    e.failed = [{"feature": "stale", "error": "from an earlier build"}]
    sketch = types.SimpleNamespace(name="T1_3", profiles=types.SimpleNamespace(count=0))
    e.extrude_profiles(types.SimpleNamespace(name="Frame_1"), sketch, "t1", None, "-1 in", "0 in")
    assert e.failed == []


def test_the_coordinator_reports_what_the_extruder_could_not_build(monkeypatch):
    monkeypatch.setattr(solid_coordinator.timeline_order, "ensure_frame_before_inlay", lambda *a, **k: {})
    strategy = types.SimpleNamespace(capture=lambda b: None, restore=lambda b, c: None, finish=lambda *a: None)
    sc = _coordinator([], strategy)
    sc.extrusion_engine.failed = [{"feature": "t1_TRIM_CUT", "error": FUSION_SAYS}]
    sc.run("Frame_1")
    assert sc.failures == [{"feature": "t1_TRIM_CUT", "error": FUSION_SAYS}]
    errors = [m for m, level in sc.log.entries if level == "ERROR"]
    assert any("t1_TRIM_CUT" in m and FUSION_SAYS in m for m in errors), sc.log.entries
    assert not any("FINISHED OK" in m for m, _ in sc.log.entries)


def test_a_clean_build_reports_no_failures(monkeypatch):
    monkeypatch.setattr(solid_coordinator.timeline_order, "ensure_frame_before_inlay", lambda *a, **k: {})
    strategy = types.SimpleNamespace(capture=lambda b: None, restore=lambda b, c: None, finish=lambda *a: None)
    sc = _coordinator([], strategy)
    sc.extrusion_engine.failed = []
    sc.run("Frame_1")
    assert sc.failures == [] and any("FINISHED OK" in m for m, _ in sc.log.entries)


def test_build_solid_returns_the_coordinators_failures(monkeypatch):
    class Coordinator:
        def __init__(self, *a, **k):
            self.log, self.failures = _Log(), []

        def run(self, comp_name):
            self.failures.append({"feature": "t1_TRIM_CUT", "error": FUSION_SAYS})

    monkeypatch.setattr(solid_coordinator, "SolidCoordinator", Coordinator)
    assert solid_coordinator.build_solid_logic_v3() == [{"feature": "t1_TRIM_CUT", "error": FUSION_SAYS}]


def test_send_frame_answers_ok_false_with_the_feature_and_fusions_message():
    w = tsf.World()
    tsf.send_bspline(w)
    b = tsf.Builds(w)

    def refusing_solid(**kw):
        b.solid(**kw)
        return [{"feature": "t1_TRIM_CUT", "error": FUSION_SAYS}]

    r = tsf.sf.send_frame(w, tsf.payload(), lambda: tsf.Body(), tsf.Log(), resolve_template=tsf.resolve_template,
                          build_sketch=b.sketch, build_solid=refusing_solid, value_input=lambda e: e)
    assert r["ok"] is False and r["frame"] == "Frame_1"
    assert "t1_TRIM_CUT" in r["error"] and FUSION_SAYS in r["error"]
    assert r["failed"] == [{"feature": "t1_TRIM_CUT", "error": FUSION_SAYS}]


def test_send_frame_ok_when_the_solid_build_returns_no_failures():
    w = tsf.World()
    tsf.send_bspline(w)
    b = tsf.Builds(w)
    r = tsf.sf.send_frame(w, tsf.payload(), lambda: tsf.Body(), tsf.Log(), resolve_template=tsf.resolve_template,
                          build_sketch=b.sketch, build_solid=lambda **kw: (b.solid(**kw), [])[1], value_input=lambda e: e)
    assert r["ok"] is True and r["error"] is None and "failed" not in r
