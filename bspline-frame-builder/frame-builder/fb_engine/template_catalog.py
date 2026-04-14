"""
Central template metadata for the Frame Builder.

This is the single source of truth for template display names, descriptions,
and stable style keys used across the UI and the engine.
"""

TEMPLATE_CATALOG = {
    "Template 1": {
        "display_name": "Template 1 - Hourglass",
        "description": "Standardized Arc Series - Metric Unified",
        "prefix": "T1",
    },
    "Template 2": {
        "display_name": "Template 2 - Narrow Neck",
        "description": "Standardized Arc Series - Metric Unified",
        "prefix": "T2",
    },
    "Template 3": {
        "display_name": "Template 3",
        "description": "Dynamic Clone of Template 2 - Ready for customization",
        "prefix": "T3",
    },
    "Template 4": {
        "display_name": "Template 4",
        "description": "Dynamic Clone of Template 2 - Standardized T4 Wiring",
        "prefix": "T4",
    },
}


def get_display_name(style_id):
    for key, entry in TEMPLATE_CATALOG.items():
        if key in style_id:
            return entry["display_name"]
    return style_id


def get_entry(style_id):
    for key, entry in TEMPLATE_CATALOG.items():
        if key in style_id:
            return entry
    return None


def get_available_templates():
    return [{"label": entry["display_name"], "value": entry["display_name"]}
            for entry in TEMPLATE_CATALOG.values()]
