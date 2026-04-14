import importlib
try:
    from phases import T1_p03_projs, T1_p04_anatomy, T1_p05_loop, T1_p06_chain, T1_p07_horns, T1_p08_waist_pins, T1_p09_tangency, T1_p10_horn_tangency, T1_p11_radius_removal, T1_p12_welds, T1_p13_symmetry, T1_p14_drivers
except ImportError:
    # Fallback for different execution contexts
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import T1_p03_projs, T1_p04_anatomy, T1_p05_loop, T1_p06_chain, T1_p07_horns, T1_p08_waist_pins, T1_p09_tangency, T1_p10_horn_tangency, T1_p11_radius_removal, T1_p12_welds, T1_p13_symmetry, T1_p14_drivers

def get_sketch(ui_data=None):
    """
    Sketch 2: Shape Outline.
    Phases 03-14 of the global construction sequence.
    """
    # Internal reloads removed to stabilize Fusion 360 module specs.

    return {
        'Name': '2_shape-outline',
        'Blocks': [
            T1_p03_projs.get_block(ui_data),
            T1_p04_anatomy.get_block(ui_data),
            T1_p05_loop.get_block(ui_data),
            T1_p06_chain.get_block(ui_data),
            T1_p07_horns.get_block(ui_data),
            T1_p08_waist_pins.get_block(ui_data),
            T1_p09_tangency.get_block(ui_data),
            T1_p10_horn_tangency.get_block(ui_data),
            T1_p11_radius_removal.get_block(ui_data),
            T1_p12_welds.get_block(ui_data),
            T1_p13_symmetry.get_block(ui_data),
            T1_p14_drivers.get_block(ui_data),
        ]
    }

