"""T84 item 7: a direct, PERMANENT regression guard for the exact root cause H23 item 59/60 found and
this item fixed -- p02_03_loop.py's own unconditional `Vertical` constraint on horn_TR/horn_TL, which
made Fusion's solver snap a seeded (tapered, slanted) horn straight back to vertical regardless of what
seed was sent (confirmed live: a taper=-15 seed built with horn_TR still perfectly vertical before this
fix). No JS-side test can see this -- the JS construction was already correct before the fix; the bug
lived ENTIRELY in this Fusion phase declaration. horn_BR/horn_BL must stay Vertical (taper only ever
affects the TOP corner, item 59's own construction fix leaves the bottom corner alone -- Template 12's
own identical, already-shipped pattern)."""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
_FRAME_BUILDER_ROOT = os.path.dirname(os.path.dirname(_HERE))
if _FRAME_BUILDER_ROOT not in sys.path:
    sys.path.insert(0, _FRAME_BUILDER_ROOT)

import importlib.util  # noqa: E402

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


def test_top_horns_are_not_forced_vertical():
    targets = _vertical_targets(_load_loop_block())
    assert "horn_TR" not in targets, "horn_TR must stay free to slant under a tapered seed (T84 item 7)"
    assert "horn_TL" not in targets, "horn_TL must stay free to slant under a tapered seed (T84 item 7)"


def test_bottom_horns_still_are_vertical():
    # Taper only ever affects the TOP corner (item 59's own construction fix); the bottom horns keep
    # Template 1's own untouched mechanism.
    targets = _vertical_targets(_load_loop_block())
    assert "horn_BR" in targets
    assert "horn_BL" in targets


def test_mutation_non_vacuous():
    """Proves the test above is not vacuous: a BuildSequence that DOES still force horn_TR vertical
    (the pre-fix state) must fail it."""
    block = _load_loop_block()
    mutated = dict(block, BuildSequence=[
        dict(step, Targets=['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']) if step.get('Type') == 'Vertical' else step
        for step in block["BuildSequence"]
    ])
    targets = _vertical_targets(mutated)
    assert "horn_TR" in targets and "horn_TL" in targets  # the mutated (pre-fix-shaped) block DOES fail the rule above
