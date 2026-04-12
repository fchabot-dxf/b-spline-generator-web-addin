import importlib
try:
    from phases import p03_projs, p04_anatomy, p05_loop, p06_chain, p07_horns, p08_waist_pins, p09_tangency, p10_horn_tangency, p11_radius_removal, p12_welds, p13_drivers
except ImportError:
    # Fallback for different execution contexts
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import p03_projs, p04_anatomy, p05_loop, p06_chain, p07_horns, p08_waist_pins, p09_tangency, p10_horn_tangency, p11_radius_removal, p12_welds, p13_drivers

def get_sketch(ui_data=None):
    """
    Sketch 2: Shape Outline.
    Phases 03-13 of the global construction sequence.
    """
    for m in [p03_projs, p04_anatomy, p05_loop, p06_chain, p07_horns, p08_waist_pins, p09_tangency, p10_horn_tangency, p11_radius_removal, p12_welds, p13_drivers]:
        importlib.reload(m)

    return {
        'Name': '2_shape-outline',
        'Blocks': [
            p03_projs.get_block(ui_data),
            p04_anatomy.get_block(ui_data),
            p05_loop.get_block(ui_data),
            p06_chain.get_block(ui_data),
            p07_horns.get_block(ui_data),
            p08_waist_pins.get_block(ui_data),
            p09_tangency.get_block(ui_data),
            p10_horn_tangency.get_block(ui_data),
            p11_radius_removal.get_block(ui_data),
            p12_welds.get_block(ui_data),
            p13_drivers.get_block(ui_data),
        ]
    }

