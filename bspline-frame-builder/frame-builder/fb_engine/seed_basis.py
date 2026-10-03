"""
FB-APP F14 (S8): what the shape-outline (sketch 2) SEEDS are fractions of.

The phase files write each seed as a fraction of the board (``widthIn *
0.464286``). Those fractions were fit at the templates' default
boundingboxoffset of 0.25 in: on 7x9, 0.464286 * 7 = 3.25 = 3.5 - 0.25, the
safe-zone corner. With a bigger offset the safe zone shrinks, but those seeds
don't. The coincident constraints then drag points across the centreline, and
Fusion solves into the mirrored branch: the waist arcs cross and the top horns
swap sides, with a healthy timeline. MEASURED F14 (flat core, 50-case sweep):
T2 inverts from bbox 0.5 on 4 of 5 boards, T1 at bbox 1.0.

So a seed is a fraction of the SEED BOARD: the board whose safe zone at the
seeds' own offset (SEED_FIT_BBOX) is this build's safe zone,
    widthIn  -> (widthIn  - 2 * (boundingboxoffset - SEED_FIT_BBOX))
    heightIn -> (heightIn - 2 * (boundingboxoffset - SEED_FIT_BBOX)).
At the default offset this is exactly the old seed at every board size, so
the S4 goldens are unchanged. Only EXISTING parameters are referenced: no
Fusion parameter is added.
Applied to sketch 2 only (sketch 1 is the board itself; sketch 3's surround is
board-sized). The app's seeds (seed_geometry, F11) replace the mapped Points
afterwards with in-position values, so they are untouched.
"""
import re

SEED_FIT_BBOX = "0.25 in"  # the boundingboxoffset both templates' literal seeds were fit at
SEED_BOARD = {
    name: f"({name} - 2 * (boundingboxoffset - {SEED_FIT_BBOX}))" for name in ("widthIn", "heightIn")
}
_TOKEN = re.compile(r"\b(widthIn|heightIn)\b")


def on_seed_board(expr):
    """One seed expression with widthIn / heightIn read as the seed board."""
    if not isinstance(expr, str):
        return expr
    return _TOKEN.sub(lambda m: SEED_BOARD[m.group(1)], expr)


def seed_sketch(sketch):
    """Rewrite a shape-outline sketch's seeds (Line / Arc3Point Points, the
    temporary seed Radius expressions) onto the seed board, in place."""
    for block in sketch.get("Blocks", []):
        for step in block.get("BuildSequence", []):
            if step.get("Type") in ("Line", "Arc3Point") and "Points" in step:
                # H23 item 47: a point may be a {'SeedFrom': {...}} marker (fb_engine/geometry.py's
                # own `_resolve_point_spec`, resolved at BUILD time against live geometry) instead
                # of a literal [x_expr, y_expr] pair -- left untouched here, not iterated into.
                step["Points"] = [p if isinstance(p, dict) else [on_seed_board(v) for v in p]
                                  for p in step["Points"]]
            elif step.get("Type") == "Radius" and "Expression" in step:
                step["Expression"] = on_seed_board(step["Expression"])
    return sketch
