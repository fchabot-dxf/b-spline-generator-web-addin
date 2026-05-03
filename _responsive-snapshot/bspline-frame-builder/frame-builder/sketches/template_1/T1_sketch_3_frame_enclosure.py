import importlib
try:
    from phases import p15_encl_projs, p16_encl_welds, p17_encl_offset, p18_encl_miters, p19_encl_surround_rect
except ImportError:
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import p15_encl_projs, p16_encl_welds, p17_encl_offset, p18_encl_miters, p19_encl_surround_rect

def get_sketch(ui_data=None):
    """
    Sketch 3: Frame Enclosure.
    Phases 15-19 of the global construction sequence.
    """
    # Internal reloads removed to stabilize Fusion 360 module specs.

    return {
        'Name': '3_frame-enclosure',
        'Blocks': [
            p15_encl_projs.get_block(ui_data),
            p16_encl_welds.get_block(ui_data),
            p17_encl_offset.get_block(ui_data),
            p18_encl_miters.get_block(ui_data),
            p19_encl_surround_rect.get_block(ui_data),
        ]
    }



