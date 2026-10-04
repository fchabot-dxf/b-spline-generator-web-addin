def get_block(ui_data=None):
    """
    Silhouette Loop: the 12-piece clockwise I Shape outline (Template 9).

    A capital serif "I": a full-width top flange, a full-width bottom flange,
    and a narrower stem between them, each flange-to-stem transition a square
    (not filleted) step -- Fred's sketch (HANDOFF-ranchy.md backlog: "about 12
    straight bars, with many inside corners"). All straight lines, clockwise
    from the top-left corner:
      top_edge         TL  -> TR                  (the top, full width)
      flange_side_R    TR  -> notch TR outer       (down the flange's right edge)
      shoulder_TR      notch TR outer -> TR inner  (in, to the stem's right edge)
      stem_side_R      TR inner -> BR inner        (down the stem's right edge)
      shoulder_BR      BR inner -> notch BR outer  (out, back to full width)
      flange_side_BR   notch BR outer -> BR        (down to the bottom-right corner)
      bottom_edge      BR -> BL                    (the base, full width)
      flange_side_BL   BL -> notch BL outer        (up the flange's left edge)
      shoulder_BL      notch BL outer -> BL inner  (in, to the stem's left edge)
      stem_side_L      BL inner -> TL inner        (up the stem's left edge)
      shoulder_TL      TL inner -> notch TL outer  (out, back to full width)
      flange_side_TL   notch TL outer -> TL        (up to the top-left corner)
    The 4 INSIDE corners (a shoulder meeting a stem side) are reflex (270 deg).

    Seeds: the 7x9 solve of the app's provisional I Shape (stem half width
    0.45 x hw = 1.4625 in, flange height 0.7 x hh = 2.975 in -- H23 item 79,
    Fred's own pick, up from the original 0.4 x hh = 1.7 in; frame-defs
    shapeModel), as widthIn / heightIn fractions. Each line starts ON its
    corner and ends 0.001 short of the next one (no auto-coincidence before
    the explicit Coincidents of p02_03), matching Template 6's own seed style.

    The two free values (the stem's half width and the flange height) are
    left to the seeds (and, from the app, to the Frame tab's "Stem width" /
    "Flange height" handles, which move these same seeds: FRAME_SEED_MAP).
    No dimension, no parameter.

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    """
    seq = [
        {'ID': 'top_edge',       'Type': 'Line', 'Points': [['-widthIn * 0.464286', 'heightIn * 0.472222'], ['widthIn * 0.464286 - 0.001', 'heightIn * 0.472222']], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'flange_side_R',  'Type': 'Line', 'Points': [['widthIn * 0.464286', 'heightIn * 0.472222'], ['widthIn * 0.464286', 'heightIn * 0.141667 + 0.001']], 'StartID': 'flange_side_R:S', 'EndID': 'flange_side_R:E'},
        {'ID': 'shoulder_TR',    'Type': 'Line', 'Points': [['widthIn * 0.464286', 'heightIn * 0.141667'], ['widthIn * 0.208928 + 0.001', 'heightIn * 0.141667']], 'StartID': 'shoulder_TR:S', 'EndID': 'shoulder_TR:E'},
        {'ID': 'stem_side_R',    'Type': 'Line', 'Points': [['widthIn * 0.208928', 'heightIn * 0.141667'], ['widthIn * 0.208928', '-heightIn * 0.141667 + 0.001']], 'StartID': 'stem_side_R:S', 'EndID': 'stem_side_R:E'},
        {'ID': 'shoulder_BR',    'Type': 'Line', 'Points': [['widthIn * 0.208928', '-heightIn * 0.141667'], ['widthIn * 0.464286 - 0.001', '-heightIn * 0.141667']], 'StartID': 'shoulder_BR:S', 'EndID': 'shoulder_BR:E'},
        {'ID': 'flange_side_BR', 'Type': 'Line', 'Points': [['widthIn * 0.464286', '-heightIn * 0.141667'], ['widthIn * 0.464286', '-heightIn * 0.472222 + 0.001']], 'StartID': 'flange_side_BR:S', 'EndID': 'flange_side_BR:E'},
        {'ID': 'bottom_edge',    'Type': 'Line', 'Points': [['widthIn * 0.464286', '-heightIn * 0.472222'], ['-widthIn * 0.464286 + 0.001', '-heightIn * 0.472222']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},
        {'ID': 'flange_side_BL', 'Type': 'Line', 'Points': [['-widthIn * 0.464286', '-heightIn * 0.472222'], ['-widthIn * 0.464286', '-heightIn * 0.141667 - 0.001']], 'StartID': 'flange_side_BL:S', 'EndID': 'flange_side_BL:E'},
        {'ID': 'shoulder_BL',    'Type': 'Line', 'Points': [['-widthIn * 0.464286', '-heightIn * 0.141667'], ['-widthIn * 0.208928 - 0.001', '-heightIn * 0.141667']], 'StartID': 'shoulder_BL:S', 'EndID': 'shoulder_BL:E'},
        {'ID': 'stem_side_L',    'Type': 'Line', 'Points': [['-widthIn * 0.208928', '-heightIn * 0.141667'], ['-widthIn * 0.208928', 'heightIn * 0.141667 - 0.001']], 'StartID': 'stem_side_L:S', 'EndID': 'stem_side_L:E'},
        {'ID': 'shoulder_TL',    'Type': 'Line', 'Points': [['-widthIn * 0.208928', 'heightIn * 0.141667'], ['-widthIn * 0.464286 + 0.001', 'heightIn * 0.141667']], 'StartID': 'shoulder_TL:S', 'EndID': 'shoulder_TL:E'},
        {'ID': 'flange_side_TL', 'Type': 'Line', 'Points': [['-widthIn * 0.464286', 'heightIn * 0.141667'], ['-widthIn * 0.464286', 'heightIn * 0.472222 - 0.001']], 'StartID': 'flange_side_TL:S', 'EndID': 'flange_side_TL:E'},
    ]
    return {
        'Name': 'Silhouette Loop',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }
