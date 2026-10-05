"""CAM_POSITION -- the one stock + one WCS every B-spline panel setup shares (H23 item 82).

Pure data plus pure math (no adsk import), so it is testable without Fusion.

Why: the Clean and Carved B-spline setups machine the SAME physical part, so they must sit in the exact
same position. Measured 2026-10-05 (WORK-LOG item 82 probe): with a per-setup stock and the stock box
point 'top 1', two setups of one part landed 0.25 in apart; with one fixed box (X/Y centred, Z from the
model bottom) and one declared WCS point, both read back identically, also under flipY.

  stock       one fixed box around the panel: the panel's X/Y extent + margin_xy_in (total, split evenly),
              z_in tall, its bottom on the model bottom (bottom + outline are the same for Clean and Carved).
              The MM-Stock placeholder is built from the same two numbers.
  wcs_points  the shared WCS origins, as corners of that box ('min'/'max' per axis; 'z' is 'top'/'bottom'),
              one per setup side; a setup names its side with spec['wcs_point'].
  op_heights  written on every 3D operation (op_heights['strategies']) of a setup that declares
              spec['op_heights'] = True: Top = Stock top, Bottom = Stock bottom + bottom_offset (Fusion's
              default bottom offset is verticalStockToLeave, 0.5 mm -- measured -- so it is stated here).
"""

CAM_POSITION = {
    'stock': {
        'margin_xy_in': 1.0,     # total; 0.5 in each side (the placeholder's '+ 1 in')
        'z_in':         2.0,     # the placeholder's 2 in
        'xy_mode':      'center',
        'z_mode':       'bottom',
    },
    'wcs_points': {
        'back':    {'x': 'min', 'y': 'min', 'z': 'top'},
        'flipped': {'x': 'min', 'y': 'max', 'z': 'bottom'},
    },
    'op_heights': {
        'top':           "'from stock top'",
        'bottom':        "'from stock bottom'",
        'bottom_offset': '0 in',
        # ONLY these (3D) strategies get the heights: there the bottom height is a limit and the model
        # surface stops the tool. A 2D pocket's bottom IS its design depth -- 'stock bottom' would cut
        # through -- so every strategy not listed keeps its template heights (advisor ruling, item 82).
        # operation.strategy ids; 'adaptive' / 'pocket_clearing' measured, the rest UNVERIFIED until the
        # acceptance log prints the real template strategies.
        'strategies': ('adaptive', 'pocket_clearing', 'morphed_spiral', 'parallel', 'scallop', 'contour',
                       'spiral', 'radial', 'pencil', 'steep_and_shallow', 'flow', 'project', 'ramp',
                       'horizontal', 'blend'),
    },
}

# Name of the hidden sketch holding the WCS points (one sketch per z level is not needed: the points carry z).
WCS_SKETCH_NAME = '__cam_wcs'

IN_CM = 2.54


def stock_box_cm(panel_min_cm, panel_max_cm, position=CAM_POSITION):
    """World box (cm) of the shared stock around a panel bbox given as (x, y, z) min / max in cm.

    X/Y: centred on the panel, grown by margin_xy_in in total. Z: from the panel bottom, z_in tall.
    Returns {'x': (lo, hi), 'y': (lo, hi), 'z': (lo, hi)}.
    """
    st = position['stock']
    half = st['margin_xy_in'] * IN_CM / 2.0
    (x0, y0, z0), (x1, y1, _z1) = panel_min_cm, panel_max_cm
    return {
        'x': (x0 - half, x1 + half),
        'y': (y0 - half, y1 + half),
        'z': (z0, z0 + st['z_in'] * IN_CM),
    }


def wcs_point_cm(box, side, position=CAM_POSITION):
    """(x, y, z) in cm of the declared WCS point for a setup side ('back' / 'flipped') on a stock box."""
    corner = position['wcs_points'][side]
    pick = {'min': 0, 'max': 1, 'bottom': 0, 'top': 1}
    return tuple(box[axis][pick[corner[axis]]] for axis in ('x', 'y', 'z'))


def stock_dims_cm(box):
    """(x, y, z) extents of a stock box in cm."""
    return tuple(box[a][1] - box[a][0] for a in ('x', 'y', 'z'))
