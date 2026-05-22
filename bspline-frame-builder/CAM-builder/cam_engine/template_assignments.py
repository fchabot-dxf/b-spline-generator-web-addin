"""
template_assignments.py
=======================
Per-project storage for CAM template overrides.

Each setup defined in ``SETUP_SPECS`` ships with a default list of cloud
templates (e.g. B-spline Back → [Pocket back, Morphed Spiral]). The user
can override that list per project — remove any default, swap one out,
add as many additional templates as they want — via the template browser
UI in the CAM Builder palette. Overrides land here as Fusion Attributes
on the active Design so they travel inside the .f3d.

Storage layout
--------------
Attribute group:  ``CAMBuilder``
Attribute name:   ``templates::<setup-name>``      (e.g. ``templates::B-spline Back``)
Value:            JSON-encoded list of template leaf filenames.

If no override attribute exists for a given setup, callers should fall
back to ``spec.get('cloud_templates', [])`` from SETUP_SPECS — the
defaults baked into setup_builder.

Public API
----------
``load_overrides(design)``           → dict[setup_name -> list[leaf_name]]
``load_for_setup(design, name)``     → list[leaf_name] or None  (None = no override)
``save_for_setup(design, name, ls)`` → bool
``clear_for_setup(design, name)``    → bool

All functions are safe to call when ``design`` is None / not a Fusion
Design (e.g. mid-test) — they no-op and return empty/None.
"""

from __future__ import annotations

import json
from typing import List, Optional, Dict


ATTR_GROUP        = 'CAMBuilder'
ATTR_NAME_PREFIX  = 'templates::'   # full attr name = ATTR_NAME_PREFIX + setup_name


def _attr_name(setup_name: str) -> str:
    return f'{ATTR_NAME_PREFIX}{setup_name}'


def load_for_setup(design, setup_name: str) -> Optional[List[str]]:
    """Return the user's override list for one setup, or ``None`` if the
    user hasn't touched the defaults yet."""
    if not design or not setup_name:
        return None
    try:
        attr = design.attributes.itemByName(ATTR_GROUP, _attr_name(setup_name))
    except Exception:
        return None
    if not attr:
        return None
    try:
        parsed = json.loads(attr.value)
        if isinstance(parsed, list):
            # Filter to strings only — guard against legacy / corrupt entries.
            return [str(x) for x in parsed if isinstance(x, str)]
    except Exception:
        pass
    return None


def save_for_setup(design, setup_name: str, leaf_names: List[str]) -> bool:
    """Persist the override list. Pass ``[]`` to mean "no templates" (which
    is meaningfully different from "no override"). Returns True on success."""
    if not design or not setup_name:
        return False
    try:
        payload = json.dumps([str(s) for s in (leaf_names or [])])
        design.attributes.add(ATTR_GROUP, _attr_name(setup_name), payload)
        return True
    except Exception:
        return False


def clear_for_setup(design, setup_name: str) -> bool:
    """Drop the override for one setup, returning it to its SETUP_SPECS
    default. Returns True if an attribute existed and was removed."""
    if not design or not setup_name:
        return False
    try:
        attr = design.attributes.itemByName(ATTR_GROUP, _attr_name(setup_name))
        if attr:
            attr.deleteMe()
            return True
    except Exception:
        pass
    return False


def load_overrides(design) -> Dict[str, List[str]]:
    """Return every setup that has an override, as ``{name: [leaves]}``."""
    out: Dict[str, List[str]] = {}
    if not design:
        return out
    try:
        attrs = design.attributes.itemsByGroup(ATTR_GROUP)
    except Exception:
        return out
    for a in attrs:
        if not a.name.startswith(ATTR_NAME_PREFIX):
            continue
        setup_name = a.name[len(ATTR_NAME_PREFIX):]
        try:
            parsed = json.loads(a.value)
            if isinstance(parsed, list):
                out[setup_name] = [str(x) for x in parsed if isinstance(x, str)]
        except Exception:
            continue
    return out


def resolve_templates(design, setup_name: str, default_list: List[str]) -> List[str]:
    """Single-call resolver used by setup_builder at build time. Returns
    the user's override if present, otherwise the SETUP_SPECS default."""
    override = load_for_setup(design, setup_name)
    return override if override is not None else (default_list or [])
