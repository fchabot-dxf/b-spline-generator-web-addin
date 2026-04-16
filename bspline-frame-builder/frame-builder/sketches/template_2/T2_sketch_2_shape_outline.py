import importlib
try:
    from phases import T2_p03_projs, T2_p04_anatomy, T2_p05_lines, T2_p06_arcs, T2_p07_chain, T2_p08_horns, T2_p09_waist_pins, T2_p10_tangency, T2_p11_horn_tangency, T2_p12_radius_removal, T2_p13_welds, T2_p14_symmetry, T2_p15_drivers
except ImportError:
    # Fallback for different execution contexts
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import T2_p03_projs, T2_p04_anatomy, T2_p05_lines, T2_p06_arcs, T2_p07_chain, T2_p08_horns, T2_p09_waist_pins, T2_p10_tangency, T2_p11_horn_tangency, T2_p12_radius_removal, T2_p13_welds, T2_p14_symmetry, T2_p15_drivers

def get_sketch(ui_data=None):
    """
    Sketch 2: Shape Outline.
    Phases 03-15 of the global construction sequence.
    """
    # Internal reloads removed to stabilize Fusion 360 module specs.

    return {
        'Name': '2_shape-outline',
        'Blocks': [
            T2_p03_projs.get_block(ui_data),
            T2_p04_anatomy.get_block(ui_data),
            T2_p05_lines.get_block(ui_data),
            T2_p06_arcs.get_block(ui_data),
            T2_p07_chain.get_block(ui_data),
            T2_p08_horns.get_block(ui_data),
            T2_p09_waist_pins.get_block(ui_data),
            T2_p10_tangency.get_block(ui_data),
            T2_p11_horn_tangency.get_block(ui_data),
            T2_p12_radius_removal.get_block(ui_data),
            T2_p13_welds.get_block(ui_data),
            T2_p14_symmetry.get_block(ui_data),
            T2_p15_drivers.get_block(ui_data),
        ]
    }

