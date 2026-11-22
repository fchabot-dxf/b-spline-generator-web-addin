def get_block(ui_data=None):
    """
    Silhouette Loop: the 4-piece clockwise Trapezoid outline (Template 20).

    Four straight lines, clockwise from the top-left corner (Fusion y up):
      top_edge     top-left -> top-right         (on the safe zone's top line)
      side_R       top-right -> bottom-right
      bottom_edge  bottom-right -> bottom-left   (on the safe zone's bottom line)
      side_L       bottom-left -> top-left

    Seeds: the app's declared default -- the narrow side UP, each narrow end 15%
    of the wide side in from its corner (Left inset = Right inset = 0.3 x hw; the
    app's provisional shapeModel, template_data FRAME_PROVISIONAL_SHAPE). Written
    on the safe zone itself, not as 7x9 board fractions: with no corner pin
    (p02_03) the wide side's own ends ARE these seeds, so they must be exact at
    every board. `widthIn / 2 - 0.25 in` is the safe-zone half width at the
    seeds' own fit offset; fb_engine/seed_basis.py (F14) rewrites widthIn onto
    the seed board, so it is the build's own safe zone at any Trim offset. Each
    line starts ON its corner and ends 0.001 in short of the next one, the top
    0.001 under its line and the base 0.001 above it (no auto-coincidence before
    the explicit welds), as every template's rails.

    The app moves these same four lines to its solved outline on every Send
    (FRAME_SEED_MAP): Left inset / Right inset / Narrow side Up|Down are seeds,
    never a parameter.

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    """
    hw = '(widthIn / 2 - 0.25 in)'
    hh = '(heightIn / 2 - 0.25 in)'
    nx = f'{hw} * 0.7'  # the narrow side's half width: (1 - 0.3) x hw
    seq = [
        {'ID': 'top_edge',    'Type': 'Line', 'Points': [[f'-{nx}', f'{hh} - 0.001'], [f'{nx} - 0.001', f'{hh} - 0.001']], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'side_R',      'Type': 'Line', 'Points': [[nx, f'{hh} - 0.001'], [hw, f'-{hh} + 0.002']], 'StartID': 'side_R:S', 'EndID': 'side_R:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [[f'{hw} - 0.001', f'-{hh} + 0.001'], [f'-{hw} + 0.001', f'-{hh} + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},
        {'ID': 'side_L',      'Type': 'Line', 'Points': [[f'-{hw}', f'-{hh} + 0.002'], [f'-{nx}', f'{hh} - 0.002']], 'StartID': 'side_L:S', 'EndID': 'side_L:E'},
    ]
    return {
        'Name': 'Silhouette Loop',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }
