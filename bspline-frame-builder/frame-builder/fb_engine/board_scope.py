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

BOARD_ATTR = ("Bspline", "board")


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
        self._owned = None

    def _boards(self):
        return [b for b in tagged_board_components(self.design) if not _same(b, self.root)]

    def has_boards(self):
        """True if the design holds any tagged board (then every design-wide lookup must be scoped)."""
        return bool(self._boards())

    def owns(self, comp):
        """True if `comp` belongs to this board: inside it (a tagged board), or outside every tagged board (legacy)."""
        if comp is None:
            return False
        if self.is_board:
            if self._owned is None:
                self._owned = subtree_components(self.host)
            return any(_same(comp, c) for c in self._owned)
        if self._owned is None:
            self._owned = [c for b in self._boards() for c in subtree_components(b)]  # here: what the legacy board does NOT own
        return not any(_same(comp, c) for c in self._owned)

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
