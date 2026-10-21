"""
stock_dims.py -- the B-spline stock box Fred types in the CAM palette (Stock card, X / Y / Z in inches), kept on the active
Design (the template_assignments.py / op_ledger.py pattern) so it travels inside the .f3d.

Meaning: the TOTAL stock box, in the MODEL's axes (X across the panel, Y up it, Z through it), centred on the panel in X/Y,
its bottom on the model's world bottom; ONE box shared by the Back and the flipped setups (the flipped one takes the
previous setup's stock). EMPTY (no attribute) = default: a NEW setup gets the declared box (panel + margin, 2 in tall) and an
EXISTING setup keeps whatever stock it has. FILLED = Fred's explicit intent: BUILD / APPLY writes this box to the B-spline
setups, existing ones too.

Storage layout
--------------
Attribute group:  ``CAMBuilder``
Attribute name:   ``stock::B-spline``
Value:            JSON ``[x, y, z]`` in inches.

Every function is safe to call with ``design`` None (no-op / None).
"""

from __future__ import annotations

import json
from typing import List, Optional, Tuple

ATTR_GROUP = 'CAMBuilder'
ATTR_NAME = 'stock::B-spline'
IN_CM = 2.54


def parse_dims(value) -> Optional[Tuple[float, float, float]]:
    """(x, y, z) inches from a list / tuple of three positive numbers, else None. Pure."""
    try:
        x, y, z = (float(v) for v in value)
    except Exception:
        return None
    return (x, y, z) if all(v > 0 and v == v for v in (x, y, z)) else None


def load(design) -> Optional[Tuple[float, float, float]]:
    """The saved stock (x, y, z) in inches, or None when the stock is default (nothing saved / unreadable)."""
    if not design:
        return None
    try:
        attr = design.attributes.itemByName(ATTR_GROUP, ATTR_NAME)
        return parse_dims(json.loads(attr.value)) if attr else None
    except Exception:
        return None


def save(design, dims) -> bool:
    """Save (x, y, z) inches; None / invalid clears (default). Returns True when something valid is stored."""
    if not design:
        return False
    d = parse_dims(dims) if dims is not None else None
    if d is None:
        clear(design)
        return False
    try:
        design.attributes.add(ATTR_GROUP, ATTR_NAME, json.dumps([round(v, 4) for v in d]))
        return True
    except Exception:
        return False


def clear(design) -> bool:
    """Drop the saved stock (back to default). True when an attribute existed and was removed."""
    if not design:
        return False
    try:
        attr = design.attributes.itemByName(ATTR_GROUP, ATTR_NAME)
        if attr:
            attr.deleteMe()
            return True
    except Exception:
        pass
    return False


def panel_bbox_cm(design):
    """(min, max) world bbox in cm of the panel the bspline_set MM machines -- Stamped when it exists, else Clean (the MM
    filter's own 'Stamped wins' rule) -- or None."""
    root = design.rootComponent
    for want in ('stamped', 'clean'):
        for occ in root.allOccurrences:
            path = (occ.fullPathName or '').lower()
            if 'b-spline set' not in path or want not in (occ.component.name or '').lower():
                continue
            for b in occ.bRepBodies:
                if getattr(b, 'isSolid', False) and (b.name or '').lower().startswith('panel'):
                    bb = b.boundingBox
                    return (bb.minPoint.asArray(), bb.maxPoint.asArray())
    return None


def part_extent_in(design, box_of=None):
    """{'x', 'y', 'z'} inches: the extent the stock must hold -- the panel and the wood frame around it, in the model's axes
    (the Stock card's warning compares the typed box with this). None when the design holds no panel. ``box_of`` (testing):
    a function returning the (min, max) cm of each body list, else the real Design bodies are read."""
    panel = panel_bbox_cm(design)
    if panel is None:
        return None
    lo, hi = list(panel[0]), list(panel[1])
    try:
        for occ in design.rootComponent.allOccurrences:
            if (occ.component.name or '').lower().startswith('frame'):
                for b in occ.bRepBodies:
                    bb = b.boundingBox
                    for k in range(3):
                        lo[k] = min(lo[k], bb.minPoint.asArray()[k])
                        hi[k] = max(hi[k], bb.maxPoint.asArray()[k])
    except Exception:
        pass
    return {a: round((hi[k] - lo[k]) / IN_CM, 4) for k, a in enumerate('xyz')}


def default_dims_in(design, position=None):
    """The declared default stock (x, y, z) in inches for the preview of an empty card: the panel's extent + the margin in
    X / Y (CAM_POSITION['stock']), the declared thickness in Z. None when the design holds no panel."""
    from .cam_position import CAM_POSITION, stock_box_cm, stock_dims_cm
    panel = panel_bbox_cm(design)
    if panel is None:
        return None
    box = stock_box_cm(panel[0], panel[1], position or CAM_POSITION)
    return tuple(round(v / IN_CM, 4) for v in stock_dims_cm(box))


def smaller_axes(dims, need) -> List[str]:
    """The axes ('X' / 'Y' / 'Z') where the typed ``dims`` (x, y, z) is smaller than ``need`` ({'x','y','z'}): the Stock
    card's detection-only warning (nothing is clamped). Pure."""
    if not dims or not need:
        return []
    return [a.upper() for a, d in zip('xyz', dims) if d < need.get(a, 0) - 1e-6]
