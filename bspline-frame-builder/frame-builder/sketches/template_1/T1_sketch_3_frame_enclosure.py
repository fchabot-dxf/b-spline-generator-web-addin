import importlib
try:
    from phases import p14_encl_projs, p15_encl_offset, p16_encl_miters
except ImportError:
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import p14_encl_projs, p15_encl_offset, p16_encl_miters

def get_sketch(ui_data=None):
    """
    Sketch 3: Frame Enclosure.
    Phases 14-16 of the global construction sequence.
    """
    for m in [p14_encl_projs, p15_encl_offset, p16_encl_miters]:
        importlib.reload(m)

    return {
        'Name': '3_frame-enclosure',
        'Blocks': [
            p14_encl_projs.get_block(ui_data),
            p15_encl_offset.get_block(ui_data),
            p16_encl_miters.get_block(ui_data),
        ]
    }
