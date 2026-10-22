"""op_states.py -- what the CAM palette's Toolpaths list shows for each operation, read straight from Fusion.

Read-only and light (a palette opened on a doc, a focus, a poll while a generation runs): no ledger is needed for the
STATE; the ledger only tells hand-added operations from the add-in's (the tag; the same rule as op_ledger.foreign_operations).

State of one operation (measured live 2026-10-20, seat D, on a copy of Fred's file):
  suppressed  op.isSuppressed (operationState 2)
  error       op.hasError                  -- Fusion's first error line travels with it ('why')
  none        no toolpath yet              (operationState 3)
  stale       a toolpath that is no longer valid (operationState 1): Fred edited the tool or a setting, an op before it
              in the setup was regenerated, ... -- Fusion flips it the moment the edit is made
  warn        a valid toolpath with a warning ('why')
  valid       a valid toolpath             (operationState 0)

The list view is cam-op-list.js (one declared map of states -> dot / label / button); this module sends raw state ids.
"""

from __future__ import annotations

import math

from . import hole_chain, op_ledger
from .toolpath_gen import why_empty

STATES = ('suppressed', 'error', 'none', 'stale', 'warn', 'valid')

# Declared: the ledger leaf prefix of the hole chain; a hand-added pocket op in a setup that holds one is flagged
# 'dup' (it may cut the holes a second time -- hole_chain.build_hole_chain's INFO line, shown in the list).
CHAIN_LEAF_PREFIX = 'hole-chain:'

# Declared: Fusion's tool_type -> the short word the list shows next to the diameter.
TOOL_TYPE_SHORT = {
    'flat end mill': 'flat', 'ball end mill': 'ball', 'bull nose end mill': 'bull', 'tapered mill': 'taper',
    'chamfer mill': 'chamfer', 'radius mill': 'radius', 'slot mill': 'slot', 'face mill': 'face', 'drill': 'drill',
    'lollipop mill': 'lollipop', 'form mill': 'form', 'dovetail mill': 'dovetail', 'thread mill': 'thread',
}

CM_PER_IN = 2.54


def _first_line(text):
    text = (text or '').strip()
    return text.splitlines()[0].strip() if text else ''


def op_state(op):
    """(state id, Fusion's first error / warning line or ''). Never raises."""
    try:
        if getattr(op, 'isSuppressed', False):
            return 'suppressed', ''
        err = _first_line(getattr(op, 'error', ''))
        if getattr(op, 'hasError', False):
            return 'error', err
        if not getattr(op, 'hasToolpath', False):
            return 'none', err
        if not getattr(op, 'isToolpathValid', False):
            return 'stale', ''
        if getattr(op, 'hasWarning', False):
            return 'warn', _first_line(getattr(op, 'warning', ''))
        return 'valid', ''
    except Exception:
        return 'none', ''


def diameter_label(in_):
    """0.1875 -> '3/16', 0.25 -> '1/4', 0.5 -> '1/2'; a diameter that is no 1/64 multiple -> '0.123 in'. Pure."""
    if in_ is None or in_ <= 0:
        return ''
    for den in (2, 4, 8, 16, 32, 64):
        num = round(in_ * den)
        if num and abs(in_ - num / den) < 0.0006:
            g = math.gcd(num, den)
            n, d = num // g, den // g
            return f'{n}' if d == 1 else f'{n}/{d}'
    return f'{in_:.3f} in'


def _param(op, name):
    try:
        return op.parameters.itemByName(name)
    except Exception:
        return None


def tool_label(op):
    """'3/16 flat' from the op's tool_diameter (cm in Fusion's API) and tool_type. '' when unreadable."""
    try:
        d = _param(op, 'tool_diameter')
        dia = diameter_label(d.value.value / CM_PER_IN) if d is not None else ''
        t = _param(op, 'tool_type')
        kind = str(t.expression).strip("'\" ") if t is not None else ''
        return ' '.join(x for x in (dia, TOOL_TYPE_SHORT.get(kind, kind)) if x)
    except Exception:
        return ''


def all_ops(setup):
    """Every operation of the setup in tree order, the ones inside folders too (Fred's 'slots' folder): setup.allOperations,
    else the plain list (a setup with no folders / a fake)."""
    try:
        return [op for op in setup.allOperations]
    except Exception:
        return op_ledger._ops(setup)


