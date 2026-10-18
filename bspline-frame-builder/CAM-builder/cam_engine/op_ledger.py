"""
op_ledger.py
============
Which operations the add-in stamped, kept on the active Design (the template_assignments.py pattern) so the setups
and operations themselves stay untouched (H23 item 91: an attribute written on a fresh setup broke the first APPLY).

Storage layout
--------------
Attribute group:  ``CAMBuilder``
Attribute name:   ``ops::<setup-name>``
Value:            JSON ``{template leaf: [operation key, ...]}`` -- the keys of the operations that template made.

Used for two rules (Fred, "Send stops wiping CAM"):
  * APPLY does not stamp a template again into a setup that still holds that template's operations;
  * a clear never deletes a setup holding an operation that is not in this record.

All functions are safe to call with ``design`` None (they no-op).
"""

from __future__ import annotations

import json
import re
from typing import Dict, List, Optional, Set

ATTR_GROUP       = 'CAMBuilder'
ATTR_NAME_PREFIX = 'ops::'   # full attr name = ATTR_NAME_PREFIX + setup_name


def _attr_name(setup_name: str) -> str:
    return f'{ATTR_NAME_PREFIX}{setup_name}'


def op_key(op) -> Optional[str]:
    """An operation's stable identity. entityToken first, then operationId; None when the object offers neither."""
    for attr in ('entityToken', 'operationId'):
        try:
            v = getattr(op, attr)
        except Exception:
            continue
        if v:
            return str(v)
    return None


def load(design, setup_name: str) -> Optional[Dict[str, List[str]]]:
    """{leaf: [keys]} for one setup, or None when nothing was ever recorded for it."""
    if not design or not setup_name:
        return None
    try:
        attr = design.attributes.itemByName(ATTR_GROUP, _attr_name(setup_name))
        if not attr:
            return None
        parsed = json.loads(attr.value)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    return {str(k): [str(x) for x in v if isinstance(x, str)] for k, v in parsed.items() if isinstance(v, list)}


def record(design, setup_name: str, leaf: str, ops) -> bool:
    """Add the keys of ``ops`` (just stamped from template ``leaf``) to the setup's record. Operations with no key
    are not recorded (they cannot be told apart later)."""
    if not design or not setup_name:
        return False
    keys = [k for k in (op_key(o) for o in ops) if k]
    if not keys:
        return False
    try:
        data = load(design, setup_name) or {}
        data[leaf] = sorted(set(data.get(leaf, [])) | set(keys))
        design.attributes.add(ATTR_GROUP, _attr_name(setup_name), json.dumps(data))
        return True
    except Exception:
        return False


def ours_tokens(design, setup_name: str) -> Set[str]:
    """Every operation key recorded for the setup."""
    return {k for ks in (load(design, setup_name) or {}).values() for k in ks}


def holds_template(design, setup, setup_name: str, leaf: str) -> bool:
    """True when ``setup`` still holds at least one operation recorded from template ``leaf``."""
    recorded = set((load(design, setup_name) or {}).get(leaf, []))
    if not recorded:
        return False
    return any(op_key(o) in recorded for o in _ops(setup))


def base_name(name) -> str:
    """An operation name without Fusion's / the rename's " (N)" suffix."""
    return re.sub(r' \(\d+\)$', '', str(name or ''))


def named_like(setup, leaf_base: str) -> bool:
    """True when the setup holds an operation named like template ``leaf_base`` (the add-in renames its operations to
    the template's name). The fallback for a setup with no record."""
    return any(base_name(getattr(o, 'name', None)) == leaf_base for o in _ops(setup))


def _ops(setup):
    try:
        return [setup.operations.item(i) for i in range(setup.operations.count)]
    except Exception:
        return []


def foreign_operations(design, setup, setup_name: str, known_names=frozenset()) -> list:
    """The setup's operations that are NOT provably the add-in's: not in the record. When nothing was ever
    recorded for the setup (a file from before the record), an operation counts as ours only if its name is one of
    ``known_names`` (the declared template names, which the add-in renames its operations to)."""
    ops = _ops(setup)
    recorded = load(design, setup_name)
    if recorded is None:
        return [o for o in ops if base_name(getattr(o, 'name', None)) not in known_names]
    ours = ours_tokens(design, setup_name)
    return [o for o in ops if op_key(o) not in ours]
