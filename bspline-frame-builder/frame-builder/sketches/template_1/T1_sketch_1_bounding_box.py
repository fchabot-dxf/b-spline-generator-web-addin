import importlib
try:
    from phases import p0a_bb_rect, p0b_bb_offset
except ImportError:
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import p0a_bb_rect, p0b_bb_offset

def get_sketch(ui_data=None):
    """
    Sketch 1: Bounding Box.
    Modular refactor into phased building blocks.
    
    Phases:
      0a p0a_bb_rect   - Primary model boundary rectangle
      0b p0b_bb_offset - Safety zone offset + corner tagging
    """
    for m in [p0a_bb_rect, p0b_bb_offset]:
        importlib.reload(m)

    return {
        "Name": "1_bounding-box",
        "Blocks": [
            p0a_bb_rect.get_block(ui_data),
            p0b_bb_offset.get_block(ui_data)
        ]
    }
