"""
frame_layout.py -- FRAME-SPLIT (Fred 2026-10-24): the Frame cut as 1 to 4 setups ("sometimes I don't have large enough
pieces"). Declared data + pure functions; setup_builder expands the ONE declared Frame spec through ``expand``.

A layout is a list of PIECES. Each piece = the frame SIDES it cuts (any of bottom / right / top / left) and, optionally, its
own stock THICKNESS in inches (Fred: "two thickness" -- the halves can be different boards; length and width come from the
piece's own bars). Every side is in exactly one piece. All pieces share the Frame spec's passes (one cloud template).
A side means EVERY bar on it, by the BAR NAMING rule (frame-builder fb_engine/frame_definition.py BAR_NAME_RULE):
frame_right, or frame_right_1, frame_right_2, ... -- so the same layout works for every template (4 to 12 bars). A piece
whose sides have no bar in this frame (a peaked roof has no top) is not built; the letters close up. When the frame is
split, the inset window's bars (frame_window_*) get their OWN setup, "Frame Window" (Fred 2026-10-24).

Setup names: 1 piece -> "Frame" (exactly today's setup); 2..4 pieces -> "Frame A", "Frame B", ... (Fred: hand-built
frame setups in existing files are not adopted for this -- no extra aliases).

Kept on the active Design (the stock_dims.py pattern) so it travels inside the .f3d:
  Attribute group ``CAMBuilder``, name ``frame::layout``, value JSON ``[{"bars": [...], "thickness_in": x|null}, ...]``.
EMPTY (no attribute) = the default: one piece, all four bars, the model's own thickness -- the build is identical to the
pre-FRAME-SPLIT one.
"""

from __future__ import annotations

import json
import re
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

WINDOW = 'window'
WINDOW_NAME = 'Frame Window'
_SIDE_RX = re.compile(r'^frame_(top|bottom|right|left)(?:_[1-9][0-9]*)?$')

# Every setup name a layout can produce (the coordinator's cleanup set).
ALL_NAMES = frozenset(['Frame', WINDOW_NAME] + [f'Frame {c}' for c in LETTERS[:MAX_PIECES]])


def body_side(body_name) -> Optional[str]:
    """'top' / 'bottom' / 'right' / 'left' for a frame bar body (frame_right, frame_right_2 ...), 'window' for the inset
    window's frame_window_*, None for anything else."""
    n = str(body_name or '').lower()
    if n.startswith('frame_window_'):
        return WINDOW
    m = _SIDE_RX.match(n)
    return m.group(1) if m else None


def present_sides(body_names):
    """The sides (and 'window') that have at least one bar among ``body_names``."""
    return {s for s in (body_side(n) for n in body_names) if s}


def design_body_names(design) -> Optional[list]:
    """Every body name in the design's component tree (duck-typed), or None when it cannot be read."""
    try:
        root = design.rootComponent
        names = [b.name for b in root.bRepBodies]
        for occ in root.allOccurrences:
            names.extend(b.name for b in occ.component.bRepBodies)
        return names
    except Exception:
        return None


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


def built_pieces(layout, present=None) -> List[dict]:
    """The pieces that become setups, in order: each {'index' (in the saved layout), 'name', 'bars', 'thickness_in'},
    pieces with no bar in ``present`` dropped (letters close up), then -- when the frame is split and ``present`` has the
    inset window -- {'index': None, 'name': 'Frame Window', 'bars': ('window',), 'thickness_in': None}.
    ``present`` None = unknown (every piece kept, no window setup)."""
    pieces = parse(layout) or default_layout()
    kept = [(i, p) for i, p in enumerate(pieces)
            if present is None or any(b in present for b in p['bars'])]
    if not kept:                                   # nothing recognised: fall back to the whole frame
        kept = [(0, {'bars': list(BARS), 'thickness_in': None})]
    n = len(kept)
    out = [{'index': i, 'name': piece_name(k, n), 'bars': tuple(p['bars']), 'thickness_in': p['thickness_in']}
           for k, (i, p) in enumerate(kept)]
    if len(pieces) > 1 and present is not None and WINDOW in present:
        out.append({'index': None, 'name': WINDOW_NAME, 'bars': (WINDOW,), 'thickness_in': None})
    return out


def expand(frame_spec: dict, layout, present=None) -> List[dict]:
    """The Frame spec as one spec per built piece (built_pieces). The default layout returns ``[frame_spec]`` itself
    (byte-identical build: every frame body, window bars included, in one 'Frame' setup).

    Each piece spec = the Frame spec + 'name', 'bars' (the SIDES it binds -- every frame_<side> / frame_<side>_N body --
    or ('window',)), 'thickness_in' (None = the bars' own thickness) and 'tpl_key' = the Frame spec's name (template
    overrides are kept per role, so every piece runs the same passes)."""
    pieces = parse(layout) or default_layout()
    if pieces == default_layout():
        return [frame_spec]
    out = []
    for p in built_pieces(pieces, present):
        spec = dict(frame_spec)
        spec.update({'name': p['name'], 'bars': p['bars'], 'thickness_in': p['thickness_in'],
                     'tpl_key': frame_spec['name']})
        out.append(spec)
    return out


def body_matches(body_name: str, bars) -> bool:
    """True when a body belongs to one of ``bars`` (sides, or 'window'): frame_right / frame_right_2 -> 'right',
    frame_window_top -> 'window'."""
    return body_side(body_name) in bars
