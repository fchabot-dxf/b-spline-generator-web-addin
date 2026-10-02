"""
H23 item 29 part 1 (PREP ONLY): tests for stage_timing_lib.py's pure functions, plus one test
proving send_stage_timing.py's own CENTRAL mechanism -- wrapping b-spline-gen.py's module-level
_send_progress to time _handle_generate's own stage boundaries -- actually intercepts real calls,
using the SAME fake-adsk + "no active design" early-exit idiom
b-spline-gen/test_import_failed_no_modal.py already established for driving the REAL
_handle_generate without a Fusion bridge. No live Fusion needed for anything in this file.
"""
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
_REPO = os.path.dirname(os.path.dirname(os.path.dirname(_HERE)))
_BSG_DIR = os.path.join(_REPO, "bspline-frame-builder", "b-spline-gen")
if _BSG_DIR not in sys.path:
    # b-spline-gen.py imports its own sibling modules (sketch_manifest_builder etc.) as plain
    # top-level names, relying on its own dir already being on sys.path -- normally done by
    # bspline-frame-builder.py's own _load_submodule bootstrap; here we're loading it directly.
    sys.path.insert(0, _BSG_DIR)

from stage_timing_lib import (  # noqa: E402
    stage_durations, load_captured_payload, parse_solid_coordinator_phases, unwrap_captured_frame_payload,
    frame_build_ui_data,
)


# --------------------------------------------------------------- stage_durations
class TestStageDurations:
    def test_empty_events_is_empty(self):
        assert stage_durations([], end_time=100.0) == []

    def test_single_event_runs_to_end_time(self):
        assert stage_durations([("Preparing Geometry...", 10.0)], end_time=12.5) == \
            [("Preparing Geometry...", 2.5)]

    def test_consecutive_events_each_duration_to_the_next(self):
        events = [("A", 0.0), ("B", 1.0), ("C", 3.5)]
        assert stage_durations(events, end_time=10.0) == [("A", 1.0), ("B", 2.5), ("C", 6.5)]


# --------------------------------------------------------------- load_captured_payload
class TestLoadCapturedPayload:
    def test_missing_file_returns_none_with_a_warning(self, tmp_path):
        payload, warning = load_captured_payload(str(tmp_path / "no_such_file.json"))
        assert payload is None
        assert "no captured payload" in warning

    def test_payload_without_step_text_warns(self, tmp_path):
        p = tmp_path / "last_send.json"
        p.write_text('{"params": {"widthIn": 7}, "frame": {}}', encoding="utf-8")
        payload, warning = load_captured_payload(str(p))
        assert payload == {"params": {"widthIn": 7}, "frame": {}}
        assert "no stepVariants/stepText" in warning

    def test_payload_with_step_variants_has_no_warning(self, tmp_path):
        p = tmp_path / "full_capture.json"
        p.write_text('{"stepVariants": [{"name": "x", "stepText": "ISO-10303..."}]}', encoding="utf-8")
        payload, warning = load_captured_payload(str(p))
        assert warning is None
        assert payload["stepVariants"][0]["name"] == "x"


# --------------------------------------------------------------- unwrap_captured_frame_payload
class TestUnwrapCapturedFramePayload:
    def test_post_processing_shape_is_unwrapped_to_the_raw_frame_payload(self):
        captured = {"params": {"widthIn": 7}, "frame": {
            "payload": {"templateId": "template_1", "appearance": "3D Ash - Unfinished"},
            "result": {"ok": True, "frame": "Frame_1"},
        }}
        out = unwrap_captured_frame_payload(captured)
        assert out["frame"] == {"templateId": "template_1", "appearance": "3D Ash - Unfinished"}
        assert out["params"] == {"widthIn": 7}  # untouched

    def test_already_raw_frame_payload_passes_through_unchanged(self):
        raw = {"frame": {"templateId": "template_1"}}
        assert unwrap_captured_frame_payload(raw) == raw

    def test_no_frame_key_passes_through_unchanged(self):
        no_frame = {"params": {"widthIn": 7}}
        assert unwrap_captured_frame_payload(no_frame) == no_frame

    def test_does_not_mutate_the_input(self):
        captured = {"frame": {"payload": {"templateId": "t1"}, "result": {}}}
        unwrap_captured_frame_payload(captured)
        assert captured["frame"] == {"payload": {"templateId": "t1"}, "result": {}}


