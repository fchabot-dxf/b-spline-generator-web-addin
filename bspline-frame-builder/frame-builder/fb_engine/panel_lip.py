"""
panel_lip.py — FB-APP F22 PANEL LIP (Fred: "for the panel I sometimes want a small offset outward, just to be sure
it actually sits well everywhere and that I can flush trim at the end when it's glued").

The panel's TRIM_CUT normally follows the frame outline. With a lip, the frame sketch gets one more curve loop:
the outline offset OUTWARD by the Fusion user parameter `panel_lip` (the ONE exception to "frames never get new
params", Fred: "if needed add a param in fusion"; registered in parameter_schema's FRAME group, written only by
[Send frame]). The trim profile is then bounded by the surround and the lip loop; the ring between the outline
and the lip loop is no feature, so the panel keeps it. The bars are untouched. Editing `panel_lip` in Fusion moves
the lip loop (a parametric offset) and the trim follows.

Lip 0 = no block, no parameter: the template is returned unchanged (today exactly).

Pure: no adsk. The lip curves are named by ONE rule (`lip_ids`), which declared_profiles.classify reads too
(the solid build re-resolves the template from disk, so the ids must be derivable, not stored).
"""
import copy

from fb_engine.parameter_schema import PANEL_LIP_PARAM

LIP_PREFIX = "lip_"
LIP_PHASE_ID = "p03_90_panel_lip"


def lip_ids(outline_ids):
    """The lip loop's curve ids, one per outline curve, in outline order."""
    return [f"{LIP_PREFIX}{c}" for c in outline_ids]


def _frame_sketch(template, outline):
    """The sketch holding the frame outline (the one whose inner-edge Offset step starts from it)."""
    for sk in template.get("Sketches", []):
        for block in sk.get("Blocks", []):
            for step in (block.get("Steps") or []) + (block.get("BuildSequence") or []):
                if step.get("Type") == "Offset" and list(step.get("SourceID") or []) == list(outline):
                    return sk
    return None


def apply_panel_lip(template, lip_in):
    """The template with the panel lip block appended to its frame sketch (lip > 0), else unchanged."""
    lip = float(lip_in or 0)
    if not lip > 0:
        return template
    out = copy.deepcopy(template)
    outline = out["Frame"]["regions"]["outline"]
    sk = _frame_sketch(out, outline)
    if sk is None:
        raise ValueError("the template's frame sketch (its outline Offset) was not found")
    sk["Blocks"].append({
        "PhaseID": LIP_PHASE_ID,
        "Name": "Panel Lip",
        "Steps": [{
            "Type": "Offset",
            "SourceID": list(outline),
            "DistanceExpr": PANEL_LIP_PARAM,
            "Side": "outward",
            "TargetIDs": lip_ids(outline),
        }],
    })
    return out
