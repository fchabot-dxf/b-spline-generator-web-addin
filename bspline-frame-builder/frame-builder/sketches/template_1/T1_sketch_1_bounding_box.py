import importlib
try:
    from phases import T1_p01_bb_layout, T1_p02_bb_offset
except ImportError:
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import T1_p01_bb_layout, T1_p02_bb_offset

def get_sketch(ui_data=None):
    """
    Sketch 1: Bounding Box.
    Phases:
      1 T1_p01_bb_layout - Primary model boundary rectangle
      2 T1_p02_bb_offset - Safety zone offset + corner tagging
    """
    # Internal reloads removed to stabilize Fusion 360 module specs.
    # Reloading is now managed at the template level.

    return {
        "Name": "1_bounding-box",
        "Blocks": [
            T1_p01_bb_layout.get_block(ui_data),
            T1_p02_bb_offset.get_block(ui_data)
        ]
    }

