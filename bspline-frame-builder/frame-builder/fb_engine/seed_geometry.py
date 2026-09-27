"""
seed_geometry.py — FB-APP F11, option B (Fred: "simply seed it in position").

The app's seeded frame shape reaches Fusion as SEED GEOMETRY: the template's
own shape-outline seeds (the literal points its phases already declare, and
the temporary seed radius dims they set then delete) are moved to the app's
solved outline. The sketch's own constraints (coincidence, tangency, the pin
welds) then solve from there. No dimension and no user parameter is added.

`seed_geometry` (built by the app from template_data FRAME_SEED_MAP, see
editor/frame-handles.js frameSeedGeometry): {id: {"points": [[x, y], ...]}}
for a Line / Arc3Point block (Fusion sketch coordinates, inches), or
{id: {"radius": r}} for a seed Radius dim (inches).

Pure: returns a changed COPY of the resolved template.
"""
import copy


class SeedGeometryError(ValueError):
    """A seed names nothing in the template, or has the wrong shape."""


def _in(v):
    return f"{float(v)} in"


def apply_seed_geometry(template, seed_geometry):
    out = copy.deepcopy(template)
    pending = dict(seed_geometry or {})
    for sketch in out.get("Sketches", []):
        for block in sketch.get("Blocks", []):
            for step in block.get("BuildSequence", []) or []:
                key = step.get("ID") if step.get("Type") in ("Line", "Arc3Point") else (
                    step.get("Name") if step.get("Type") == "Radius" else None)
                if key not in pending:
                    continue
                seed = pending.pop(key)
                if step["Type"] == "Radius":
                    if "radius" not in seed:
                        raise SeedGeometryError(f"seed {key!r}: a Radius seed needs 'radius'")
                    step["Expression"] = _in(seed["radius"])
                else:
                    pts = seed.get("points")
                    if not isinstance(pts, list) or len(pts) != len(step.get("Points", [])):
                        raise SeedGeometryError(f"seed {key!r}: {len(step.get('Points', []))} points expected")
                    step["Points"] = [[_in(x), _in(y)] for x, y in pts]
    if pending:
        raise SeedGeometryError(f"seed(s) not in the template: {sorted(pending)}")
    return out
