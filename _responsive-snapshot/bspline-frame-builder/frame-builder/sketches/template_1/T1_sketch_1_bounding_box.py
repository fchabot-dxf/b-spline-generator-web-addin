import importlib
try:
    from phases import p01_bb_layout, p02_bb_offset
except ImportError:
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import p01_bb_layout, p02_bb_offset

def get_sketch(ui_data=None):
    """
    Sketch 1: Bounding Box.
    Phases:
      1 p01_bb_layout - Primary model boundary rectangle
      2 p02_bb_offset - Safety zone offset + corner tagging
    """
    # Internal reloads removed to stabilize Fusion 360 module specs.
    # Reloading is now managed at the template level.

    return {
        "Name": "1_bounding-box",
        "Blocks": [
            p01_bb_layout.get_block(ui_data),
            p02_bb_offset.get_block(ui_data)
        ]
    }

