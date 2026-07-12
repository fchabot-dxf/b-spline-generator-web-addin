"""
Frame Inspector selection item builder.

This module converts selected Fusion sketch entities into a structured
selection payload for the inspector palette.
"""

import adsk.core, adsk.fusion
from fb_shared.expression_coords import get_entity_coord_expr
from fb_shared.entity_helpers import get_fb_name as get_entity_name


def _get_native(ent):
    if hasattr(ent, 'nativeObject') and ent.nativeObject:
        return ent.nativeObject
    return ent


def build_selection_items(entities, coord_func, meta_func=None):
    items = []
    for ent in entities:
        ent = _get_native(ent)
        name = get_entity_name(ent)
        coord = ''
        coord_expr = ''
        meta = ''
        try:
            coord = coord_func(ent) or ''
        except Exception:
            coord = ''
        try:
            coord_expr = get_entity_coord_expr(ent) or ''
        except Exception:
            coord_expr = ''
        if meta_func:
            try:
                meta = meta_func(ent) or ''
            except Exception:
                meta = ''
        items.append({
            'name': name,
            'coord': coord,
            'coordExpr': coord_expr,
            'meta': meta
        })
    return items
