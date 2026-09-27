"""
FB-APP F14 (S8): what a NON-inverted shape outline is, declared once. Used on
the recorded Fusion goldens (tests/fixtures/frame-parity, frame-inversion)
and by the live sweep.

MEASURED F14: at boundingboxoffset 0.5 (T2 7x9, the app's own payload) the
waist arcs cross the centreline and the top horns swap sides (horn_TL at
x = +3.757), with a healthy timeline, so Fusion reports nothing.

The invariant, per sketch-2 outline curve (construction curves skipped):
  - a LEFT curve (id ending "_L", horn_TL, horn_BL) keeps every recorded point
    at x <= 0, a RIGHT one (_R, horn_TR, horn_BR) at x >= 0;
  - every point lies inside the safe zone (the board minus the bbox offset).
Pure: works on the goldens' curve records ({start, end, mid?} in inches).
"""

TOL_IN = 1e-4


def curve_side(curve_id):
    if curve_id.endswith("_L") or curve_id in ("horn_TL", "horn_BL"):
        return -1
    if curve_id.endswith("_R") or curve_id in ("horn_TR", "horn_BR"):
        return 1
    return 0


def outline_violations(curves, width_in, height_in, bbox_in):
    """The list of violations (empty = not inverted) for a sketch-2 outline."""
    hx, hy = width_in / 2 - bbox_in + TOL_IN, height_in / 2 - bbox_in + TOL_IN
    bad = []
    for cid, c in sorted(curves.items()):
        if c.get("construction") or cid.startswith("proj_"):
            continue
        side = curve_side(cid)
        for x, y in [c["start"], c["end"]] + ([c["mid"]] if "mid" in c else []):
            if side and side * x < -TOL_IN:
                bad.append(f"{cid} on the wrong side (x={x})")
                break
            if abs(x) > hx or abs(y) > hy:
                bad.append(f"{cid} outside the safe zone ({x}, {y})")
                break
    return bad
