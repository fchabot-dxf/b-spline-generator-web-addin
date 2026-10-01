"""F22 PANEL LIP: the lip block, the lip ring's classification, the declared offset side, the frame-owned param."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from fb_engine.template_resolver import resolve_template  # noqa: E402
from fb_engine.panel_lip import apply_panel_lip, lip_ids, LIP_PHASE_ID  # noqa: E402
from fb_engine.declared_profiles import classify, DeclaredProfileError  # noqa: E402
from fb_engine.parameter_schema import ParameterSchema, PANEL_LIP_PARAM  # noqa: E402
from fb_engine.frame_definition import EXTRUSION_SETTINGS  # noqa: E402

TEMPLATES = ["template_1", "template_2", "template_3", "template_4", "template_5", "template_6", "template_8"]


def _blocks(t):
    return [(sk["Name"], b["PhaseID"]) for sk in t["Sketches"] for b in sk["Blocks"]]


@pytest.mark.parametrize("tid", TEMPLATES)
def test_lip_0_leaves_the_template_exactly_as_today(tid):
    t, _ = resolve_template(tid)
    assert apply_panel_lip(t, 0) is t
    assert apply_panel_lip(t, None) is t


@pytest.mark.parametrize("tid", TEMPLATES)
def test_the_lip_block_is_one_outward_offset_of_the_outline_driven_by_panel_lip(tid):
    t, _ = resolve_template(tid)
    before = _blocks(t)
    out = apply_panel_lip(t, 0.0625)
    assert _blocks(t) == before                        # the input is untouched (a copy)
    added = [x for x in _blocks(out) if x not in before]
    frame_sketch = [sk["Name"] for sk in t["Sketches"] if any(b["PhaseID"].startswith("p03_") for b in sk["Blocks"])][0]
    assert added == [(frame_sketch, LIP_PHASE_ID)]
    step = [b for sk in out["Sketches"] for b in sk["Blocks"] if b["PhaseID"] == LIP_PHASE_ID][0]["Steps"][0]
    outline = t["Frame"]["regions"]["outline"]
    assert step == {"Type": "Offset", "SourceID": outline, "DistanceExpr": PANEL_LIP_PARAM, "Side": "outward",
                    "TargetIDs": lip_ids(outline)}


@pytest.mark.parametrize("tid", TEMPLATES)
def test_the_lip_ring_is_no_feature_the_trim_still_cuts_and_the_bars_are_unchanged(tid):
    t, _ = resolve_template(tid)
    frame = t["Frame"]
    reg = frame["regions"]
    lip = lip_ids(reg["outline"])
    # the trim profile is now bounded by the surround + the lip loop
    feat, _ = classify(lip + [reg["surround"]], frame)
    assert feat["region"] == "surround-minus-outline"
    # the ring between the outline and the lip loop: the panel keeps it
    assert classify(lip + reg["outline"], frame) == (None, None)
    # MEASURED live (F22): the miters split the ring at the outline corners, so a ring piece also touches miters
    from fb_engine.declared_profiles import miter_curve_id
    corner = [miter_curve_id(*reg["miters"][0]), miter_curve_id(*reg["miters"][1])]
    assert classify(lip[:3] + reg["outline"][:3] + corner, frame) == (None, None)
    # a bar is classified exactly as before. The sample piece is the first MITER's own outline piece, not
    # reg["outline"][0] directly: every template so far happens to order its outline starting at that same piece
    # (so this was a no-op there), but Template 8 starts its own outline elsewhere (at the TR corner, matching
    # _solveDippedLeftWave's own piece order) -- using the miter's own piece keeps this test's intent (a bar
    # profile including BOTH the outline+inner pair and a corner/miter piece) correct regardless of that ordering.
    m0 = reg["miters"][0]
    piece0 = m0[0].split(":")[0]
    bar = [piece0, "inner_" + piece0, piece0]
    assert classify(bar, frame) == classify([c for c in bar], frame)
    assert classify([piece0, "inner_" + piece0], frame)[0]["region"] == "outline-minus-inner"
    # a lip profile with a stray curve is refused, never guessed
    with pytest.raises(DeclaredProfileError):
        classify(lip + ["somewhere_else"], frame)


def test_the_declared_offset_side(monkeypatch):
    import types, importlib
    # offsets.py imports adsk at module level; the rule itself is pure: a scoped stand-in, the module loaded fresh
    fake = types.ModuleType('adsk')
    fake.core, fake.fusion = types.ModuleType('adsk.core'), types.ModuleType('adsk.fusion')
    for k, v in (('adsk', fake), ('adsk.core', fake.core), ('adsk.fusion', fake.fusion)):
        monkeypatch.setitem(sys.modules, k, v)
    monkeypatch.delitem(sys.modules, 'fb_engine.offsets', raising=False)
    offset_went_wrong_side = importlib.import_module('fb_engine.offsets').offset_went_wrong_side
    assert offset_went_wrong_side((10, 10), (12, 12), "inward") is True
    assert offset_went_wrong_side((10, 10), (8, 8), "inward") is False
    assert offset_went_wrong_side((10, 10), (8, 8), "outward") is True
    assert offset_went_wrong_side((10, 10), (12, 12), "outward") is False


def test_panel_lip_is_the_one_frame_owned_param_and_the_setting_names_it():
    assert ParameterSchema.FRAME_OWNED_PARAMS == (PANEL_LIP_PARAM,) == ("panel_lip",)
    assert ParameterSchema.is_frame_owned("panel_lip")
    assert not ParameterSchema.is_board_owned("panel_lip") and not ParameterSchema.is_lattice_owned("panel_lip")
    s = [x for x in EXTRUSION_SETTINGS if x["key"] == "panelLip"][0]
    assert s["param"] == PANEL_LIP_PARAM and s["default"] == 0.0 and s["max"] == "boundingboxoffset"


def test_the_step_dispatcher_passes_the_declared_side_through(monkeypatch):
    """MEASURED live: step_step rebuilt the offset dict from a fixed key list, dropping Side, so the lip went inward."""
    import types, importlib
    fake = types.ModuleType('adsk')
    fake.core, fake.fusion = types.ModuleType('adsk.core'), types.ModuleType('adsk.fusion')
    for k, v in (('adsk', fake), ('adsk.core', fake.core), ('adsk.fusion', fake.fusion)):
        monkeypatch.setitem(sys.modules, k, v)
    monkeypatch.delitem(sys.modules, 'fb_engine.offsets', raising=False)
    offsets = importlib.import_module('fb_engine.offsets')
    seen = []
    monkeypatch.setattr(offsets, 'offset_step', lambda ctx, sk, name, off: seen.append(off))
    t, _ = resolve_template('template_1')
    step = [b for sk in apply_panel_lip(t, 0.0625)["Sketches"] for b in sk["Blocks"] if b["PhaseID"] == LIP_PHASE_ID][0]["Steps"][0]
    offsets.step_step(types.SimpleNamespace(entity_map={}), None, 'T1_3', step)
    assert seen[0]["Side"] == "outward"
    offsets.step_step(types.SimpleNamespace(entity_map={}), None, 'T1_3', {**step, "Side": None} if False else {k: v for k, v in step.items() if k != "Side"})
    assert seen[1]["Side"] == "inward"  # every template offset before F22: the default
