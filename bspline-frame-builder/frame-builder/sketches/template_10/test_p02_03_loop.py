"""T84 item 7 + H23 item 63: T10's top horns are Vertical ONLY on the unseeded (literal) path.

Root cause (T84 item 7): an unconditional `Vertical` on horn_TR/horn_TL made Fusion snap a seeded (tapered,
slanted) horn back to vertical. Removing it outright (T84 item 7's first fix) broke the UNSEEDED default --
the re-recorded goldens showed the top horns leaning in and asymmetric (3.0925 vs -3.0821 at 7x9). So the
constraint is declared `UnseededOnly`: seed_geometry.apply_seed_geometry drops it from every seeded Send,
and the literal path (Sketch Builder, goldens) keeps it. horn_BR/horn_BL stay Vertical always."""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
_FRAME_BUILDER_ROOT = os.path.dirname(os.path.dirname(_HERE))
if _FRAME_BUILDER_ROOT not in sys.path:
    sys.path.insert(0, _FRAME_BUILDER_ROOT)

import importlib.util  # noqa: E402

from fb_engine.seed_geometry import apply_seed_geometry  # noqa: E402

_PHASE_PATH = os.path.join(_HERE, "phases", "p02_03_loop.py")


def _load_loop_block():
    spec = importlib.util.spec_from_file_location("t10_p02_03_loop_crosscheck", _PHASE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.get_block()


def _vertical_targets(block):
    targets = set()
    for step in block["BuildSequence"]:
        if step.get("Type") == "Vertical":
            targets.update(step["Targets"])
    return targets


def _as_template(block):
    return {"Sketches": [{"Blocks": [block]}]}


def test_unseeded_build_keeps_the_top_horns_vertical():
    targets = _vertical_targets(_load_loop_block())
    assert {"horn_TR", "horn_TL", "horn_BR", "horn_BL"} <= targets


def test_a_seeded_send_frees_the_top_horns_but_not_the_bottom():
    block = _load_loop_block()
    seed = {"horn_TR": {"points": [[3.0, 2.7], [2.8, 1.0]]}}
    seeded = apply_seed_geometry(_as_template(block), seed)["Sketches"][0]["Blocks"][0]
    targets = _vertical_targets(seeded)
    assert "horn_TR" not in targets and "horn_TL" not in targets
    assert "horn_BR" in targets and "horn_BL" in targets


def test_unseeded_apply_keeps_unseeded_only_steps():
    block = _load_loop_block()
    same = apply_seed_geometry(_as_template(block), {})["Sketches"][0]["Blocks"][0]
    assert {"horn_TR", "horn_TL"} <= _vertical_targets(same)
