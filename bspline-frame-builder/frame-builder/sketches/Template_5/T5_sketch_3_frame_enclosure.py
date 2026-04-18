import importlib
try:
    from phases import T5_p16_encl_projs, T5_p17_encl_welds, T5_p18_encl_offset, T5_p19_encl_miters, T5_p20_encl_surround_rect
except ImportError:
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import T5_p16_encl_projs, T5_p17_encl_welds, T5_p18_encl_offset, T5_p19_encl_miters, T5_p20_encl_surround_rect

def get_sketch(ui_data=None):
    """
    Sketch 3: Frame Enclosure.
    Phases 16-20 of the global construction sequence.
    """
    # Internal reloads removed to stabilize Fusion 360 module specs.

    return {
        'Name': '3_frame-enclosure',
        'Blocks': [
            T5_p16_encl_projs.get_block(ui_data),
            T5_p17_encl_welds.get_block(ui_data),
            T5_p18_encl_offset.get_block(ui_data),
            T5_p19_encl_miters.get_block(ui_data),
            T5_p20_encl_surround_rect.get_block(ui_data),
        ]
    }



