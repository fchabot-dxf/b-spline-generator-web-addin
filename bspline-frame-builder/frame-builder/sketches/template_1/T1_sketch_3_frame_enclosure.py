import importlib
try:
    from phases import p8_encl_projs, p9_encl_offset, p10_encl_miters
except ImportError:
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import p8_encl_projs, p9_encl_offset, p10_encl_miters

def get_sketch(ui_data=None):
    """
    Sketch 3: Frame Enclosure.
    Dedicated sketch for the inner wall offset and mitered enclosure.
    Projects derived geometry from Sketch 2 to ensure topological continuity.
    """
    for m in [p8_encl_projs, p9_encl_offset, p10_encl_miters]:
        importlib.reload(m)

    return {
        'Name': '3_frame-enclosure',
        'Blocks': [
            p8_encl_projs.get_block(ui_data),
            p9_encl_offset.get_block(ui_data),
            p10_encl_miters.get_block(ui_data),
        ]
    }
