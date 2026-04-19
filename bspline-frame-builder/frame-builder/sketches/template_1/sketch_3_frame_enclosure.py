"""
Sketch 3: Frame Enclosure.
Phases live in ``phases/p03_*.py`` — the loader picks them up by filename.
"""
try:
    from template_loader import load_phase_blocks
except ImportError:
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
    from template_loader import load_phase_blocks


def get_sketch(ui_data=None):
    return {
        "Name": "3_frame-enclosure",
        "Blocks": load_phase_blocks(3, ui_data),
    }