# --------------------------------------------------------------- frame_build_ui_data
class TestFrameBuildUiData:
    def test_merges_board_dims_with_frame_params_filtered_to_declared_names(self):
        payload = {
            "params": {"widthIn": 7, "heightIn": 9, "stampDepth": 0.25},  # top-level: board + stamp
            "frame": {"params": {"boundingboxoffset": 0.25, "ck_arc_shoulder_weld": 1}},
        }
        declared = {"widthIn", "heightIn", "boundingboxoffset", "ck_arc_shoulder_weld"}
        out = frame_build_ui_data(payload, declared)
        assert out == {"widthIn": "7", "heightIn": "9", "boundingboxoffset": "0.25",
                        "ck_arc_shoulder_weld": "1"}
        assert "stampDepth" not in out  # not a declared frame param

    def test_frame_params_win_on_a_genuine_name_collision(self):
        payload = {"params": {"frame_thickness": "stale"}, "frame": {"params": {"frame_thickness": 0.75}}}
        out = frame_build_ui_data(payload, {"frame_thickness"})
        assert out == {"frame_thickness": "0.75"}

    def test_missing_frame_key_still_returns_top_level_declared_params(self):
        out = frame_build_ui_data({"params": {"widthIn": 7}}, {"widthIn"})
        assert out == {"widthIn": "7"}


# --------------------------------------------------------------- parse_solid_coordinator_phases
class TestParseSolidCoordinatorPhases:
    def test_parses_all_four_lines(self):
        log = "\n".join([
            "=== SOLID COORDINATOR (v4.07.B): Synthesis Started",
            "Discovery Phase: 0.12s",
            "Extrusion Phase: 1.84s",
            "Finishing Phase: 0.33s",
            "SOLID SYNTHESIS FINISHED OK (Total: 2.41s)",
        ])
        assert parse_solid_coordinator_phases(log) == {
            "discovery": 0.12, "extrusion": 1.84, "finishing": 0.33, "total": 2.41}

    def test_missing_lines_are_just_absent(self):
        assert parse_solid_coordinator_phases("nothing matches here") == {}

    def test_aborted_build_reports_only_what_ran(self):
        log = "Discovery Phase: 0.05s\nABORT: No target component found"
        assert parse_solid_coordinator_phases(log) == {"discovery": 0.05}


# --------------------------------------------------------------- the wrapping mechanism itself
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


def _import_bsg():
    import importlib.util
    path = os.path.join(_BSG_DIR, "b-spline-gen.py")
    spec = importlib.util.spec_from_file_location("b_spline_gen_stage_timing_under_test", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["b_spline_gen_stage_timing_under_test"] = module
    spec.loader.exec_module(module)
    return module


class _SpyApp:
    def __init__(self, palette):
        self.activeProduct = object()
        self.userInterface = types.SimpleNamespace(palettes=types.SimpleNamespace(itemById=lambda _id: palette))


class _SpyPalette:
    def __init__(self):
        self.sent = []

    def sendInfoToHTML(self, action, payload_json):
        self.sent.append((action, payload_json))


class TestSendProgressWrappingCapturesRealStageBoundaries:
    """Proves the one mechanism send_stage_timing.py's own live harness depends on: monkeypatching
    the REAL b-spline-gen.py module's _send_progress (a bare module-level name _handle_generate
    calls unqualified, so patching the module attribute intercepts every call) records a
    timestamped event for each stage AND still calls through to the original -- against the real
    _handle_generate, not a reimplementation of it (same discipline test_import_failed_no_modal.py
    already established for this exact early-exit path)."""

    def test_wrapped_send_progress_records_the_one_stage_before_the_no_design_exit(self, monkeypatch):
        _adsk = _install_fake_adsk()
        bsg = _import_bsg()
        monkeypatch.setattr(_adsk.fusion, "Design",
                            types.SimpleNamespace(cast=staticmethod(lambda _p: None)), raising=False)
        palette = _SpyPalette()
        monkeypatch.setattr(bsg, "app", _SpyApp(palette))
        monkeypatch.setattr(bsg, "ui", types.SimpleNamespace(messageBox=lambda *a: None))

        events = []
        original = bsg._send_progress

        def wrapped(msg):
            events.append((msg, len(events)))  # a fake clock: call order stands in for time.time()
            return original(msg)

        monkeypatch.setattr(bsg, "_send_progress", wrapped)

        handler = bsg.PaletteHTMLEventHandler()
        handler._handle_generate({"stepVariants": [], "frame": None, "isPreview": False})

        assert events == [("Preparing Geometry...", 0)]
        # wrapped still called through to the original -- the toast the user actually sees:
        assert ("import_progress", '{"msg": "Preparing Geometry..."}') in palette.sent
