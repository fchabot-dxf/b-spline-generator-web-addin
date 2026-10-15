"""Send targets (seat A 2026-10-14; advisor 45, Fred): one Send menu, one path.

    replace       the project's own board: the tagged board component with the project's boardId, else the LEGACY
                  untagged root board (today's Send, unchanged); clears only that board
    newComponent  a NEW board component in this design, tagged with the project's (fresh) boardId, offset beside
                  the right-most content by BOARD_SPACING_IN; clears nothing
    newDocument   a new Fusion document (the other documents are never closed or modified); a legacy-layout Send into it

The palette mints the boardId (main/send-targets.js); a project's next replace targets the board it last created.
`locked` (the job timeline's playhead, coming): names a replace must not touch -- a locked B-Spline Set / frame is
kept, never deleted (`is_locked`).
"""

SEND_TARGET_PLAN = {
    "replace": {"where": "own", "clears_own": True},
    "newComponent": {"where": "new", "clears_own": False},
    "newDocument": {"where": "newDoc", "clears_own": False},
}
DEFAULT_SEND_TARGET = "replace"
BOARD_SPACING_IN = 2.0  # the gap between a new board and the right-most content already in the design


def send_target_of(data):
    """The payload's declared target (absent = replace, today's Send); an unknown one is refused (ValueError)."""
    target = (data or {}).get("target") or DEFAULT_SEND_TARGET
    if target not in SEND_TARGET_PLAN:
        raise ValueError(f"Unknown Send target {target!r}: one of {', '.join(SEND_TARGET_PLAN)}.")
    return target


def board_of(data):
    """The payload's board: {'id', 'name'} (id '' = a project that has none yet)."""
    b = (data or {}).get("board") or {}
    return {"id": str(b.get("id") or ""), "name": str(b.get("name") or "").strip() or "Board"}


def locked_of(data):
    """The names a replace must not touch (sketches / setups / components), as a set."""
    return {str(n) for n in ((data or {}).get("locked") or []) if n}


def is_locked(name, locked):
    return bool(locked) and str(name) in locked


def find_board_component(design, board_id, tagged_boards):
    """The component tagged with `board_id` (BOARD_ATTR's value), or None. `tagged_boards(design)` lists the tagged
    components (fb_engine.board_scope.tagged_board_components)."""
    if not board_id:
        return None
    for comp in tagged_boards(design):
        try:
            a = comp.attributes.itemByName("Bspline", "board")
            if a is not None and a.value == board_id:
                return comp
        except Exception:
            continue
    return None


def new_board_offset_in(content_max_x_in, width_in, spacing_in=BOARD_SPACING_IN):
    """The X translation (inches) of a new board: its left edge `spacing_in` past the right-most content. A board's
    geometry is centred on its own origin, so the origin goes half its width further. Empty design: 0."""
    if content_max_x_in is None:
        return 0.0
    return float(content_max_x_in) + float(spacing_in) + float(width_in) / 2.0