def _selects_circles(op):
    """True when the op's boundary is picked SketchCircles: the kind of pocket that cuts the node holes (a back pocket
    on the outline selects lines and splines, or no curves at all)."""
    try:
        cs = _param(op, 'machiningBoundarySel').value.getCurveSelections()
        for i in range(cs.count):
            for g in cs.item(i).inputGeometry:
                if 'SketchCircle' in str(getattr(g, 'objectType', '')):
                    return True
    except Exception:
        pass
    return False


def _uses_rest(op):
    p = _param(op, 'useRestMachining')
    try:
        return bool(p is not None and str(p.expression).strip().lower() == 'true')
    except Exception:
        return False


def addin_op_names():
    """The names the add-in gives the operations it stamps: every declared template leaf sans extension, and the hole
    chain's op names. The fallback that tells hand-added operations apart in a setup with no ledger record."""
    from . import setup_builder
    ext = '.f3dhsm-template'
    names = {leaf[:-len(ext)] if leaf.endswith(ext) else leaf
             for spec in setup_builder.SETUP_SPECS for leaf in (spec.get('cloud_templates') or [])}
    for chain in hole_chain.HOLE_CHAINS.values():
        names.update(o['name'] for o in chain['ops'])
    return names


def _is_hand_added(key, name, ours, known_names):
    """Not made by the add-in. With a ledger record (``ours``: the recorded keys): not in it. Without one (a file from
    before the record): not named like a declared template / chain op. The same rule as op_ledger.foreign_operations, but
    over EVERY operation (that one walks the top level only, and Fred's slots sit in a folder)."""
    if ours is not None:
        return key not in ours
    return op_ledger.base_name(name) not in known_names


def snapshot(cam, design, known_names=frozenset(), apply_of=None):
    """[{'name': setup, 'ops': [{key, name, tool, rest, strategy, state, why, src ('addin' | 'hand'), dup}]}] in setup /
    operation order. Returns [] with no CAM. ``known_names``: the names the add-in renames its operations to (the
    fallback for a setup with no ledger record -- op_ledger.foreign_operations). ``apply_of(setup name)``: the setup's own
    APPLY button state ({'enabled', 'why'}, or None for a setup with no declared role -- setup_builder.apply_state)."""
    out = []
    if cam is None:
        return out
    for i in range(cam.setups.count):
        s = cam.setups.item(i)
        ops = all_ops(s)
        recorded = op_ledger.load(design, s.name)
        ours = op_ledger.ours_tokens(design, s.name) if recorded is not None else None
        has_chain = any(leaf.startswith(CHAIN_LEAF_PREFIX) for leaf in (recorded or {}))
        rows = []
        for o in ops:
            state, why = op_state(o)
            key = op_ledger.op_key(o) or o.name
            hand = _is_hand_added(key, o.name, ours, known_names)
            strategy = getattr(o, 'strategy', '')
            rows.append({
                'key': key, 'name': o.name, 'tool': tool_label(o), 'rest': _uses_rest(o),
                'strategy': strategy, 'state': state, 'why': why, 'src': 'hand' if hand else 'addin',
                'dup': bool(hand and has_chain and state != 'suppressed' and strategy in hole_chain.POCKET_STRATEGIES
                            and _selects_circles(o)),
            })
        out.append({'name': s.name, 'ops': rows, 'apply': apply_of(s.name) if apply_of else None})
    return out


def find_op(cam, setup_name, key):
    """The live operation with this setup name and key (op_ledger.op_key), or None. Never raises."""
    try:
        for i in range(cam.setups.count):
            s = cam.setups.item(i)
            if s.name != setup_name:
                continue
            for o in all_ops(s):
                if (op_ledger.op_key(o) or o.name) == key:
                    return o
    except Exception:
        pass
    return None


def missing_targets(cam, setup_name=None):
    """[(setup name, key)] of the operations "Generate all missing" would run, in setup / operation order: every op
    that is not suppressed and has no valid toolpath (none, stale or error). ``setup_name`` limits it to one setup."""
    out = []
    for i in range(cam.setups.count):
        s = cam.setups.item(i)
        if setup_name is not None and s.name != setup_name:
            continue
        for o in all_ops(s):
            if op_state(o)[0] in ('none', 'stale', 'error'):
                out.append((s.name, op_ledger.op_key(o) or o.name))
    return out
