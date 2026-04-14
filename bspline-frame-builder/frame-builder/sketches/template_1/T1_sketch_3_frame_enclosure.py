import importlib
try:
    from phases import T1_p15_encl_projs, T1_p16_encl_welds, T1_p17_encl_offset, T1_p18_encl_miters, T1_p19_encl_surround_rect
except ImportError:
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import T1_p15_encl_projs, T1_p16_encl_welds, T1_p17_encl_offset, T1_p18_encl_miters, T1_p19_encl_surround_rect

def get_sketch(ui_data=None):
    """
    Sketch 3: Frame Enclosure.
    Phases 15-19 of the global construction sequence.
    """
    # Internal reloads removed to stabilize Fusion 360 module specs.

    return {
        'Name': '3_frame-enclosure',
        'Blocks': [
            T1_p15_encl_projs.get_block(ui_data),
            T1_p16_encl_welds.get_block(ui_data),
            T1_p17_encl_offset.get_block(ui_data),
            T1_p18_encl_miters.get_block(ui_data),
            T1_p19_encl_surround_rect.get_block(ui_data),
        ]
    }



