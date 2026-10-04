"""
H23 item 44 (2): a PERMANENT, declared guard -- every corner `frameMiters` (JS) / `miters.py`
(Python) expects an inner-corner point for must have that point resolved by an EXPLICIT declared
step (`ResolveInnerCorners` or `ResolveLineCircleCorner`), never left to Fusion's own native offset
to tag on its own.

MEASURED TWICE this session (items 38 and 43), independently, on two different templates: Fusion's
inward offset can produce the geometrically CORRECT inner curve/point for a line-meets-arc corner,
but never tag it with any ID at all -- `fb_engine/miters.py`'s own lookup then returns `None`
silently ("MITER MISS", never raised, never surfaced anywhere except a DEBUG-level log line), and
`declared_profiles.classify` finds one unsplit profile spanning multiple declared bars. Nothing
else in the test suite catches this: a template with this exact gap builds a VALID-LOOKING sketch
(no exception), just with fewer declared bars than it should have -- only a LIVE Fusion build ever
revealed either case, and only because someone happened to look at the "NOT BUILT" log line.

This test needs no Fusion at all: it reads the SAME declared `regions.miters` (the Source/Target
pairs `p03_04`'s own Miters block -- and `declared_profiles.classify` -- actually use) and the
SAME declared corner-resolution steps (`ResolveInnerCorners` / `ResolveLineCircleCorner`) every
template's own `p03_03`-numbered phase declares, and asserts every miter's own Target ID is
covered by one of them. Seat C's own new templates (Flask, Arched Funnel, Tulip) will inherit this
test automatically the moment they're added to `TEMPLATES` below (or discovered dynamically --
see `test_every_registered_template_is_covered_by_this_list`).
"""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
_FRAME_BUILDER_ROOT = os.path.dirname(_HERE)
if _FRAME_BUILDER_ROOT not in sys.path:
    sys.path.insert(0, _FRAME_BUILDER_ROOT)

import pytest  # noqa: E402

from fb_engine.template_resolver import resolve_template, _ensure_template_registry  # noqa: E402

TEMPLATES = ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6',
             'template_7', 'template_8', 'template_9', 'template_10', 'template_11', 'template_12',
             'template_13', 'template_14', 'template_15', 'template_16', 'template_17', 'template_18']

_RESOLVE_STEP_TYPES = ('ResolveInnerCorners', 'ResolveLineCircleCorner', 'ResolveCircleCircleCorner')


def _covered_inner_ids(template):
    """Every InnerID any declared ResolveInnerCorners / ResolveLineCircleCorner step (in ANY
    sketch/block of this resolved template) actually resolves."""
    out = set()
    for sk in template['Sketches']:
        for block in sk.get('Blocks', []):
            for step in block.get('BuildSequence', []) or []:
                if step.get('Type') in _RESOLVE_STEP_TYPES:
                    for cfg in (step.get('Corners') or {}).values():
                        inner_id = cfg.get('InnerID')
                        if inner_id:
                            out.add(inner_id)
    return out


def test_every_registered_template_is_covered_by_this_list():
    """A new template (Flask / Arched Funnel / Tulip / ...) added to the registry but not to
    TEMPLATES above would silently skip this guard -- fails loudly instead."""
    discovered = {e['id'] for e in _ensure_template_registry()}
    assert discovered == set(TEMPLATES), (
        f"TEMPLATES is out of sync with the real registry -- missing: {discovered - set(TEMPLATES)}, "
        f"extra: {set(TEMPLATES) - discovered}")


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_no_declared_miter_can_miss_its_inner_corner(template_id):
    """Every [OuterID, InnerID] pair in this template's own declared regions.miters (the EXACT
    pairs fb_engine/miters.py's own miter_step and declared_profiles.classify both key off of)
    must have its InnerID covered by an explicit ResolveInnerCorners or ResolveLineCircleCorner
    step -- never left for Fusion's own native offset tagging to (maybe) provide."""
    template, _ = resolve_template(template_id)
    miters = template['Frame']['regions'].get('miters', [])
    assert miters, f"{template_id}: no declared miters at all -- regions.miters is empty"
    covered = _covered_inner_ids(template)
    missing = [pair for pair in miters if pair[1] not in covered]
    assert not missing, (
        f"{template_id}: {len(missing)} declared miter(s) have NO explicit inner-corner resolve "
        f"step -- MITER MISS is possible live: {missing}")
