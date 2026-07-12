"""
Frame Inspector payload builder.

This module constructs the JSON payload sent to the inspector palette.
"""

from selection_items import build_selection_items
from fb_shared.entity_helpers import get_fb_name, get_entity_coord, get_fb_metadata


def build_payload(entities):
    count = len(entities)
    payload = {
        'count': count,
        'mainFeature': 'Select geometry...',
        'items': [],
        'listLabel': 'Selection',
        'type': 'Other'
    }

    if count == 0:
        return payload

    first_ent = entities[0]
    if hasattr(first_ent, 'nativeObject') and first_ent.nativeObject:
        first_ent = first_ent.nativeObject

    payload['mainFeature'] = get_fb_name(first_ent) if count == 1 else f"{count} Entities Selected"
    payload['items'] = build_selection_items(entities, get_entity_coord, get_fb_metadata)
    return payload
