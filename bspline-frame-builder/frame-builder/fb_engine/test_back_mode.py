"""2026-11-24 (advisor, saved boards unchanged): the board's Back mode reaches the frame builder and picks how the trim /
window cut reaches past the panel (frame_definition.CUT_THROUGH_BY_BACK_MODE): the Send's frame payload carries
`backMode`, [Send frame] stamps a non-default mode on the frame component (the Bars Off pattern), the solid build reads
it there and hands it to the extruder. Absent / shell = no stamp = through all, as every board before.
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
from fb_engine import solid_coordinator  # noqa: E402
from fb_engine.back_mode import BACK_MODE_ATTR, back_mode_of, stamp_back_mode, back_mode_on_comp  # noqa: E402
from fb_engine.test_trim_cut_paint import _coordinator  # noqa: E402
from fb_engine import test_send_frame as tsf  # noqa: E402


class _Attrs:
    def __init__(self):
        self.items = {}

    def add(self, g, n, v):
        self.items[(g, n)] = types.SimpleNamespace(value=v)

    def itemByName(self, g, n):
        return self.items.get((g, n))


def _comp():
    return types.SimpleNamespace(name="Frame_1", attributes=_Attrs())


def test_the_payloads_back_mode_absent_or_unknown_is_shell():
    assert back_mode_of({"backMode": "flat"}) == "flat"
    assert back_mode_of({"backMode": "shell"}) == "shell"
    assert back_mode_of({}) == "shell" and back_mode_of(None) == "shell" and back_mode_of({"backMode": "x"}) == "shell"


def test_only_a_non_default_back_mode_is_stamped_and_an_untagged_frame_reads_shell():
    c = _comp()
    assert stamp_back_mode(c, "shell") is False and c.attributes.items == {}
    assert back_mode_on_comp(c) == "shell"
    assert stamp_back_mode(c, "flat") is True
    assert c.attributes.items[BACK_MODE_ATTR].value == "flat" and back_mode_on_comp(c) == "flat"


def _send(back_mode=None):
    w = tsf.World()
    tsf.send_bspline(w)
    b = tsf.Builds(w)
    pl = tsf.payload() if back_mode is None else tsf.payload(backMode=back_mode)
    r = tsf.sf.send_frame(w, pl, lambda: tsf.Body(), tsf.Log(), resolve_template=tsf.resolve_template,
                          build_sketch=b.sketch, build_solid=b.solid, value_input=lambda e: e)
    frame = [c for c in w.components if c.name == "Frame_1"][0]
    return r, frame


@pytest.mark.parametrize("back_mode, stamped", [("flat", "flat"), ("shell", None), (None, None)])
def test_send_frame_stamps_the_frame_with_the_boards_back_mode(back_mode, stamped):
    r, frame = _send(back_mode)
    assert r["ok"] is True
    a = frame.attributes.itemByName(*BACK_MODE_ATTR)
    assert (a.value if a else None) == stamped


@pytest.mark.parametrize("stamp, expected", [(None, "shell"), ("flat", "flat")])
def test_the_solid_build_hands_the_frames_back_mode_to_the_extruder(monkeypatch, stamp, expected):
    monkeypatch.setattr(solid_coordinator.timeline_order, "ensure_frame_before_inlay", lambda *a, **k: {})
    strategy = types.SimpleNamespace(capture=lambda b: None, restore=lambda b, c: None, finish=lambda *a: None)
    sc = _coordinator([], strategy)
    comp = _comp()
    if stamp:
        stamp_back_mode(comp, stamp)
    sc.discovery.find_frame_component = lambda: comp
    seen = {}
    sc.extrusion_engine.extrude_profiles = lambda *a, **k: (seen.update(k), [])[1]
    sc.extrusion_engine.failed = []
    sc.run("Frame_1")
    assert seen.get("back_mode") == expected
