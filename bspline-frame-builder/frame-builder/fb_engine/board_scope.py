"""Send targets (seat A 2026-10-14; advisor 45, Fred): WHICH BOARD a Send / frame build belongs to.

A design can hold several boards. A board sent "as new component" is a root occurrence TAGGED BOARD_ATTR (value =
its boardId), offset beside the others; its B-Spline Set and its Frame_N live INSIDE it. The LEGACY board is today's
layout -- the Set and the Frame directly under the root, untagged. Every design-wide lookup of the Send (the frame
to delete / build into, the inlay the frame goes before in the timeline) asks ONE scope instead:

    BoardScope(design)              the legacy root board: owns every component outside the tagged boards
    BoardScope(design, board_comp)  a tagged board: owns its own component and everything inside it

A design with no tagged board reads exactly as before (the legacy scope owns everything), so a legacy Send is
unchanged. MEASURED (probe 2, 2026-10-14, the real send_frame nested in a Board offset +12 in): the trim cut works
ONLY from the ROOT's features with a root-context profile (`cut_context`); every component's own features refused
("body not found to extrude through").
"""

import re

BOARD_ATTR = ("Bspline", "board")


def board_param_prefix(board_id):
    """Send targets S2 (Fred 2026-10-14, "per-board params"): a tagged board's user parameters are named
    "<boardId>_<name>" -- the id is assigned once (the palette mints it, the board's BOARD_ATTR holds it), so a
    re-send keeps the SAME names (never "widthIn2"). The legacy root board has none: its names stay as they are."""
    return f"{board_id}_" if board_id else ""


def lattice_layer_prefix(layer_id):
    """A lattice layer's own part of the name (two lattice layers of one board must not share rail_width)."""
    return f"L{layer_id}_" if layer_id not in (None, "") else ""


_IDENT = re.compile(r"(?<![\w.])([A-Za-z_][A-Za-z0-9_]*)(?![\w(])")


class BoardNamer:
    """THE one name map of a board's user parameters (declared; S2). `name(base)` -> the board's name, `base(name)`
    -> back (Pull and the stale pass read through it), `rename(text, mapping)` rewrites an expression's tokens that
    are KEYS of `mapping` only -- function names (followed by "("), units and any name not declared for this board
    (Fred's own params) are never touched. The legacy namer (prefix "") is the identity: legacy Sends unchanged."""

    def __init__(self, prefix="", foreign_prefixes=()):
        self.prefix = prefix or ""
        self.foreign = tuple(p for p in foreign_prefixes if p)  # other boards' prefixes (the legacy namer skips them)

    @property
    def is_identity(self):
        return not self.prefix

    def name(self, base):
        if not self.prefix or not base or str(base).startswith(self.prefix):
            return base
        return f"{self.prefix}{base}"

    def base(self, name):
        if self.prefix and name and str(name).startswith(self.prefix):
            return str(name)[len(self.prefix):]
        return name

    def owns(self, name):
        """True if a parameter named `name` belongs to this board's namespace (the legacy one: no board's prefix)."""
        name = str(name or "")
        if self.prefix:
            return name.startswith(self.prefix)
        return not any(name.startswith(p) for p in self.foreign)

    def child(self, part):
        """A sub-namespace inside this board (a lattice layer). The legacy board's stays the identity."""
        return BoardNamer(self.prefix + part, self.foreign) if self.prefix and part else self

    def mapping(self, bases):
        return {b: self.name(b) for b in bases if b}

    @staticmethod
    def rename(text, mapping):
        if not isinstance(text, str) or not mapping or all(k == v for k, v in mapping.items()):
            return text
        return _IDENT.sub(lambda m: mapping.get(m.group(1), m.group(1)), text)


def _same(a, b):
    try:
        return a == b
    except Exception:
        return a is b


def tagged_board_components(design):
    """Every component tagged as a board (BOARD_ATTR), in attribute order."""
    out = []
    try:
        for a in design.findAttributes(*BOARD_ATTR) or []:
            if a.parent is not None and not any(_same(a.parent, c) for c in out):
                out.append(a.parent)
    except Exception:
        pass
    return out


def subtree_components(comp):
    """`comp` and every component occurring anywhere inside it."""
    out = [comp]
    try:
        for occ in comp.allOccurrences:
            c = occ.component
            if not any(_same(c, x) for x in out):
                out.append(c)
    except Exception:
        pass
    return out


class BoardScope:
    """The board a Send builds into: `host` is the board's own component, or the root for the legacy board."""

    def __init__(self, design, host=None):
        self.design = design
        self.root = design.rootComponent
        self.host = host if host is not None else self.root
        self.is_board = not _same(self.host, self.root)
        self.board_id = self._board_id()
        self.namer = (BoardNamer(board_param_prefix(self.board_id)) if self.is_board
                      else BoardNamer("", [board_param_prefix(i) for i in self._board_ids()]))

    def _board_id(self):
        if not self.is_board:
            return ""
        try:
            a = self.host.attributes.itemByName(*BOARD_ATTR)
            return a.value if a is not None else ""
        except Exception:
            return ""

    def _board_ids(self):
        out = []
        try:
            for a in self.design.findAttributes(*BOARD_ATTR) or []:
                if getattr(a, "value", None):
                    out.append(a.value)
        except Exception:
            pass
        return out

    def _boards(self):
        return [b for b in tagged_board_components(self.design) if not _same(b, self.root)]

    def has_boards(self):
        """True if the design holds any tagged board (then every design-wide lookup must be scoped)."""
        return bool(self._boards())

    def owns(self, comp):
        """True if `comp` belongs to this board: inside it (a tagged board), or outside every tagged board (legacy)."""
        if comp is None:
            return False
        # read LIVE every time, never cached: a Send asks before AND after it builds (MEASURED live, S1 check: a cache
        # taken at the delete step missed the frame built right after -- "the frame sketch build created no frame")
        if self.is_board:
            return any(_same(comp, c) for c in subtree_components(self.host))
        return not any(_same(comp, c) for b in self._boards() for c in subtree_components(b))

    def is_direct_child(self, comp):
        """True if `comp` occurs directly under this board's host (where its Set and its Frame_N live)."""
        try:
            return any(_same(o.component, comp) for o in self.host.occurrences)
        except Exception:
            return False

    def root_occurrence_of(self, comp):
        """`comp`'s occurrence in ROOT context (an assembly-context proxy), or None."""
        try:
            for occ in self.root.allOccurrencesByComponent(comp) or []:
                return occ
        except Exception:
            pass
        return None

    def cut_context(self, frame_comp):
        """For a board: (root extrude features, the frame's root-context occurrence) -- the trim cut is built from
        the root with the profile in that context (MEASURED, probe 2). None for the legacy board (unchanged)."""
        if not self.is_board:
            return None
        occ = self.root_occurrence_of(frame_comp)
        if occ is None:
            return None
        return (self.root.features.extrudeFeatures, occ)
