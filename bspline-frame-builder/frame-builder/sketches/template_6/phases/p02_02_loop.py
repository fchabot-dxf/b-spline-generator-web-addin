def get_block(ui_data=None):
    """
    Silhouette Loop: the 8-piece clockwise Tab Top outline (Template 6).

    A rectangle with a narrower rectangular tab centred on top, all
    straight lines, clockwise from the tab's top-left corner:
      tab_top      tab top-left  -> tab top-right      (on the safe zone's top line)
      tab_side_R   tab top-right -> right inside corner (down)
      shoulder_R   right inside corner -> right shoulder corner (out, right)
      side_R       right shoulder corner -> bottom-right corner (down)
      bottom_edge  bottom-right -> bottom-left          (the base, on the safe zone's bottom corners)
      side_L       bottom-left -> left shoulder corner   (up)
      shoulder_L   left shoulder corner -> left inside corner (in, right)
      tab_side_L   left inside corner -> tab top-left    (up)
    The two INSIDE corners (shoulder meets tab side) are reflex (270 deg).

    Seeds: the 7x9 solve of the app's provisional Tab Top (tab half width
    0.5 x hw = 1.625 in, tab height 0.5 x hh = 2.125 in; frame-defs
    shapeModel), as widthIn / heightIn fractions. Each line starts ON its
    corner and ends 0.001 short of the next one (no auto-coincidence before
    the explicit Coincidents of p02_03). The tab top sits just under the
    safe-zone top line (heightIn * 0.47 vs 0.472222 at 9 in) and the base
    0.001 above its projected corners, as Template 2's rails.

    The two free values (the tab's half width and its height) are left to
    the seeds (and, from the app, to the Frame tab's "Tab width" / "Tab
    height" handles, which move these same seeds: FRAME_SEED_MAP). No
    dimension, no parameter.

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    """
    seq = [
        {'ID': 'tab_top',     'Type': 'Line', 'Points': [['-widthIn * 0.232143', 'heightIn * 0.47'], ['widthIn * 0.232143 - 0.001', 'heightIn * 0.47']], 'StartID': 'tab_top:S', 'EndID': 'tab_top:E'},
        {'ID': 'tab_side_R',  'Type': 'Line', 'Points': [['widthIn * 0.232143', 'heightIn * 0.47'], ['widthIn * 0.232143', 'heightIn * 0.236111 + 0.001']], 'StartID': 'tab_side_R:S', 'EndID': 'tab_side_R:E'},
        {'ID': 'shoulder_R',  'Type': 'Line', 'Points': [['widthIn * 0.232143', 'heightIn * 0.236111'], ['widthIn * 0.464286 - 0.001', 'heightIn * 0.236111']], 'StartID': 'shoulder_R:S', 'EndID': 'shoulder_R:E'},
        {'ID': 'side_R',      'Type': 'Line', 'Points': [['widthIn * 0.464286', 'heightIn * 0.236111'], ['widthIn * 0.464286', '(-heightIn * 0.472222) + 0.002']], 'StartID': 'side_R:S', 'EndID': 'side_R:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn * 0.464286 - 0.001', '(-heightIn * 0.472222) + 0.001'], ['-widthIn * 0.464286 + 0.001', '(-heightIn * 0.472222) + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},
        {'ID': 'side_L',      'Type': 'Line', 'Points': [['-widthIn * 0.464286', '(-heightIn * 0.472222) + 0.002'], ['-widthIn * 0.464286', 'heightIn * 0.236111 - 0.001']], 'StartID': 'side_L:S', 'EndID': 'side_L:E'},
        {'ID': 'shoulder_L',  'Type': 'Line', 'Points': [['-widthIn * 0.464286', 'heightIn * 0.236111'], ['-widthIn * 0.232143 - 0.001', 'heightIn * 0.236111']], 'StartID': 'shoulder_L:S', 'EndID': 'shoulder_L:E'},
        {'ID': 'tab_side_L',  'Type': 'Line', 'Points': [['-widthIn * 0.232143', 'heightIn * 0.236111'], ['-widthIn * 0.232143', 'heightIn * 0.47 - 0.001']], 'StartID': 'tab_side_L:S', 'EndID': 'tab_side_L:E'},
    ]
    return {
        'Name': 'Silhouette Loop',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }
