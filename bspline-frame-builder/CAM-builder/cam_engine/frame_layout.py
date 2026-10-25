"""
frame_layout.py -- FRAME-SPLIT (Fred 2026-10-24): the Frame cut as 1 to 4 setups ("sometimes I don't have large enough
pieces"). Declared data + pure functions; setup_builder expands the ONE declared Frame spec through ``expand``.

A layout is a list of PIECES. Each piece = the frame bars it cuts (any of bottom / right / top / left) and, optionally, its
own stock THICKNESS in inches (Fred: "two thickness" -- the halves can be different boards; length and width come from the
piece's own bars). Every bar is in exactly one piece. All pieces share the Frame spec's passes (one cloud template).

Setup names: 1 piece -> "Frame" (exactly today's setup); 2..4 pieces -> "Frame A", "Frame B", ... (Fred: hand-built
frame setups in existing files are not adopted for this -- no extra aliases).

Kept on the active Design (the stock_dims.py pattern) so it travels inside the .f3d:
  Attribute group ``CAMBuilder``, name ``frame::layout``, value JSON ``[{"bars": [...], "thickness_in": x|null}, ...]``.
EMPTY (no attribute) = the default: one piece, all four bars, the model's own thickness -- the build is identical to the
pre-FRAME-SPLIT one.
"""

from __future__ import annotations

import json
from typing import List, Optional

ATTR_GROUP = 'CAMBuilder'
ATTR_NAME = 'frame::layout'

BARS = ('bottom', 'right', 'top', 'left')
MAX_PIECES = 4
LETTERS = 'ABCD'

# The palette's "Pieces" choices (Fred: 1-4). 2 = Fred's usual split.
PRESETS = {
    1: [list(BARS)],
    2: [['bottom', 'right'], ['top', 'left']],
    3: [['bottom', 'right'], ['top'], ['left']],
    4: [[b] for b in BARS],
}

# Every setup name a layout can produce (the coordinator's cleanup set).
ALL_NAMES = frozenset(['Frame'] + [f'Frame {c}' for c in LETTERS[:MAX_PIECES]])


def default_layout() -> List[dict]:
    return [{'bars': list(BARS), 'thickness_in': None}]


def preset(n: int) -> Optional[List[dict]]:
    """The layout for the palette's "Pieces: n" choice, thickness unset; None for an unknown n."""
    bars = PRESETS.get(n)
    return [{'bars': list(b), 'thickness_in': None} for b in bars] if bars else None


def parse(value) -> Optional[List[dict]]:
    """A valid layout (normalised) from a list of {'bars', 'thickness_in'}, else None. Pure.

    Valid = 1..4 pieces, each with at least one known bar, every bar in exactly one piece, thickness a positive number or
    None/empty (= the model's own thickness)."""
    try:
        pieces = list(value)
    except Exception:
        return None
    if not 1 <= len(pieces) <= MAX_PIECES:
        return None
    out, seen = [], []
    for p in pieces:
        try:
            bars = [str(b).lower() for b in p['bars']]
        except Exception:
            return None
        if not bars or any(b not in BARS for b in bars):
            return None
        t = p.get('thickness_in') if isinstance(p, dict) else None
        if t in (None, ''):
            t = None
        else:
            try:
                t = float(t)
            except Exception:
                return None
            if not (t > 0 and t == t):
                return None
        seen.extend(bars)
        out.append({'bars': [b for b in BARS if b in bars], 'thickness_in': t})
    if sorted(seen) != sorted(BARS):           # a bar missing, or in two pieces
        return None
    return out


def load(design) -> List[dict]:
    """The saved layout, or the default (one piece) when nothing valid is saved / ``design`` is None."""
    if design:
        try:
            attr = design.attributes.itemByName(ATTR_GROUP, ATTR_NAME)
            if attr:
                got = parse(json.loads(attr.value))
                if got:
                    return got
        except Exception:
            pass
    return default_layout()


def save(design, layout) -> bool:
    """Save a valid layout (the default clears the attribute). True when the layout was valid."""
    if not design:
        return False
    got = parse(layout)
    if got is None:
        return False
    try:
        if got == default_layout():
            attr = design.attributes.itemByName(ATTR_GROUP, ATTR_NAME)
            if attr:
                attr.deleteMe()
        else:
            design.attributes.add(ATTR_GROUP, ATTR_NAME, json.dumps(got))
        return True
    except Exception:
        return False


def piece_name(i: int, n: int) -> str:
    return 'Frame' if n == 1 else f'Frame {LETTERS[i]}'


def expand(frame_spec: dict, layout) -> List[dict]:
    """The Frame spec as one spec per piece. The default layout returns ``[frame_spec]`` itself (byte-identical build).

    Each piece spec = the Frame spec + 'name', 'bars' (body names frame_<bar> to bind), 'thickness_in'
    (None = the model's thickness) and 'tpl_key' = the Frame spec's name (template overrides are kept per role, so every
    piece runs the same passes)."""
    pieces = parse(layout) or default_layout()
    if pieces == default_layout():
        return [frame_spec]
    n = len(pieces)
    out = []
    for i, p in enumerate(pieces):
        spec = dict(frame_spec)
        spec.update({
            'name': piece_name(i, n),
            'bars': tuple(p['bars']),
            'thickness_in': p['thickness_in'],
            'tpl_key': frame_spec['name'],
        })
        out.append(spec)
    return out


def body_matches(body_name: str, bars) -> bool:
    """True when a body named ``frame_<bar>`` belongs to one of ``bars``."""
    n = str(body_name or '').lower()
    return any(n == f'frame_{b}' for b in bars)
